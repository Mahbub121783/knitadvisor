# KnitAdvisor vs the Universal Virtual Fabric Studio PRD v3.0 — Engineering Audit

Date: 2026-11-19 · Scope: the PRD (11 pages) and the companion workbook `Virtual_Fabric_Studio_Universal_Engine_Matrix_v3.xlsx` (6 tabs), checked line by line against the code in `backend/engine` and `frontend/assets/js` (uncommitted work included). Woven is in scope of the PRD but deferred in our plan ("knitting only"); it is scored, and marked deferred.

Scoring: **Done** = 1 (working, tested, reachable), **Partial** = ½ (exists but narrower than the PRD, or not wired to the Studio), **Missing** = 0.

---

## 1. Verdict

| Area | Score | Comment |
|---|---|---|
| Module 1: unit cell, GSM, reverse solver | **81 %** | The strongest part. GSM is the same law as the PRD's, but uses measured constants. |
| Module 2: yarn profiling, optics, fibre matrix | **64 %** | Yarn work is deep. The "any-N-yarn" face/back visibility is not universal yet. |
| Module 3: feasibility gates and machine compilers | **50 %** | The biggest structural gap: no single 3-gate verdict, no packing Φ, no V-bed. |
| Module 4: wet processing and chemicals | **67 %** | Route compiler is good. Polypropylene is missing, several FATAL rules are only notes, and there are no per-chemical deltas. |
| Module 5: 3D, shaders, five viewports | **55 %** | Knit 3D and shaders are strong. Burnout lab, barré simulator, full lightbox and DWR are missing. |
| Module 6: virtual lab, trim, eco, export | **58 %** | Missing: air permeability, SPC/Cpk, trim matcher and U3MA. |
| 20-rule guardrail register | **60 %** | 7 done, 10 partial, 3 missing. |
| **Overall** | **≈ 62 %** | The simple mean of the seven rows. |

On scientific grounding, KnitAdvisor is ahead of the PRD. Every number carries a measured, calculated or estimated tag, and the constants come from 2,201 factory greige→finish records rather than from tables. The PRD has none of this. Several PRD numbers are unsourced or physically wrong (section 6); they should not be copied in as-is.

### Update, 2026-11-19: Phase A done

- **Feasibility engine** (`feasibility-engine.js`): every weft analysis now carries three gates plus a quality group, all 20 rules with their basis, Φ_cell, the wet route of the whole cloth, and a repair vector. A FATAL locks `/studio/export` (409).
- **Fabric DNA** (`fabric-dna.js`): schema-3.0 export and import, with the unit-cell law written out. Round trip tested on 7 structures (same programme and weight); the hand-written PRD sample opens at 144 GSM.
- **Chemistry fixes:**
  - Wool and silk: no-caustic scour, disperse dyeing at 105 °C, acid clearing, heat-set at 170 °C.
  - A peroxide killer follows the bleach.
  - No cationic softener on an optical white.
- **Score changes:** Module 3 50 → 61 %, Module 4 67 → 78 %, guardrails 60 → 83 %. **Overall ≈ 62 → 68 %.**
- **New findings:**
  - The catalogue's `relief_single` knits two separate cloths as drawn.
  - The DNA's unit-cell law disagrees with the Studio by more than 50 % on fleece and French terry. The Studio's fleece courses-per-cm is not mass-consistent; to be investigated.

### Update, 2026-11-19: Phase B done

