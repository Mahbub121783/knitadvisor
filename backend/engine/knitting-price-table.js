/**
 * KnitAdvisor — Knitting Price Table
 * ===================================
 * Real industry price list: fabric type × variant × yarn count tier.
 * Source: Official Knitting & Dyeing Price List (11-page reference document).
 *
 * Structure:
 *   key:  canonical fabric+variant key (mapped from KnitAdvisor fabric IDs)
 *   above30: price in USD/kg for yarn count > 30s (finer / higher gauge)
 *   below30: price in USD/kg for yarn count ≤ 30s (coarser / lower gauge)
 *
 * Count threshold: 30 Ne (cotton count system)
 *   - above30 = count > 30  (fine: 32s, 34s, 36s, 40s …)
 *   - below30 = count ≤ 30  (coarse: 10s–30s)
 *
 * 0.00 entries in the original list = "not applicable / not available".
 * We keep them as null to avoid wrong zero-price lookups.
 */

'use strict';

// ============================================================
// RAW PRICE TABLE  (all 11 pages, verbatim)
// ============================================================
const KNITTING_PRICES = [
  // ─── 4x1 RIB ───────────────────────────────────────────────────────────────
  { fabric:'rib_4x1',          variant:'plain',            above30:0.45, below30:0.45 },
  // ─── 5x2 RIB ───────────────────────────────────────────────────────────────
  { fabric:'rib_5x2',          variant:'plain',            above30:0.50, below30:0.50 },
  { fabric:'rib_5x2',          variant:'elastane_ff',      above30:0.65, below30:0.60 },
  { fabric:'rib_5x2',          variant:'elastane_hf',      above30:0.55, below30:0.50 },
  { fabric:'rib_5x2',          variant:'feeder_stripe_ff', above30:0.65, below30:0.60 },
  // ─── 6x2 RIB ───────────────────────────────────────────────────────────────
  { fabric:'rib_6x2',          variant:'plain',            above30:0.60, below30:0.50 },
  // ─── 9x3 RIB ───────────────────────────────────────────────────────────────
  { fabric:'rib_9x3',          variant:'plain',            above30:0.50, below30:0.45 },
  { fabric:'rib_9x3',          variant:'elastane_ff',      above30:0.50, below30:0.47 },
  // ─── CRAPE JERSEY ──────────────────────────────────────────────────────────
  { fabric:'crape_jersey',     variant:'plain',            above30:0.70, below30:0.65 },
  // ─── CRINKLE JERSEY ────────────────────────────────────────────────────────
  { fabric:'crinkle_jersey',   variant:'elastane_ff',      above30:1.00, below30:1.00 },
  // ─── DESIGN LYCRA INTERLOCK PIQUE (F.F) ────────────────────────────────────
  { fabric:'design_lycra_interlock_pique', variant:'plain',       above30:0.80, below30:0.85 },
  { fabric:'design_lycra_interlock_pique', variant:'elastane_ff', above30:0.80, below30:0.85 },
  // ─── DOUBLE LACOSTE ────────────────────────────────────────────────────────
  { fabric:'double_lacoste',   variant:'plain',            above30:0.23, below30:0.18 },
  { fabric:'double_lacoste',   variant:'elastane_hf',      above30:0.44, below30:0.39 },
  { fabric:'double_lacoste',   variant:'eng_stripe',       above30:1.80, below30:1.75 },
  { fabric:'double_lacoste',   variant:'eng_stripe_hf',    above30:2.30, below30:2.25 },
  { fabric:'double_lacoste',   variant:'feeder_stripe',    above30:0.31, below30:0.26 },
  { fabric:'double_lacoste',   variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── DOUBLE LACOSTE SLUB ───────────────────────────────────────────────────
  { fabric:'double_lacoste_slub', variant:'plain',            above30:0.28, below30:0.23 },
  { fabric:'double_lacoste_slub', variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'double_lacoste_slub', variant:'eng_stripe',       above30:2.05, below30:2.00 },
  { fabric:'double_lacoste_slub', variant:'eng_stripe_hf',    above30:2.45, below30:2.40 },
  { fabric:'double_lacoste_slub', variant:'feeder_stripe',    above30:0.33, below30:0.28 },
  { fabric:'double_lacoste_slub', variant:'feeder_stripe_hf', above30:0.57, below30:0.52 },
  // ─── DOUBLE LACOSTE VISCOSE ────────────────────────────────────────────────
  { fabric:'double_lacoste_viscose', variant:'plain',            above30:0.28, below30:0.23 },
  { fabric:'double_lacoste_viscose', variant:'elastane_hf',      above30:0.46, below30:0.41 },
  // ─── EYELET RIB ────────────────────────────────────────────────────────────
  { fabric:'eyelet_rib',       variant:'plain',            above30:2.30, below30:2.20 },
  // ─── FANCY JERSEY ──────────────────────────────────────────────────────────
  { fabric:'fancy_jersey',     variant:'plain',            above30:0.55, below30:0.40 },
  { fabric:'fancy_jersey',     variant:'design',           above30:0.00, below30:0.40 },
  // ─── FLAT BACK RIB ─────────────────────────────────────────────────────────
  { fabric:'flat_back_rib',    variant:'plain',            above30:0.33, below30:0.33 },
  { fabric:'flat_back_rib',    variant:'elastane_ff',      above30:0.45, below30:0.40 },
  { fabric:'flat_back_rib',    variant:'elastane_hf',      above30:0.00, below30:0.00 },
  // ─── FRENCH TERRY (3-THREAD) ───────────────────────────────────────────────
  { fabric:'french_terry_3t',  variant:'plain',            above30:0.28, below30:0.23 },
  { fabric:'french_terry_3t',  variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'french_terry_3t',  variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'french_terry_3t',  variant:'eng_stripe',       above30:2.30, below30:2.25 },
  { fabric:'french_terry_3t',  variant:'eng_stripe_hf',    above30:2.55, below30:2.50 },
  { fabric:'french_terry_3t',  variant:'feeder_stripe',    above30:0.44, below30:0.39 },
  { fabric:'french_terry_3t',  variant:'feeder_stripe_hf', above30:0.57, below30:0.52 },
  // ─── FRENCH TERRY (3-THREAD, INSIDE BRUSH) ─────────────────────────────────
  { fabric:'french_terry_3t_brush', variant:'plain',            above30:0.33, below30:0.28 },
  { fabric:'french_terry_3t_brush', variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'french_terry_3t_brush', variant:'eng_stripe',       above30:2.05, below30:2.00 },
  { fabric:'french_terry_3t_brush', variant:'eng_stripe_hf',    above30:2.55, below30:2.50 },
  { fabric:'french_terry_3t_brush', variant:'feeder_stripe',    above30:0.44, below30:0.39 },
  { fabric:'french_terry_3t_brush', variant:'feeder_stripe_hf', above30:0.57, below30:0.52 },
  // ─── FRENCH TERRY (2-THREAD) ───────────────────────────────────────────────
  { fabric:'french_terry_2t',  variant:'plain',            above30:0.28, below30:0.23 },
  { fabric:'french_terry_2t',  variant:'elastane_ff',      above30:0.44, below30:0.39 },
  { fabric:'french_terry_2t',  variant:'elastane_hf',      above30:0.44, below30:0.39 },
  { fabric:'french_terry_2t',  variant:'eng_stripe',       above30:2.05, below30:2.00 },
  { fabric:'french_terry_2t',  variant:'eng_stripe_hf',    above30:2.45, below30:2.40 },
  { fabric:'french_terry_2t',  variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'french_terry_2t',  variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  { fabric:'french_terry_2t',  variant:'pique_mixed',      above30:0.44, below30:0.39 },
  // ─── FRENCH TERRY (2-THREAD, INSIDE BRUSH) ─────────────────────────────────
  { fabric:'french_terry_2t_brush', variant:'plain',            above30:0.28, below30:0.23 },
  { fabric:'french_terry_2t_brush', variant:'elastane_hf',      above30:0.44, below30:0.39 },
  { fabric:'french_terry_2t_brush', variant:'eng_stripe',       above30:2.05, below30:2.00 },
  { fabric:'french_terry_2t_brush', variant:'eng_stripe_hf',    above30:2.45, below30:2.40 },
  { fabric:'french_terry_2t_brush', variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'french_terry_2t_brush', variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── HEAVY JERSEY ──────────────────────────────────────────────────────────
  { fabric:'heavy_jersey',     variant:'plain',            above30:0.30, below30:0.25 },
  { fabric:'heavy_jersey_270', variant:'plain',            above30:0.30, below30:0.25 },
  // ─── INTERLOCK ─────────────────────────────────────────────────────────────
  { fabric:'interlock',        variant:'plain',            above30:0.28, below30:0.23 },
  { fabric:'interlock',        variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'interlock',        variant:'elastane_hf',      above30:0.44, below30:0.39 },
  { fabric:'interlock',        variant:'eng_stripe',       above30:3.05, below30:3.00 },
  { fabric:'interlock',        variant:'eng_stripe_ff',    above30:4.05, below30:4.00 },
  { fabric:'interlock',        variant:'eng_stripe_hf',    above30:3.80, below30:3.75 },
  { fabric:'interlock',        variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'interlock',        variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'interlock',        variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── INTERLOCK DESIGN ──────────────────────────────────────────────────────
  { fabric:'interlock_design', variant:'plain',            above30:0.70, below30:0.65 },
  // ─── INTERLOCK DOUBLE FACE ─────────────────────────────────────────────────
  { fabric:'interlock_double_face', variant:'plain',       above30:0.57, below30:0.52 },
  { fabric:'interlock_double_face', variant:'elastane_ff', above30:0.60, below30:0.55 },
  // ─── INTERLOCK PIQUE ───────────────────────────────────────────────────────
  { fabric:'interlock_pique',  variant:'plain',            above30:0.57, below30:0.52 },
  { fabric:'interlock_pique',  variant:'design',           above30:1.50, below30:1.50 },
  { fabric:'interlock_pique',  variant:'elastane_ff',      above30:0.60, below30:0.55 },
  // ─── INTERLOCK POLYESTER DOUBLE FACE ───────────────────────────────────────
  { fabric:'interlock_poly_double', variant:'plain',       above30:0.70, below30:0.65 },
  // ─── INTERLOCK Y/D STRIPE ──────────────────────────────────────────────────
  { fabric:'interlock_yd',     variant:'plain',            above30:2.25, below30:2.20 },
  // ─── MESH JERSEY ───────────────────────────────────────────────────────────
  { fabric:'mesh_jersey',      variant:'plain',            above30:0.55, below30:0.00 },
  // ─── OTTOMAN RIB ───────────────────────────────────────────────────────────
  { fabric:'ottoman_rib',      variant:'plain',            above30:0.67, below30:0.67 },
  { fabric:'ottoman_rib',      variant:'elastane_hf',      above30:0.70, below30:0.70 },
  // ─── PIQUE ─────────────────────────────────────────────────────────────────
  { fabric:'pique',            variant:'plain',            above30:0.27, below30:0.25 },
  { fabric:'pique',            variant:'poly_birds_eye',   above30:0.61, below30:0.57 },
  { fabric:'pique',            variant:'poly_mesh',        above30:0.61, below30:0.57 },
  // ─── PIQUE HONEYCOMB ───────────────────────────────────────────────────────
  { fabric:'pique_honeycomb',  variant:'plain',            above30:0.23, below30:0.18 },
  { fabric:'pique_honeycomb',  variant:'elastane_hf',      above30:0.44, below30:0.39 },
  { fabric:'pique_honeycomb',  variant:'eng_stripe',       above30:1.85, below30:1.80 },
  { fabric:'pique_honeycomb',  variant:'eng_stripe_hf',    above30:2.30, below30:2.25 },
  { fabric:'pique_honeycomb',  variant:'feeder_stripe',    above30:0.31, below30:0.26 },
  { fabric:'pique_honeycomb',  variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  { fabric:'pique_honeycomb',  variant:'poly_birds_eye',   above30:0.00, below30:0.00 },
  { fabric:'pique_honeycomb',  variant:'poly_mesh',        above30:0.00, below30:0.00 },
  // ─── PIQUE HONEYCOMB SLUB ──────────────────────────────────────────────────
  { fabric:'pique_honeycomb_slub', variant:'plain',        above30:0.28, below30:0.23 },
  { fabric:'pique_honeycomb_slub', variant:'elastane_hf',  above30:0.46, below30:0.41 },
  // ─── POINTAL JERSEY ────────────────────────────────────────────────────────
  { fabric:'pointal_jersey',   variant:'jacquard',         above30:2.30, below30:2.20 },
  // ─── POINTTELLE RIB ────────────────────────────────────────────────────────
  { fabric:'pointtelle_rib',   variant:'plain',            above30:1.50, below30:1.45 },
  { fabric:'pointtelle_rib',   variant:'jacquard',         above30:2.55, below30:2.50 },
  // ─── POPCORN JERSEY ────────────────────────────────────────────────────────
  { fabric:'popcorn_jersey',   variant:'plain',            above30:0.00, below30:0.72 },
  // ─── RIB IRREGULAR ─────────────────────────────────────────────────────────
  { fabric:'rib_irregular',    variant:'plain',            above30:0.50, below30:0.45 },
  { fabric:'rib_irregular',    variant:'elastane_ff',      above30:0.75, below30:0.70 },
  // ─── RIB 1x1 ───────────────────────────────────────────────────────────────
  { fabric:'rib_1x1',          variant:'plain',            above30:0.25, below30:0.20 },
  { fabric:'rib_1x1',          variant:'elastane_ff',      above30:0.44, below30:0.39 },
  { fabric:'rib_1x1',          variant:'elastane_hf',      above30:0.37, below30:0.32 },
  { fabric:'rib_1x1',          variant:'eng_stripe',       above30:2.35, below30:2.30 },
  { fabric:'rib_1x1',          variant:'eng_stripe_ff',    above30:3.05, below30:3.00 },
  { fabric:'rib_1x1',          variant:'eng_stripe_hf',    above30:2.55, below30:2.50 },
  { fabric:'rib_1x1',          variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_1x1',          variant:'feeder_stripe_ff', above30:0.50, below30:0.45 },
  { fabric:'rib_1x1',          variant:'feeder_stripe_hf', above30:0.45, below30:0.40 },
  // ─── RIB 1x1 SLUB ──────────────────────────────────────────────────────────
  { fabric:'rib_1x1_slub',     variant:'plain',            above30:0.35, below30:0.30 },
  { fabric:'rib_1x1_slub',     variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'rib_1x1_slub',     variant:'elastane_hf',      above30:0.41, below30:0.36 },
  { fabric:'rib_1x1_slub',     variant:'eng_stripe',       above30:2.51, below30:2.46 },
  { fabric:'rib_1x1_slub',     variant:'eng_stripe_ff',    above30:3.15, below30:3.10 },
  { fabric:'rib_1x1_slub',     variant:'eng_stripe_hf',    above30:2.65, below30:2.60 },
  { fabric:'rib_1x1_slub',     variant:'feeder_stripe',    above30:0.45, below30:0.40 },
  { fabric:'rib_1x1_slub',     variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_1x1_slub',     variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 1x1 VISCOSE ───────────────────────────────────────────────────────
  { fabric:'rib_1x1_viscose',  variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_1x1_viscose',  variant:'elastane_ff',      above30:0.45, below30:0.40 },
  { fabric:'rib_1x1_viscose',  variant:'elastane_hf',      above30:0.40, below30:0.35 },
  { fabric:'rib_1x1_viscose',  variant:'eng_stripe',       above30:2.45, below30:2.40 },
  { fabric:'rib_1x1_viscose',  variant:'eng_stripe_ff',    above30:3.05, below30:3.00 },
  { fabric:'rib_1x1_viscose',  variant:'feeder_stripe',    above30:0.45, below30:0.40 },
  { fabric:'rib_1x1_viscose',  variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 2x1 ───────────────────────────────────────────────────────────────
  { fabric:'rib_2x1',          variant:'plain',            above30:0.35, below30:0.30 },
  { fabric:'rib_2x1',          variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'rib_2x1',          variant:'elastane_hf',      above30:0.45, below30:0.40 },
  { fabric:'rib_2x1',          variant:'eng_stripe',       above30:3.25, below30:3.20 },
  { fabric:'rib_2x1',          variant:'eng_stripe_ff',    above30:2.50, below30:2.50 },
  { fabric:'rib_2x1',          variant:'eng_stripe_hf',    above30:3.05, below30:3.00 },
  { fabric:'rib_2x1',          variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_2x1',          variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_2x1',          variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 2x1 SLUB ──────────────────────────────────────────────────────────
  { fabric:'rib_2x1_slub',     variant:'plain',            above30:0.37, below30:0.32 },
  { fabric:'rib_2x1_slub',     variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'rib_2x1_slub',     variant:'elastane_hf',      above30:0.44, below30:0.39 },
  { fabric:'rib_2x1_slub',     variant:'eng_stripe',       above30:3.29, below30:3.24 },
  { fabric:'rib_2x1_slub',     variant:'eng_stripe_ff',    above30:3.65, below30:3.60 },
  { fabric:'rib_2x1_slub',     variant:'eng_stripe_hf',    above30:3.67, below30:3.62 },
  { fabric:'rib_2x1_slub',     variant:'feeder_stripe',    above30:0.44, below30:0.39 },
  { fabric:'rib_2x1_slub',     variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_2x1_slub',     variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 2x1 VISCOSE ───────────────────────────────────────────────────────
  { fabric:'rib_2x1_viscose',  variant:'plain',            above30:0.37, below30:0.32 },
  { fabric:'rib_2x1_viscose',  variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'rib_2x1_viscose',  variant:'eng_stripe',       above30:3.41, below30:3.36 },
  { fabric:'rib_2x1_viscose',  variant:'eng_stripe_ff',    above30:3.93, below30:3.88 },
  { fabric:'rib_2x1_viscose',  variant:'feeder_stripe',    above30:0.44, below30:0.39 },
  { fabric:'rib_2x1_viscose',  variant:'feeder_stripe_ff', above30:0.61, below30:0.57 },
  { fabric:'rib_2x1_viscose',  variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 2x2 ───────────────────────────────────────────────────────────────
  { fabric:'rib_2x2',          variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_2x2',          variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'rib_2x2',          variant:'elastane_hf',      above30:0.48, below30:0.43 },
  { fabric:'rib_2x2',          variant:'eng_stripe',       above30:3.29, below30:3.24 },
  { fabric:'rib_2x2',          variant:'eng_stripe_ff',    above30:3.80, below30:3.75 },
  { fabric:'rib_2x2',          variant:'eng_stripe_hf',    above30:3.67, below30:3.62 },
  { fabric:'rib_2x2',          variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_2x2',          variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_2x2',          variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 2x2 SLUB ──────────────────────────────────────────────────────────
  { fabric:'rib_2x2_slub',     variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_2x2_slub',     variant:'elastane_ff',      above30:0.57, below30:0.52 },
  { fabric:'rib_2x2_slub',     variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'rib_2x2_slub',     variant:'eng_stripe',       above30:3.29, below30:3.24 },
  { fabric:'rib_2x2_slub',     variant:'eng_stripe_ff',    above30:3.80, below30:3.75 },
  { fabric:'rib_2x2_slub',     variant:'eng_stripe_hf',    above30:3.67, below30:3.62 },
  { fabric:'rib_2x2_slub',     variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_2x2_slub',     variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_2x2_slub',     variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 2x2 VISCOSE ───────────────────────────────────────────────────────
  { fabric:'rib_2x2_viscose',  variant:'plain',            above30:0.37, below30:0.32 },
  { fabric:'rib_2x2_viscose',  variant:'elastane_ff',      above30:0.57, below30:0.52 },
  { fabric:'rib_2x2_viscose',  variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'rib_2x2_viscose',  variant:'eng_stripe',       above30:3.05, below30:3.00 },
  { fabric:'rib_2x2_viscose',  variant:'eng_stripe_ff',    above30:3.80, below30:3.75 },
  { fabric:'rib_2x2_viscose',  variant:'feeder_stripe',    above30:0.44, below30:0.39 },
  { fabric:'rib_2x2_viscose',  variant:'feeder_stripe_hf', above30:0.57, below30:0.52 },
  // ─── RIB 3x1 ───────────────────────────────────────────────────────────────
  { fabric:'rib_3x1',          variant:'elastane_ff',      above30:0.55, below30:0.50 },
  // ─── RIB 3x2 ───────────────────────────────────────────────────────────────
  { fabric:'rib_3x2',          variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_3x2',          variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'rib_3x2',          variant:'elastane_hf',      above30:0.48, below30:0.43 },
  { fabric:'rib_3x2',          variant:'eng_stripe',       above30:3.29, below30:3.24 },
  { fabric:'rib_3x2',          variant:'eng_stripe_ff',    above30:3.93, below30:3.88 },
  { fabric:'rib_3x2',          variant:'eng_stripe_hf',    above30:3.67, below30:3.62 },
  { fabric:'rib_3x2',          variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_3x2',          variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_3x2',          variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 3x2 SLUB ──────────────────────────────────────────────────────────
  { fabric:'rib_3x2_slub',     variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_3x2_slub',     variant:'elastane_ff',      above30:0.57, below30:0.52 },
  { fabric:'rib_3x2_slub',     variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'rib_3x2_slub',     variant:'eng_stripe',       above30:3.25, below30:3.20 },
  { fabric:'rib_3x2_slub',     variant:'eng_stripe_ff',    above30:3.80, below30:3.75 },
  { fabric:'rib_3x2_slub',     variant:'eng_stripe_hf',    above30:3.55, below30:3.50 },
  { fabric:'rib_3x2_slub',     variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_3x2_slub',     variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_3x2_slub',     variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 3x2 VISCOSE ───────────────────────────────────────────────────────
  { fabric:'rib_3x2_viscose',  variant:'plain',            above30:0.37, below30:0.32 },
  { fabric:'rib_3x2_viscose',  variant:'elastane_ff',      above30:0.57, below30:0.52 },
  { fabric:'rib_3x2_viscose',  variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'rib_3x2_viscose',  variant:'eng_stripe',       above30:3.35, below30:3.30 },
  { fabric:'rib_3x2_viscose',  variant:'eng_stripe_ff',    above30:3.80, below30:3.75 },
  { fabric:'rib_3x2_viscose',  variant:'feeder_stripe',    above30:0.44, below30:0.39 },
  { fabric:'rib_3x2_viscose',  variant:'feeder_stripe_hf', above30:0.57, below30:0.52 },
  // ─── RIB 3x3 ───────────────────────────────────────────────────────────────
  { fabric:'rib_3x3',          variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_3x3',          variant:'elastane_ff',      above30:0.54, below30:0.50 },
  // ─── RIB 4x2 ───────────────────────────────────────────────────────────────
  { fabric:'rib_4x2',          variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_4x2',          variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'rib_4x2',          variant:'elastane_hf',      above30:0.48, below30:0.43 },
  { fabric:'rib_4x2',          variant:'eng_stripe',       above30:3.25, below30:3.20 },
  { fabric:'rib_4x2',          variant:'eng_stripe_ff',    above30:3.80, below30:3.75 },
  { fabric:'rib_4x2',          variant:'eng_stripe_hf',    above30:3.55, below30:3.50 },
  { fabric:'rib_4x2',          variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_4x2',          variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_4x2',          variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 4x2 SLUB ──────────────────────────────────────────────────────────
  { fabric:'rib_4x2_slub',     variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_4x2_slub',     variant:'elastane_ff',      above30:0.57, below30:0.52 },
  { fabric:'rib_4x2_slub',     variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'rib_4x2_slub',     variant:'eng_stripe',       above30:3.34, below30:3.29 },
  { fabric:'rib_4x2_slub',     variant:'eng_stripe_ff',    above30:3.80, below30:3.75 },
  { fabric:'rib_4x2_slub',     variant:'eng_stripe_hf',    above30:3.77, below30:3.62 },
  { fabric:'rib_4x2_slub',     variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_4x2_slub',     variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_4x2_slub',     variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 4x2 VISCOSE ───────────────────────────────────────────────────────
  { fabric:'rib_4x2_viscose',  variant:'plain',            above30:0.37, below30:0.32 },
  { fabric:'rib_4x2_viscose',  variant:'elastane_ff',      above30:0.57, below30:0.52 },
  { fabric:'rib_4x2_viscose',  variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'rib_4x2_viscose',  variant:'eng_stripe',       above30:3.25, below30:3.20 },
  { fabric:'rib_4x2_viscose',  variant:'eng_stripe_ff',    above30:3.80, below30:3.75 },
  { fabric:'rib_4x2_viscose',  variant:'feeder_stripe',    above30:0.44, below30:0.39 },
  { fabric:'rib_4x2_viscose',  variant:'feeder_stripe_hf', above30:0.57, below30:0.52 },
  // ─── RIB 4x3 ───────────────────────────────────────────────────────────────
  { fabric:'rib_4x3',          variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_4x3',          variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'rib_4x3',          variant:'elastane_hf',      above30:0.48, below30:0.43 },
  { fabric:'rib_4x3',          variant:'eng_stripe',       above30:3.29, below30:3.24 },
  { fabric:'rib_4x3',          variant:'eng_stripe_ff',    above30:3.93, below30:3.88 },
  { fabric:'rib_4x3',          variant:'eng_stripe_hf',    above30:3.67, below30:3.62 },
  { fabric:'rib_4x3',          variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_4x3',          variant:'feeder_stripe_ff', above30:0.57, below30:0.52 },
  { fabric:'rib_4x3',          variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 4x3 VISCOSE ───────────────────────────────────────────────────────
  { fabric:'rib_4x3_viscose',  variant:'plain',            above30:0.37, below30:0.32 },
  { fabric:'rib_4x3_viscose',  variant:'elastane_ff',      above30:0.57, below30:0.52 },
  { fabric:'rib_4x3_viscose',  variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'rib_4x3_viscose',  variant:'eng_stripe',       above30:3.35, below30:3.30 },
  { fabric:'rib_4x3_viscose',  variant:'eng_stripe_ff',    above30:3.90, below30:3.85 },
  { fabric:'rib_4x3_viscose',  variant:'feeder_stripe',    above30:0.44, below30:0.39 },
  { fabric:'rib_4x3_viscose',  variant:'feeder_stripe_hf', above30:0.57, below30:0.52 },
  // ─── RIB 4x4 ───────────────────────────────────────────────────────────────
  { fabric:'rib_4x4',          variant:'plain',            above30:0.31, below30:0.26 },
  { fabric:'rib_4x4',          variant:'elastane_ff',      above30:0.50, below30:0.45 },
  { fabric:'rib_4x4',          variant:'elastane_hf',      above30:0.48, below30:0.43 },
  { fabric:'rib_4x4',          variant:'eng_stripe',       above30:3.30, below30:3.25 },
  { fabric:'rib_4x4',          variant:'eng_stripe_ff',    above30:3.90, below30:3.85 },
  { fabric:'rib_4x4',          variant:'eng_stripe_hf',    above30:3.65, below30:3.60 },
  { fabric:'rib_4x4',          variant:'feeder_stripe',    above30:0.37, below30:0.32 },
  { fabric:'rib_4x4',          variant:'feeder_stripe_ff', above30:0.65, below30:0.65 },
  { fabric:'rib_4x4',          variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── RIB 4x4 VISCOSE ───────────────────────────────────────────────────────
  { fabric:'rib_4x4_viscose',  variant:'plain',            above30:0.37, below30:0.32 },
  { fabric:'rib_4x4_viscose',  variant:'elastane_ff',      above30:0.57, below30:0.52 },
  { fabric:'rib_4x4_viscose',  variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'rib_4x4_viscose',  variant:'eng_stripe',       above30:3.41, below30:3.36 },
  { fabric:'rib_4x4_viscose',  variant:'eng_stripe_ff',    above30:4.05, below30:4.00 },
  { fabric:'rib_4x4_viscose',  variant:'feeder_stripe',    above30:0.44, below30:0.39 },
  { fabric:'rib_4x4_viscose',  variant:'feeder_stripe_hf', above30:0.57, below30:0.52 },
  // ─── RIB 4x8 ───────────────────────────────────────────────────────────────
  { fabric:'rib_4x8',          variant:'elastane_ff',      above30:0.00, below30:0.00 },
  // ─── RIB 5x1 ───────────────────────────────────────────────────────────────
  { fabric:'rib_5x1',          variant:'plain',            above30:0.00, below30:0.40 },
  // ─── RIB 5x3 ───────────────────────────────────────────────────────────────
  { fabric:'rib_5x3',          variant:'plain',            above30:0.59, below30:0.54 },
  { fabric:'rib_5x3',          variant:'elastane_ff',      above30:0.57, below30:0.57 },
  // ─── RIB 5x4 ───────────────────────────────────────────────────────────────
  { fabric:'rib_5x4',          variant:'elastane_ff',      above30:0.65, below30:0.60 },
  // ─── RIB 6x4 ───────────────────────────────────────────────────────────────
  { fabric:'rib_6x4',          variant:'elastane_ff',      above30:0.00, below30:0.55 },
  // ─── RIB 7x3 ───────────────────────────────────────────────────────────────
  { fabric:'rib_7x3',          variant:'plain',            above30:0.25, below30:2.20 },
  { fabric:'rib_7x3',          variant:'elastane_ff',      above30:0.57, below30:0.57 },
  { fabric:'rib_7x3',          variant:'jacquard',         above30:2.20, below30:2.20 },
  // ─── RIB 8x2 ───────────────────────────────────────────────────────────────
  { fabric:'rib_8x2',          variant:'plain',            above30:0.00, below30:0.00 },
  { fabric:'rib_8x2',          variant:'elastane_ff',      above30:0.50, below30:0.47 },
  // ─── RIB 8x4 ───────────────────────────────────────────────────────────────
  { fabric:'rib_8x4',          variant:'plain',            above30:0.50, below30:0.45 },
  // ─── RIB 8x8 ───────────────────────────────────────────────────────────────
  { fabric:'rib_8x8',          variant:'plain',            above30:0.00, below30:0.00 },
  { fabric:'rib_8x8',          variant:'elastane_ff',      above30:0.50, below30:0.47 },
  // ─── RIB FLAT BACK ─────────────────────────────────────────────────────────
  { fabric:'rib_flat_back',    variant:'plain',            above30:0.75, below30:0.70 },
  { fabric:'rib_flat_back',    variant:'elastane_ff',      above30:0.90, below30:0.85 },
  { fabric:'rib_flat_back',    variant:'elastane_hf',      above30:0.85, below30:0.80 },
  // ─── RIB FLAT BACK Y/D ─────────────────────────────────────────────────────
  { fabric:'rib_flat_back_yd', variant:'plain',            above30:1.00, below30:0.95 },
  { fabric:'rib_flat_back_yd', variant:'elastane_ff',      above30:1.15, below30:1.10 },
  { fabric:'rib_flat_back_yd', variant:'elastane_hf',      above30:0.55, below30:0.50 },
  // ─── SHOULDER TAPE ─────────────────────────────────────────────────────────
  { fabric:'shoulder_tape',    variant:'plain',            above30:0.10, below30:0.05 },
  // ─── SINGLE JERSEY ─────────────────────────────────────────────────────────
  { fabric:'single_jersey',    variant:'plain',            above30:0.23, below30:0.18 },
  { fabric:'single_jersey',    variant:'design',           above30:0.30, below30:0.25 },
  { fabric:'single_jersey',    variant:'elastane_ff',      above30:0.35, below30:0.30 },
  { fabric:'single_jersey',    variant:'elastane_hf',      above30:0.31, below30:0.26 },
  { fabric:'single_jersey',    variant:'eng_stripe',       above30:1.15, below30:1.10 },
  { fabric:'single_jersey',    variant:'eng_stripe_ff',    above30:2.15, below30:2.10 },
  { fabric:'single_jersey',    variant:'eng_stripe_hf',    above30:1.60, below30:1.55 },
  { fabric:'single_jersey',    variant:'feeder_stripe',    above30:0.35, below30:0.30 },
  { fabric:'single_jersey',    variant:'feeder_stripe_ff', above30:0.45, below30:0.40 },
  { fabric:'single_jersey',    variant:'feeder_stripe_hf', above30:0.40, below30:0.35 },
  { fabric:'single_jersey',    variant:'pique_mixed',      above30:0.45, below30:0.40 },
  { fabric:'single_jersey',    variant:'pointal',          above30:1.55, below30:1.50 },
  { fabric:'single_jersey',    variant:'poly_birds_eye',   above30:0.45, below30:0.40 },
  { fabric:'single_jersey',    variant:'poly_mesh',        above30:0.50, below30:0.45 },
  // ─── SINGLE JERSEY SLUB ────────────────────────────────────────────────────
  { fabric:'single_jersey_slub', variant:'plain',            above30:0.25, below30:0.20 },
  { fabric:'single_jersey_slub', variant:'elastane_ff',      above30:0.45, below30:0.40 },
  { fabric:'single_jersey_slub', variant:'elastane_hf',      above30:0.37, below30:0.32 },
  { fabric:'single_jersey_slub', variant:'eng_stripe',       above30:1.35, below30:1.30 },
  { fabric:'single_jersey_slub', variant:'feeder_stripe',    above30:0.31, below30:0.26 },
  { fabric:'single_jersey_slub', variant:'feeder_stripe_ff', above30:0.50, below30:0.45 },
  { fabric:'single_jersey_slub', variant:'feeder_stripe_hf', above30:0.45, below30:0.40 },
  // ─── SINGLE JERSEY VISCOSE ─────────────────────────────────────────────────
  { fabric:'single_jersey_viscose', variant:'plain',       above30:0.25, below30:0.20 },
  { fabric:'single_jersey_viscose', variant:'elastane_ff', above30:0.39, below30:0.34 },
  { fabric:'single_jersey_viscose', variant:'elastane_hf', above30:0.33, below30:0.28 },
  // ─── SINGLE LACOSTE ────────────────────────────────────────────────────────
  { fabric:'single_lacoste',   variant:'plain',            above30:0.23, below30:0.18 },
  { fabric:'single_lacoste',   variant:'elastane_ff',      above30:0.44, below30:0.39 },
  { fabric:'single_lacoste',   variant:'elastane_hf',      above30:0.44, below30:0.39 },
  { fabric:'single_lacoste',   variant:'eng_stripe',       above30:1.80, below30:1.75 },
  { fabric:'single_lacoste',   variant:'eng_stripe_hf',    above30:2.30, below30:2.25 },
  { fabric:'single_lacoste',   variant:'feeder_stripe',    above30:0.31, below30:0.26 },
  { fabric:'single_lacoste',   variant:'feeder_stripe_hf', above30:0.50, below30:0.45 },
  // ─── SINGLE LACOSTE SLUB ───────────────────────────────────────────────────
  { fabric:'single_lacoste_slub', variant:'plain',            above30:0.28, below30:0.23 },
  { fabric:'single_lacoste_slub', variant:'elastane_hf',      above30:0.50, below30:0.45 },
  { fabric:'single_lacoste_slub', variant:'eng_stripe',       above30:2.05, below30:2.00 },
  { fabric:'single_lacoste_slub', variant:'eng_stripe_hf',    above30:2.45, below30:2.40 },
  { fabric:'single_lacoste_slub', variant:'feeder_stripe',    above30:0.33, below30:0.28 },
  { fabric:'single_lacoste_slub', variant:'feeder_stripe_hf', above30:0.57, below30:0.52 },
  // ─── SINGLE LACOSTE VISCOSE ────────────────────────────────────────────────
  { fabric:'single_lacoste_viscose', variant:'plain',       above30:0.28, below30:0.23 },
  { fabric:'single_lacoste_viscose', variant:'elastane_hf', above30:0.46, below30:0.41 },
  // ─── TERRY TOWELLING ───────────────────────────────────────────────────────
  { fabric:'terry_towelling',  variant:'plain',            above30:0.38, below30:0.35 },
  // ─── VERIGATED RIB ─────────────────────────────────────────────────────────
  { fabric:'verigated_rib',    variant:'plain',            above30:0.57, below30:0.52 },
  { fabric:'verigated_rib',    variant:'elastane_ff',      above30:0.63, below30:0.58 },
  { fabric:'verigated_rib',    variant:'elastane_hf',      above30:0.70, below30:0.65 },
  // ─── WAFFLE / THERMAL ──────────────────────────────────────────────────────
  { fabric:'waffle',           variant:'plain',            above30:0.63, below30:0.58 },
  { fabric:'waffle',           variant:'design',           above30:0.63, below30:0.58 },
  { fabric:'waffle',           variant:'elastane_ff',      above30:0.85, below30:0.80 },
  { fabric:'waffle',           variant:'elastane_hf',      above30:0.85, below30:0.80 },
  { fabric:'waffle',           variant:'feeder_stripe',    above30:0.70, below30:0.65 },
  // ─── WAFFLE (RANDOM) ───────────────────────────────────────────────────────
  { fabric:'waffle_random',    variant:'plain',            above30:0.70, below30:0.65 },
  { fabric:'waffle_random',    variant:'elastane_ff',      above30:0.65, below30:0.60 },
  // ─── WOVEN FABRIC ──────────────────────────────────────────────────────────
  { fabric:'woven_fabric',     variant:'plain',            above30:1.35, below30:1.30 },
];

// ============================================================
// INDEX: fabric → variant → price record
// ============================================================
const _INDEX = {};
KNITTING_PRICES.forEach(r => {
  if (!_INDEX[r.fabric]) _INDEX[r.fabric] = {};
  _INDEX[r.fabric][r.variant] = r;
});

// ============================================================
// ALIAS MAP: KnitAdvisor fabric IDs → price-table fabric keys
// ============================================================
const FABRIC_ALIAS = {
  // Single Jersey family
  single_jersey:        'single_jersey',
  single_jersey_slub:   'single_jersey_slub',
  single_jersey_viscose:'single_jersey_viscose',
  // Rib family
  rib_1x1:              'rib_1x1',
  rib_2x1:              'rib_2x1',
  rib_2x2:              'rib_2x2',
  rib_3x2:              'rib_3x2',
  rib_4x2:              'rib_4x2',
  lycra_rib_1x1:        'rib_1x1',
  lycra_rib_2x2:        'rib_2x2',
  // Pique / Lacoste
  pique_single:         'single_lacoste',
  lacoste_single:       'single_lacoste',
  pique_double:         'double_lacoste',
  lacoste_double:       'double_lacoste',
  pique_honeycomb:      'pique_honeycomb',
  // Interlock
  interlock:            'interlock',
  ponte_di_roma:        'interlock',
  interlock_pique:      'interlock_pique',
  // Fleece / Terry
  fleece_2_thread:      'french_terry_2t',
  fleece_3_thread:      'french_terry_3t',
  fleece_diagonal:      'french_terry_3t',
  french_terry:         'french_terry_3t',
  terry_fabric:         'terry_towelling',
  // Heavy / Waffle
  heavy_jersey:         'heavy_jersey',
  waffle:               'waffle',
};

// ============================================================
// VARIANT DETECTOR: infer variant key from fabric+composition context
// ============================================================
function detectVariant(fabricId, parsedComp, yarnForm, count_ne) {
  const slub = yarnForm === 'slub' || (fabricId || '').includes('slub');
  const fibers = (parsedComp && parsedComp.fibers) || {};
  const viscose = (fibers.viscose || 0) >= 30;
  const elastane = (fibers.elastane || fibers.spandex || fibers.lycra || 0) > 0;

  if (viscose) {
    const base = FABRIC_ALIAS[fabricId] || fabricId;
    const viscKey = base + '_viscose';
    if (_INDEX[viscKey]) return { fabricKey: viscKey, variant: 'plain' };
  }
  if (slub) {
    const base = FABRIC_ALIAS[fabricId] || fabricId;
    const slubKey = base + '_slub';
    if (_INDEX[slubKey]) return { fabricKey: slubKey, variant: 'plain' };
  }
  if (elastane) return { fabricKey: FABRIC_ALIAS[fabricId] || fabricId, variant: 'elastane_hf' };
  return { fabricKey: FABRIC_ALIAS[fabricId] || fabricId, variant: 'plain' };
}

// ============================================================
// MAIN LOOKUP: getKnittingPrice(fabricId, countNe, parsedComp, yarnForm)
// Returns { price_usd_kg, tier, fabric_key, variant, source, note }
// ============================================================
function getKnittingPrice(fabricId, countNe, parsedComp, yarnForm) {
  const ne = parseFloat(countNe) || 30;
  const tier = ne > 30 ? 'above30' : 'below30';
  const tierLabel = ne > 30 ? `above 30s (${ne}Ne)` : `below/equal 30s (${ne}Ne)`;

  const { fabricKey, variant } = detectVariant(fabricId, parsedComp, yarnForm, ne);

  // Try exact match, fall back to plain, then generic rib/sj
  let rec = (_INDEX[fabricKey] && _INDEX[fabricKey][variant]) || null;
  if (!rec) rec = (_INDEX[fabricKey] && _INDEX[fabricKey]['plain']) || null;

  // Generic fallbacks for un-mapped fabrics
  if (!rec) {
    const cat = (fabricId || '').toLowerCase();
    if (cat.includes('rib') || cat.includes('lycra')) rec = _INDEX['rib_1x1'] && _INDEX['rib_1x1']['plain'];
    else if (cat.includes('interlock')) rec = _INDEX['interlock'] && _INDEX['interlock']['plain'];
    else if (cat.includes('fleece') || cat.includes('terry')) rec = _INDEX['french_terry_3t'] && _INDEX['french_terry_3t']['plain'];
    else if (cat.includes('waffle')) rec = _INDEX['waffle'] && _INDEX['waffle']['plain'];
    else rec = _INDEX['single_jersey'] && _INDEX['single_jersey']['plain'];
  }

  if (!rec) return { price_usd_kg: 0.40, tier, fabric_key: fabricKey, variant: 'fallback', source: 'fallback', note: 'No price record found; using global default' };

  const raw = rec[tier];
  // 0.00 in list = N/A; use the other tier's price as fallback
  const price = (raw && raw > 0) ? raw : ((rec[tier === 'above30' ? 'below30' : 'above30'] || 0) || 0.40);

  return {
    price_usd_kg: parseFloat(price.toFixed(4)),
    tier,
    tier_label: tierLabel,
    fabric_key: fabricKey,
    variant,
    above30: rec.above30,
    below30: rec.below30,
    source: 'Official Knitting Price List',
    note: `${fabricKey} · ${variant} · ${tierLabel} = USD ${price}/kg`,
  };
}

module.exports = {
  getKnittingPrice,
  KNITTING_PRICES,
  FABRIC_ALIAS,
  detectVariant,
};
