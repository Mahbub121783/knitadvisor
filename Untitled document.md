## **. Types of Knitted Fleece Fabric**

Fleece fabrics are primarily weft-knitted structures. Depending on the yarn setup and finishing processes, they are categorized into several types:

| Fleece Type | Construction | Key Characteristics | Common End-Use |
| :---- | :---- | :---- | :---- |
| **3-Thread Fleece** | Face, Tie, and Loop yarns | Heavy, highly insulated, loop back is usually brushed. | Winter hoodies, sweatshirts |
| **2-Thread Fleece** | Face and Loop yarns only | Lighter weight, less durable pile than 3-thread. | Light autumn wear, joggers |
| **French Terry** | 3-Thread or 2-Thread | The loop back is left **unbrushed** (loops remain intact). | Moisture-wicking activewear |
| **Polar Fleece** | 100% Polyester | Knitted, then heavily brushed and sheared on *both* sides. | Jackets, blankets, outdoor gear |
| **Microfleece** | Micro-denier Polyester | Extremely fine fibers, lightweight, high warmth-to-weight ratio. | Base layers, light pullovers |

## **2\. Technical Characteristics and Parameters**

A high-quality 3-thread fleece relies on the correct ratio and relationship between three distinct yarns.

* **Face Yarn:** Forms the technical face (outside) of the fabric. It provides durability, printability, and aesthetic appeal.  
* **Binding / Tie Yarn:** Invisible from the face, it locks the heavy loop yarn to the face yarn.  
* **Loop / Fleece Yarn:** Forms the large, float-like loops on the technical back, which are later mechanically brushed/raised to create the soft fleece pile.

### **Standard Parameter Combinations for 3-Thread Fleece**

| Target Fabric GSM | Face Yarn (Ne) | Tie Yarn (Ne / Denier) | Loop Yarn (Ne) | Machine Gauge |
| :---- | :---- | :---- | :---- | :---- |
| **240 \- 260** | 32s Combed Cotton | 75D Polyester / 40s Cotton | 20s Carded Cotton | 20G \- 24G |
| **280 \- 320** | 30s Combed Cotton | 75D Polyester / 40s Cotton | 16s Carded Cotton | 20G |
| **330 \- 360** | 26s Combed Cotton | 50D Polyester / 30s Cotton | 10s Carded Cotton | 16G \- 18G |
| **380+ (Heavy)** | 20s Combed Cotton | 50D Polyester | 8s Carded Cotton | 16G |

> **Key Rule of Thumb:** The Loop yarn is always the coarsest (thickest), the Tie yarn is the finest, and the Face yarn sits in the middle. The Stitch Length ratio is typically **Face : Tie : Loop \= 1 : 0.8 : 2.5**.

## **3\. Advanced Knitting Procedure (3-Thread Fleece)**

Fleece is knitted on specialized multi-track circular knitting machines (usually with 4 cam tracks) equipped with fleece sinkers. The sequence requires three separate yarn feeders to complete one structural course.

**1.Feeder 1: Laying the Loop Yarn:**Cam position: Tuck and Miss.  
The thick loop yarn is fed into the machine. The needles are arranged so that selected needles tuck the yarn, while the remaining needles miss (float) it. The sinkers push this floating yarn out to create large, extended loops on the back.

**2.Feeder 2: Interlocking with the Tie Yarn:**Cam position: Knit and Tuck.  
The fine binding yarn is introduced. It knits on the needles that tucked the loop yarn, and tucks on the needles that missed the loop yarn. This effectively anchors the massive loop yarn floats to the base structure so they do not pull out.

**3.Feeder 3: Knitting the Face Yarn:**Cam position: All Knit.  
The face yarn is fed to all needles. Every needle performs a knit stitch. This creates the smooth, continuous jersey-like surface on the front of the fabric, covering the tie and loop yarns completely.

**4.Mechanical Finishing (Raising/Brushing):**Post-knitting process.  
After knitting, the fabric passes over wire-covered cylinders in a raising machine. The sharp wires pluck and break the long loop yarn floats on the technical back, turning the loops into a soft, fuzzy pile (fleece).