- **Polypropylene** is a Studio fibre (spun, dope-dyed). It takes no dye class in the piece, and its route stays at 115 °C or below. Beside polyester, the 130 °C disperse route is flagged FATAL (U-10).
- **Hard blocks.** The Yarn chemistry card has a "Force the process" section: caustic scour, disperse °C, heat-set °C, skip the peroxide killer, softener type, and reactive before disperse. Each forced setting is run through the gates. U-09, U-10, U-11 and U-12 can go FATAL (U-10 only when the route actually reaches PP-melting temperatures); U-18 and U-19 are warnings. Every failure comes with a one-click repair that clears exactly that setting, and the compiled safe route is shown beside it.
- **27 chemicals** (`process-effects.js`). The route's chemicals, plus the dye-bath chemicals and any extra finishes (DWR, wet-rub improver, GSM improver, hydrophilic softener, anti-creasing, oil remover), are added up into bending, friction, hairiness, weight, Δb*/ΔL* and wet-rubbing effects. The Hand card works with them: the softener is the hand engine's own finish, and every other chemical's bending and friction ride on top. The Studio's weight is deliberately not changed. All of it is tagged estimate.
- **Score changes:** Module 4 78 → 90 %, guardrails 83 → 92 %, Module 2 (fibre matrix) 64 → 68 %. **Overall ≈ 68 → 71 %.**
- **Still open in chemistry:** the per-chemical numbers have no mill measurement behind them, and Δb*/ΔL* are reported but not yet fed into the Colour card.

### Update, 2026-11-19: Phase C done

- **Virtual lab** (`virtual-lab-engine.js`, Studio card + Lab tab, `/studio/virtual-lab`):
  - **Air permeability** at 100 Pa, built from the loop geometry's open area, the thickness, and the flow through the fibre mass. A raised nap and a pile or loop yarn are layers in series. The calibration is a 30s jersey = 700 mm/s, tagged estimate.
  - **Thermal resistance** (Rct, clo) from the thickness and a fibre-and-air conductivity.
  - **End-use fit** for six uses.
  - The PRD's air-permeability formula (no thickness, no pore size) was not copied.
- **SPC.** A hundred rolls (up to 1000), seeded:
  - Yarn count, stitch length and finishing spreads add in quadrature.
  - Output: weight σ, Cp, Cpk, % of rolls in spec, a histogram, the width Cp, and a shade ΔE00 pass rate.
  - Cpk is given twice: machine set to target, and set from the Studio's number untried, with the model's own typical error as the bias.
- **Collar and cuff matcher.** The Studio itself works out a 1×1 lycra rib collar (×1.25 body weight) and a 2×2 cuff (×1.35): yarn count, gauge, diameter, GSM, width. It also says whether they can share the body's dye bath.
- **Score changes:** Module 6 58 → 80 %, end-use and lab coverage up. **Overall ≈ 71 → 75 %.**
- **Still open:** all the lab numbers are estimates until ISO 9237 air permeability, ISO 11092 Rct and a 100-roll weight log from a mill replace them. The Uster CVm is not yet linked to the count spread.

### Update, 2026-11-19: Phase D done

- **Lightbox** (`lightbox-engine.js`): a colour under D65, TL84, CWF, tungsten A and a UV black light, with ΔE2000 (Bradford-adapted), swatches, colour inconstancy, the optical brightener (a glow band at 440 nm, strong in daylight and UV, weak in a shop fluorescent, none under tungsten) and metamerism. With two measured curves the ΔE under each light is law. Without them it gives a risk from the dye classes and the depth, not an invented number. The Studio's real 3D view has a Light selector (D65 / TL84 / CWF / A). D65 and A are the CIE tables. TL84 and CWF are modelled and fitted to their published chromaticity, so tagged estimate.
- **U-20** now reads this: a dual-dye cloth (disperse + reactive) in a medium or dark shade is a high-risk WARN; measured curves above ΔE 0.8 are a WARN.
- **Burnout lab** (`burnout-engine.js`): which of six reagents dissolves which fibre, the weight left, the g/m², the residue, and per feed whether the yarn vanishes and whether what is left still holds together. A fleece's cotton ground dissolving in acid leaves loose polyester loops.
- **Barré simulator** (`defects-engine.js`): the feeder-to-feeder loop-length and count spread gives a cover spread, a lightness step ΔL*, visibility, the loop tolerance that keeps it invisible, and a stripe preview.
- **Universal grinning** (U-15): ΔE between face and back yarn, the visible share at rest, 20 % and 40 % stretch, and the rule ΔE > 25, porosity > 15 % and visible share > 8 %. It reads the back yarn colour you give; without one it says "not checked".
- **Score changes:** Module 5 55 → 72 %, guardrails 92 → 97 % (U-15 and U-20 now real), Module 2 grinning done. **Overall ≈ 75 → 79 %.**
- **Still open:** the burnout view is a table, not a 3D dissolve; the DWR droplet is not built; the lamp spectra and brightener strength need a spectrophotometer; the barré and grinning thresholds need a mill's rating.

