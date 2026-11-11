/**
 * KnitAdvisor — relaxation states and shrinkage (Fabric Studio)
 * ============================================================
 *
 * A weft knit has no single size: its loops take a different shape in each
 * state of relaxation, while the loop LENGTH stays what the machine knitted.
 * Munden (1959): wales/cm = Kw / ℓ, courses/cm = Kc / ℓ, the constants set by
 * the state, not by the machine.
 *
 *   state            what it is                               Kc     Kw    (plain knit)
 *   dry relaxed      off the machine, conditioned flat        5.0    3.8   Munden
 *   wet relaxed      soaked, dried flat                       5.3    4.1   Munden
 *   fully relaxed    washed and tumble dried (five cycles)    5.5    4.2   Postle / cotton
 *                    — the state a garment reaches at home    (5.3–5.8, 4.1–4.3)
 *   finished         dyed, dried and compacted: the factory records (this
 *                    studio's own constants for each family)
 *
 * The factory's finished cotton jersey sits at Kc ≈ 5.2, Kw ≈ 3.8 — between
 * dry and wet relaxed, as a compacted cloth should. Every state is placed
 * relative to it: wpc_state = wpc_finished × Kw_state / Kw_finished(jersey),
 * the same for courses. Other families carry the jersey ratios (MODELLED —
 * their relaxed constants are not in the factory records).
 *
 * Fibre: cotton and the regenerated cellulosics swell and relax fully;
 * polyester and nylon barely, heat-set elastane fabrics little. The change
 * from the finished state is scaled (cotton 1, viscose / modal 1.2, CVC
 * 0.75, PC 0.6, polyester 0.35, elastane plated × 0.6) — MODELLED.
 *
 * Residual shrinkage (finished → fully relaxed, i.e. after home laundering):
 *   length = 1 − cpc_finished / cpc_fully_relaxed,  width likewise with wales.
 * To keep it within a limit r the cloth must leave the compactor at
 * cpc ≥ cpc_FR × (1 − r) and wpc ≥ wpc_FR × (1 − r).
 */
'use strict';

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

const LIT = {
  dry: { kc: 5.0, kw: 3.8, label: 'Dry relaxed — off the machine, conditioned flat (greige)' },
  wet: { kc: 5.3, kw: 4.1, label: 'Wet relaxed — soaked, dried flat' },
  full: { kc: 5.5, kw: 4.2, kcR: [5.3, 5.8], kwR: [4.1, 4.3], label: 'Fully relaxed — washed and tumble dried (the garment at home)' },
};
const FIBRE_K = { cotton: 1, viscose: 1.2, modal: 1.2, cvc: 0.75, polyester_spun: 0.6, polyester_filament: 0.35, nylon_filament: 0.35 };

/**
 * @param a { S (solve result: wpc, cpc, gsm, width), fibre, elastane (bool), jersey: {kc, kw} (factory finished jersey), limitPct }
 */
function states(a) {
  const { S } = a;
  const J = a.jersey;                                      // the factory's finished jersey constants
  const f = (FIBRE_K[a.fibre] != null ? FIBRE_K[a.fibre] : 1) * (a.elastane ? 0.6 : 1);
  // a state's ratio to the finished state, scaled for the fibre
  const ratio = (k, k0) => 1 + (k / k0 - 1) * f;
  const at = (kc, kw) => {
    const wpc = S.wpc * ratio(kw, J.kw), cpc = S.cpc * ratio(kc, J.kc);
    return { wpc: r2(wpc), cpc: r2(cpc), gsm: Math.round(S.gsm * (wpc * cpc) / (S.wpc * S.cpc)), width_in: r1(S.width * S.wpc / wpc),
      length_pct: r1((S.cpc / cpc - 1) * 100), width_pct: r1((S.wpc / wpc - 1) * 100) };
  };
  const out = [
    { state: 'dry', label: LIT.dry.label, ...at(LIT.dry.kc, LIT.dry.kw) },
    { state: 'finished', label: 'Finished — dyed, dried, compacted (the factory records)', wpc: r2(S.wpc), cpc: r2(S.cpc), gsm: Math.round(S.gsm), width_in: r1(S.width), length_pct: 0, width_pct: 0 },
    { state: 'wet', label: LIT.wet.label, ...at(LIT.wet.kc, LIT.wet.kw) },
    { state: 'full', label: LIT.full.label, ...at(LIT.full.kc, LIT.full.kw) },
  ];
  // residual shrinkage: finished → fully relaxed, with the literature's range
  const sh = (k, k0) => (1 - 1 / ratio(k, k0)) * 100;
  const residual = {
    length_pct: [sh(LIT.full.kcR[0], J.kc), sh(LIT.full.kc, J.kc), sh(LIT.full.kcR[1], J.kc)].map(r1),
    width_pct: [sh(LIT.full.kwR[0], J.kw), sh(LIT.full.kw, J.kw), sh(LIT.full.kwR[1], J.kw)].map(r1),
  };
  // greige (dry relaxed) → finished: what dyeing and finishing do to the length and width
  const dry = out[0];
  const processing = { length_pct: r1((1 - dry.cpc / S.cpc) * 100), width_pct: r1((1 - dry.wpc / S.wpc) * 100) };
  // compaction to hold the residual shrinkage at the limit
  const lim = a.limitPct > 0 ? a.limitPct : 5;
  const full = out[3];
  const compaction = {
    limit_pct: lim,
    min_cpc: r2(full.cpc * (1 - lim / 100)), min_wpc: r2(full.wpc * (1 - lim / 100)),
    max_width_in: r1(S.width * S.wpc / (full.wpc * (1 - lim / 100))),
    gsm_at_limit: Math.round(full.gsm * (1 - lim / 100) ** 2),
    length_ok: residual.length_pct[1] <= lim, width_ok: residual.width_pct[1] <= lim,
  };
  return {
    states: out, residual, processing, compaction, fibre_factor: r2(f),
    basis: 'published relaxed-state constants for plain knit (dry and wet relaxed), fully relaxed from cotton laundering tables; each state placed against the factory\'s finished jersey (Kc ' + r2(J.kc) + ', Kw ' + r2(J.kw) + '); other families and fibres carry these ratios — modelled',
  };
}

function checks(R, family) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const L = R.residual.length_pct, W = R.residual.width_pct, c = R.compaction;
  const lvl = (v) => (v > c.limit_pct + 3 ? 'warn' : v > c.limit_pct ? 'note' : 'ok');
  add(lvl(Math.max(L[1], W[1])), `Residual shrinkage after home laundering (finished → fully relaxed): length ${L[1]}% (${L[0]}–${L[2]}), width ${W[1]}% (${W[0]}–${W[2]}) — modelled from the relaxation constants${family !== 'single_jersey' ? ', jersey ratios carried to this family' : ''}.`);
  if (!c.length_ok || !c.width_ok) add('note', `To hold shrinkage within ${c.limit_pct}%, finish (compact) to at least ${c.min_cpc} courses/cm and ${c.min_wpc} wales/cm — open width no more than ${c.max_width_in}" — weight about ${c.gsm_at_limit} GSM.`);
  return out;
}

module.exports = { states, checks, LIT, FIBRE_K };
