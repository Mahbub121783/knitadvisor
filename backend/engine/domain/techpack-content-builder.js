/**
 * KnitAdvisor — Tech Pack / Spec Sheet content builder
 * =======================================================
 *
 * Pure, network/DB-free transform: takes the SAME result object
 * engine/index.js's calculate() already returns (the exact response
 * result.html renders from) and reshapes it into a flat, renderer-agnostic
 * "sections" structure — label/value rows, tables, and presence flags.
 *
 * Deliberately produces NO PDF here. Kept separate from
 * techpack-pdf-renderer.js (which does the actual pdfkit drawing) for the
 * same reason knowledge-assistant-engine.js keeps its prompt/grounding logic
 * separate from the network calls: this file's section-selection logic
 * (which sections appear, in what order, with what fallback text) is worth
 * unit-testing on its own, and a renderer is not.
 *
 * FIELD PATHS ARE DELIBERATE, NOT GUESSED: every path below was checked
 * against engine/index.js's actual response object (e.g. dia/gauge/rpm/
 * efficiency live under `input`, NOT `machine` — `machine` only carries
 * the engine's gauge/dia RECOMMENDATIONS; yarn price fields live under
 * `costing`, NOT `yarn` — `yarn` carries count/fibre detail, `costing`
 * carries what that yarn was actually priced at).
 *
 * SOURCED-DATA DISCIPLINE: every value placed on the sheet already carries
 * the calculation engine's own source tagging (PDF_VERIFIED / INDUSTRY_TYPICAL
 * / ESTIMATED / GOVT_GAZETTE / etc.) — this builder does not invent new
 * numbers or drop that provenance, it only re-labels for a printed page.
 * Per knitadvisor-no-source-links, no external URL or site name is ever
 * placed on the sheet — only this app's own internal source-confidence tags.
 */

function row(label, value) {
  if (value == null || value === '') return null;
  return { label, value: String(value) };
}

function fmtNum(v, decimals = 2) {
  if (v == null || Number.isNaN(Number(v))) return null;
  return Number(v).toFixed(decimals);
}

