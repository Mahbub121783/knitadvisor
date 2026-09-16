/**
 * Knowledge Assistant indexer — builds/refreshes knowledge_chunks from this
 * app's own existing, already-safe-to-show knowledge sources.
 *
 *   node scripts/build-knowledge-index.js            embed + upsert changed/new chunks
 *   node scripts/build-knowledge-index.js --dry-run   build + print chunks, no embedding/DB writes
 *
 * WHERE THE CONTENT COMES FROM (and why only these)
 * ---------------------------------------------------
 * Every source below is read through the SAME exported function the app's
 * own API routes already use to serve it publicly — never a raw data/*.json
 * read — because dyeing-faults-engine.js (and its sibling modules) strip an
 * internal-only `source_key` field before their content leaves the module
 * (see knitadvisor-no-source-links: external research provenance must never
 * reach an API response or a rendered page). Reading the same getters those
 * routes call means this indexer inherits that stripping automatically
 * instead of having to re-implement it. `flattenToText` below drops any
 * stray `source_key` a second time as defense in depth.
 *
 * Fibre advisory (engine/domain/fibre-advisory.js) is deliberately NOT
 * indexed here: its findings are generated per-request from a user's actual
 * composition/process inputs, not a static catalog — there is no fixed
 * "the findings" to embed ahead of time.
 *
 * IDEMPOTENCY: each chunk's content is SHA-256'd; a chunk whose hash matches
 * what is already stored is skipped (no re-embedding, no cost) — see
 * knowledgeRepo.existingHashes().
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const knowledgeRepo = require('../db/repositories/knowledge-repo');
const multiProviderEmbed = require('../ai/multi-provider-embed');
const { close } = require('../db/client');

const { FAULTS_DATABASE } = require('../engine/domain/faults-engine');
const { getDyeingKnowledge } = require('../engine/domain/dyeing-faults-engine');
const { getDyeingTheory } = require('../engine/domain/dyeing-theory-engine');
const { GLOSSARY, BASIC_ELEMENTS, FORMATION_CYCLES } = require('../engine/domain/academy-engine');

const DRY_RUN = process.argv.includes('--dry-run');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Generic, format-agnostic flatten: turns any nested value into readable
 * text good enough for an LLM to read as context. Drops `source_key` again
 * as a second, independent safety net beyond each module's own stripping. */
function flattenToText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenToText).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([k]) => k !== 'source_key' && k !== 'source_url')
      .map(([k, v]) => `${k}: ${flattenToText(v)}`)
      .join('. ');
  }
  return '';
}

function chunk(sourceModule, sourceRef, title, content) {
  return { sourceModule, sourceRef: String(sourceRef), title, content: content.trim() };
}