> **Note on Feeder 2 (Tie yarn) variants:** the position-matched tie-tuck described above (knit where the loop tucked, tuck where it missed) is one real 3-thread technique. This app's actual generator (`backend/engine/fabric-derivatives.js` → `fleece_3_thread`, sourced from `220289760-Fleece-Fabrics.pdf`) implements the other common variant — **"invisible fleece"** — where the tie yarn is plated solid (knits every needle, same as the face) and only the loop yarn tucks/misses. See `advanced_fleece_fabrication_visualization.md` §2.1 for the exact 6-feeder unit cell this app renders.

## **4\. Crucial Factors Required for Flawless Knitting**

To avoid fabric defects (like drop stitches, uneven pile, or grinning, where the tie yarn shows through the face), the following mechanical factors must be controlled:

1. **Sinker Timing and Depth:** Fleece machines use special "high-nose" sinkers. The height of the sinker determines the length of the loop float. Improper sinker timing will cause the loop yarn to break during knitting.  
2. **Yarn Tension (Input):**  
   * Face and Tie yarns require **Positive Feeders** to maintain strict, uniform tension.  
   * The Loop yarn requires **Storage Feeders (Negative Feeders)** because its consumption is highly variable and much larger; positive feeding would snap the thick yarn.  
3. **Take-Down Tension:** If the take-down rollers pull the fabric too tightly, the loop floats distort, leading to uneven brushing later.

## **5\. GSM Variation Factors and Equations**

GSM (Grams per Square Meter) variation is the most common issue in fleece production. Because three distinct yarns interact, changing one parameter dynamically alters the entire fabric weight.

### **Primary Factors Affecting GSM**

* **Stitch Length (Loop Length):** The most critical factor. Increasing the stitch length of the loop yarn drastically increases fabric thickness but *lowers* the raw GSM if stitch density (CPI/WPI) drops simultaneously.  
* **Finishing (Brushing Loss):** Brushing physically tears the loop yarn fibers. A fabric can lose **4% to 8% of its total GSM** during the raising process as lint is vacuumed away.  
* **Compacting/Shrinkage Control:** Pushing the fabric wales together during stentering/compacting increases the CPI and WPI, directly driving the GSM up.

### **The Mathematics of Fleece GSM**

The GSM of a knitted fabric is governed by the stitch density (Courses and Wales per inch), the stitch length ($l$), and the yarn count ($Ne$).

For a basic single jersey, the theoretical GSM is calculated as:

$$GSM \= \\frac{CPI \\times WPI \\times l \\times 1.55 \\times 590.5}{1000 \\times Ne}$$  
*(Where $l$ is stitch length in mm, and $Ne$ is English Cotton Count).*

However, **for 3-Thread Fleece**, you must calculate the areal density of each yarn independently and sum them, adjusting for the fact that a complete structural course takes 3 feeders.

The advanced equation for 3-Thread Fleece GSM is:

$$GSM\_{Total} \= \\left( \\frac{S \\times l\_f \\times K}{Ne\_f} \\right) \+ \\left( \\frac{S \\times l\_t \\times K}{Ne\_t} \\right) \+ \\left( \\frac{S \\times l\_l \\times K}{Ne\_l} \\right) \- \\Delta\_{brushing}$$  
**Where:**

* $S$ \= Stitch Density per square inch ($CPI \\times WPI$)  
* $l\_f, l\_t, l\_l$ \= Stitch lengths of the Face, Tie, and Loop yarns (in mm)  
* $Ne\_f, Ne\_t, Ne\_l$ \= Yarn counts of the Face, Tie, and Loop yarns  
* $K$ \= Constant for metric conversion ($K \\approx 0.915$ when calculating from mm and Ne to GSM)  
* $\\Delta\_{brushing}$ \= The mass lost during the mechanical brushing process (typically 15–25 GSM depending on pile intensity).

> **Implemented:** `backend/engine/wet-processing-engine.js`'s `greigeGsmTarget()` now folds a 6% brush-loss factor (`BRUSH_LOSS_PCT.fleece`) into the grey↔finish GSM ratio for the fleece family, so the grey target is inflated to compensate for brushed-off mass — previously this model only accounted for area-shrink and dye add-on (both of which raise finished GSM), never this loss (which lowers it). Terry is excluded (loops stay uncut, unbrushed).

**To fix GSM variations on the production floor:**

If your fleece GSM is running **15g too light**, you cannot simply change the face yarn. You must adjust the **Loop yarn stitch length** (make the loops denser) or increase the **CPI (Courses Per Inch)** by tightening the machine take-down, which packs more structural rows into the same linear meter.