/** @param {object} r — the full result object from engine/index.js's calculate() */
function buildTechPackContent(r) {
  if (!r || !r.fabric || !r.input) {
    return { ok: false, error: 'A completed calculation result is required to build a tech pack.' };
  }

  const meta = {
    fabric_name: r.fabric.name || r.input.fabric || 'Fabric',
    fabric_id: r.fabric.id || null,
    gsm: r.input.gsm ?? null,
    machine_type: r.fabric.machine_type || null,
    generated_at: new Date().toISOString(),
  };

  // ---- Fabric specification ----
  const fabricSpec = [
    row('Fabric structure', r.fabric.name),
    row('Category', r.fabric.category),
    row('Machine type', r.fabric.machine_type),
    row('Target GSM', r.input.gsm != null ? `${r.input.gsm} g/m²` : null),
    row('Composition', r.input.composition || r.composition?.parsed || null),
    row('Gauge', r.input.gauge != null ? `${r.input.gauge} G` : null),
    row('Diameter', r.input.dia != null ? `${r.input.dia}"` : null),
    row('Loop length', r.loop_length?.value_mm != null ? `${r.loop_length.value_mm} mm (${fmtNum(r.loop_length.value_cm, 3)} cm)` : null),
    row('Stitch-length basis', r.loop_length?.multiplier != null ? `x${r.loop_length.multiplier} (${r.loop_length.multiplier_source || 'engine formula'})` : null),
  ].filter(Boolean);

  // ---- Yarn & pricing (count/fibre detail from `yarn`, price detail from `costing`) ----
  const yarnSpec = [
    row('Yarn count', r.costing?.yarn_count_display || r.yarn?.count_display),
    row('Yarn type', r.costing?.yarn_type_label),
    row('Base price', r.costing?.yarn_base_price_usd != null ? `$${fmtNum(r.costing.yarn_base_price_usd, 2)} / kg` : null),
    row('Final price (with surcharges)', r.costing?.yarn_final_price_usd != null ? `$${fmtNum(r.costing.yarn_final_price_usd, 2)} / kg` : null),
    row('Price source', r.costing?.yarn_price_source),
    row('Costing country', r.costing?.country?.name),
  ].filter(Boolean);

  // ---- Machine & production ----
  const machineSpec = [
    row('Diameter x Gauge (as run)', (r.input.dia != null && r.input.gauge != null) ? `${r.input.dia}" x ${r.input.gauge}G` : null),
    row('Feeders (theoretical)', r.machine?.feeders_theoretical ?? null),
    row('RPM', r.input.rpm ?? null),
    row('Efficiency', r.input.efficiency != null ? `${r.input.efficiency}%` : null),
    row('Production rate', r.production?.kg_per_hour != null ? `${fmtNum(r.production.kg_per_hour, 2)} kg/hr` : (r.production?.kg_per_day != null ? `${fmtNum(r.production.kg_per_day, 1)} kg/day` : null)),
  ].filter(Boolean);

  // ---- Quality prediction ----
  const q = r.quality_prediction;
  const qualitySpec = q ? [
    row('Length shrinkage', q.shrinkage?.lengthwise_pct != null ? `${fmtNum(q.shrinkage.lengthwise_pct, 2)}%` : null),
    row('Width shrinkage', q.shrinkage?.widthwise_pct != null ? `${fmtNum(q.shrinkage.widthwise_pct, 2)}%` : null),
    row('Spirality', q.spirality?.predicted_pct != null ? `${fmtNum(q.spirality.predicted_pct, 2)}% (${(q.spirality.risk_level || '').split(' — ')[0]})` : null),
    row('Pilling', typeof q.pilling === 'object' ? (q.pilling?.rating ?? q.pilling?.grade ?? JSON.stringify(q.pilling)) : q.pilling),
    row('Bursting strength', q.bursting_strength?.value != null ? `${q.bursting_strength.value} ${q.bursting_strength.unit || ''}`.trim() : null),
  ].filter(Boolean) : [];

  // ---- Costing ----
  const c = r.costing;
  const costing = c ? {
    total_per_kg: fmtNum(c.total_per_kg_usd, 3),
    breakdown: [
      row('Raw material (with waste)', c.raw_material_per_kg_usd != null ? `$${fmtNum(c.raw_material_per_kg_usd, 3)} / kg` : null),
      row('Knitting CMT', c.knitting_per_kg_usd != null ? `$${fmtNum(c.knitting_per_kg_usd, 3)} / kg` : null),
      row('Dyeing CMT', c.dyeing_per_kg_usd != null ? `$${fmtNum(c.dyeing_per_kg_usd, 3)} / kg` : null),
      row('Finishing', c.finishing_per_kg_usd != null ? `$${fmtNum(c.finishing_per_kg_usd, 3)} / kg` : null),
    ].filter(Boolean),
    margins: (c.margin_scenarios || []).map(m => ({
      margin_pct: m.margin_pct,
      selling_price_usd: fmtNum(m.selling_price_usd, 3),
    })),
    dyeing_source: c.dyeing_detail?.source || null,
  } : null;

  // ---- Dyeing recipe (only when a REAL_RECIPE matched) ----
  const dd = c && c.dyeing_detail;
  const dyeingRecipe = (dd && dd.source === 'REAL_RECIPE') ? {
    recipe_name: dd.recipe_name,
    color_label: dd.color_label,
    match_quality: dd.match_quality,
    chemicals: (dd.chemicals || []).map(ch => row(ch.name || ch.chemical, ch.dosage || ch.qty)).filter(Boolean),
  } : null;

  // ---- Garment CMT / FOB (only when the caller supplied garment_weight_g + garment_type) ----
  const g = r.garment_costing;
  const garment = (g && g.consumption && g.cmt) ? {
    garment_name: g.cmt.garment.name,
    net_weight_g: g.consumption.net.weight_g,
    gross_weight_g: g.consumption.gross.weight_g,
    total_wastage_pct: g.consumption.allowances.total_wastage_pct,
    fabric_cost_per_garment_usd: fmtNum(g.consumption.fabric_cost_per_garment_usd, 4),
    sam_minutes: fmtNum(g.cmt.sam.sewing.sam_minutes, 3),
    cmt_total_usd: fmtNum(g.cmt.cmt_total_usd, 4),
    fob_total_usd: fmtNum(g.cmt.summary.fob_total_usd, 4),
    fabric_share_pct: fmtNum(g.cmt.summary.fabric_share_pct_of_fob, 1),
    breakdown: [
      row('Fabric (gross, with allowances)', `$${fmtNum(g.consumption.gross.fabric_cost_usd, 4)}`),
      row('Making (sewing labor)', `$${fmtNum(g.cmt.labor.making_cost_usd, 4)}`),
      row('Cutting (labor)', `$${fmtNum(g.cmt.labor.cutting_cost_usd, 4)}`),
      row('Trims', `$${fmtNum(g.cmt.trim.total_usd, 4)}`),
      row('Overhead', `$${fmtNum(g.cmt.summary.overhead_usd, 4)} (${g.cmt.summary.overhead_pct}%)`),
      row('Profit', `$${fmtNum(g.cmt.summary.profit_usd, 4)} (${g.cmt.summary.profit_pct}%)`),
    ].filter(Boolean),
  } : null;

  return {
    ok: true,
    meta,
    fabric_spec: fabricSpec,
    yarn_spec: yarnSpec,
    machine_spec: machineSpec,
    quality: qualitySpec,
    costing,
    dyeing_recipe: dyeingRecipe,
    garment,
    warnings: r.warnings || [],
  };
}

module.exports = { buildTechPackContent };