// ============================================================================
// HAND-AUTHORED METHODOLOGY SUMMARIES
//
// This app's own costing/consumption engines carry real sourcing detail only
// in code comments (see garment-costing-engine.js, fabric-consumption-
// engine.js, bd-wage-board.js) — there is no exported narrative string to
// pull automatically. These summaries are this indexer's own words,
// restating what those files already document, so "how does KnitAdvisor
// calculate CMT cost" is answerable without reading source code.
// ============================================================================
function authoredChunks() {
  return [
    chunk('methodology', 'sam_cmt_costing',
      'How KnitAdvisor calculates garment Cut-Make-Trim (CMT) cost',
      `KnitAdvisor builds a garment's sewing labor cost from Standard Allowed Minutes (SAM), not a flat per-piece guess. SAM = Basic Time x 1.30, where the 1.30 allowance factor is a 10% bundle allowance plus a 20% machine/personal allowance — a standard industry formula (onlineclothingstudy.com, textilelearner.net). Basic Time is the sum of named sewing operations (e.g. shoulder join, sleeve attach, hem) built to land on a published total-SAM benchmark for that garment type (basic T-shirt ~8.5 min, polo ~10.4 min, hoodie ~16.0 min, jogger ~11.65 min). Labor cost per garment = (SAM x cost-per-minute-at-100%-efficiency) / line-efficiency-fraction, where cost-per-minute-at-100% = the wage grade's monthly gross wage / standard working minutes per month (26 days x 8 hours x 60 = 12,480). Wage grades come from the Bangladesh Minimum Wage Board's December 2023 gazette (5 grades, Tk 12,500 floor at Grade 5 up to Tk 14,750 at Grade 1). Line efficiency defaults to 60% (INDUSTRY_TYPICAL — real range documented 43-82%). Cutting-room labor is estimated as a percentage of sewing SAM (default 8%, garment-complexity-aware). Trim costs (labels, hangtag, thread, packing) are named line items, not a lump sum. The final FOB total adds overhead (default 10%) and profit (default 10%) on top of fabric + CMT.`),

    chunk('methodology', 'fabric_consumption_gross_up',
      'How KnitAdvisor turns a garment\'s net fabric weight into what a factory actually buys',
      `A garment's NET fabric weight (what ends up sewn into the finished piece) is not what a factory has to purchase. KnitAdvisor grosses it up using four named, independently-sourced allowance percentages, summed and applied once: (1) Marker/lay-planning cutting loss — keyed to garment style complexity (13% for a plain T-shirt up to 20% for a multi-panel hoodie), based on published marker efficiency of 80-90% (i.e. 10-20% loss), lower for styles with many small/curved panels. (2) Rejection/damage — fabric holes, shading-off, spreading defects forcing a re-cut, published range 3-5%, default 4%. (3) End-bit/remnant loss — unusable fabric at the end of each roll, published range 1-3%, default 2%. (4) GSM tolerance buffer — a buffer against the mill's own delivered-GSM tolerance (commonly +-3 to 5%), default 3%. Total default wastage is therefore around 20-25% depending on garment type. On top of the per-garment gross-up, a one-time sample & development fabric allocation (lab-dip, fit, PP and size-set sampling, cut at lower manual efficiency) is calculated and, when an order quantity is given, amortized into a per-garment addition. The formula shape (Total consumption = Net consumption x (1 + Wastage%)) is the standard industry approach (onlineclothingstudy.com, garmentcalc.com).`),

    chunk('methodology', 'single_jersey_derivative_classification',
      'Why fleece, terry, pique and other structures are classified under single jersey',
      `KnitAdvisor classifies fleece, terry (loop-pile terry), pique and several other fabrics as single-jersey derivatives because they are all produced on the same single-bed (single-cylinder) circular knitting machine family as plain single jersey, using the same basic knit-loop formation, with the difference being an added inlay/pile yarn (terry, fleece) or a tuck/miss stitch variation in the needle selection pattern (pique). This is a structural classification based on the machine bed configuration and base loop type, not a finish or hand-feel classification — a fabric that FEELS very different from plain jersey (like brushed fleece) can still be a single-jersey derivative if it never used a second needle bed. Double-bed structures (rib, interlock, and their own derivatives like waffle and pointelle) are classified separately for the same reason: they require two opposing needle beds.`),

    chunk('methodology', 'dyeing_hybrid_costing_model',
      'Why KnitAdvisor\'s dyeing cost for a REAL_RECIPE shade is not just the price-list figure',
      `When a shade matches one of KnitAdvisor's real, cost-verified factory dyeing recipe cards (source REAL_RECIPE), the displayed cost is a hybrid: the official dyeing price-list conversion PLUS the real chemical cost from that recipe, where the chemical cost is assumed to represent a fixed share (17%, sourced) of the total dyeing cost. This hybrid exists because the bare recipe-card chemical figure alone understates real dyeing cost (it excludes machine time, labor, utilities, overhead already baked into the price list), while the price-list figure alone ignores the real, verified chemical dosing a specific shade actually needs. All dollar figures in KnitAdvisor are shown USD-primary.`),

    chunk('methodology', 'country_costing_model',
      'How KnitAdvisor prices fabric for a country other than its Bangladesh anchor',
      `Bangladesh is KnitAdvisor's quoted cost anchor — its yarn, knitting, dyeing and finishing figures come from real dated market quotes and a factory price list. For every other country, ONLY the yarn/energy-sensitive portion of cost is modelled, using that country's published industrial electricity tariff compared against Bangladesh's — never a marketing-page fabric price table, which is not a comparable, sourced figure. Knitting, dyeing and finishing costs stay the SAME price-list numbers regardless of country, because no free, dated, per-country source exists for those steps the way it does for electricity tariffs.`),
  ];
}