---

## 2. Module-by-module

### Module 1: universal N-yarn GSM, ISO 139 and the reverse solver

| PRD item | Status | Where / note |
|---|---|---|
| GSM = Σ(Lᵢ·Texᵢ)/A_cell | Done | `fabric-studio.js`: per-feed ℓ × tex × wales × courses. A_cell = 1/(wpc·cpc), which is the same law. Wales and courses come from measured Kw/Kc, not guessed. |
| Mass share per yarn channel | Done | `fabric-studio.js` `feeds[].mass_share_pct` (elastane included) |
| Arbitrary N yarns (Y1…YN) | Partial | Weft: any number of feeds. Warp: any number of bars. There is no single `YarnChannel[]` contract across weft/warp/woven, and woven is a separate engine. |
| ISO 139 regain / RH correction | Partial | Regain is in `yarn-engine`, `blend-yarn-engine`, `melange-engine` and `materials`. There is no RH input, and no M_ISO139 term in the Studio GSM. |
| Finished → greige back-calculation (shrinkage, stage losses, chemical gain) | Done | `knit-plan.js`, `wet-processing-engine.js` (compaction, dye mass), `yarn-chemistry-engine.js` (retention per stage), cloth state (`knit-relax.js`) |
| Constrained reverse solver (target GSM + composition → tex, ℓ, gauge) | Done | `studio-invent.js` (evolutionary inverse design), `fabric-reverse.js`, `yarn-solver.js` |
| Snap to commercial counts | Done | yarn-solver / reverse |
| Unit-cell thickness T_cell | Partial | Only estimates: the hand engine's compression thickness, and fleece/terry pile. There is no general T_cell. |

### Module 2: N-yarn profiling, optical dilution, fibre matrix

| PRD item | Status | Where / note |
|---|---|---|
| Lab mass melange Σ Mᵢ·Shareᵢ | Done | `melange-engine.js` |
| Optical face/back visibility V_face(i) for any N | Partial | Plating, fleece binder and melange visibility exist per structure. There is no universal z-projection from the stitch graph. |
| Mode B: reverse-solve the yarn melange for an overall target | Done | Melange role target colour, and colour target `applyToInput` |
| Grinning alert (ΔE > 25, porosity > 15 %, V_face > 0.08) | Partial | Fleece and plating grin warnings exist. They are not ΔE- and porosity-based, so they are not universal. |
| Spinning systems (ring, compact, rotor, MVS, worsted, FDY/DTY/POY/ATY, core-spun, chenille, bouclé) | Done | `blend-yarn-engine.js`, `fancy-yarn-engine.js`, yarn-real 3D |
| Metallic / Lurex | Missing | No metallic yarn model |
| Twist Z/S, helix angle, spirality, auto-suggest alternate feeders above 5° | Partial | Helix and TPI are in the blend engine. Spirality is in the Studio and the stretch engine. "Alternate S/Z" is advice text only: there is no automatic feeder suggestion and no 5° trigger. |
| Uster IPI, hairiness, CVm → neps, fuzz, pilling, batch GSM variance | Partial | `uster-engine.js`, hairiness in 3D, pilling grade. CVm does not reach a GSM variance or SPC. |
| Slub diameter function + needle/hook clearance | Done | `fancy-yarn-engine.js` (slub vs hook/sinker check) |
| Elastane draft ratio → Tex_eff (window 2.0–4.2×) | Partial | The stretch engine takes the Lycra denier and feed type. The draft ratio is not an explicit input and has no window check. |
| 9-fibre density, regain and chemical matrix | Partial | `yarn-chemistry-engine.js` resistance table covers 13 fibres: cotton, linen, viscose, modal, tencel, bamboo, polyester, CDP, nylon, acrylic, wool, silk, elastane. **Polypropylene is missing from chemistry** (it exists in `materials.js`/`fibre-advisory.js`). |

### Module 3: feasibility gates and the four machine compilers

