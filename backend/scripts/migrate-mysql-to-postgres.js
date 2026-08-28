/**
 * One-shot data migration: MySQL -> PostgreSQL.
 *
 * Run on the server, after `node db/migrate.js` has created the schema:
 *   node scripts/migrate-mysql-to-postgres.js            # dry run, counts only
 *   node scripts/migrate-mysql-to-postgres.js --apply    # copies
 *
 * Reads MySQL through the legacy MYSQL_* variables so both databases can be
 * configured at once during the cutover; they can be deleted afterwards.
 *
 * Five MySQL tables are intentionally not copied — fabrics,
 * fabric_count_formulas, fabric_patterns, formula_history and
 * yarn_count_lookup. Nothing in the codebase queries them.
 *
 * Safe to re-run: every insert is ON CONFLICT DO NOTHING, keyed on the natural
 * unique column, so a partial run can simply be repeated.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const { query, transaction, close } = require('../db/client');

const APPLY = process.argv.includes('--apply');

function mysqlConfig() {
  const missing = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASS', 'MYSQL_NAME'].filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Missing MySQL env vars for the migration: ${missing.join(', ')}`);
  return {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_NAME,
    port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
    connectTimeout: 20000,
  };
}

// MySQL TINYINT(1) comes back as 0/1; Postgres wants real booleans.
const bool = v => v === 1 || v === true || v === '1';

// parsed_gsm was SMALLINT UNSIGNED in MySQL, which silently clamps anything
// larger to 65535 instead of rejecting it — a request with gsm 999999 was
// recorded as 65535, a number that looks real and is not. The Postgres CHECK
// rejects those rows outright, so rather than widening the constraint to admit
// the bad data, out-of-range values are imported as NULL: "we did not record a
// usable GSM" is the truth, and 65535 is not.
let clampedGsm = 0;
function gsm(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 20000) { clampedGsm++; return null; }
  return n;
}
// LONGTEXT columns held JSON strings; jsonb wants either an object or valid
// JSON text. Anything unparseable is dropped rather than aborting the row.
function json(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  try { JSON.parse(v); return v; } catch { return null; }
}

/**
 * Order matters: ai_provider_stats before its keys and models (foreign keys),
 * and the self-referencing current_model_id / current_key_id are cleared on
 * insert and repaired at the end, once both sides exist.
 */
