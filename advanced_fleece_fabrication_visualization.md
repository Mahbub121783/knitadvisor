# Advanced 3-Thread Fleece Fabric Architecture: Engineering & Digital Visualization Parameters

This document provides a highly technical breakdown of 3-thread fleece fabrication, specifically structured for algorithmic interpretation, digital twin modeling, and procedural 2D/3D fabric generation. 

## 1. Yarn Geometry and Volumetric Parameters

For accurate 3D visualization, the physical space occupied by the yarns must be calculated before applying stitch topology.

### 1.1 Yarn Diameter Calculation
The theoretical diameter ($d$) of the yarn determines the collision bounds in a 3D simulation. For cotton and polyester blends typical in fleece:

$$d (inches) = \frac{1}{28.02 \times \sqrt{Ne}}$$
$$d (mm) = \frac{0.907}{\sqrt{Ne}}$$
*(Where $Ne$ is the English Cotton Count)*

**Application in 3D:** 
*   **Face Yarn (e.g., 30s Ne):** $d \approx 0.165 \text{ mm}$
*   **Tie Yarn (e.g., 75D Polyester $\approx$ 70s Ne):** $d \approx 0.108 \text{ mm}$
*   **Loop Yarn (e.g., 16s Ne):** $d \approx 0.226 \text{ mm}$

> **Implementation note:** this is the single canonical yarn-diameter formula used everywhere in the app — `frontend/js/knit3d/fabric-mesh.js` (`yarnDiameterMm`, `yarnRadius`) and `frontend/js/pattern-renderer.js` (`resolveRowDiameterScale`, notation line-weight) both compute from this exact constant (`0.907/√Ne`, equivalently `0.03733·√Tex` since $Tex = 590.5/Ne$). The 3D renderer previously used an uncorrelated constant (`0.0444·√Tex`, ~19% thicker) for the yarn tube only; it has been reconciled to this formula so the 3D view and this doc now agree.

### 1.2 Twist Multiplier and Surface Bump
The Twist Multiplier (TM) affects the visual texture (bump map) of the individual yarns. 
*   $TPI \text{ (Twists Per Inch)} = TM \times \sqrt{Ne}$
*   Fleece loop yarns typically use a low TM (3.2 - 3.4) to facilitate the brushing process, meaning the 3D model should render the loop yarn with lower torsional twist angles and higher fiber hairiness.

---

## 2. Structural Topology & Loop Geometry