| PRD item | Status | Where / note |
|---|---|---|
| Gate 1: cohesion, weft knit | Done | `stitch-graph.js`: every needle knits, steady repeat, tuck stack, long hold, long float |
| Gate 1: cohesion, warp knit | Done | `stitch-graph.js` `holdsTogether` (bars, inlay) |
| Gate 1: cohesion, woven / multi-layer Z-binder | Missing | Woven deferred. No spacer/double-cloth layer-lock check. |
| Gate 2: volumetric packing Φ_cell | Partial | Not computed. We use the factory tightness-factor window (p5–p95 per family) and the stretch jam point, which are measured and arguably better. Φ is not reported. |
| Gate 3: machine mechanics, circular | Done | Gauge/count window, interlock clash (`clashesOnInterlock`), tuck and float limits |
| One 3-gate verdict, a repair vector, and a lock on render/export when FATAL | **Missing** | Checks are scattered warnings with no PASS/WARN/FATAL per gate. `studio-invent` repairs by search, but an analysed design gets no repair vector. |
| Circular compiler: needles, feeders, kg/h, RPM | Done | `knit-machine.js`, `fabric-studio.js` production block, `formulas/production.js` |
| CSP-vs-RPM speed cap | Missing | |
| Timing offset, sinker depth, plating tension window | Partial | Per-feed tension in cN and plating are modelled. There is no timing offset and no 1.15–1.65 tension-ratio rule. |
| Flat V-bed compiler (transfer, racking, intarsia, fully-fashioned) | **Missing** | The Studio button exists but is disabled ("Coming next"). |
| Warp-knit compiler (lapping notation, runner, bars) | Done | `warp-studio.js`, `warp-topology.js` |
| Warp shogging limit, run-in per rack, elastane let-off | Partial | Runner per rack is done. There is no shogging limit and no let-off tension. |
| Woven loom compiler (matrix, crimp, cover factor) | Partial | `woven-engine.js` and the woven reference layer are in the calculator, not in the Studio (deferred). |
| Woven reed clearance (U-08) | Missing | Deferred |
| Float snag (U-13) | Done | `stitch-graph.js` FLOAT_WARN |

### Module 4: wet processing and chemicals

| PRD item | Status | Where / note |
|---|---|---|
| Dyeing route compiler by detected fibres | Done | `yarn-chemistry-engine.js` (ordered route, per-stage conditions, recipe amounts) |
| Polyester dyed before reactive (U-11) | Done | Route order |
| Caustic on wool/silk (U-09) | Partial | The resistance table rates it 0 ("destroys"). It is not a hard block, and there is no auto-switch to a non-ionic scour. |
| Polypropylene route (dope-dyed only, ≤ 115 °C) (U-10) | **Missing** | PP is not in the chemistry engine |
| Peroxide killer before enzyme (U-12) | Partial | Exists only as fault-guide text in `wet-processing-engine.js`. It is not inserted into the route. |
| 27 chemicals each changing GSM, bending, friction, ΔL*/Δb*, hairiness, fastness | Partial | Recipe amounts exist. Finishes (softener, silicone, resin) change the hand. There are no per-chemical deltas wired into look, colour and hand. |
| Stenter overfeed, compactor, residual shrinkage | Done | `wet-processing-engine.js`, `quality-engine.js`, cloth state |
| Sanforizer (woven) | Partial | Mentioned in `quality-engine.js`. Woven deferred. |
| Surface finishing: brushing, peach, mercerising, calendering | Done | Brush/peach/mercerise are modelled into hand and look; calendering is in the wet guide |

### Module 5: 3D spline engine, shaders, five viewports

