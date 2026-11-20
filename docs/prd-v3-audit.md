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

### Update, 2026-11-19: Phase E done

- **U-14, speed against the yarn.** The CSP is worked out from the yarn's breaking force (lea ≈ 160 strands × 0.7 efficiency; a 30s combed cotton reads ≈ 2600) when the mill has not given one. The cap is min(35, CSP ÷ 85 × 30 ÷ dia). An estimated CSP gets a 10 % margin before a warning; a given CSP none.
- **Elastane draft window** 2.0–4.2× (U-19): slack and over-drawn are named separately, with a repair into the window.
- **Plating tension** (U-16): a Back/face tension input in the plated-yarn card; 1.15–1.65 passes. The plating yarn is now a role of its own, so its fibres, chemistry and form are worked out too.
- **Metallic (Lurex) film yarn**: a fancy form whose count is film width × thickness × 1.4. It has sparkle, no hair, and is stiff. Never knitted alone: U-07 warns if it is the ground yarn. Caustic and heat above about 130 °C attack the aluminium: U-09 warns. Its 3D is a bright filament, not a ribbon.
- **Flat V-bed compiler** (`vbed-compiler.js`, the "Flat V-bed" choice in "What are you making?"): gauge 5–18, the envelope 24000 ÷ GG², transfers, racking ±6 against the yarn's elongation, panel width, courses an hour and kg/h from the carriage, and the carriage programme pass by pass. The circular-only rules (U-05, U-14) become n/a, and U-04 uses the flat envelope with a repair that sets the gauge.
- **Warp shogging** was already in `warp-studio.js` (a limit per machine class): earlier audit row corrected.
- **Score changes:** Module 3 61 → 80 %, Module 2 68 → 74 %, guardrails 97 → 98 %. **Overall ≈ 79 → 84 %.**
- **Still open:** the flat-bed fabric uses the circular factory records (so panel weight is an estimate until a trial panel is weighed); no fully-fashioned shaping, intarsia or cable-by-cable stitch-cam programme; no machine-maker file export; the V-bed production and efficiency are typical, not a data sheet.

### Update, 2026-11-19: Phase F done

- **Drape from the tester numbers** (`drape-engine.js`, `POST /studio/drape`, a Drape & drop card and a Drape tab). The cloth is a lattice of particles whose stiffnesses are the hand engine's own numbers: stretch = load ÷ extension along each direction, shear = G, bending = B along the courses and the wales, weight = GSM. It is hung under gravity (implicit Euler with conjugate gradients), and a Cusick test (30 cm sample, 18 cm clamped discs) reads the drape coefficient and the folds.
  - Hand-engine cloths read 35 % for a limp silk, 44-49 % for a cotton jersey, ~87 % stiff, ~98 % board. A softener lowers it, a resin finish raises it.
  - The coefficient is the mean of two lattices and the spread is shown as the range.
  - The first solver (position-based) was rejected: it was 6× too soft on a cantilever against theory. The final one matches an analytic cantilever within about 30 % (coarse lattice) and orders cloths correctly.
- **Garment-level drape**: a circular skirt hung from a 66 cm waist ring (hem sweep, hang, folds). It is one garment, not a pattern-piece garment: no body collision, no seams.
- **Water drop** (`repellency-engine.js`): contact angle from the fibre's flat angle and the loop's solid share (Cassie–Baxter for a hydrophobic surface, Wenzel for a wetting one), spray rating, roll-off tilt, wicking, and the angle at 20 % stretch. DWR choices: none, non-fluorinated (~108° flat), fluorocarbon C6 (~118° flat). The Drape tab animates the drop as the cloth is tilted. A polyester jersey with C6 reads ~140° (spray 90, rolls off at ~12°); untreated cotton wicks.
- **Score changes:** Module 5 72 → 88 %. **Overall ≈ 84 → 87 %.**
- **Still open:** no self-collision, so folds may pass through each other (a very limp cloth reads a little low); no garment body, seams or pattern pieces; one skirt only; the stretch stiffness is capped at 30 N/m for speed (a drape load is tiny); a Cusick reading of the mill's own cloth is what turns the number from estimate into measured.

### Update, 2026-11-19: Phase G done (the last phase)

