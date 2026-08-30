# KnitAdvisor — System Structure

The whole system answers one question: given a fabric and a target GSM, what
should the floor actually run? Everything below is organised around keeping that
answer **deterministic** — same inputs, same spec, forever, with no network call
between the question and the answer.

That single constraint explains every boundary in this document.

---

## The four kinds of thing, and where each lives

| Kind | Lives in | Changes when | May it be async? |
|---|---|---|---|
| **Formula** — a relation between quantities | `backend/engine/formulas/` | the literature is corrected (≈ never) | no |
| **Reasoning** — choosing which relation applies | `backend/engine/domain/` | the floor teaches us something | no |
| **Measurement** — factory records, colours, prices | **PostgreSQL** (`engine/reference/` reads it) | the mill sends a new file | loaded once at boot |
| **Operational state** — cache, logs, sessions | **PostgreSQL** (`db/repositories/`) | constantly | yes |

The first two are code because they are logic. The third is a database because
it is data — it wants indexes, edits without a deploy, and an audit trail. The
fourth was always a database.

### Why formulas are *not* in the database

Putting `Count = a × GSM + b` in a table sounds tidier and is the wrong trade.
`calculate()` would have to become `async`, and a database hiccup would then
produce a *different answer* rather than a slower one. A spec engine that
sometimes cannot spec is not a spec engine.

### Why measurement *is*, and how the engine stays synchronous

`engine/reference/` loads every reference table **once at boot**, freezes it, and
hands the engine plain objects. The engine reads that snapshot synchronously on
every calculation and never issues a query.

```
boot    →  reference.load()   reads PostgreSQL into a frozen snapshot
request →  calculate()        reads the snapshot synchronously — zero I/O
import  →  new rows written; restart (or reference.reload()) picks them up
```

If PostgreSQL is unreachable at boot, `load()` falls back to the seed files in
`backend/data/` and the catalogue modules in `engine/catalog/`. Those files are
not stale duplicates to delete — they are the floor that keeps the calculator
answering during an outage, on a fresh checkout, and in tests that should not
need a database.

---

## Layout

```
backend/
  server.js                   boot: db → seed → reference.load() → listen
  routes/
    api.js                    POST /api/calculate and the rest of the public API
    search.js                 pg_trgm fuzzy search over the reference tables
    viz.js  admin.js  internal-cron.js
  engine/
    index.js                  calculate() — the 21-stage orchestrator
    formulas/                 ── THE CALCULATION FORMULA SECTION ──
      index.js                  re-exports the flat surface; read this first
      units.js                  length / weight / area / count conversion
      yarn.js                   Ne-Tex-denier, cover factor, tightness factor
      gsm-count.js              GSM→count regressions and lookup tables
      loop-length.js            stitch length from count and GSM
      machine.js                needles, feeders, pitch, gauge
      production.js             kg/hr, spun and filament
      fabric-weight.js          GSM from a swatch, weight from GSM, fibre split
      efficiency.js             machine efficiency and loss
      validation.js             sensible band for every input
      weft.js                   courses, wales, stitch density
      warp-knit.js              the warp-knit relations
    domain/                   reasoning engines — choose, weigh, warn
      factory-knowledge.js      the provenance ladder: exact → interpolated →
                                extrapolated → nearest → published
      composition-engine.js  color-engine.js  quality-engine.js
      costing-engine.js      wet-processing-engine.js  yarn-engine.js
      machine-optimizer.js   critical-path.js  factory-match.js
      risk-assessment.js     pattern-engine.js  fabric-physics.js
      faults-engine.js       striper-engine.js  uster-engine.js
      viz-engine.js          academy-engine.js
    catalog/                  embedded data — the fallback tier behind reference/
      fabric-derivatives.js     the 60 structures
      tcx-database.js  scotdic-database.js  bros-database.js
      archroma-database.js  knitting-price-table.js
      factory-dataset.js  production-data.js
    reference/
      index.js                  DB → frozen snapshot, with the file fallback
  db/
    client.js  migrate.js  seed.js
    migrations/               001 schema · 002 analytics · 003 reference data
    repositories/             cache · logs · admin · viz
  data/                       seed JSON — the source the importer reads
  scripts/
    import-reference-data.js  every data source → PostgreSQL
    migrate-mysql-to-postgres.js  reencrypt-provider-keys.js  run-tests.js
  tests/                      *.test.js — pure engine, no database needed
  middleware/  cache/  ai/

frontend/
  index.html  result.html  converter.html  patterns.html
  academy.html  weft-calc.html  diagnostics.html  admin.html  404.html
  assets/
    css/style.css
    js/                       api · ui · storage · admin · pattern-renderer
      knit3d/                 the WebGL fabric renderer
      vendor/                 pinned libraries, cached immutable

docs/                         this file and the rest
```

---

## What is in PostgreSQL

**Reference** (migration 003) — read at boot, never during a calculation:

| Table | Rows | What it is |
|---|---:|---|
| `fabrics` | 60 | the catalogue, with each fabric's data bucket |
| `factory_records` | 2,201 | real greige→finish jobs — the ground truth |
| `composition_reference` | 103 | those records collapsed into count/SL curves |
| `risk_records` | 50 | production jobs with documented risks |
| `colour_book` | 1,940 | TCX, SCOTDIC, BROS, Archroma — trigram indexed |
| `yarn_prices` | 213 | the mill price list |
| `calibration` | 128 | TF bands, regressions, LL multipliers, K constants |
| `knitting_faults` | 11 | the fault database |
| `reference_versions` | 8 | row count + checksum per table, stamped by the importer |

**Operational** (migrations 001–002) — written during normal use:
`query_logs`, `result_cache`, `viz_render_cache`, `viz_configs`,
`admin_users`, `admin_sessions`, the `ai_provider_*` tables,
`schema_migrations`, and the two analytics materialized views.

### Extensions

`pg_trgm` and `pgcrypto` are enabled. Only `pg_trgm` is used — it powers
`/api/search/*`. `pgcrypto` is deliberately unused: Node's `crypto` already does
scrypt, AES-256-CBC and SHA-256, and moving that into SQL would put plaintext
secrets into query strings where slow-query and statement logs can capture them.

---

## Refreshing the data

```bash
node scripts/import-reference-data.js            # dry run — reports counts only
node scripts/import-reference-data.js --apply    # write
```

Idempotent. Every insert is `ON CONFLICT DO UPDATE`, so a re-run after a data
refresh updates in place. The importer refuses to write if any weft-knit fabric
has no data bucket, because a missing bucket is silent at runtime: the fabric
loses its factory reference and quietly falls back to the published regression.

Restart the app afterwards so the reference snapshot is reloaded.

---

## The request path

```
browser  →  POST /api/calculate
            ├─ rate limit (240/min per IP per worker)
            ├─ cache key = md5(engine_version | 28 input fields)
            ├─ L1 in-process LRU        500 entries · 24 h
            ├─ L2 result_cache          30 days · 80 ms budget, then treated as a miss
            └─ calculate()              synchronous · ~0.9 ms · reads the snapshot
                                        └─ 21 stages, each appending to formula_trace
            writes L1, L2 and the query log fire-and-forget
```

A database outage costs the L2 cache, the log line and the admin panel. It does
not cost an answer.
