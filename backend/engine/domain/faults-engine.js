/**
 * KnitAdvisor Knitted Fabric Faults Engine
 * Source: Understanding Textile for Marchandiser pp.494-500
 * Rule-based diagnosis and complete faults knowledge base
 */

const FAULTS_DATABASE = [
  {
    id: "holes",
    name: "Holes (Broken ends, holes or cracks)",
    description: "Holes are the result of cracks or yarn breakages. During stitch formation the yarn had already broken in the region of the needle hook. Depending on the knitted structure, yarn count, machine gauge and course density, the holes have different sizes.",
    symptoms: ["holes", "cracks", "yarn_breakage", "rupture"],
    yarn_causes: [
      "High yarn irregularity / thick-thin places",
      "Incorrect yarn input tension setting (yarn running-in tension is too high)",
      "Poorly lubricated yarns / high coefficient of friction",
      "Weak places in yarn which break during stitch formation",
      "Knots, slubs, or foreign matter in the yarn path",
      "Yarn is too dry, losing its natural elasticity"
    ],
    machine_causes: [
      "Yarn trapped between the needle cheek taper and closing latch (yarn damage)",
      "Stitches set too small (high tightness), causing difficulty in casting-off",
      "Incorrect relation between cylinder and dial loop length",
      "Badly set yarn feeder position or feeding angle",
      "Defective knitting elements (worn needles, sinks, cams)"
    ],
    remedies: [
      "Reduce yarn feed tension and optimize yarn path geometry",
      "Ensure proper yarn waxing and conditioning (yarn lubrication)",
      "Readjust stitch cams (couliering) to increase loop length if stitches are too tight",
      "Check feeder alignment and adjust distance from needle line",
      "Inspect needles and dial elements for burrs, replace worn hooks or latch cheeks"
    ]
  },
  {
    id: "drop_stitches",
    name: "Drop Stitches",
    description: "These are the result of a defective needle or when a yarn is not properly fed during stitch formation, i.e., not properly laid-in the needle hooks. These are the unlinked knitted loops.",
    symptoms: ["dropped_loops", "vertical_gaps", "unlinked_loops"],
    yarn_causes: [
      "High yarn twist causing loops to snarl and jump out of hooks",
      "Very dry material lacking flexibility to stay in the hook",
      "Insufficient yarn tension leading to high yarn vibrations and slack"
    ],
    machine_causes: [
      "Improper setting of the yarn feed angle (badly set yarn feeder)",
      "Closed needle latch - a wale of dropped stitches will be produced until latch is opened",
      "Broken needle hook",
      "Low fabric take-down tension, allowing loops to fall out of the hook",
      "Wrongly threaded-in yarn feeder",
      "Dial loop length not properly related to cylinder loop length, causing loops to jump out",
      "Bad take-up mechanical mechanism"
    ],
    remedies: [
      "Verify needle hook and latch condition; replace bent or broken needles",
      "Adjust yarn feeder height and horizontal angle so yarn is laid directly inside the hook",
      "Adjust fabric take-down tension to keep loops taut below the needle line",
      "Ensure latches are opened by latch openers or brushing devices before feeding",
      "Verify relation between dial and cylinder stitch settings"
    ]
  },
  {
    id: "cloth_fallout",
    name: "Cloth Fall-out (Pressed-off stitches)",
    description: "It is an area consisting of drop stitches lying side by side. They can occur either when a yarn is laid-out or when it breaks without any immediate connection. Empty needles with closed latches run into the yarn feeder and remove the yarn from following hooks.",
    symptoms: ["large_holes", "pressed_off", "cloth_drop", "machine_empty"],
    yarn_causes: [
      "Yarn breaks completely before reaching the yarn feeder",
      "Yarn package winding faults, poor package build-up causing snags and breaks"
    ],
    machine_causes: [
      "Fibre fly or lint blocking the yarn guides, feeders, or stop-motions",
      "Defective yarn stop-motion mechanism failing to stop machine on break",
      "Empty needle with closed latch running into the yarn feeder"
    ],
    remedies: [
      "Clean yarn guides, feeders, and yarn storage units of lint and fibre fly",
      "Check and adjust yarn package placement and tension disks",
      "Test electronic yarn break detectors (stop-motions) to ensure instant machine stop on yarn breakage",
      "Ensure proper functionality of the latch opening brushes"
    ]
  },
  {
    id: "needle_marks",
    name: "Needle Marks (Vertical Stripes)",
    description: "Vertical stripes observed as longitudinal gaps in the fabric. The space between adjacent wales is irregular and the closed appearance of the fabric is broken. Often the result of a meager setting, i.e., yarn count too fine for machine gauge or incorrect course density.",
    symptoms: ["vertical_stripes", "longitudinal_lines", "wale_gaps"],
    yarn_causes: [
      "Yarn count is too fine for the machine gauge (meager setting)"
    ],
    machine_causes: [
      "Twisted or bent needle hooks",
      "Stiff needle latches or needle pivots",
      "Incorrect closing of the hook by the latch",
      "Heavily running needles (needles tight in cylinder tricks/slots)",
      "Damaged dial or cylinder trick walls",
      "Damaged needle latch and needle hooks",
      "Worn or mismatched knitting elements from different suppliers"
    ],
    remedies: [
      "Inspect cylinder and dial slots (tricks); clean out hardened lint, grease, and dirt",
      "Replace bent, twisted, or stiff needles immediately",
      "Ensure all needles in the cylinder are of the same make and construction",
      "Choose a yarn count appropriate for the machine gauge (follow G = sqrt(1650/Tex) rule)",
      "Check dial-to-cylinder alignment (timing and concentricity)"
    ]
  },
  {
    id: "horizontal_stripes",
    name: "Horizontal Stripes",
    description: "These are caused by unevenness in the courses; they traverse horizontally and repeat themselves regularly or irregularly.",
    symptoms: ["horizontal_stripes", "course_lines", "horizontal_bands"],
    yarn_causes: [
      "Differences in yarn running-in tension across different feeders"
    ],
    machine_causes: [
      "Deflector in dial cam brought into tuck position by mistake",
      "Deflector not completely switched off (needle grips yarn and forms tuck loop)",
      "Yarn feeder badly set at one or more systems",
      "Couliering (stitch depth cams) not set constantly across all feeders",
      "Jerky impulse or uneven pull from the fabric take-up roll"
    ],
    remedies: [
      "Calibrate stitch length across all feeders using a yarn rate meter (LFA meter)",
      "Verify dial cam deflectors are fully disengaged",
      "Check and equalize yarn feed tension at all storage feeders",
      "Ensure smooth, continuous operation of the fabric take-up and wind-up mechanism",
      "Adjust and lock stitch cam screws securely"
    ]
  },
  {
    id: "barreness",
    name: "Barre'ness",
    description: "Periodic lateral irregularities in the fabric, appearing as bands or stripes. Classified into structural, colour, or shadow barre'ness.",
    symptoms: ["barre_lines", "periodic_bands", "shade_changes"],
    yarn_causes: [
      "Individual yarns differ with respect to count, twist, blend, or physical properties",
      "Yarns dye differently during piece dyeing due to varying dye affinity",
      "Different course lengths being fed at different systems"
    ],
    machine_causes: [
      "Uneven stitch length (couliering) at different systems",
      "Improper feeder heights or feed angles causing minor loop structure variations"
    ],
    remedies: [
      "Use yarn from the same batch/lot number on all feeders of the machine",
      "Perform yarn dye-affinity checks before loading batches",
      "Verify yarn feed rate (LFA) is identical at all feeders",
      "Ensure identical stitch cams setting and inspect cams for wear"
    ]
  },
  {
    id: "bunching_up",
    name: "Bunching-up (Thick and thin places)",
    description: "Visible knots in the fabric referred to as bunching up. They appear as beads and turn up irregularly in the fabric. Can build up resulting in a 'cloudy' appearance. More irregular the yarn, more pronounced the cloudy appearance.",
    symptoms: ["beads", "thick_thin", "cloudy_look", "slubs"],
    yarn_causes: [
      "Thick and thin places in the yarn (high yarn CV%)",
      "Spinning faults in yarn (slubs, bad splices, or knots)"
    ],
    machine_causes: [
      "Fabric take-up tension is too weak, causing fabric to bunch up at the knitting zone"
    ],
    remedies: [
      "Use high-quality combed or carded yarn with low yarn mass variation (Uster CV%)",
      "Adjust and increase fabric take-down tension to pull fabric down uniformly",
      "Use yarn clearers on winders to cut and splice thick places and slubs"
    ]
  },
  {
    id: "snags",
    name: "Snags / Snagging",
    description: "Loops or yarn filaments pulled out from the fabric surface. Mainly occurs while processing filament yarns. Tendency is reduced by using coarser single filaments, lesser crimp elasticity, and higher twist.",
    symptoms: ["pulled_loops", "filament_breaks", "hairy_surface"],
    yarn_causes: [
      "Fine filament yarns with low twist",
      "High crimp elasticity in textured yarns"
    ],
    machine_causes: [
      "Rough surfaces on yarn guide elements, ceramic eyes, or tension discs",
      "Rough or nicked yarn feeders, needles, sinkers, or trick walls",
      "Rough rollers on fabric take-up",
      "Careless fabric handling, storage, or transport after knitting"
    ],
    remedies: [
      "Inspect and polish all yarn contact surfaces; replace chipped ceramic guides",
      "Check needles, sinkers, and cylinder dial edges for nicks or burrs",
      "Wrap take-up rolls with protective covers if processing delicate filament yarns",
      "Handle and store fabric rolls in clean, smooth containers with protective wrapping"
    ]
  },
  {
    id: "tuck_stitches",
    name: "Tuck or Double Stitches",
    description: "These occur due to badly knitted or non-knitted loops. They are unintentional tuck loops or floats, showing up as thick places or small beads in the fabric. May also appear as shadows against light.",
    symptoms: ["double_loops", "shadow_look", "unintentional_tuck"],
    yarn_causes: [
      "Yarn count too thick, preventing proper loop shedding"
    ],
    machine_causes: [
      "Fabric take-up is too weak, insufficient, has a one-sided drag, or is not continuous",
      "The dial is set too high (dial needles do not support fabric, which is pulled up)",
      "Incorrect course density or couliering setting",
      "Loops are too tight (e.g. in interlock), preventing loops from clearing the needle latch"
    ],
    remedies: [
      "Readjust and increase fabric take-up tension, ensuring uniform drag across circumference",
      "Lower the dial height to ensure dial needles support the fabric properly",
      "Check and adjust couliering (stitch cams) to loosen loops if clearing is difficult",
      "Verify needle latches open and close freely; clean trick slots of lint build-up"
    ]
  },
  {
    id: "soil_stripe",
    name: "Soil Stripes",
    description: "Soil stripes can appear in the direction of wales (needle stripes) or courses. Wales stripes are solely caused by the machine. Course stripes are usually present in the yarn or caused by standing courses.",
    symptoms: ["oil_marks", "black_stripes", "dirty_lines", "stop_marks"],
    yarn_causes: [
      "Soiled or dirty yarn package",
      "Dust and dirt built up on yarn packages during long storage"
    ],
    machine_causes: [
      "Defective or excessive lubrication from automatic oilers / greasing devices",
      "Accumulated dirt and oil on needles after replacing individual needles",
      "Machine stoppage leaving a standing course mark (oil line from needle bed)"
    ],
    remedies: [
      "Clean cylinder slots and blow out dirty oil regularly",
      "Adjust automatic oiling intervals and quantity; use washable needle oils",
      "Ensure needles are wiped clean after replacement before starting production",
      "Avoid prolonged machine stoppage with yarn threaded; blow clean dirt from yarn packages"
    ]
  },
  {
    id: "colour_fly",
    name: "Colour Fly / Coloured Tinges",
    description: "Colour fly consists of single fibres, bunches of fibres or yarn pieces in varying colours. It sticks on the yarn or is knitted into the fabric and is very difficult to remove.",
    symptoms: ["foreign_fibers", "colored_spots", "lint_spots"],
    yarn_causes: [
      "Contamination in the raw yarn shipment",
      "Fly fibers from neighboring spinning frames"
    ],
    machine_causes: [
      "High accumulation of airborne lint (fly) in the knitting shed",
      "Cross-contamination from adjacent machines running different colors",
      "Poor machine cleaning schedule"
    ],
    remedies: [
      "Install partition curtains between machines running different colors",
      "Use overhead fans and traveling cleaners to blow away lint",
      "Clean machines regularly using compressed air (with yarn guides covered)",
      "Keep yarn packages stored in plastic bags until ready to mount on creels"
    ]
  }
];