- **Material package** (`Make the ZIP` under the real view; `material-package.js`, `pbr-package.js`, `studio-pbr.js`, `POST /studio/material`): one ZIP of open formats.
  - **Maps.** One tile of the real knitted structure (a whole number of repeats, so it tiles without a seam), read back from the real view's own bake: albedo with the opacity in its alpha, a tangent-space normal (OpenGL, +Y up), roughness, ambient occlusion, displacement (levels-stretched), opacity, and ORM packed for glTF. The jersey's V-shaped wales show in the height, normal and occlusion maps. Resolution is the tile's own (up to 2048 px a side).
  - **glTF 2.0 binary** (`swatch.glb`): a 30 cm swatch whose UVs repeat the tile, or the draped Cusick sample if the drape has been run. Maps embedded, a REPEAT sampler, `KHR_materials_sheen` for the yarn fuzz, an alpha mask when the cloth has holes.
  - **physics.json**: weight, thickness, bending, shear, stretch under load, friction, on knit axes (course = weft, wale = warp), in SI and in the tester's units. Drape, comfort and water numbers are added when they have been worked out.
  - **README**: the conventions, what each file is, and what it rests on.
- **U3MA, ZFAB and SBSAR are not written, and the package says so.** They are closed formats with no public specification, and CLO's fabric properties are in its own units from its fabric-kit calibration, which a conversion would only guess. The PNG maps and the physics numbers are what those tools' material editors take. This is the one PRD deliverable that stays open.
- **Structurally checked, not opened in CLO or Browzwear**: the glb's magic, lengths, 4-byte alignment, accessor bounds, UV tiling and embedded images are tested; the ZIP is read back by a real unzip; the PNG by zlib. A viewer has not loaded the file.
- **Score changes:** Module 6 80 → 90 % (the U3MA/ZFAB item stays at zero). **Overall ≈ 87 → 90 %.**
- **What is still open across the whole PRD:** woven in the Studio (deferred by choice); the closed CAD formats; Lurex as a 3D ribbon; a real viewer's check of the glTF; the garment as pattern pieces on a body; and above all the mill's own readings (Cusick, KES/FAST, opacity, air permeability, spectrophotometer, a 100-roll weight log, ISO 9237/11092), which turn the estimate tags into measured ones.

### Deep audit, 2026-11-19: scored by running the system against the PRD and the Excel, not by feature presence

Method: Done = 1, Partial = 0.5, Missing = 0 for presence; then every number the Excel or the PRD gives was run through the real code and compared. Scratch probes: audit1-5.js.