function buildChunks() {
  const chunks = [];

  // ---- Knit (weft) faults ----
  for (const f of FAULTS_DATABASE) {
    const content = [
      f.description,
      f.yarn_causes?.length ? `Yarn-related causes: ${f.yarn_causes.join('; ')}.` : '',
      f.machine_causes?.length ? `Machine-related causes: ${f.machine_causes.join('; ')}.` : '',
      f.remedies?.length ? `Remedies: ${f.remedies.join('; ')}.` : '',
    ].filter(Boolean).join(' ');
    chunks.push(chunk('knit_faults', f.id, f.name, content));
  }

  // ---- Dyeing faults + QC knowledge (already source_key-stripped by the module) ----
  const dk = getDyeingKnowledge();
  for (const f of dk.faults) {
    const content = [
      f.causes?.length ? `Causes: ${f.causes.join('; ')}.` : '',
      f.remedies?.length ? `Remedies: ${f.remedies.join('; ')}.` : '',
    ].filter(Boolean).join(' ');
    chunks.push(chunk('dyeing_faults', f.id, f.name, content));
  }
  if (dk.qc_framework) chunks.push(chunk('dyeing_qc', 'shade_variation_checklist', dk.qc_framework.title, flattenToText(dk.qc_framework)));
  if (dk.process_checkpoints) chunks.push(chunk('dyeing_qc', 'process_checkpoints', dk.process_checkpoints.title, flattenToText(dk.process_checkpoints)));
  if (dk.salt_comparison) chunks.push(chunk('dyeing_qc', 'salt_comparison', dk.salt_comparison.title, flattenToText(dk.salt_comparison)));

  // ---- Dyeing theory ----
  const theory = getDyeingTheory();
  for (const d of theory.dye_classes || []) chunks.push(chunk('dyeing_theory', `dye_class_${d.key}`, d.name, flattenToText(d)));
  for (const m of theory.machines || []) chunks.push(chunk('dyeing_theory', `machine_${m.key}`, m.name, flattenToText(m)));
  for (const p of theory.process_flows || []) chunks.push(chunk('dyeing_theory', `process_flow_${p.key}`, p.name, flattenToText(p)));
  if (theory.fastness) chunks.push(chunk('dyeing_theory', 'fastness', theory.fastness.title || 'Fastness Testing Theory', flattenToText(theory.fastness)));

  // ---- Academy: glossary, machine elements, loop-formation cycles ----
  for (const [key, entry] of Object.entries(GLOSSARY || {})) {
    chunks.push(chunk('academy_glossary', key, entry.term, entry.definition + (entry.page ? ` (Textbook page ${entry.page}.)` : '')));
  }
  for (const [category, items] of Object.entries(BASIC_ELEMENTS || {})) {
    for (const [key, entry] of Object.entries(items || {})) {
      chunks.push(chunk('academy_elements', `${category}_${key}`, entry.name || `${category} - ${key}`, flattenToText(entry)));
    }
  }
  for (const [cycleType, stages] of Object.entries(FORMATION_CYCLES || {})) {
    const content = (stages || []).map(s => `Stage ${s.stage} (${s.name}): ${s.desc}`).join(' ');
    chunks.push(chunk('academy_formation_cycles', cycleType, `${cycleType} needle loop formation cycle`, content));
  }

  // ---- This app's own methodology, hand-authored ----
  chunks.push(...authoredChunks());

  return chunks.filter(c => c.content && c.content.length >= 10);
}

async function main() {
  const chunks = buildChunks();
  console.log(`Built ${chunks.length} candidate chunks.`);

  const bySourceModule = {};
  for (const c of chunks) bySourceModule[c.sourceModule] = (bySourceModule[c.sourceModule] || 0) + 1;
  console.log('By source module:', bySourceModule);

  if (DRY_RUN) {
    console.log('\n--dry-run: printing first 3 chunks, no embedding or DB writes.\n');
    for (const c of chunks.slice(0, 3)) {
      console.log(`[${c.sourceModule}::${c.sourceRef}] ${c.title}\n  ${c.content.slice(0, 200)}${c.content.length > 200 ? '...' : ''}\n`);
    }
    return;
  }

  // Fail fast with one clear message rather than repeating the same "no
  // Mistral key" error across every one of ~98 chunks.
  try {
    await multiProviderEmbed.embed('connectivity check', 'document');
  } catch (err) {
    console.error(`Embedding provider not ready — ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const existing = await knowledgeRepo.existingHashes();
  let embedded = 0, skipped = 0, failed = 0;

  for (const c of chunks) {
    const contentHash = sha256(c.content);
    const key = `${c.sourceModule}::${c.sourceRef}`;
    if (existing.get(key) === contentHash) {
      skipped++;
      continue;
    }
    try {
      const { embedding } = await multiProviderEmbed.embed(c.content, 'document');
      await knowledgeRepo.upsertChunk({
        sourceModule: c.sourceModule,
        sourceRef: c.sourceRef,
        title: c.title,
        content: c.content,
        contentHash,
        embedding,
        embeddingModel: multiProviderEmbed.MISTRAL_EMBED_MODEL,
      });
      embedded++;
      process.stdout.write(`  embedded: ${key}\n`);
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${key} — ${err.message}`);
    }
  }

  const total = await knowledgeRepo.chunkCount();
  console.log(`\nDone. ${embedded} embedded/updated, ${skipped} unchanged (skipped), ${failed} failed. ${total} chunks total in the store.`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch(err => { console.error('[build-knowledge-index] ' + err.message); process.exitCode = 1; })
  .finally(() => close());