| PRD item | Status | Where / note |
|---|---|---|
| Knit loop/tuck/float → 3D tubes | Done | `knit3d/loop-geometry.js`, `topology-builder.js`, `fabric-mesh.js` |
| One mesher for knit, warp **and** woven | Partial | `warp-topology.js` shares the knit pipeline. Woven uses its own `woven3d/`. |
| Contact flattening (elliptical a/b ≈ 1.35) | Partial | Some flattening in `macro.js`. There is no contact relaxation at each crossing. The yarn twin solver exists but is not wired in. |
| Procedural fibre shader: twist, melange, neps, hairiness, slub, anisotropic sheen | Done | `yarn-material.js`, `dye-shader.js`, `hairiness.js`, `nap.js`, yarn-real view, fancy yarns, lustre |
| Viewport 1: 8K macro microscope | Done | Yarn real view, loop view, 4K/8K capture. Cross-section cutaway is partial. |
| Viewport 2: backlight and defect simulator (barré, pinholes) | Partial | Backlight and translucency are done (`fabric-light-engine.js`). **No barré / stitch-length tolerance stripes.** |
| Viewport 3: chemical burnout lab | **Missing** | |
| Viewport 4: orthotropic drape | Partial | `cloth-physics.js` (XPBD) and `cloth-sim.js` drape a swatch. They use their own `fabricMechanics` tables, **not** the hand engine's KES numbers. There is no garment drape. |
| Viewport 4: DWR lotus droplet | Missing | |
| Viewport 5: lightbox (D65/TL84/CWF/A/UV) with live ΔE2000 | Partial | `spectral.js` has D65 and A, and the melange metamerism check uses them. **There is no TL84, no CWF, no UV/OBA, and no lightbox view in the Studio.** |

### Module 6: virtual lab, trim, eco, export

| PRD item | Status | Where / note |
|---|---|---|
| Bursting strength (knit) | Done | `quality-engine.js`, blend card |
| Woven tensile / Elmendorf tear | Partial | Deferred with woven |
| Air permeability | **Missing** | |
| Thermal resistance (Clo / Rct) | Partial | Fleece and terry only |
| Pilling grade | Done | Studio and blend engine |
| Wash and rubbing fastness | Done | Chemistry, shade-spec |
| SPC: 100-roll Monte Carlo, σ, Cp/Cpk, ΔE pass rate | Partial | Each analysis carries a cross-validated likely range. There is no Monte Carlo and no Cpk. |
| Collar/cuff trim auto-matcher | **Missing** | Collar/cuff exist only as consumption and costing |
| Water and carbon with an eco-optimizer | Done | Carbon engine v2 with levers (`/carbon.html`) |
| Machine job card PDF | Done | `machine-export.js` (set-up PDF, PNG/BMP programme, CSV cam chart), tech-pack PDF |
| Costing / T&A workbook (.xlsx) | Partial | Cost sheet as PDF and in the UI. No .xlsx, no ERP stock link. API `/api/v1` exists. |
| U3MA / ZFAB with 8K PBR maps and CAD physics JSON | **Missing** | Planned as the last task |

---

## 3. The 20-rule guardrail register

| ID | Rule | Status | Note |
|---|---|---|---|
| U-01 | Topology disintegration | Done | Knit and warp. Woven deferred. |
| U-02 | 3D jamming (Φ > 0.74) | Partial | Tightness window, not Φ |
| U-03 | Sleazy (Φ < 0.14) | Partial | Low-tightness warning, not Φ |
| U-04 | Circular hook breakage | Done | Gauge/count window |
| U-05 | Interlock needle crash | Done | `clashesOnInterlock` |
| U-06 | Consecutive tuck overload | Done | Stack limit 4. The PRD's "2 for spun" is too strict; see section 6. |
| U-07 | Slub latch jam | Done | Fancy-yarn hook check |
| U-08 | Woven reed abrasion | Missing | Deferred |
| U-09 | Caustic on wool/silk | Partial | Warns; does not block |
| U-10 | Polypropylene melt | Missing | |
| U-11 | CVC temperature clash | Done | Route order |
| U-12 | Peroxide kills enzyme | Partial | Text only |
| U-13 | Float snag | Done | |
| U-14 | CSP vs RPM | Missing | |
| U-15 | Universal grinning | Partial | Structure-specific |
| U-16 | Plating inversion | Partial | Tension modelled, no ratio window |
| U-17 | Brushing tear | Partial | Note, no SL threshold |
| U-18 | Cationic softener on white/OBA | Partial | Cost model only |
| U-19 | Elastane heat-set window | Partial | Note "170–190 °C", no window check |
| U-20 | Metamerism D65 vs TL84/CWF | Partial | D65 vs A only |