const TABLES = [
  {
    name: 'admin_users',
    select: 'SELECT username, password_hash, created_at FROM admin_users',
    insert: `INSERT INTO admin_users (username, password_hash, created_at)
             VALUES ($1,$2,coalesce($3, now())) ON CONFLICT (username) DO NOTHING`,
    map: r => [r.username, r.password_hash, r.created_at],
    // The Postgres schema rejects bare 64-hex (unsalted SHA-256) hashes. A row
    // still on the legacy format cannot be carried over; the account is
    // re-seeded with a fresh random password instead.
    skip: r => /^[0-9a-f]{64}$/i.test(r.password_hash || ''),
    skipReason: 'legacy unsalted SHA-256 hash — will be re-seeded',
  },
  {
    name: 'ai_provider_stats',
    select: 'SELECT * FROM ai_provider_stats',
    insert: `INSERT INTO ai_provider_stats
               (provider_name, display_name, provider_type, priority, daily_limit, per_min_limit,
                tokens_today, requests_today, failures_today, is_healthy, is_enabled,
                last_failure_at, cooldown_until, api_key_env, api_key_source, model_name, api_url,
                model_switching_enabled, key_switching_enabled)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
             ON CONFLICT (provider_name) DO NOTHING`,
    map: r => [r.provider_name, r.display_name || null, r.provider_type || r.provider_name,
               r.priority, r.daily_limit, r.per_min_limit, r.tokens_today, r.requests_today,
               r.failures_today, bool(r.is_healthy), bool(r.is_enabled), r.last_failure_at,
               r.cooldown_until, r.api_key_env, r.api_key_source || 'env', r.model_name, r.api_url,
               bool(r.model_switching_enabled), bool(r.key_switching_enabled)],
  },
  {
    name: 'ai_provider_keys',
    select: `SELECT k.*, p.provider_name FROM ai_provider_keys k
             JOIN ai_provider_stats p ON p.id = k.provider_id`,
    insert: `INSERT INTO ai_provider_keys
               (provider_id, key_index, api_key_encrypted, is_active, is_healthy,
                failures_today, tokens_today, last_used_at, cooldown_until, created_at)
             VALUES ((SELECT id FROM ai_provider_stats WHERE provider_name = $1),
                     $2,$3,$4,$5,$6,$7,$8,$9,coalesce($10, now()))
             ON CONFLICT (provider_id, key_index) DO NOTHING`,
    map: r => [r.provider_name, r.key_index, r.api_key_encrypted, bool(r.is_active),
               bool(r.is_healthy), r.failures_today, r.tokens_today, r.last_used_at,
               r.cooldown_until, r.created_at],
    skip: r => !String(r.api_key_encrypted || '').includes(':'),
    skipReason: 'not in ivHex:cipherHex form — would violate the encrypted-shape constraint',
  },
  {
    name: 'ai_provider_models',
    select: `SELECT m.*, p.provider_name FROM ai_provider_models m
             JOIN ai_provider_stats p ON p.id = m.provider_id`,
    insert: `INSERT INTO ai_provider_models
               (provider_id, model_name, is_active, is_healthy, avg_response_ms,
                requests_today, failures_today, last_failure_at, cooldown_until, created_at)
             VALUES ((SELECT id FROM ai_provider_stats WHERE provider_name = $1),
                     $2,$3,$4,$5,$6,$7,$8,$9,coalesce($10, now()))
             ON CONFLICT (provider_id, model_name) DO NOTHING`,
    map: r => [r.provider_name, r.model_name, bool(r.is_active), bool(r.is_healthy),
               r.avg_response_ms || 0, r.requests_today || 0, r.failures_today || 0,
               r.last_failure_at, r.cooldown_until, r.created_at],
  },
  {
    name: 'ai_provider_config',
    select: 'SELECT cfg_key, cfg_value FROM ai_provider_config',
    insert: `INSERT INTO ai_provider_config (cfg_key, cfg_value) VALUES ($1,$2)
             ON CONFLICT (cfg_key) DO NOTHING`,
    map: r => [r.cfg_key, r.cfg_value],
  },
  {
    name: 'ai_provider_meta',
    select: 'SELECT meta_key, meta_value FROM ai_provider_meta',
    insert: `INSERT INTO ai_provider_meta (meta_key, meta_value) VALUES ($1,$2)
             ON CONFLICT (meta_key) DO NOTHING`,
    map: r => [r.meta_key, r.meta_value],
  },
  {
    name: 'viz_configs',
    select: 'SELECT * FROM viz_configs',
    insert: `INSERT INTO viz_configs
               (fabric_id, fabric_category, machine_type, sheen_model, loop_head_ratio,
                loop_height_ratio, foot_splay_ratio, layer_count, bar_colors, animate_default)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (fabric_id) DO NOTHING`,
    map: r => [r.fabric_id, r.fabric_category, r.machine_type, r.sheen_model,
               r.loop_head_ratio, r.loop_height_ratio, r.foot_splay_ratio,
               r.layer_count, json(r.bar_colors), bool(r.animate_default)],
  },
  {
    name: 'result_cache',
    select: 'SELECT * FROM result_cache WHERE expires_at > NOW()',
    insert: `INSERT INTO result_cache (cache_key, result_json, hit_count, created_at, last_hit, expires_at)
             VALUES ($1,$2,$3,coalesce($4, now()),coalesce($5, now()),$6)
             ON CONFLICT (cache_key) DO NOTHING`,
    map: r => [r.cache_key, json(r.result_json), r.hit_count || 0, r.created_at, r.last_hit, r.expires_at],
    skip: r => json(r.result_json) === null,
    skipReason: 'result_json is not valid JSON',
  },
  {
    name: 'viz_render_cache',
    select: 'SELECT * FROM viz_render_cache WHERE expires_at > NOW()',
    insert: `INSERT INTO viz_render_cache (cache_key, fabric_id, path_json, render_ms, hit_count, created_at, last_hit, expires_at)
             VALUES ($1,$2,$3,$4,$5,coalesce($6, now()),$7,$8)
             ON CONFLICT (cache_key) DO NOTHING`,
    map: r => [r.cache_key, r.fabric_id, json(r.path_json), r.render_ms, r.hit_count || 0,
               r.created_at, r.last_hit, r.expires_at],
    skip: r => json(r.path_json) === null,
    skipReason: 'path_json is not valid JSON',
  },
  {
    name: 'query_logs',
    select: 'SELECT * FROM query_logs ORDER BY id',
    insert: `INSERT INTO query_logs
               (input_text, input_type, parsed_fabric, parsed_gsm, parsed_dia, parsed_gauge,
                result_json, response_ms, from_cache, cache_key, ai_provider, ai_tokens_used,
                ip_hash, user_agent, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15, now()))`,
    map: r => [r.input_text, r.input_type || 'form', r.parsed_fabric, gsm(r.parsed_gsm), r.parsed_dia,
               r.parsed_gauge, json(r.result_json), r.response_ms, bool(r.from_cache), r.cache_key,
               r.ai_provider, r.ai_tokens_used, r.ip_hash, (r.user_agent || '').slice(0, 200) || null,
               r.created_at],
    // No natural key, so a re-run would duplicate. Guarded below.
    guard: async () => {
      const [{ n }] = await query('SELECT count(*)::int AS n FROM query_logs');
      if (n > 0) return `query_logs already has ${n} row(s) — skipping to avoid duplicates`;
      return null;
    },
  },
];