/**
 * Rule-based diagnosis function
 * @param {Array<string>} selectedSymptoms — e.g. ["holes", "vertical_stripes", "oil_marks"]
 * @param {Object} conditions — e.g. { yarnTension: 'high', needleCondition: 'stiff' }
 * @returns {Array<Object>} — List of diagnosed faults with confidence and matches
 */
function diagnoseFaults(selectedSymptoms = [], conditions = {}) {
  const results = [];

  // Helper mapping: text symptoms to causes/keywords
  const symptomKeywords = {
    // Basic symptoms
    "holes": ["holes", "cracks", "yarn_breakage", "break", "weak"],
    "drop_stitch": ["dropped_loops", "vertical_gaps", "unlinked", "slip"],
    "pressed_off": ["pressed_off", "fall-out", "cloth_drop"],
    "vertical_lines": ["vertical_stripes", "longitudinal", "wale_gaps", "needle marks"],
    "horizontal_lines": ["horizontal_stripes", "course_lines", "horizontal_bands", "barre"],
    "oil_marks": ["oil_marks", "black_stripes", "dirty_lines", "grease"],
    "lint_spots": ["foreign_fibers", "colored_spots", "lint_spots", "colour fly"],
    "pulled_loops": ["pulled_loops", "filament", "rough", "snag"],
    "beads": ["beads", "thick_thin", "knots", "slubs", "tuck"],
    
    // Conditions
    "high_tension": ["tension is too high", "high yarn tension", "couliering", "tight"],
    "low_tension": ["low yarn tension", "insufficient yarn tension", "slack"],
    "stiff_needles": ["stiff needle", "heavily running needles", "stiff latches"],
    "closed_latch": ["closed latch", "closed needle latch"],
    "broken_hook": ["broken needle hook", "damaged needle latch"],
    "weak_takeup": ["take-up is too weak", "low fabric take-down", "bad take-up"],
    "oil_leakage": ["lubrication", "oiling", "greasing"]
  };

  FAULTS_DATABASE.forEach(fault => {
    let score = 0;
    const matches = [];

    // 1. Match selected symptoms
    selectedSymptoms.forEach(sym => {
      const keywords = symptomKeywords[sym] || [];
      
      // Check description
      const descMatch = keywords.some(kw => fault.description.toLowerCase().includes(kw.toLowerCase()));
      // Check symptoms list
      const symListMatch = keywords.some(kw => fault.symptoms.some(fs => fs.toLowerCase().includes(kw.toLowerCase())));

      if (descMatch || symListMatch) {
        score += 3; // High weight for direct symptoms
        matches.push(`Symptom match: ${sym}`);
      }
    });

    // 2. Match Yarn Causes
    fault.yarn_causes.forEach(cause => {
      selectedSymptoms.forEach(sym => {
        const keywords = symptomKeywords[sym] || [];
        const matchesKeyword = keywords.some(kw => cause.toLowerCase().includes(kw.toLowerCase()));
        if (matchesKeyword) {
          score += 1;
          matches.push(`Yarn cause matched: "${cause}"`);
        }
      });
    });

    // 3. Match Machine Causes
    fault.machine_causes.forEach(cause => {
      selectedSymptoms.forEach(sym => {
        const keywords = symptomKeywords[sym] || [];
        const matchesKeyword = keywords.some(kw => cause.toLowerCase().includes(kw.toLowerCase()));
        if (matchesKeyword) {
          score += 1;
          matches.push(`Machine cause matched: "${cause}"`);
        }
      });
    });

    // Calculate confidence percentage
    const maxPossibleScore = 10;
    const confidence = Math.min(100, Math.round((score / maxPossibleScore) * 100));

    if (score > 0) {
      results.push({
        id: fault.id,
        name: fault.name,
        description: fault.description,
        confidence,
        matches: [...new Set(matches)], // unique matches
        yarn_causes: fault.yarn_causes,
        machine_causes: fault.machine_causes,
        remedies: fault.remedies
      });
    }
  });

  // Sort by confidence descending
  return results.sort((a, b) => b.confidence - a.confidence);
}

module.exports = {
  FAULTS_DATABASE,
  diagnoseFaults
};