Fleece cannot be modeled using a standard plain jersey (Peirce's model). It requires a multi-layered topological approach, often utilizing variations of the **Leaf and Glaskin 3D loop model** tailored for multi-track tuck/miss structures.

### 2.1 The Unit Cell — "Invisible Fleece" (as implemented, PDF-verified)
This app renders the **"invisible fleece"** construction: the tie/plated yarn is knitted at **every** needle (plated in with the face yarn) rather than tucking at specific needles — that's precisely what hides the tie-in from the technical face. The loop yarn is the only one that tucks/misses, 1-in-4 needles per pass, and the pass alternates track (needle 4, then needle 2) across two knit-pairs to build the full 4-wale repeat. This is the exact structure sourced from `220289760-Fleece-Fabrics.pdf` and encoded in `backend/engine/fabric-derivatives.js` (`fleece_3_thread`), and it's what the notation grid, 2D texture and 3D loop topology all actually generate:

| Feeder | Yarn Type | Needle 1 | Needle 2 | Needle 3 | Needle 4 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **F1** | Plated / Tie-in | Knit | Knit | Knit | Knit |
| **F2** | Face / Ground | Knit | Knit | Knit | Knit |
| **F3** | Loop / Fleece (Thick) | Miss | Miss | Miss | Tuck |
| **F4** | Plated / Tie-in | Knit | Knit | Knit | Knit |
| **F5** | Face / Ground | Knit | Knit | Knit | Knit |
| **F6** | Loop / Fleece (Thick) | Miss | Tuck | Miss | Miss |

6 feeders / 4 wales per repeat. The loop yarn's tuck position shifts by one track between F3 and F6 (needle 4, then needle 2) so a full 4-wale cycle needs two knit-pairs, not one.

> **Alternate model (not what's implemented here):** some sources/machines instead run a simpler 3-feeder cell where the **tie yarn's own action is position-matched to the loop yarn** — it knits wherever the loop yarn tucked and tucks wherever the loop yarn missed (`Untitled document.md` §3 describes this variant: "[the tie yarn] knits on the needles that tucked the loop yarn, and tucks on the needles that missed it"). That's a real, different technique (the tie yarn is picked out at specific needles rather than plated solid) — it is **not** the structure this app generates, so don't use its 3-row table to spec the notation/3D/GSM generator; use the 6-row table above.

*(Note: The exact miss/tuck ratio and track-shift cascade depends on whether it is a 1:2, 1:3, or 1:4 diagonal fleece arrangement — see `fleece_diagonal` for the 12-feeder cascading-tuck variant.)*

### 2.2 Stitch Length ($l$) Ratios
For procedural generation, the spline length of each loop must adhere to standard mechanical ratios:
$$l_{face} : l_{tie} : l_{loop} \approx 1 : 0.85 : 2.5 \text{ to } 3.0$$

### 2.3 Fabric Thickness Estimation ($t$)
The pre-brushed thickness of the fabric is the sum of the interacting loop diameters at the binding points:
$$t = 2(d_{face}) + d_{tie} + 2(d_{loop})$$
Post-brushing, the thickness increases exponentially due to the erection of broken loop fibers, requiring a volumetric scattering density function in 3D renderers rather than solid geometry.

---

## 3. Advanced GSM & Mass Distribution Equations

To programmatically calculate output GSM based on input parameters (Count, Stitch Length, CPI, WPI), use the composite areal density equation.

### 3.1 Composite GSM Equation
$$GSM = K \times S \times \left( \frac{l_f}{Ne_f} + \frac{l_t}{Ne_t} + \frac{l_l}{Ne_l} \right)$$
**Where:**
*   $S = CPI \times WPI$ (Stitch Density per square inch)
*   $l_f, l_t, l_l$ = Stitch lengths (in mm)
*   $Ne$ = Yarn count in English Cotton Count. *(Note: Convert denier to Ne for the tie yarn: $Ne = 5315 / \text{Denier}$)*
*   $K = 0.915$ (Metric conversion constant)

> **Brushing mass loss ($\Delta_{brushing}$):** raising/brushing tears loop-yarn fibre from the floats and vacuums it away as lint — mass leaves the fabric, so the finished GSM above is *lower* than what the grey (pre-brush) fabric actually weighed. See `Untitled document.md` §5 for the full $GSM_{Total}$ equation with this term subtracted. **Implemented** in `backend/engine/wet-processing-engine.js` (`greigeGsmTarget`, `BRUSH_LOSS_PCT.fleece = 0.06`): the grey→finish GSM model folds a 6% brush-loss factor into `totalRatio` alongside area-shrink and dye add-on, so the grey target is produced heavier to compensate. That 6% is distinct from `production-data.js`'s `PROCESS_LOSS_MODIFIER.brush = 1.5%` — the latter is a booking/kg-yield loss figure (real mill data) layered on top of general cutting/handling waste, not a per-m² GSM correction; the two answer different questions and intentionally coexist.

### 3.2 Porosity and Cover Factor ($K_c$)
For 2D visualization (opacity maps) and thermal properties, the cover factor defines how much light/air passes through the unbrushed fabric base:
$$K_c = \frac{1}{\sqrt{Ne_{face}} \times l_{face}}$$
A tighter face (higher $K_c$) prevents the tie yarn from "grinning" (showing through to the face). 

---

## 4. 2D / 3D Visualization Map Data

When translating this structural data into PBR (Physically Based Rendering) materials for digital fabric generation, map the parameters as follows:

### 4.1 Diffuse / Albedo Map
*   **Front (Technical Face):** Distinct V-shaped interlocking loops. High structural regularity.
*   **Back (Technical Back - Unbrushed):** Long horizontal floats. 
*   **Back (Technical Back - Brushed):** Requires a procedural noise texture to simulate randomized fiber clustering and fuzz.

### 4.2 Normal & Displacement Maps
*   **Front Displacement:** Set to low amplitude. The face is knitted uniformly (all-knit), creating a relatively flat topology.
*   **Back Displacement (Unbrushed):** High amplitude. The loop yarn floats create significant height variation. Use a sine-wave based height map aligned with the course direction.

### 4.3 Simulation Physics (Cloth Properties)
If integrating with 3D physics engines (e.g., Marvelous Designer, Clo3D, or custom WebGL physics):
*   **Bending Rigidity ($B$):** High. Fleece is thick and resists bending.
*   **Shear Stiffness ($G$):** Moderate. The interlocking 3-yarn structure prevents heavy skewing compared to single jersey.
*   **Friction Coefficient ($\mu$):** 
    *   Face: Low ($\approx 0.2 - 0.3$) - smooth jersey surface.
    *   Back (Brushed): Extremely High ($\approx 0.7 - 0.9$) - inter-fiber entanglement.
    *   Thickness collision offset: Set to $\ge 2.5\text{mm}$.

---

## 5. Knitting Machine Operational Parameters

For systems tracking manufacturing viability:
*   **Gauge ($G$):** Needles per inch. Directly dictates the maximum yarn thickness (Face Ne must be roughly $G \times 1.5$).
*   **Sinker Height ($h_s$):** The mechanical determinant of $l_{loop}$. In software logic: $l_{loop} \propto h_s$.
*   **Yarn Tension Variables:** 
    *   Face/Tie: Constant tension (Positive feed).
    *   Loop: Variable tension (Storage feed) due to the alternating Tuck/Miss sequence creating sudden slack/pull dynamic loads.