**Measured facts**
- 63 of 63 templates solve to the target GSM (62 within 0.8 %, worst 1.9 %); 150 random designs with every card on: 0 crashes, 0 non-finite numbers. Latency 7-10 ms plain, about 60 ms with every card on. 12 yarn channels, each with its own fibre and count, work.
- Unit-cell law GSM = sum(L.Tex)/A_cell against the Studio: 35/63 within 2 %, 54/63 within 10 %. Worst: fleece_2/3_thread and french_terry (+56 to +103 %), bourrelet/relief_single (-33 %). Cause not yet proven; the likely suspects are the fleece course count (cpc) being counted twice and the fleece thickness in Phi being too low. Both open.
- Excel tab 2 scenario 1 (micro jersey): law 143.8 GSM, Studio 134 (-6.8 %). Scenario 3 (CVC fleece): 266.3 vs 266 (solved to the target, but Phi 0.53 against the Excel's 0.41).
- Excel tab 3 (9 fibres x 4 chemicals): 29 of 36 cells match; 6 differ by one class (ours WARN where the Excel says SAFE), 1 by more (nylon/hypochlorite: ours WARN, Excel FATAL).
- Excel tab 4: needles 2638 vs 2639 (rounding). The woven Peirce saturation 67.6 % agrees with the Excel's K_total 0.681.
- Excel tab 5: routes are generated per blend and are sensible (heat-set first for elastane, disperse before reactive for CVC); not compared step by step.
- Excel tab 6 carbon: cotton reactive 8.13 vs 7.5; CVC 9.02 vs 10.8; polypropylene 4.62 vs dope-dyed 4.8; wool/poly 40.6 vs 10.2 (the Excel figure ignores wool's fibre footprint; ours is the sourced one).
- PRD Test 4 (wool + NaOH): FATAL, export locked. PRD Test 2 (10 % melange in a yarn): the cloth composition carries it by mass share (10 % in the yarn gives 6.3 % in the cloth for the grey_90_10 preset), by law.
- DNA schema 3.0: top-level, unit-cell, machine, feasibility contracts complete; yarn node is missing twistDir, tm, csp, uster, melangePercent, slub, elastaneDraftRatio, tensionCN, colorLab; topology nodes and activeChemicals absent.

**Fleece fix, 2026-11-20 (first of the five).** Cause found: the fleece's measured Ks (10.GSM.l/tex) was taken on the whole yarn, the floating loop yarn included, so Ks / Kw / l over-counted courses by the loop yarn's mass share (about 1.6x on a 3-thread, 2.0x on a 2-thread). The cpc is now scaled to the knitting yarn's share of the mass (fleece family with a loop feed only; weight is unchanged). The hand model's T0 also gave a fleece the thickness of its jersey ground (0.62 mm); it now adds a loop-yarn layer of 2.2 loop diameters (modelled, about 1.17 mm, French terry about the same; brushing raises it). Result: law vs Studio on the fleece family from +56..+103 % to within 1.5 %; Phi 0.64 to 0.34. Templates within 10 % of the law: 54/63 to 58/63. Still outside 10 %: bourrelet and relief_single (-33 %), half_milano (-25 %), blister_single (-17 %), texipique (-15 %): tuck/relief cells whose course count in the cell is approximate. 94/94 suites pass; regression test added to fabric_dna.test.js.

**Composition solver, 2026-11-20 (second of the five).** `target.composition` ("95% CO 5% EL" or {fibre: %}) now runs the Studio backwards (`composition-solver.js`, a "Target composition" field in step 3): the elastane's denier, draft and feeding are solved for its mass share (draft held to 2.0-4.2, 3.0 preferred; 2-12 % on jersey, rib and interlock land within half a point), the remaining fibres become the yarn's blend, and with `composition_roles` ({face:'cotton', loop:'polyester'}) the count of the minor fibre's yarn is solved. The answer is checked by running the Studio on the solved design and comparing the cloth's fibre shares; the report says what was set, what the cloth is, the miss in points. Refusals in words (total off 100, unknown fibre name, a fibre no role carries, 30 % or more elastane, a clash with the blend/melange cards). Also fixed on the way: an assumed loop yarn is now spun of the ground's own blend. Basis stated: mass as fed, not dry mass with regain; staple yarns assumed. 95/95 suites.

**DNA yarn node, mill readings, open material formats, 2026-11-20 (third to fifth).**
- **DNA schema 3.0 contract is complete** (the audit script finds no missing key). Each yarn now carries twistDir, tm (alpha_e), csp, uster (U %, CVm, thin/thick/neps, IPI, hairiness H), melangePercent, slub, elastaneDraftRatio, tensionCN, colorLab, and a `detail` object with the basis of each (twist TPI/TPM, CSP basis and breaking force, tension range, colour source). The stitch graph has `nodes` for both beds (id, feed, needle, op, yarnId, x/y mm, z) and the wet pipeline has `activeChemicals` from the 27-chemical table (with or without the Chemistry card). A given CSP and twist direction survive the round trip.
- **Mill readings** (`mill-readings.js`, step "3b Mill readings" in the Studio): thickness (ISO 5084), air permeability (ISO 9237), Rct (ISO 11092) and the Cusick drape coefficient replace the estimate they measure, are tagged `measured`, keep the model's figure as `model_value`, and report the gap in per cent. Thickness feeds the packing gate, the lab and the hand numbers. A reading belongs to that cloth and lot only. This is the mechanism by which an "estimate" tag becomes "measured": the readings themselves can only come from the mill's tester.
- **Open material formats** in the material ZIP: a MaterialX 1.38 document (`material.mtlx`) and a USD ASCII file with a UsdPreviewSurface (`material.usda`), both wired to the six PNG maps. Written to the published specifications; tested for well-formedness and wiring, NOT opened in Substance, Maya, Blender or Quick Look here.
- **Still not written, and why:** U3MA (Browzwear), ZFAB (CLO) and SBSAR (Adobe) are closed formats with no public specification. Writing them would mean guessing bytes that cannot be checked here, so they are not written and the README says so. Their material editors take the PNG maps and physics numbers that are in the package; MaterialX and USD cover the open route.
- 96/96 suites.

**Development sheet v1, 2026-11-20.** The R&D flow the CEO asked for: eight inputs (composition, GSM, colour depth, diameter, brushing/peach, optional width and shrinkage, and the drawn design) give one sheet (`dev-sheet.js`, `POST /studio/dev-sheet`, the "R&D" card and "Development sheet" tab in the Studio): fabric type and confidence, yarn with elastane on a full or half feeder, machine set-up (gauge, diameter, feeders, RPM, stitch length, VDQ course length, cam chart), greige, dyeing route with temperature, time, pH, chemicals and dye amounts, a finishing prescription (heat-set, stenter, compaction, brushing) and the finished cloth, plus first-roll instructions. For a structure the factory records do not cover, the stitch-graph laws are tried and trusted only where their stitch length gives a tightness factor inside the factory window of the family; otherwise the family table is kept and the gap between the two engines becomes the stated band. Not done: the quality-pulley reading (needs the machine's own reference settings), the stenter temperature / speed / overfeed are typical settings not measurements, chemistry still does not change the cloth's size, and no sheet is exact: the accuracy line says so and points to a trial roll. 97/97 suites.

**Development sheet, steps 2-5 completed, 2026-11-20.**
- **Step 2, the R&D interface:** Simple (default) and Expert modes (`studio-mode.js`). Simple shows the R&D card, what you are making, start-from and bed, trial rolls, save, machine files and the needle programme; tabs Development sheet, 3D fabric, Fabric & yarn, Notation, Cam & needle set-out. The 19 research cards and tabs are hidden, not removed, and still feed the answer in Expert. The R&D card's composition, GSM, diameter, brushing, width and shrinkage are written into the fields the engine already reads, so the 3D view and the notation follow them. The sheet is live: after the first press it re-works itself whenever the drawing or an input changes (rib, fleece, Lacoste checked in headless Edge), and it opens with what the drawing decided (bed, gating, repeat, yarn roles, knit / tuck / miss / transfer counts, floats).
- **Step 3, finishing prescription:** an ordered sequence (heat-set, wet processing, squeeze, stenter, compact, peach / brush, check), the water to evaporate per m² (pick-up less regain, physics), compaction needed to meet the buyer's shrinkage limit, overfeed; temperatures and speeds stay typical settings and are tagged so.
- **Step 4, chemistry to size:** `process-dimensions.js` (and `out.process_dimensions`): no heat-set on elastane, hot heat-set on polyester, wool in an alkaline or hot bath (felting), viscose / modal, a dark shade, a resin finish each move the residual shrinkage; shown beside the usual route's figure with the reason. Estimate: directions are textile practice, sizes are typical; the Studio's measured weight and width are not changed.
- **Step 5, VDQ pulley:** one or two of the machine's own reference settings (saved in the browser) give every feeder's pulley reading in the sheet.
- 98/98 suites.

**Final pre-presentation audit, 2026-11-20.** All 63 templates x 3 compositions (100 % CO, 95/5 CO/EL, 60/40 CVC) through the development sheet: 189 sheets, every one with yarn, machine set-up, cam chart, greige, dyeing, finishing and finished cloth, finished weight on target. Fixed: the Single Relief template knitted its two beds on different feeds only (two cloths that never join, U-01 FATAL on every composition): its fourth feed now knits both beds (the tie course); a plush / terry packing gate used the ground thickness without the pile (Phi > 1, FATAL on CVC): the pile height is now added; a plush sheet carried no accuracy band: it now says +/-25 %. Weight bands across the 189 sheets: +/-5 % on 16 (structures in the factory records), +/-14 % on 78 (stitch-graph laws, inside the factory tightness window), +/-25 % on 46, wider (to +/-62 %) where the two engines disagree and the gap is stated. Direct to machine without a trial: the needle programme, cam chart, track set-out, gauge, diameter, feeders and the yarn per feeder; the stitch length is a starting setting inside the stated band; a first roll calibrates it.

**Gaps that hold the score down**
1. "Zero presets": the Studio still has 63 templates and 18 family branches in the solver.
2. No composition-vector solver: the elastane share is an input, not solved from a target composition.
3. Fleece family: law/Studio disagreement and Phi (above).
4. Woven is a separate calculator, not inside the Studio, the gates or the DNA.
5. No .xlsx costing/ERP export; 3D and the tech-pack are not feasibility-locked (only /studio/export is).
6. U3MA/ZFAB/SBSAR not written (closed formats).
7. Every estimate tag still waits for the mill's own readings.

**Score**
| Area | Score |
|---|---|
| 1 Architecture / unit-cell / DNA / zero presets | 70 % |
| 2 N-yarn compiler | 85 % |
| 3 Feasibility gates | 88 % |
| 4 Machine compiler | 80 % |
| 5 Chemistry (27 chemicals, multi-fibre) | 85 % |
| 6 Lab, lightbox, eco, export | 80 % |
| 7 Woven in the Studio | 25 % |
| PRD overall (with woven) | about 74 % |
| PRD overall (knit only) | about 80 % |
| Excel overall (tabs 1-6) | about 81 % |
| **Both together** | **about 77 % (about 81 % knit only)** |

**Re-score after the fleece fix, composition solver, DNA node, readings and open formats (2026-11-20):** architecture / unit cell / DNA about 85 % (law within 10 % on 58 of 63 templates, DNA contract complete, 63 templates remain), N-yarn compiler about 92 %, feasibility about 90 %, machine about 80 %, chemistry about 85 %, lab / export about 86 %, woven in the Studio still 25 %. PRD overall about 78 % with woven, about 86 % knit only; with the Excel (about 85 %) both together about 81 % (about 86 % knit only). These are the judged scores of the same table, moved only by what was built and tested since.\n\nThe earlier "about 90 %" counted features present. Against measured agreement it is about 77 %. The fastest points: fix the fleece cpc/thickness, a composition solver, the DNA yarn fields, an .xlsx workbook, and woven inside the Studio.

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