---

## 4. Where KnitAdvisor already goes beyond the PRD

The PRD does not ask for these, and they matter for being world-class:

- **Measured constants and honest tags.** Kw, Kc and Ks come from 2,201 factory greige→finish records. Every output is tagged measured, calculated or estimated, and every analysis carries a cross-validated likely range. The PRD's "±0.8 % GSM accuracy" claim has no evidence behind it; ours is measured.
- **Floor learning.** Per-machine profiles come from logged rolls, and trial rolls override the model.
- **Construction-first Studio with inverse design.** Evolutionary search over needle programmes, plus the anonymous pooled prior (k ≥ 5).
- **Fabric hand (KES/FAST-style).** Tensile, shear, bending, compression, surface, and five hand scores.
- **Colour target.** Pantone/Lab/hex input, CIEDE2000 matching, K/S depth, %owf, and a lab-dip verdict.
- **Light and opacity engine.** Contrast ratio, plus show-through at 20 % and 40 % stretch.
- **Cloth states.** As knitted / wet / finished / after washing.
- **Stretch J-curve with yarn recovery and growth.** Melange from bale to cloth with a spectral metamerism check. Fibre-by-fibre 3D yarn with fancy yarns.
- **Commercial layer.** Costing with country tariffs, live yarn prices, RFQ, carbon v2, fabric scan (photo, so it stays inside the PRD's "no video AI" boundary), and the paid API.

---

## 5. Layout and architecture: change or not?

**Do not rewrite the stack.** The PRD names TypeScript/WASM, Next.js and Zustand. Our stack is plain JS engines on Express with a vanilla-JS Studio, covered by 86 test suites. A rewrite would throw away tested engines to gain nothing the PRD actually requires: our engines already run in milliseconds, inside the PRD's latency budget of 3–22 ms per module.

The useful change is three thin layers on top of what exists:

1. **Fabric DNA adapter.** Read and write the PRD's v3 JSON (`yarns[]`, `unitCell`, `machineCompiler`, `wetProcessingPipeline`, `feasibilityVerdict`) to and from the Studio input. Presets stay as starting macros, which already matches the Studio's construction-first rule.
2. **Feasibility engine (`feasibility-engine.js`).** Collect every existing check into Gate 1, Gate 2 and Gate 3 with the U-01…U-20 codes, a severity, and a repair vector. Lock export and the tech pack on FATAL.
3. **Studio layout additions** (no redesign):
   - A gate strip above the 3D view: three chips for Gate 1, 2 and 3, each PASS, WARN or FATAL, with the repair on click.
   - A **Yarn channels** panel listing Y1…YN with fibre, count, ℓ, mass share and face share, whatever the machine.
   - A **Lab** tab: bursting, air permeability, Clo, pilling, fastness, SPC.
   - A **Lightbox** control: D65/TL84/CWF/A/UV with ΔE2000.
   - A **Burnout** toggle in the cloth view.

The workbook layout needs fixes before it is used as a reference:
- It caps at 8 yarns.
- Fibre density is a nested IF.
- "Projected finished GSM" is a heuristic formula, not the PRD's own back-calculation.
- The Φ formula double-counts packing (see section 6).

---

## 6. Engineering corrections to the PRD itself

These are the head-of-engineering findings. The items below should **not** be built as written.

1. **Φ_cell limit 0.74 is the close-packing limit for spheres, not yarns.** Parallel cylinders pack to 0.907. Also, dᵢ already contains a fibre packing fraction (0.58), so Φ_cell measures envelope volume, not fibre volume. Fix: compute Φ, report it, and keep it warn-only until it is calibrated against our factory records and their tightness windows. Our measured tightness window remains the fatal test.
2. **Air permeability = 1800·(1−Φ)^2.2 has no thickness and no pore size.** Fix: build it from the open area (already computed in `fabric-light-engine.js`) and thickness with a Kozeny–Carman/orifice model, tagged estimate until mill readings exist (ISO 9237).
3. **U-04 "Tex_total > 21500/GG²" must apply to the yarn(s) inside one hook, not the cell total.** A fleece loop yarn is tucked and floated, not knitted, so the cell total would wrongly block every 3-thread fleece.
4. **U-06 "≤ 2 tucks for spun yarn" is stricter than practice.** Double and triple tucks on spun cotton are routine (pique, honeycomb, thermal). Keep our stack limit, tied to the factory records.
5. **Wool is internally inconsistent in the PRD.** It says wool felts above 105 °C, then routes wool/polyester at 115 °C. **Our own engine also holds a wool blend at 120 °C**, which is too hot; wool/polyester should be ≤ 105–110 °C with a wool protector. This is a real bug in our code to fix.
6. **"±0.8 % GSM accuracy" and "< 5 % drape error in CLO3D"** are promises without data. We publish measured ranges instead. Drape error can only be shown against a physical fabric-kit test of the same cloth.
7. **The numbers for the 27 chemicals** (GSM Δ, bending and friction multipliers, ΔL*/Δb*) and **the eco table** (CVC 95 L/kg, 10.8 kg CO₂e/kg, and so on) are unsourced. Use them only as estimate-tagged starting values. Our carbon v2 physics model stays the authority.
8. **The "9-fibre" matrix omits acrylic**, which is common in knits. We already cover 13 fibres; add polypropylene and keep acrylic.
9. **The ISO 139 correction is linear in RH.** Real regain follows a sorption isotherm with hysteresis. Acceptable as an estimate; label it so.
10. **These thresholds have no stated basis:** the CSP-RPM cap, the plating tension ratio 1.15–1.65, brushing SL 1.35 mm, back-scatter β = 0.65 and mercerising "+30 % lustre". Add them as **warnings tagged estimate**, never as FATAL, until the factory floor confirms them.

---

## 7. Build plan to close the gap (knitting first; woven stays deferred)

| Phase | Work | Closes | Gain |
|---|---|---|---|
| A | `feasibility-engine.js`: the 3-gate verdict, U-01…U-20 codes, repair vector, export lock. Fabric DNA v3 JSON import/export. Φ_cell reported (warn-only). Studio gate strip. | Module 3 core, register structure | +6–8 pts |
| B | Chemistry: polypropylene, hard blocks for U-09/U-10/U-12, U-18 and U-19 window checks, **wool temperature fix**, per-chemical deltas (estimate) into hand, look and colour | Module 4, 6 rules | +4 pts |
| C | Virtual lab: air permeability, Clo for any structure, SPC Monte Carlo from Uster CVm and machine tolerance (σ, Cp, Cpk), collar/cuff rib matcher from the body fabric | Module 6 | +5 pts |
| D | Lightbox: TL84, CWF, F-series, UV/OBA in `spectral.js`, U-20, a Studio lightbox. Burnout lab view. Barré / stitch-length-tolerance defect simulator. Universal grinning (ΔE + porosity + face share from the stitch graph). | Module 5, U-15/U-20 | +5 pts |
| E | Machine: CSP-RPM cap, elastane draft ratio, plating tension window, warp shogging limit, metallic yarn. **Flat V-bed compiler** (transfer, racking). | Module 3 / 2 | +5 pts |
| F | Drape: feed the hand engine's KES numbers into the XPBD cloth, then garment-level drape. DWR droplet. | Module 5 | +3 pts |
| G (last) | PBR map pack (albedo, normal, roughness, displacement, opacity) + glTF, then U3MA/ZFAB feasibility | Module 6 export | +3 pts |
| Deferred | Woven in the Studio: Gate 1 woven, U-08 reed, sanforizer, tear | Woven parts | +4 pts |

After A–G: about **90 %** of the PRD for knitting. What remains is woven, plus the parts that need a lab: calibration of Φ, air permeability, drape error and the chemical deltas against measured cloth.

---

## 8. What only measurement can finish

Software alone cannot reach "world-class". These need readings from a mill, and each one turns an *estimate* tag into *measured*:

- Opacity on black and white backing
- KES/FAST bending and shear
- Air permeability (ISO 9237)
- Thermal resistance (ISO 11092)
- Drape coefficient
- Lab-dip spectro under D65/TL84/CWF
- A 100-roll GSM log for Cpk

The floor-learning and calibration-intake paths already exist to take them.