async function main() {
  console.log(`MySQL -> PostgreSQL data migration (${APPLY ? 'APPLY' : 'DRY RUN'})\n`);

  const my = await mysql.createConnection(mysqlConfig());
  const summary = [];

  try {
    for (const t of TABLES) {
      let rows;
      try {
        [rows] = await my.query(t.select);
      } catch (err) {
        summary.push({ table: t.name, status: 'SOURCE MISSING', detail: err.code });
        continue;
      }

      if (t.guard) {
        const reason = await t.guard();
        if (reason) { summary.push({ table: t.name, read: rows.length, status: 'SKIPPED', detail: reason }); continue; }
      }

      const skipped = [];
      const usable = rows.filter(r => {
        if (t.skip && t.skip(r)) { skipped.push(r); return false; }
        return true;
      });

      let written = 0;
      if (APPLY && usable.length) {
        await transaction(async (q) => {
          for (const r of usable) { await q(t.insert, t.map(r)); written++; }
        });
      }

      summary.push({
        table: t.name,
        read: rows.length,
        eligible: usable.length,
        written: APPLY ? written : 0,
        skipped: skipped.length,
        detail: skipped.length ? t.skipReason : '',
      });
    }

    // Repair the self-references now that providers, keys and models all exist.
    if (APPLY) {
      await query(`
        UPDATE ai_provider_stats p
        SET current_model_id = m.id
        FROM ai_provider_models m
        WHERE m.provider_id = p.id AND m.model_name = p.model_name AND p.current_model_id IS NULL`);
      await query(`
        UPDATE ai_provider_stats p
        SET current_key_id = k.id
        FROM ai_provider_keys k
        WHERE k.provider_id = p.id AND k.key_index = 1 AND p.current_key_id IS NULL`);
      await query('SELECT refresh_analytics()');
    }
  } finally {
    await my.end();
  }

  console.log('table                  read  eligible  written  skipped  note');
  console.log('-'.repeat(90));
  for (const s of summary) {
    console.log(
      `${String(s.table).padEnd(22)} ${String(s.read ?? '-').padStart(4)} ` +
      `${String(s.eligible ?? '-').padStart(9)} ${String(s.written ?? '-').padStart(8)} ` +
      `${String(s.skipped ?? '-').padStart(8)}  ${s.status ? s.status + ': ' : ''}${s.detail || ''}`
    );
  }

  if (!APPLY) console.log('\nDry run — re-run with --apply to write.');
}

main()
  .catch(err => { console.error('\n[Migrate] ' + err.message); process.exitCode = 1; })
  .finally(() => close());
