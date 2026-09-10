/**
 * KnitAdvisor — Complete Knit Fabric Derivatives Catalog
 * Version: 2.0
 * 
 * DATA QUALITY MARKERS:
 *   PDF_VERIFIED   — exact value from source PDFs
 *   LOOKUP_DERIVED — regression calculated from PDF lookup tables
 *   ESTIMATED      — derived from structural relationship to base (use with calibration)
 *
 * PATTERN NOTATION:
 *   'K' = Knit loop
 *   'T' = Tuck loop
 *   'M' = Miss / Float loop
 *   Pattern rows = courses (1=bottom), columns = wales
 *   Double bed: { C: cylinder pattern, D: dial pattern }
 *
 * LOOP LENGTH FORMULA:
 *   LL (mm) = 1257.765 × multiplier / (Count × GSM)
 *   multiplier is relative to 24GG Single Jersey (base = 1.0)
 */

const FABRIC_DERIVATIVES = [

  // ============================================================
  // CATEGORY 1: SINGLE JERSEY & DERIVATIVES (Single Needle Bed)
  // ============================================================

  {
    id: 'single_jersey',
    name: 'Single Jersey (Plain)',
    name_bn: 'সিঙ্গেল জার্সি',
    category: 'single_jersey',
    base: null,
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 36 },
    gsm_range: { min: 90, max: 300 },
    count_formula: {
      type: 'regression',
      a: -0.141, b: 50.22,
      source: 'PDF_VERIFIED',
      source_file: '448733518GSMtoCountConversion.pdf p.2',
      note: 'Verified against worked example: 160 GSM → 27.66 Ne'
    },
    ll_multiplier: 1.0,
    ll_source: 'PDF_VERIFIED — KnittingCalculations.pdf p.14',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 1,
      beds: ['cylinder'],
      pattern: [['K']],
      cam: [
        { feed: 1, cylinder: 'K', note: 'Plain knit cam on all needles' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'All long-butt needles, all engaged uniformly'
      }
    },
    machine_note: 'Standard feeders = Dia × 3. One yarn per feeder.',
    typical_machines: 'Fukahama, Mayer & Cie, Santoni'
  },

  {
    id: 'heavy_jersey',
    name: 'Heavy Single Jersey',
    name_bn: 'হেভি সিঙ্গেল জার্সি',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 14, max: 20 },
    gsm_range: { min: 250, max: 420 },
    count_formula: {
      type: 'regression',
      a: -0.0889, b: 37.11,
      source: 'LOOKUP_DERIVED',
      note: 'Regression matched to factory R&D database.'
    },
    ll_multiplier: 1.05,
    ll_source: 'ESTIMATED — slightly longer loop to accommodate heavy yarn',
    typical_gauge: 16,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 1,
      beds: ['cylinder'],
      pattern: [['K']],
      cam: [
        { feed: 1, cylinder: 'K', note: 'Plain knit cam on all needles' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'All long-butt needles'
      }
    },
    machine_note: 'Requires robust needles and stronger take-down tension.',
    typical_machines: 'Fukahama, Mayer & Cie'
  },

  {
    id: 'pique_single',
    // Name disambiguated 2026-09-11: some sources (e.g. textileblog.com) use
    // "Single Pique" for an INTERLOCK (double-bed) cross-tuck structure —
    // see `pique_interlock` below, a genuinely different machine/structure.
    // THIS entry is single-bed, cylinder-only. Renamed for clarity; id kept
    // unchanged (load-bearing across costing/quality/pattern/striper engines).
    // NOTE: keep this string free of the word "double" — fabric-visualizer.js's
    // _detectConstruction() does substring matching on id+category+name, and
    // "double" here previously made a single-bed pique render mislabeled as
    // "Finished double piqué" (caught by regression testing 2026-09-11).
    name: 'Single-Bed Piqué (Polo Pique — Cross-Tuck)',
    name_bn: 'সিঙ্গেল পিকে',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 140, max: 300 },
    count_formula: {
      type: 'regression',
      a: -0.146, b: 57.16,
      source: 'PDF_VERIFIED',
      source_file: '448733518GSMtoCountConversion.pdf p.2',
      note: 'Verified: 220 GSM → 25.04 Ne'
    },
    ll_multiplier: 1.25,
    ll_source: 'ESTIMATED — tuck loops add ~25% yarn per course',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder'],
      pattern: [
        ['K','T'], // Feed 1
        ['K','T'], // Feed 2
        ['T','K'], // Feed 3
        ['T','K']  // Feed 4
      ],
      cam: [
        { feed: 1, cylinder: 'K/T', note: 'Odd needles knit, even needles tuck' },
        { feed: 2, cylinder: 'K/T', note: 'Same as feed 1 (double tuck formation)' },
        { feed: 3, cylinder: 'T/K', note: 'Odd needles tuck, even needles knit' },
        { feed: 4, cylinder: 'T/K', note: 'Same as feed 3 (double tuck formation)' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternating long butt (A) and short butt (B) needles.'
      }
    },
    machine_note: '4-feeder sequence. Double tuck helps build fabric thickness.',
    appearance: 'Cellular / micro-textured surface. Pronounced raised cells. Commonly used in polo shirts.'
  },

  {
    id: 'pique_double',
    name: 'Double Pique (Honeycomb Pique)',
    name_bn: 'ডাবল পিকে',
    category: 'single_jersey',
    base: 'pique_single',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 160, max: 340 },
    count_formula: {
      type: 'regression',
      a: -0.138, b: 55.0,
      source: 'ESTIMATED',
      note: 'Double pique ~7% heavier than single pique per count. Interpolated.'
    },
    ll_multiplier: 1.35,
    ll_source: 'ESTIMATED — 2×tuck per repeat increases yarn consumption',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      pattern: [
        ['K','T','K','T'],
        ['T','K','T','K'],
        ['K','T','K','T'],
        ['T','K','T','K']
      ],
      cam: [
        { feed: 1, cylinder: 'K/T alternate', note: 'A=K, B=T' },
        { feed: 2, cylinder: 'T/K alternate', note: 'A=T, B=K' },
        { feed: 3, cylinder: 'K/T alternate', note: 'same as feed 1' },
        { feed: 4, cylinder: 'T/K alternate', note: 'same as feed 2' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternating long-short butt'
      }
    },
    appearance: 'Prominent honeycomb / waffle texture. Heavier and more textured than single pique.'
  },

  {
    id: 'lacoste_single',
    name: 'Single Lacoste',
    name_bn: 'সিঙ্গেল লাকোস্ট',
    category: 'single_jersey',
    base: 'pique_single',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 150, max: 280 },
    count_formula: {
      type: 'lookup_derived',
      a: -0.169, b: 56.65,
      source: 'LOOKUP_DERIVED',
      source_file: 'ilide_infoyarncountvsgsmxlspr PDF',
      lookup_points: [{gsm:180,count:26},{gsm:200,count:24},{gsm:210,count:20},{gsm:230,count:18}],
      note: 'Linear regression on 4 ilide lookup points. r²≈0.95'
    },
    ll_multiplier: 1.15,
    ll_source: 'ESTIMATED — 2-feed structure, tuck every other needle each course',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder'],
      pattern: [
        ['K','T'], // Feed 1 (tuck on B, knit on A)
        ['K','K'], // Feed 2 (ground knit)
        ['T','K'], // Feed 3 (tuck on A, knit on B)
        ['K','K']  // Feed 4 (ground knit)
      ],
      cam: [
        { feed: 1, cylinder: 'K/T', note: 'A needles knit, B needles tuck' },
        { feed: 2, cylinder: 'K', note: 'All needles knit (lock/ground course)' },
        { feed: 3, cylinder: 'T/K', note: 'A needles tuck, B needles knit' },
        { feed: 4, cylinder: 'K', note: 'All needles knit (lock/ground course)' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Long (A) and short (B) butt alternating.'
      }
    },
    machine_note: '4-feeder repeat (Knit-Tuck alternate + All Knit ground course).',
    appearance: 'Slightly open cellular structure, very stable, minimal curl.'
  },

  {
    id: 'lacoste_double',
    name: 'Double Lacoste',
    name_bn: 'ডাবল লাকোস্ট',
    category: 'single_jersey',
    base: 'lacoste_single',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 170, max: 320 },
    count_formula: {
      type: 'regression',
      a: -0.167, b: 64.36,
      source: 'PDF_VERIFIED',
      source_file: '448733518GSMtoCountConversion.pdf p.2',
      note: 'Verified: 220 GSM → 27.62 Ne'
    },
    ll_multiplier: 1.20,
    ll_source: 'ESTIMATED — 4-feed sequence with double tuck rows',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 6,
      wales_per_repeat: 2,
      beds: ['cylinder'],
      pattern: [
        ['K','K'], // Feed 1 (all knit)
        ['K','T'], // Feed 2
        ['K','T'], // Feed 3
        ['K','K'], // Feed 4 (all knit)
        ['T','K'], // Feed 5
        ['T','K']  // Feed 6
      ],
      cam: [
        { feed: 1, cylinder: 'K', note: 'All needles knit' },
        { feed: 2, cylinder: 'K/T', note: 'A=K, B=T' },
        { feed: 3, cylinder: 'K/T', note: 'Same as feed 2' },
        { feed: 4, cylinder: 'K', note: 'All needles knit' },
        { feed: 5, cylinder: 'T/K', note: 'A=T, B=K' },
        { feed: 6, cylinder: 'T/K', note: 'Same as feed 5' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternating long-short butt'
      }
    },
    appearance: 'Heavy, highly structured double-tuck French-like Lacoste. Distinct wide wale texture.'
  },

  {
    id: 'french_terry',
    name: 'French Terry (3-Thread / Inlay Fleece)',
    name_bn: 'ফ্রেঞ্চ টেরি',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 16, max: 24 },
    gsm_range: { min: 200, max: 480 },
    count_formula: {
      type: 'multi_yarn',
      yarns: [
        { role: 'ground', formula: { a: -0.10, b: 38.0 }, note: 'Ground/face yarn (finer)', source: 'ESTIMATED' },
        { role: 'tie', formula: { a: -0.07, b: 27.0 }, note: 'Tie yarn (medium)', source: 'ESTIMATED' },
        { role: 'pile_inlay', note: 'Coarse pile yarn (inlay, does not form needle loop)', source: 'LOOKUP' }
      ],
      lookup: [
        { gsm: 220, ground: '36/S', tie: '14/S', pile: '75D binder' },
        { gsm: 240, ground: '34/S', tie: '16/S', pile: '75D binder' },
        { gsm: 260, ground: '32/S', tie: '18/S', pile: '75D binder' },
        { gsm: 280, ground: '30/S', tie: '20/S', pile: '75D binder' },
        { gsm: 300, ground: '30/S', tie: '20/S', pile: '75D binder' },
        { gsm: 320, ground: '28/S', tie: '20/S', pile: '75D binder' }
      ],
      source: 'PDF_VERIFIED',
      source_file: '448733518GSMtoCountConversion.pdf p.1'
    },
    ll_multiplier: 1.60,
    ll_source: 'ESTIMATED — ground yarn LL; pile/inlay adds significant weight',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 1,
      beds: ['cylinder'],
      yarn_feeds: 3,
      pattern: [
        ['K'],
        ['K']
      ],
      cam: [
        { feed: 1, cylinder: 'K', yarn: 'ground', note: 'Ground yarn knits all needles' },
        { feed: 2, cylinder: 'K+T alternate', yarn: 'tie', note: 'Tie yarn tucks every 2nd needle (holds inlay)' },
        { feed: 3, cylinder: 'inlay', yarn: 'pile', note: 'Pile yarn floats over sinkers — forms loops on back' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'All needles engaged. Sinker control creates back loops for pile.'
      }
    },
    machine_note: 'Requires sinker ring modification for loop formation. Loop height controlled by sinker advancement.',
    appearance: 'Smooth face (S/J appearance), looped back surface (un-brushed loops). Common in sweatshirts, activewear.'
  },

  {
    id: 'fleece_2_thread',
    name: '2-Thread Fleece (Simple Fleece)',
    name_bn: 'টু-থ্রেড ফ্লিস',
    category: 'single_jersey',
    base: 'french_terry',
    machine_type: 'single_bed_circular_then_brushing',
    gauge_range: { min: 16, max: 24 },
    gsm_range: { min: 200, max: 420 },
    count_formula: {
      type: 'multi_yarn',
      note: '2-yarn system: Ground + Fleece inlay',
      lookup: [
        { gsm: 220, ground: '30/S', loop: '16/S' },
        { gsm: 250, ground: '24/S', loop: '20/S' },
        { gsm: 280, ground: '20/S', loop: '20/S' }
      ],
      source: 'PDF_VERIFIED',
      source_file: '220289760-Fleece-Fabrics.pdf'
    },
    ll_multiplier: 1.60,
    ll_source: 'ESTIMATED — standard 2-thread multiplier',
    typical_gauge: 20,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      note: '2-Thread Fleece (Simple Fleece). 4 Feeder cycle.',
      pattern: [
        ['K','K','K','K'], // Feeder 1 (Ground)
        ['M','M','M','T'], // Feeder 2 (Fleece) - Track 1 Tucks (in standard 1-2-3-4 order this maps to track 1 or 4)
        ['K','K','K','K'], // Feeder 3 (Ground)
        ['M','T','M','M']  // Feeder 4 (Fleece) - Track 3 Tucks
      ],
      cam: [
        { feed: 1, cylinder: 'K', yarn: 'ground', note: 'All tracks knit' },
        { feed: 2, cylinder: 'M/T', yarn: 'fleece', note: 'Track 1 Tucks, others Miss' },
        { feed: 3, cylinder: 'K', yarn: 'ground', note: 'All tracks knit' },
        { feed: 4, cylinder: 'M/T', yarn: 'fleece', note: 'Track 3 Tucks, others Miss' }
      ],
      needle_arrangement: { 
        butt_pattern: 'ABCD', 
        description: '4-Track arrangement.' 
      }
    },
    appearance: 'Smooth face, brushed back. Simpler 2-yarn structure.'
  },

  {
    id: 'fleece_3_thread',
    name: '3-Thread Fleece (Invisible Fleece)',
    name_bn: 'থ্রি-থ্রেড ফ্লিস',
    category: 'single_jersey',
    base: 'french_terry',
    machine_type: 'single_bed_circular_then_brushing',
    gauge_range: { min: 16, max: 24 },
    gsm_range: { min: 200, max: 500 },
    count_formula: {
      type: 'multi_yarn',
      note: '3-yarn system: Face/Ground + Plated/Tie-in + Fleece/Back',
      lookup: [
        { gsm: 200, ground: '36/S', loop: '12/S', binder: '75D' },
        { gsm: 220, ground: '36/S', loop: '14/S', binder: '75D' },
        { gsm: 240, ground: '34/S', loop: '16/S', binder: '75D' },
        { gsm: 260, ground: '32/S', loop: '18/S', binder: '75D' },
        { gsm: 280, ground: '30/S', loop: '20/S', binder: '75D' },
        { gsm: 300, ground: '30/S', loop: '20/S', binder: '75D' },
        { gsm: 310, ground: '30/S', loop: '16/S', yarn2: '34/S' }, // from PDF
        { gsm: 320, ground: '28/S', loop: '20/S', binder: '75D' },
        { gsm: 340, ground: '28/S', loop: '22/S', binder: '75D' }
      ],
      source: 'PDF_VERIFIED',
      source_file: '220289760-Fleece-Fabrics.pdf & 448733518GSMtoCountConversion.pdf'
    },
    ll_multiplier: 1.65,
    ll_source: 'ESTIMATED — higher than French Terry due to pre-brush pile loop length',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 6,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      note: '3-Thread Fleece (Invisible Fleece). Feeder 1/4=Plated, 2/5=Ground, 3/6=Fleece (Tuck/Miss).',
      pattern: [
        ['K','K','K','K'], // Feeder 1 (Plated/Tie-in)
        ['K','K','K','K'], // Feeder 2 (Face/Ground)
        ['M','M','M','T'], // Feeder 3 (Fleece/Loop) - Track 4 Tucks
        ['K','K','K','K'], // Feeder 4 (Plated/Tie-in)
        ['K','K','K','K'], // Feeder 5 (Face/Ground)
        ['M','T','M','M']  // Feeder 6 (Fleece/Loop) - Track 2 Tucks
      ],
      cam: [
        { feed: 1, cylinder: 'K', yarn: 'plated', note: 'All tracks knit' },
        { feed: 2, cylinder: 'K', yarn: 'ground', note: 'All tracks knit' },
        { feed: 3, cylinder: 'M/T', yarn: 'fleece', note: 'Track 4 Tucks, Tracks 1-3 Miss' },
        { feed: 4, cylinder: 'K', yarn: 'plated', note: 'All tracks knit' },
        { feed: 5, cylinder: 'K', yarn: 'ground', note: 'All tracks knit' },
        { feed: 6, cylinder: 'M/T', yarn: 'fleece', note: 'Track 2 Tucks, Tracks 1,3,4 Miss' }
      ],
      needle_arrangement: { 
        butt_pattern: 'ABCD', 
        description: '4-Track arrangement. Track 1(A), Track 2(B), Track 3(C), Track 4(D)' 
      }
    },
    appearance: 'Smooth face, looped/brushed back. Invisible fleece hides tie-in.'
  },

  {
    id: 'fleece_diagonal',
    name: 'Diagonal Fleece',
    name_bn: 'ডায়াগোনাল ফ্লিস',
    category: 'single_jersey',
    base: 'french_terry',
    machine_type: 'single_bed_circular_then_brushing',
    gauge_range: { min: 16, max: 24 },
    gsm_range: { min: 200, max: 480 },
    count_formula: {
      type: 'multi_yarn',
      note: 'Same base as 3-Thread Fleece',
      lookup: [],
      source: 'PDF_VERIFIED',
      source_file: '220289760-Fleece-Fabrics.pdf'
    },
    ll_multiplier: 1.65,
    ll_source: 'ESTIMATED — same as 3-thread fleece',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 12,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      note: 'Diagonal Fleece. 12-feeder cycle cascading tucks.',
      pattern: [
        ['K','K','K','K'], // F1
        ['K','K','K','K'], // F2
        ['M','M','M','T'], // F3
        ['K','K','K','K'], // F4
        ['K','K','K','K'], // F5
        ['M','M','T','M'], // F6
        ['K','K','K','K'], // F7
        ['K','K','K','K'], // F8
        ['M','T','M','M'], // F9
        ['K','K','K','K'], // F10
        ['K','K','K','K'], // F11
        ['T','M','M','M']  // F12
      ],
      cam: [
        { feed: 1, cylinder: 'K', yarn: 'plated', note: 'Knit' },
        { feed: 2, cylinder: 'K', yarn: 'ground', note: 'Knit' },
        { feed: 3, cylinder: 'M/T', yarn: 'fleece', note: 'Track 4 Tucks' },
        { feed: 4, cylinder: 'K', yarn: 'plated', note: 'Knit' },
        { feed: 5, cylinder: 'K', yarn: 'ground', note: 'Knit' },
        { feed: 6, cylinder: 'M/T', yarn: 'fleece', note: 'Track 3 Tucks' },
        { feed: 7, cylinder: 'K', yarn: 'plated', note: 'Knit' },
        { feed: 8, cylinder: 'K', yarn: 'ground', note: 'Knit' },
        { feed: 9, cylinder: 'M/T', yarn: 'fleece', note: 'Track 2 Tucks' },
        { feed: 10, cylinder: 'K', yarn: 'plated', note: 'Knit' },
        { feed: 11, cylinder: 'K', yarn: 'ground', note: 'Knit' },
        { feed: 12, cylinder: 'M/T', yarn: 'fleece', note: 'Track 1 Tucks' }
      ],
      needle_arrangement: { 
        butt_pattern: 'ABCD', 
        description: '4-Track arrangement.' 
      }
    },
    appearance: 'Fleece with a distinct diagonal visual effect on the back loops.'
  },

  {
    id: 'terry_fabric',
    name: 'Terry Fabric (Toweling Terry)',
    name_bn: 'টেরি ফেব্রিক',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular_terry',
    gauge_range: { min: 16, max: 22 },
    gsm_range: { min: 200, max: 600 },
    count_formula: {
      type: 'multi_yarn',
      lookup: [
        { gsm: 200, ground: '30/S', pile: '30/S' },
        { gsm: 220, ground: '26/S', pile: '26/S' },
        { gsm: 240, ground: '24/S', pile: '24/S' },
        { gsm: 260, ground: '22/S', pile: '22/S' },
        { gsm: 280, ground: '20/S', pile: '20/S' }
      ],
      source: 'PDF_VERIFIED',
      source_file: '448733518GSMtoCountConversion.pdf p.1'
    },
    ll_multiplier: 1.55,
    ll_source: 'ESTIMATED — 2-yarn system; ground LL used as base',
    typical_gauge: 20,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 1,
      beds: ['cylinder'],
      yarn_feeds: 2,
      pattern: [['K'],['K']],
      cam: [
        { feed: 'A', cylinder: 'K', yarn: 'ground', note: 'Ground yarn, short sinker — base structure' },
        { feed: 'B', cylinder: 'K', yarn: 'pile', note: 'Pile yarn, long sinker advance — forms loops on face or back' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'All needles engaged. Loop height controlled by long/short sinker ring alternation, NOT needle selection.'
      }
    },
    machine_note: 'Requires special sinker ring with alternating long/short sinkers. Terry loops are on face OR back depending on sinker setting.',
    appearance: 'Pronounced loops on surface. Ground yarn provides base, pile yarn provides loops. Used in towels, bathrobes, activewear.'
  },

  {
    id: 'pointelle',
    name: 'Pointelle (Transfer Lace)',
    name_bn: 'পয়েন্টেল',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular_or_flatbed',
    gauge_range: { min: 18, max: 36 },
    gsm_range: { min: 70, max: 180 },
    count_formula: {
      type: 'regression',
      a: -0.130, b: 47.5,
      source: 'ESTIMATED',
      note: 'Lighter than SJ for same count due to open holes from loop transfer. Fine yarns typical.'
    },
    ll_multiplier: 0.95,
    ll_source: 'ESTIMATED — open-work reduces effective fabric density',
    typical_gauge: 28,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      note: 'Uses loop transfer mechanism — select needles transfer loops to adjacent needle, leaving hole',
      pattern: [
        ['K','K','K','K'],
        ['K','M','K','K'],
        ['K','K','K','K'],
        ['K','K','K','M']
      ],
      cam: [
        { feed: 1, cylinder: 'K', note: 'All knit' },
        { feed: 2, cylinder: 'K/transfer', note: 'Transfer needles create hole, adjacent needle double-loop' },
        { feed: 3, cylinder: 'K', note: 'All knit' },
        { feed: 4, cylinder: 'K/transfer', note: 'Transfer at offset position for diamond/chevron pattern' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'All needles; selected needles have transfer/pressing mechanism engaged per course'
      }
    },
    appearance: 'Delicate open-work / lace-like holes in geometric patterns. Lightweight.'
  },

  {
    id: 'plated_jersey',
    name: 'Plated Jersey (Plating)',
    name_bn: 'প্লেটেড জার্সি',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 32 },
    gsm_range: { min: 110, max: 280 },
    count_formula: {
      type: 'combined_yarn',
      note: 'Two yarns knit simultaneously. Effective Ne calculated from combined linear density.',
      formula: 'Combined_Tex = Tex₁ + Tex₂; Combined_Ne = 590.5 / Combined_Tex',
      source: 'DERIVED — standard yarn count combination formula'
    },
    ll_multiplier: 1.05,
    ll_source: 'ESTIMATED — essentially SJ but with heavier combined yarn',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 1,
      beds: ['cylinder'],
      yarn_feeds: 2,
      pattern: [['K']],
      cam: [{ feed: 1, cylinder: 'K', note: 'Two yarns fed simultaneously through plating attachment' }],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'All needles, standard arrangement. Plating attachment positions two yarns so yarn-1 always face, yarn-2 always back.'
      }
    },
    appearance: 'Different yarn on face vs back (e.g., cotton face, polyester back). Used for moisture management fabrics.'
  },

  {
    id: 'single_jacquard',
    name: 'Single Jacquard',
    name_bn: 'সিঙ্গেল জাকার্ড',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular_electronic',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 130, max: 300 },
    count_formula: {
      type: 'regression',
      a: -0.130, b: 47.5,
      source: 'ESTIMATED',
      note: 'Varies by float length. More floats = heavier fabric for same count. 2-color as base.'
    },
    ll_multiplier: 1.20,
    ll_source: 'ESTIMATED — floats on back add significant yarn consumption',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 'variable — design dependent',
      wales_per_repeat: 'variable — design dependent',
      beds: ['cylinder'],
      note: 'Electronic needle selection: each needle individually selected for K, T, or M per course. Complex pattern possible.',
      example_2color_pattern: [
        ['K','M','K','M'],
        ['M','K','M','K']
      ],
      cam: [
        { feed: 1, yarn: 'color_A', cylinder: 'selective K/M', note: 'Electronic selection: color A needles knit, others miss' },
        { feed: 2, yarn: 'color_B', cylinder: 'selective K/M', note: 'Electronic selection: color B needles knit, others miss' }
      ],
      needle_arrangement: {
        butt_pattern: 'electronic',
        description: 'Individual electronic actuation. Needles selectively raised or bypassed per pattern data.'
      }
    },
    appearance: 'Complex multi-color patterns on face. Floats on technical back. Face and back look different.'
  },

  {
    id: 'single_cross_tuck',
    name: 'Single Cross Tuck',
    name_bn: 'সিঙ্গেল ক্রস টাক',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 130, max: 240 },
    count_formula: {
      type: 'regression',
      a: -0.15, b: 54.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.15,
    ll_source: 'ESTIMATED — tuck loops increase yarn length',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 2,
      beds: ['cylinder'],
      pattern: [
        ['K','T'],
        ['T','K']
      ],
      cam: [
        { feed: 1, cylinder: 'K/T', note: 'A=K, B=T' },
        { feed: 2, cylinder: 'T/K', note: 'A=T, B=K' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternating long-short butt'
      }
    },
    appearance: 'Symmetric micro-mesh structure. Less curl than Single Jersey.'
  },

  {
    id: 'mock_rib',
    name: 'Mock Rib (Knitted Rib-Like)',
    name_bn: 'মক রিব',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 120, max: 220 },
    count_formula: {
      type: 'regression',
      a: -0.14, b: 52.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.10,
    ll_source: 'ESTIMATED',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 2,
      beds: ['cylinder'],
      pattern: [
        ['M','K'],
        ['K','M']
      ],
      cam: [
        { feed: 1, cylinder: 'M/K', note: 'A=M (miss), B=K (knit)' },
        { feed: 2, cylinder: 'K/M', note: 'A=K (knit), B=M (miss)' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternating long-short butt'
      }
    },
    appearance: 'Rib-like texture on a single needle bed. Vertical stripes resembling rib.'
  },

  {
    id: 'knitted_twill',
    name: 'Knitted Twill Effect',
    name_bn: 'নিটেড টুইল',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 16, max: 24 },
    gsm_range: { min: 150, max: 300 },
    count_formula: {
      type: 'regression',
      a: -0.14, b: 54.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.22,
    ll_source: 'ESTIMATED — diagonal float/tuck paths',
    typical_gauge: 20,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      pattern: [
        ['K','K','T','M'], // Feed 1
        ['M','K','K','T'], // Feed 2
        ['T','M','K','K'], // Feed 3
        ['K','T','M','K']  // Feed 4
      ],
      cam: [
        { feed: 1, cylinder: 'Complex', note: 'Track 1,2 knit; Track 3 tuck; Track 4 miss' },
        { feed: 2, cylinder: 'Complex', note: 'Track 2,3 knit; Track 4 tuck; Track 1 miss' },
        { feed: 3, cylinder: 'Complex', note: 'Track 3,4 knit; Track 1 tuck; Track 2 miss' },
        { feed: 4, cylinder: 'Complex', note: 'Track 4,1 knit; Track 2 tuck; Track 3 miss' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABCD',
        description: '4-Track arrangement. Alternating needle heights.'
      }
    },
    appearance: 'Pronounced diagonal lines running along the fabric width, resembling woven twill.'
  },

  {
    id: 'knitted_crepe',
    name: 'Knitted Crepe',
    name_bn: 'নিটেড ক্রেপ',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 120, max: 240 },
    count_formula: {
      type: 'regression',
      a: -0.14, b: 52.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.15,
    ll_source: 'ESTIMATED',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      pattern: [
        ['K','T','K','K'], // Feed 1
        ['T','K','K','K'], // Feed 2
        ['K','K','T','K'], // Feed 3
        ['K','K','K','T']  // Feed 4
      ],
      cam: [
        { feed: 1, cylinder: 'Complex', note: 'Track 2 tucks; Tracks 1,3,4 knit' },
        { feed: 2, cylinder: 'Complex', note: 'Track 1 tucks; Tracks 2,3,4 knit' },
        { feed: 3, cylinder: 'Complex', note: 'Track 3 tucks; Tracks 1,2,4 knit' },
        { feed: 4, cylinder: 'Complex', note: 'Track 4 tucks; Tracks 1,2,3 knit' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABCD',
        description: '4-Track arrangement. Creates random-like crepe surface.'
      }
    },
    appearance: 'Pebbly, rough textured surface with low shine and good drapability.'
  },

  // ── Added from textileblog.com's weft-knit structure survey (2026-09-11
  // audit): 3 genuinely distinct single-bed knit-miss/knit-tuck structures
  // that were missing from the catalog. "Cross Miss" from that same survey
  // was deliberately NOT added as a separate entry — its 2-course K/M
  // alternation is the same structure already on file as `mock_rib` (cyclic
  // shift of the same pattern, different textbook's name for it), so a
  // second entry would have been a duplicate with a different label, not a
  // new fabric. Documented here rather than silently dropped so the mapping
  // is traceable.
  {
    id: 'weft_lockknit',
    name: 'Weft Lock-Knit',
    name_bn: 'ওয়েফট লক-নিট',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 120, max: 220 },
    count_formula: {
      type: 'regression',
      a: -0.141, b: 50.22,
      source: 'ESTIMATED',
      note: 'Two of four courses knit every needle — same density driver as plain single jersey — so its regression is reused, not independently derived from a PDF.'
    },
    ll_multiplier: 0.90,
    ll_source: 'ESTIMATED — 2 of 4 courses miss half the needles, so less yarn is drawn into loops per repeat than a fully-knit single jersey',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder'],
      pattern: [
        ['K','K'], // Feed 1 — full knit course (locks the previous repeat's float)
        ['M','K'], // Feed 2 — A misses (floats), B knits
        ['K','K'], // Feed 3 — full knit course (locks feed 2's float)
        ['K','M']  // Feed 4 — A knits, B misses (floats)
      ],
      cam: [
        { feed: 1, cylinder: 'K', note: 'All needles knit' },
        { feed: 2, cylinder: 'M/K', note: 'A=miss (floats), B=knit' },
        { feed: 3, cylinder: 'K', note: 'All needles knit' },
        { feed: 4, cylinder: 'K/M', note: 'A=knit, B=miss (floats)' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternating long/short butt needles. Unlike a bare 2-course cross-miss, only ONE needle group misses per half-repeat, and a full-knit course always follows — that intervening knit row "locks" the float so it can\'t ladder.'
      }
    },
    machine_note: 'Sinker timing on the miss courses must hold (not drop) the un-knitted loop. 4-feeder minimum sequence.',
    appearance: 'Face reads almost like plain single jersey; reverse shows short, evenly locked float lines every other course. More dimensionally stable and less prone to laddering/runs than plain single jersey.'
  },

  {
    id: 'birds_eye',
    name: 'Birds Eye (Double Cross-Miss)',
    name_bn: 'বার্ডস আই',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 130, max: 230 },
    count_formula: {
      type: 'regression',
      a: -0.140, b: 51.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 0.93,
    ll_source: 'ESTIMATED — paired-needle miss floats span 2 wales instead of 1, drawing slightly more yarn per repeat than Weft Lock-Knit\'s single-needle floats',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      pattern: [
        ['K','K','M','M'], // Feed 1
        ['M','M','K','K'], // Feed 2 — mirror of feed 1 (the "double" cross-miss)
        ['K','K','M','M'], // Feed 3 — repeats feed 1
        ['M','M','K','K']  // Feed 4 — repeats feed 2
      ],
      cam: [
        { feed: 1, cylinder: 'KK/MM', note: 'Wales 1-2 knit, wales 3-4 miss' },
        { feed: 2, cylinder: 'MM/KK', note: 'Wales 1-2 miss, wales 3-4 knit — mirror of feed 1' },
        { feed: 3, cylinder: 'KK/MM', note: 'Same as feed 1' },
        { feed: 4, cylinder: 'MM/KK', note: 'Same as feed 2' }
      ],
      needle_arrangement: {
        butt_pattern: 'AABB',
        description: 'Needles grouped in pairs, not single alternation — each miss float spans 2 wales, which is what produces the small round "eye" dot rather than a plain cross-miss float line.'
      }
    },
    appearance: 'Small, evenly spaced raised "eye" dots on a plain-knit ground. Firmer hand and less curl than plain single jersey; classic lightweight alternative to pique in polo/golf shirts.'
  },

  // ── "Blister" family disambiguation (4 members in this catalog) ──
  //   popcorn_blister  — single-bed, TUCK, asymmetric 4-vs-6-course tracks
  //   cellular_blister — single-bed, TUCK, matched 8-course paired-wale blocks
  //   jersey_blister   — single-bed, MISS (not tuck), unbalanced 5-course repeat
  //   blister_single   — DOUBLE-bed interlock puff (see CATEGORY 3 below)
  // All four look like "a bump/pucker on jersey" but form it by different
  // mechanisms — kept as 4 separate ids rather than GSM/gauge variants of
  // one entry, per KFS Study Material Unit II (ilide.info) which catalogues
  // Popcorn and Cellular Blister as two distinct named structures.
  {
    id: 'popcorn_blister',
    name: 'Popcorn (Asymmetric Elongated Tuck)',
    name_bn: 'পপকর্ন',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    // 2026-09-11: structure corrected against KFS Study Material Unit II
    // (ilide.info) p.7 — "the odd needle produced 4 courses and even needle
    // produced 6 courses; multiple tuck produced elongated and inclined
    // stitches, which cause curved effect in the fabric". The original
    // version of this entry used a matched 8-course/3-hold pattern on BOTH
    // needle groups — that turned out to be a different, real structure in
    // its own right (now split out below as `cellular_blister`), not what
    // "Popcorn" actually is. Popcorn's defining trait is the MISMATCH: one
    // needle group cycles every 4 courses, the other every 6, so their
    // release points drift against each other (LCM = 12 courses) instead of
    // staying in lockstep — that drift is what skews/curves the fabric.
    gauge_range: { min: 16, max: 24 },
    gsm_range: { min: 180, max: 350 },
    count_formula: {
      type: 'regression',
      a: -0.130, b: 57.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.65,
    ll_source: 'ESTIMATED — track B holds up to 5 stacked tucks before release (vs 3 in Cellular Blister), drawing more yarn per repeat',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 12,
      wales_per_repeat: 2,
      beds: ['cylinder'],
      pattern: [
        ['T','T'], // Feed 1
        ['T','T'], // Feed 2
        ['T','T'], // Feed 3
        ['K','T'], // Feed 4 — A releases (3 held loops knocked over together)
        ['T','T'], // Feed 5
        ['T','K'], // Feed 6 — B releases (5 held loops knocked over together)
        ['T','T'], // Feed 7
        ['K','T'], // Feed 8 — A releases again (its 2nd cycle)
        ['T','T'], // Feed 9
        ['T','T'], // Feed 10
        ['T','T'], // Feed 11
        ['K','K']  // Feed 12 — BOTH release together (4-course and 6-course cycles coincide at their LCM)
      ],
      cam: [
        { feed: 1, cylinder: 'T/T', note: 'A=tuck (1 of 3 held), B=tuck (1 of 5 held)' },
        { feed: 2, cylinder: 'T/T', note: 'A=tuck (2 of 3), B=tuck (2 of 5)' },
        { feed: 3, cylinder: 'T/T', note: 'A=tuck (3 of 3), B=tuck (3 of 5)' },
        { feed: 4, cylinder: 'K/T', note: 'A releases (knocks over 3 held loops); B=tuck (4 of 5)' },
        { feed: 5, cylinder: 'T/T', note: 'A=tuck (1 of 3, new cycle), B=tuck (5 of 5)' },
        { feed: 6, cylinder: 'T/K', note: 'A=tuck (2 of 3); B releases (knocks over 5 held loops)' },
        { feed: 7, cylinder: 'T/T', note: 'A=tuck (3 of 3), B=tuck (1 of 5, new cycle)' },
        { feed: 8, cylinder: 'K/T', note: 'A releases (2nd time this repeat); B=tuck (2 of 5)' },
        { feed: 9, cylinder: 'T/T', note: 'A=tuck (1 of 3), B=tuck (3 of 5)' },
        { feed: 10, cylinder: 'T/T', note: 'A=tuck (2 of 3), B=tuck (4 of 5)' },
        { feed: 11, cylinder: 'T/T', note: 'A=tuck (3 of 3), B=tuck (5 of 5)' },
        { feed: 12, cylinder: 'K/K', note: 'A and B release together — the 4-course and 6-course tracks coincide at course 12 (LCM), resetting the repeat' }
      ],
      needle_arrangement: {
        butt_pattern: 'A: 4-course cam track, B: 6-course cam track (mismatched, NOT a simple ABAB alternation)',
        description: 'Two independently-timed tuck-hold cam tracks running out of phase with each other — this mismatch, not the tucking itself, is what produces Popcorn\'s characteristic elongated, inclined, slightly curved stitch look (vs. Cellular Blister\'s regular checkerboard, where both tracks share one timing).'
      }
    },
    machine_note: 'Track B holds up to 5 stacked loops — higher press-off risk than Cellular Blister\'s 4. Coarser, low-extension yarns hold more reliably.',
    appearance: 'Irregular, elongated, slightly inclined raised bumps (not a clean checkerboard) caused by the 4-course and 6-course tuck tracks drifting in and out of phase. Prone to a mild fabric skew/spirality for the same reason — flag for stenter anti-skew finishing. All-cylinder single-bed structure — see the family note above for how this differs from Cellular Blister, Jersey Blister and Interlock Blister.'
  },

  {
    id: 'cellular_blister',
    name: 'Cellular Blister (Matched Paired-Wale Tuck)',
    name_bn: 'সেলুলার ব্লিস্টার',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 16, max: 24 },
    gsm_range: { min: 190, max: 330 },
    count_formula: {
      type: 'regression',
      a: -0.132, b: 56.5,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.58,
    ll_source: 'ESTIMATED — each releasing wale-pair knocks over 4 stacked held tuck loops in one course',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 8,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      pattern: [
        ['T','T','K','K'], // Feed 1 — wales 1-2 hold (1 of 4), wales 3-4 ground-knit
        ['T','T','K','K'], // Feed 2 — wales 1-2 hold (2 of 4)
        ['T','T','K','K'], // Feed 3 — wales 1-2 hold (3 of 4)
        ['T','T','K','K'], // Feed 4 — wales 1-2 hold (4 of 4) — release happens on the NEXT feed's transition
        ['K','K','T','T'], // Feed 5 — wales 1-2 release (knock over all 4); wales 3-4 begin holding (1 of 4)
        ['K','K','T','T'], // Feed 6 — wales 3-4 hold (2 of 4)
        ['K','K','T','T'], // Feed 7 — wales 3-4 hold (3 of 4)
        ['K','K','T','T']  // Feed 8 — wales 3-4 hold (4 of 4) — releases at feed 1 of the next repeat
      ],
      cam: [
        { feed: 1, cylinder: 'T,T,K,K', note: 'Wales 1-2 tuck (held loop 1 of 4); wales 3-4 knit (ground)' },
        { feed: 2, cylinder: 'T,T,K,K', note: 'Wales 1-2 tuck (2 of 4)' },
        { feed: 3, cylinder: 'T,T,K,K', note: 'Wales 1-2 tuck (3 of 4)' },
        { feed: 4, cylinder: 'T,T,K,K', note: 'Wales 1-2 tuck (4 of 4) — release cam engages at feed 5' },
        { feed: 5, cylinder: 'K,K,T,T', note: 'Wales 1-2 knock over all 4 held loops (release -> puff cell); wales 3-4 begin tucking (1 of 4)' },
        { feed: 6, cylinder: 'K,K,T,T', note: 'Wales 3-4 tuck (2 of 4)' },
        { feed: 7, cylinder: 'K,K,T,T', note: 'Wales 3-4 tuck (3 of 4)' },
        { feed: 8, cylinder: 'K,K,T,T', note: 'Wales 3-4 tuck (4 of 4) — release cam engages at feed 1 of next repeat' }
      ],
      needle_arrangement: {
        butt_pattern: 'AABB, both wale-pairs sharing the SAME 8-course cam timing (unlike Popcorn\'s mismatched 4-vs-6)',
        description: 'Paired-needle tuck blocks (2 wales wide, not single-needle) release in matched lockstep, giving a regular checkerboard of puff cells rather than Popcorn\'s drifting, elongated ones.'
      }
    },
    machine_note: '4 consecutive held tuck loops per needle before release — deep sinker throat / extended needle travel required, same caution as Popcorn.',
    appearance: 'Regular checkerboard of blocky, 2-wale-wide puff cells, each formed by 4 held tuck loops releasing together — bigger and more evenly spaced than Popcorn\'s smaller, irregular bumps because both wale-groups share one timing instead of two mismatched ones.'
  },

  {
    id: 'jersey_blister',
    name: 'Jersey Blister (Miss-Pucker)',
    name_bn: 'জার্সি ব্লিস্টার',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 140, max: 260 },
    count_formula: {
      type: 'regression',
      a: -0.138, b: 53.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 0.95,
    ll_source: 'ESTIMATED — mostly-knit with sparse diagonal miss floats; the floats themselves draw little yarn, but the surrounding knit loops are pulled tighter/smaller to compensate, which is the actual pucker mechanism (not a tuck bulge)',
    typical_gauge: 22,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 5,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      pattern: [
        ['K','K','K','M'], // Feed 1
        ['K','K','M','K'], // Feed 2
        ['K','M','K','K'], // Feed 3
        ['M','K','K','K'], // Feed 4
        ['K','K','K','K']  // Feed 5 — the odd course that breaks the diagonal's clean 4-course symmetry
      ],
      cam: [
        { feed: 1, cylinder: 'KKKM', note: 'Wale 4 misses (floats); 1-3 knit' },
        { feed: 2, cylinder: 'KKMK', note: 'Wale 3 misses; diagonal shift' },
        { feed: 3, cylinder: 'KMKK', note: 'Wale 2 misses; diagonal shift' },
        { feed: 4, cylinder: 'MKKK', note: 'Wale 1 misses; diagonal shift' },
        { feed: 5, cylinder: 'K all', note: 'Full plain-knit course — has no equivalent in the 4-course diagonal, which is exactly what makes the 5-course repeat UNBALANCED (source: KFS Study Material — "repeat is five course and 4 wales, hence fabric is not balanced")' }
      ],
      needle_arrangement: {
        butt_pattern: 'Diagonal single-miss shift + 1 plain course',
        description: 'A clean 4-course diagonal miss (1 float per course, shifting by 1 wale) would repeat evenly. Inserting a 5th all-knit course deliberately breaks that symmetry — the repeat no longer divides the wale count evenly, so the pucker/blister forms irregularly rather than as a tidy diagonal line.'
      }
    },
    appearance: 'Small, irregular blister/pucker from tight, starved knit loops around sparse diagonal miss floats — NOT a raised tuck bump (see Popcorn / Cellular Blister for that mechanism). Lighter-weight than the tuck-based blisters since floats consume almost no extra yarn.'
  },

  {
    id: 'knop_honeycomb',
    name: 'Knop / Honeycomb (Single-Bed Multi-Tuck)',
    name_bn: 'নপ / মৌচাক',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    // Distinct from `waffle_knit` elsewhere in this catalog, which achieves a
    // similar honeycomb LOOK on a completely different (double-bed, rib-gaited)
    // mechanism. Source: KFS Study Material Unit II (ilide.info) — "Knop
    // fabrics or Honey Comb: distribution of MULTIPLE tucks diagonally or
    // staggered through fabric... repeat size is 12 course & 4 wales." The
    // "multiple" (plural, stacked) tucks per cell is what separates this from
    // Knitted Twill's single-tuck diagonal elsewhere in this file.
    gauge_range: { min: 14, max: 20 },
    gsm_range: { min: 190, max: 340 },
    count_formula: {
      type: 'regression',
      a: -0.115, b: 55.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.50,
    ll_source: 'ESTIMATED — 3 consecutive held tucks per cell before release, same magnitude as the tuck-based blisters above',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 12,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      pattern: [
        ['T','T','K','K'], ['T','T','K','K'], ['T','T','K','K'], // wales 1-2 hold 3x, release into feed 4 of next block
        ['K','T','T','K'], ['K','T','T','K'], ['K','T','T','K'], // wales 2-3 hold 3x
        ['K','K','T','T'], ['K','K','T','T'], ['K','K','T','T'], // wales 3-4 hold 3x
        ['T','K','K','T'], ['T','K','K','T'], ['T','K','K','T']  // wales 4-1 hold 3x (wraps around), releases into feed 1 of next repeat
      ],
      cam: [
        { feed: 1, cylinder: 'T,T,K,K', note: 'Wales 1-2 tuck (1 of 3 held)' },
        { feed: 2, cylinder: 'T,T,K,K', note: 'Wales 1-2 tuck (2 of 3)' },
        { feed: 3, cylinder: 'T,T,K,K', note: 'Wales 1-2 tuck (3 of 3) — release cam engages at feed 4' },
        { feed: 4, cylinder: 'K,T,T,K', note: 'Wales 1-2 release; wales 2-3 begin (1 of 3 held) — note wale 2 shares the boundary between adjacent cells' },
        { feed: 5, cylinder: 'K,T,T,K', note: 'Wales 2-3 tuck (2 of 3)' },
        { feed: 6, cylinder: 'K,T,T,K', note: 'Wales 2-3 tuck (3 of 3)' },
        { feed: 7, cylinder: 'K,K,T,T', note: 'Wales 2-3 release; wales 3-4 begin (1 of 3 held)' },
        { feed: 8, cylinder: 'K,K,T,T', note: 'Wales 3-4 tuck (2 of 3)' },
        { feed: 9, cylinder: 'K,K,T,T', note: 'Wales 3-4 tuck (3 of 3)' },
        { feed: 10, cylinder: 'T,K,K,T', note: 'Wales 3-4 release; wales 4-1 begin (1 of 3 held, wrapping past the repeat edge)' },
        { feed: 11, cylinder: 'T,K,K,T', note: 'Wales 4-1 tuck (2 of 3)' },
        { feed: 12, cylinder: 'T,K,K,T', note: 'Wales 4-1 tuck (3 of 3) — releases at feed 1 of the next repeat' }
      ],
      needle_arrangement: {
        butt_pattern: 'Diagonal 2-wale tuck block, shifting by 1 wale every 3 courses',
        description: '4 diagonal positions x 3-course dwell = 12-course repeat, exactly matching the source\'s "12 course & 4 wales". Denser than Knitted Twill (which shifts a single tuck by 1 wale every course) — the 3-course dwell per position is what stacks enough held loops to genuinely pucker into a honeycomb cell rather than just a diagonal line.'
      }
    },
    appearance: 'Small raised honeycomb cells arranged in a diagonal cascade (not a static grid) from 3-course tuck-stacking that shifts one wale every 3 courses. All-cylinder single-bed structure — the double-bed waffle_knit elsewhere in this catalog gets a visually similar honeycomb look by a completely different mechanism.'
  },

  {
    id: 'velour_plush',
    name: 'Velour / Plush (Sinker Pile)',
    name_bn: 'ভেলুর / প্লাশ',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 16, max: 22 },
    gsm_range: { min: 220, max: 420 },
    count_formula: {
      type: 'multi_yarn',
      yarns: [
        { role: 'ground', formula: { a: -0.10, b: 38.0 }, note: 'Ground/face yarn — structurally reuses french_terry\'s own ground-yarn regression (same 3-yarn sinker-pile mechanism), not an independently measured Velour figure', source: 'ESTIMATED' },
        { role: 'tie', formula: { a: -0.07, b: 27.0 }, note: 'Tie yarn (holds the pile loops in)', source: 'ESTIMATED' },
        { role: 'pile_inlay', note: 'Continuous-filament soft-twist pile yarn (finer than Terry\'s coarser spun pile, for a denser velvet-like nap after shearing)', source: 'ESTIMATED' }
      ],
      source: 'ESTIMATED',
      note: 'No PDF lookup table for Velour specifically — reuses French Terry\'s verified ground/tie shape as the nearest real structural analogue. Flagged ESTIMATED, not PDF_VERIFIED, because of that.'
    },
    ll_multiplier: 1.55,
    ll_source: 'ESTIMATED — same 3-yarn ground+tie+pile inlay draw as French Terry',
    typical_gauge: 20,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 1,
      beds: ['cylinder'],
      yarn_feeds: 3,
      pattern: [
        ['K'],
        ['K']
      ],
      cam: [
        { feed: 1, cylinder: 'K', yarn: 'ground', note: 'Ground yarn knits all needles' },
        { feed: 2, cylinder: 'K+T alternate', yarn: 'tie', note: 'Tie yarn tucks every 2nd needle, holding the pile inlay' },
        { feed: 3, cylinder: 'inlay', yarn: 'pile', note: 'Soft-twist continuous-filament pile yarn floats over sinkers — forms uncut loops on the back' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'Same sinker-controlled inlay mechanism as French Terry. The structural knitting is identical; Velour/Plush and Terry diverge only in yarn choice and FINISHING.'
      }
    },
    machine_note: 'Post-knit finishing decides the final hand: sheared = "true velour" (cut pile, like velvet); left as-is = "plush" (uncut loop pile, denser/finer than Terry).',
    appearance: 'Dense, low, soft velvet-like pile with knit stretch. Cut pile (velour) is mechanically sheared after knitting; uncut pile (plush) is left as loops. Same knitting mechanism as French Terry — the difference is the pile yarn (finer, continuous-filament) and the finishing (shearing), not the stitch structure.'
  },

  {
    id: 'accordion_tuck',
    name: 'Selective Accordion (Anchored Float)',
    name_bn: 'অ্যাকর্ডিয়ন',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    // Source: KFS Study Material Unit II (ilide.info) — "Accordion fabric is
    // single jersey with long floats held in place on the technical back by
    // tuck stitches... [of its 3 variants] selective accordion is most widely
    // used... requires a selection device that can select the tuck loops so
    // they are carefully distributed to create the minimum of stitch
    // distortion on the face." Modelled here as the selective variant only
    // (straight/alternate accordion concentrate their tucks and were noted
    // by the source itself as causing worse face distortion and colour
    // grin-through — inferior versions of the same idea, not separately
    // catalogued).
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 130, max: 260 },
    count_formula: {
      type: 'regression',
      a: -0.137, b: 51.5,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.05,
    ll_source: 'ESTIMATED — mostly knit+float (float draws little yarn); one rotating tuck per course adds a small, steady increment',
    typical_gauge: 22,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      pattern: [
        ['K','M','M','T'], // Feed 1 — anchor tuck at wale 4
        ['T','K','M','M'], // Feed 2 — anchor tuck rotates to wale 1
        ['M','T','K','M'], // Feed 3 — anchor tuck rotates to wale 2
        ['M','M','T','K']  // Feed 4 — anchor tuck rotates to wale 3
      ],
      cam: [
        { feed: 1, cylinder: 'K,M,M,T', note: 'Base knit-and-float (jacquard ground); wale 4 tucks instead of floating, anchoring the long float behind it' },
        { feed: 2, cylinder: 'T,K,M,M', note: 'Anchor tuck rotates to wale 1' },
        { feed: 3, cylinder: 'M,T,K,M', note: 'Anchor tuck rotates to wale 2' },
        { feed: 4, cylinder: 'M,M,T,K', note: 'Anchor tuck rotates to wale 3 — never repeats the same wale twice in the 4-course repeat' }
      ],
      needle_arrangement: {
        butt_pattern: 'Requires independent per-needle K/T/M selection (3-step pattern wheel or electronic)',
        description: 'A simple 2-step pattern wheel can only manage straight or alternate accordion (tucks concentrated on fixed odd/even needles). This distributed, rotating placement — never anchoring the same wale twice per repeat — needs a selection device that can choose all 3 stitch types independently per needle per feed.'
      }
    },
    appearance: 'Long floats on the technical back, each anchored by a single rotating tuck stitch so no one wale carries all the stitch distortion. Used less as a standalone fashion fabric than as a technique inside multi-colour jacquard knits, to stop unselected colours "grinning through" between wales.'
  },

  // ============================================================
  // CATEGORY 2: RIB & DERIVATIVES (Double Needle Bed)
  // ============================================================

  {
    id: 'rib_1x1',
    name: '1×1 Rib',
    name_bn: '১×১ রিব',
    category: 'rib',
    base: null,
    machine_type: 'double_bed_circular',
    gauge_range: { min: 14, max: 24 },
    gsm_range: { min: 130, max: 480 },
    count_formula: {
      type: 'regression',
      a: -0.123, b: 54.57,
      source: 'PDF_VERIFIED',
      source_file: '448733518GSMtoCountConversion.pdf p.2',
      note: 'Verified: 220 GSM → 27.51 Ne'
    },
    ll_multiplier: 1.4,
    ll_source: 'PDF_VERIFIED — KnittingCalculations.pdf p.14 (18 GG reference)',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K']],
        D: [['K']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: 'Alternating cylinder and dial needles all knit' }
      ],
      needle_arrangement: {
        butt_pattern: 'C_D_C_D',
        description: 'Alternating cylinder (C) and dial (D) needles. Gating: 90° offset so C and D needles interleave.'
      }
    },
    appearance: 'Highly elastic, equal stretch in width and length. Reversible. Used for cuffs, waistbands, t-shirt necks.'
  },

  {
    id: 'rib_2x2',
    name: '2×2 Rib',
    name_bn: '২×২ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 14, max: 22 },
    gsm_range: { min: 150, max: 460 },
    count_formula: {
      type: 'regression',
      a: -0.108, b: 56.62,
      source: 'PDF_VERIFIED',
      source_file: '448733518GSMtoCountConversion.pdf p.3 (Lycra 2x2 base)',
      note: 'Slightly less elastic than 1×1 due to 2-needle groups. Verified for similar range.'
    },
    ll_multiplier: 1.45,
    ll_source: 'ESTIMATED — slightly higher than 1×1 rib due to wider needle grouping',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 4,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','M','M']],
        D: [['M','M','K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 2 needles', dial: 'K on 2 needles', note: 'Groups of 2 cylinder then 2 dial needles active' }
      ],
      needle_arrangement: {
        butt_pattern: 'CC_DD_CC_DD',
        description: '2 cylinder needles active, 2 dial, 2 cylinder... Remaining needles disengaged or removed.'
      }
    },
    appearance: 'Pronounced vertical cords. Less elastic than 1×1. Used for heavier sweater ribbing.'
  },

  {
    id: 'lycra_rib_1x1',
    name: '1×1 Rib + Lycra (Elastane)',
    name_bn: 'লাইক্রা ১×১ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 14, max: 24 },
    gsm_range: { min: 150, max: 420 },
    count_formula: {
      type: 'regression',
      a: -0.119, b: 59.12,
      source: 'PDF_VERIFIED',
      source_file: '448733518GSMtoCountConversion.pdf p.3',
      note: 'Lycra 1×1 Rib. Verified: 180 GSM → 37.7 Ne (cotton component)'
    },
    ll_multiplier: 1.40,
    ll_source: 'Same multiplier as 1×1 rib; elastane inlaid, does not form needle loop',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K']],
        D: [['K']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: 'Alternating cylinder and dial needles knit main spun cotton yarn plated with elastane (Lycra)' }
      ],
      needle_arrangement: {
        butt_pattern: 'C_D_C_D',
        description: 'Alternating cylinder (C) and dial (D) needles. Dual-feed plating carrier feeds Lycra simultaneously, positioning it on the fabric back.'
      },
      note: 'Main spun cotton yarn plated with elastane (Lycra) core thread (20D–40D) fed simultaneously.'
    },
    appearance: 'Same as 1×1 rib but with superior recovery/return-to-shape. 5-8% elastane typical.'
  },

  {
    id: 'half_cardigan',
    name: 'Half Cardigan (Royal Rib)',
    name_bn: 'হাফ কার্ডিগান (রয়্যাল রিব)',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 12, max: 20 },
    gsm_range: { min: 180, max: 500 },
    count_formula: {
      type: 'regression',
      a: -0.115, b: 53.5,
      source: 'ESTIMATED',
      note: 'Approx 20% heavier than 1×1 rib for same count. Adjusted from rib coefficients.'
    },
    ll_multiplier: 1.55,
    ll_source: 'ESTIMATED — tuck loops on alternate courses consume ~10% extra yarn per repeat',
    typical_gauge: 16,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K'],['K']],
        D: [['K'],['T']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: 'Course 1: full rib (knit on both beds)' },
        { feed: 2, cylinder: 'K', dial: 'T', note: 'Course 2: cylinder knits, dial tucks' }
      ],
      needle_arrangement: {
        butt_pattern: 'C_D_C_D',
        description: '1:1 alternating cylinder/dial. Dial needles tucked every second course.'
      }
    },
    appearance: 'Wider, heavier, and more structured than standard 1×1 rib. One face has a different appearance to other. Used in heavy knitwear, outerwear edges.'
  },

  {
    id: 'full_cardigan',
    name: 'Full Cardigan (Polka Rib)',
    name_bn: 'ফুল কার্ডিগান (পোলকা রিব)',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 10, max: 18 },
    gsm_range: { min: 220, max: 550 },
    count_formula: {
      type: 'regression',
      a: -0.108, b: 52.0,
      source: 'ESTIMATED',
      note: 'Heaviest rib derivative. ~35% heavier than 1×1 rib for same count. Both feeds tuck.'
    },
    ll_multiplier: 1.65,
    ll_source: 'ESTIMATED — every needle tucks on every other course, significantly higher yarn usage',
    typical_gauge: 14,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K'],['T']],
        D: [['T'],['K']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'T', note: 'Course 1: Cylinder knits, dial tucks' },
        { feed: 2, cylinder: 'T', dial: 'K', note: 'Course 2: Cylinder tucks, dial knits' }
      ],
      needle_arrangement: {
        butt_pattern: 'C_D_C_D',
        description: '1:1 alternating. Both beds alternate between knitting and tucking each course.'
      }
    },
    appearance: 'Reversible — looks same on both sides. Very bulky, highly elastic, spongy hand feel. Premium knitwear.'
  },

  {
    id: 'half_milano',
    name: 'Half Milano Rib',
    name_bn: 'হাফ মিলানো রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 12, max: 24 },
    gsm_range: { min: 160, max: 450 },
    count_formula: {
      type: 'regression',
      a: -0.120, b: 54.0,
      source: 'ESTIMATED',
      note: '2-course repeat: 1 course rib + 1 course plain. Structurally stable. Interpolated from rib/SJ midpoint.'
    },
    ll_multiplier: 1.35,
    ll_source: 'ESTIMATED — avg of rib (×1.4) and SJ (×1.0) since every 2nd course is plain',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K'],['K']],
        D: [['K'],['M']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: 'Course 1: 1×1 rib course (both beds knit)' },
        { feed: 2, cylinder: 'K', dial: 'M', note: 'Course 2: cylinder only (dial disengaged / retracted)' }
      ],
      needle_arrangement: {
        butt_pattern: 'C_D_C_D',
        description: '1:1 alternating; dial needles retracted on every second course.'
      }
    },
    appearance: 'Slight horizontal ribbing. More stable than 1×1 rib. Medium weight. Clean flat appearance with some elasticity.'
  },

  {
    id: 'full_milano',
    name: 'Full Milano Rib',
    name_bn: 'ফুল মিলানো রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 12, max: 22 },
    gsm_range: { min: 180, max: 480 },
    count_formula: {
      type: 'regression',
      a: -0.110, b: 54.0,
      source: 'ESTIMATED',
      note: '3-course repeat: 1×1 rib + plain cylinder + plain dial. Balanced, less extensible than half milano.'
    },
    ll_multiplier: 1.45,
    ll_source: 'ESTIMATED — 3-course sequence averaging rib and plain courses',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 3,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K'],['K'],['M']],
        D: [['K'],['M'],['K']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: 'Course 1: 1×1 rib (both beds)' },
        { feed: 2, cylinder: 'K', dial: 'M', note: 'Course 2: plain cylinder only' },
        { feed: 3, cylinder: 'M', dial: 'K', note: 'Course 3: plain dial only' }
      ],
      needle_arrangement: {
        butt_pattern: 'C_D_C_D',
        description: '1:1 alternating. Cylinder and dial alternately retracted in courses 2 and 3.'
      }
    },
    appearance: 'Dimensionally stable, balanced, smooth appearance. Minimal extensibility. Good for structured garments, suiting-type knitwear.'
  },

  {
    id: 'drop_needle_rib',
    name: 'Drop Needle Rib (Ladder Rib / Slub Rib)',
    name_bn: 'ড্রপ নিডেল রিব',
    category: 'rib',
    base: 'rib_2x2',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 12, max: 22 },
    gsm_range: { min: 150, max: 380 },
    count_formula: {
      type: 'regression',
      a: -0.120, b: 54.0,
      source: 'ESTIMATED',
      note: 'Lighter than standard rib due to removed needles. Varies by drop pattern (1-in-3, 1-in-4, etc.)'
    },
    ll_multiplier: 1.40,
    ll_source: 'ESTIMATED — similar to 1×1 rib; dropped needles create open channels',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 4,
      beds: ['cylinder', 'dial'],
      note: '1-in-4 drop example: every 4th cylinder needle removed',
      pattern: {
        C: [['K','K','K','M']],
        D: [['K','K','K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on active needles', dial: 'K', note: 'Active needles knit; missing needle positions form vertical channel/ladder' }
      ],
      needle_arrangement: {
        butt_pattern: 'CCC_',
        description: '3 active cylinder needles then 1 removed needle slot. Pattern repeats. Dial: standard.'
      }
    },
    appearance: 'Distinct vertical channels / grooves (ladders) between rib cords. Decorative, sporty aesthetic.'
  },

  // ============================================================
  // CATEGORY 3: INTERLOCK & DOUBLE KNIT DERIVATIVES
  // ============================================================

  {
    id: 'interlock',
    name: 'Interlock',
    name_bn: 'ইন্টারলক',
    category: 'interlock',
    base: null,
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 32 },
    gsm_range: { min: 150, max: 450 },
    count_formula: {
      type: 'regression',
      a: -0.206, b: 80.56,
      source: 'PDF_VERIFIED',
      source_file: '448733518GSMtoCountConversion.pdf p.2',
      note: 'Verified: 220 GSM → 35.24 Ne'
    },
    ll_multiplier: 1.9,
    ll_source: 'PDF_VERIFIED — KnittingCalculations.pdf p.14 (24 GG)',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      note: 'Two interlocked 1×1 rib structures. Needles in opposing positions form an interlocked double fabric.',
      pattern: {
        C: [['K','M'],['M','K']],
        D: [['M','K'],['K','M']]
      },
      cam: [
        { feed: 1, cylinder: 'K on A needles, M on B', dial: 'M on A, K on B', note: 'Feed 1: odd-position knit on cyl, even on dial' },
        { feed: 2, cylinder: 'M on A, K on B', dial: 'K on A, M on B', note: 'Feed 2: opposite — even-position knit on cyl, odd on dial' }
      ],
      needle_arrangement: {
        butt_pattern: 'A_B_A_B (cylinder) offset to B_A_B_A (dial)',
        description: 'Long (A) and short (B) butt alternating on cylinder. Dial: inverse pattern. Each feed activates complementary set.'
      }
    },
    appearance: 'Smooth on both sides (reversible). No visible ribs. Dimensionally stable, low stretch. Used in polo shirts, baby garments, sportswear.'
  },

  {
    id: 'ponte_di_roma',
    name: 'Ponte di Roma',
    name_bn: 'পন্টে ডি রোমা',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 28 },
    gsm_range: { min: 200, max: 420 },
    count_formula: {
      type: 'regression',
      a: -0.170, b: 68.0,
      source: 'ESTIMATED',
      note: '4-course sequence heavier than standard interlock. Approx. based on structural analysis. Typical 24/28 Ne for 200-280 GSM.'
    },
    ll_multiplier: 1.70,
    ll_source: 'ESTIMATED — 4-course repeat alternates interlock and plain; LL between interlock and rib',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','M'],['M','K'],['K','K'],['M','M']],
        D: [['M','K'],['K','M'],['M','M'],['K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K/M alternate', dial: 'M/K alternate', note: 'Course 1: Interlock feed A' },
        { feed: 2, cylinder: 'M/K alternate', dial: 'K/M alternate', note: 'Course 2: Interlock feed B' },
        { feed: 3, cylinder: 'K all', dial: 'M all', note: 'Course 3: Plain cylinder course (dial retracted)' },
        { feed: 4, cylinder: 'M all', dial: 'K all', note: 'Course 4: Plain dial course (cylinder retracted)' }
      ],
      needle_arrangement: {
        butt_pattern: 'A_B (cyl) / B_A (dial) — as interlock',
        description: 'Standard interlock gating. Courses 3&4 use full-width cam engagement on one bed at a time.'
      }
    },
    appearance: 'Slightly ribbed appearance, heavier and more stable than interlock. Excellent drape. Widely used for suiting, dresses, tailored knitwear.'
  },

  {
    id: 'swiss_double_pique',
    name: 'Swiss Double Pique',
    name_bn: 'সুইস ডাবল পিকে',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 28 },
    gsm_range: { min: 180, max: 360 },
    count_formula: {
      type: 'regression',
      a: -0.150, b: 62.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.50,
    ll_source: 'ESTIMATED',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K'],['M'],['K'],['M']],
        D: [['K'],['K'],['K'],['K']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: '1x1 Rib knit' },
        { feed: 2, cylinder: 'M', dial: 'K', note: 'Dial only knit' },
        { feed: 3, cylinder: 'K', dial: 'K', note: '1x1 Rib knit' },
        { feed: 4, cylinder: 'M', dial: 'K', note: 'Dial only knit' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternating cylinder needles disengaged on alternate feeds.'
      }
    },
    appearance: 'Pronounced relief micro-texture on dial face. Flat cylinder face. Balanced stability.'
  },

  {
    id: 'french_double_pique',
    name: 'French Double Pique',
    name_bn: 'ফ্রেঞ্চ ডাবল পিকে',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 28 },
    gsm_range: { min: 180, max: 360 },
    count_formula: {
      type: 'regression',
      a: -0.150, b: 62.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.50,
    ll_source: 'ESTIMATED',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K'],['K'],['K'],['K']],
        D: [['K'],['M'],['K'],['M']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: '1x1 Rib knit' },
        { feed: 2, cylinder: 'K', dial: 'M', note: 'Cylinder only knit' },
        { feed: 3, cylinder: 'K', dial: 'K', note: '1x1 Rib knit' },
        { feed: 4, cylinder: 'K', dial: 'M', note: 'Cylinder only knit' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Dial needles disengaged on alternate feeds.'
      }
    },
    appearance: 'Stable, textured cylinder face, smooth dial face. Strong structure.'
  },

  {
    id: 'lacoste_pique',
    name: 'Lacoste Pique (Double Bed)',
    name_bn: 'লাকোস্ট পিকে',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 28 },
    gsm_range: { min: 170, max: 320 },
    count_formula: {
      type: 'regression',
      a: -0.160, b: 60.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.45,
    ll_source: 'ESTIMATED',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K'],['K','K'],['K','K'],['K','K']],
        D: [['K','K'],['T','K'],['K','K'],['K','T']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: '1x1 Rib knit' },
        { feed: 2, cylinder: 'K', dial: 'T/K', note: 'Dial tucks on alternate needles' },
        { feed: 3, cylinder: 'K', dial: 'K', note: '1x1 Rib knit' },
        { feed: 4, cylinder: 'K', dial: 'K/T', note: 'Dial tucks at offset needles' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternate tucking on dial to create pique texture.'
      }
    },
    appearance: 'Characteristic cellular texture on dial side, smooth jersey side. Soft, highly breathable.'
  },

  {
    id: 'gabardine_double',
    name: 'Gabardine Double Jersey',
    name_bn: 'গ্যাবার্ডিন ডাবল জার্সি',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 14, max: 22 },
    gsm_range: { min: 200, max: 420 },
    count_formula: {
      type: 'regression',
      a: -0.130, b: 58.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.60,
    ll_source: 'ESTIMATED',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 6,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','M'],['K','M'],['M','K'],['M','K'],['K','K'],['K','K']],
        D: [['M','K'],['M','K'],['K','M'],['K','M'],['K','K'],['K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K/M', dial: 'M/K', note: 'Alternate knitting' },
        { feed: 2, cylinder: 'K/M', dial: 'M/K', note: 'Same as feed 1' },
        { feed: 3, cylinder: 'M/K', dial: 'K/M', note: 'Alternate shifted' },
        { feed: 4, cylinder: 'M/K', dial: 'K/M', note: 'Same as feed 3' },
        { feed: 5, cylinder: 'K', dial: 'K', note: 'Lock course' },
        { feed: 6, cylinder: 'K', dial: 'K', note: 'Lock course' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: '2x2 twill effect on double beds.'
      }
    },
    appearance: 'Pronounced diagonal twill lines on both face and back. Heavy, durable, structured.'
  },

  {
    id: 'poplin_double',
    name: 'Poplin Double Jersey',
    name_bn: 'পপলিন ডাবল জার্সি',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 26 },
    gsm_range: { min: 160, max: 360 },
    count_formula: {
      type: 'regression',
      a: -0.140, b: 60.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.55,
    ll_source: 'ESTIMATED',
    typical_gauge: 20,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 6,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K'],['K','M'],['K','M'],['K','K'],['M','K'],['M','K']],
        D: [['M','M'],['K','K'],['K','K'],['M','M'],['K','K'],['K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K all', dial: 'M all', note: 'Cylinder only' },
        { feed: 2, cylinder: 'K/M', dial: 'K all', note: 'Cylinder alternate, dial all' },
        { feed: 3, cylinder: 'K/M', dial: 'K all', note: 'Same as feed 2' },
        { feed: 4, cylinder: 'M all', dial: 'K all', note: 'Dial only' },
        { feed: 5, cylinder: 'M/K', dial: 'K all', note: 'Cylinder alternate shifted, dial all' },
        { feed: 6, cylinder: 'M/K', dial: 'K all', note: 'Same as feed 5' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Dial knitting more dominant to create cross-wise rib poplin effect.'
      }
    },
    appearance: 'Fine cross-wise ribs. Smooth face, slightly textured back. High density.'
  },

  {
    id: 'blister_single',
    // Name disambiguated 2026-09-11: "Single" here means "single blister
    // cell", NOT single-bed — this structure is cylinder+dial (interlock).
    // The genuinely single-bed popcorn/blister structure is `popcorn_blister`
    // above. Renamed for clarity; id kept unchanged (load-bearing elsewhere).
    name: 'Interlock Blister (Double-Bed Cellular Puff)',
    name_bn: 'সিঙ্গেল ব্লিস্টার',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 28 },
    gsm_range: { min: 200, max: 400 },
    count_formula: {
      type: 'regression',
      a: -0.150, b: 64.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.65,
    ll_source: 'ESTIMATED',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K'],['K','M'],['K','K'],['M','K']],
        D: [['K','K'],['M','M'],['K','K'],['M','M']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: '1x1 Rib Course' },
        { feed: 2, cylinder: 'K/M', dial: 'M', note: 'Cylinder knits A only, dial disengaged' },
        { feed: 3, cylinder: 'K', dial: 'K', note: '1x1 Rib Course' },
        { feed: 4, cylinder: 'M/K', dial: 'M', note: 'Cylinder knits B only, dial disengaged' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Interlock gating. Cylinder needles selectively knit to create blisters.'
      }
    },
    appearance: 'Raised puffy blister/bubble effects on face side. Flat dial back.'
  },

  {
    id: 'relief_single',
    name: 'Single Relief Fabric',
    name_bn: 'সিঙ্গেল রিলিফ ফেব্রিক',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 14, max: 24 },
    gsm_range: { min: 220, max: 420 },
    count_formula: {
      type: 'regression',
      a: -0.130, b: 60.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.60,
    ll_source: 'ESTIMATED',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K'],['K'],['K'],['M']],
        D: [['M'],['M'],['M'],['K']]
      },
      cam: [
        { feed: '1-3', cylinder: 'K all', dial: 'M (held)', note: 'Cylinder knits 3 courses, dial holds loops' },
        { feed: 4, cylinder: 'M', dial: 'K', note: 'Dial knits and releases held loops, forming relief cord' }
      ],
      needle_arrangement: {
        butt_pattern: 'Standard interlock',
        description: 'Dial loops held for 3 courses to create prominent relief structure.'
      }
    },
    appearance: 'Highly raised relief horizontal ridges. Extra-bulky, warm.'
  },

  {
    id: 'eight_lock',
    name: 'Eight-Lock (8-Lock)',
    name_bn: 'এইট-লক',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 28 },
    gsm_range: { min: 180, max: 360 },
    count_formula: {
      type: 'regression',
      a: -0.190, b: 74.0,
      source: 'ESTIMATED',
      note: '2×2 needle arrangement variant of interlock. Slightly higher count for same GSM than standard interlock.'
    },
    ll_multiplier: 1.85,
    ll_source: 'ESTIMATED — close to standard interlock multiplier',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 4,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','M','M'],['M','M','K','K']],
        D: [['M','M','K','K'],['K','K','M','M']]
      },
      cam: [
        { feed: 1, cylinder: 'K on AABB pattern', dial: 'K on BBAA', note: 'Groups of 2 active on alternate positions' },
        { feed: 2, cylinder: 'K on BBAA', dial: 'K on AABB', note: 'Interlocking complement' }
      ],
      needle_arrangement: {
        butt_pattern: 'AABB_AABB (cyl) / BBAA_BBAA (dial)',
        description: 'Groups of 2 long-butt then 2 short-butt needles alternating. Creates a 2×2 interlock effect.'
      }
    },
    appearance: 'Extremely smooth and uniform on both sides. Slightly heavier feel than standard interlock. Reversible.'
  },

  {
    id: 'bourrelet',
    name: 'Bourrelet (Ottoman / Cord Knit)',
    name_bn: 'বুরেলে (অটোমান)',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 12, max: 22 },
    gsm_range: { min: 220, max: 480 },
    count_formula: {
      type: 'regression',
      a: -0.155, b: 62.0,
      source: 'ESTIMATED',
      note: 'Very heavy structure. Multiple consecutive courses on one bed. Heavier than ponte di roma.'
    },
    ll_multiplier: 1.60,
    ll_source: 'ESTIMATED — held loops increase fabric weight significantly',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 5,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      note: 'Example: 4 courses cylinder-only then 1 interlock course',
      pattern: {
        C: [['K'],['K'],['K'],['K'],['K','M']],
        D: [['M'],['M'],['M'],['M'],['M','K']]
      },
      cam: [
        { feed: '1-4', cylinder: 'K all', dial: 'M (held)', note: 'Courses 1-4: Only cylinder knits; dial loops held (accumulate)' },
        { feed: 5, cylinder: 'K/M alternate', dial: 'M/K alternate', note: 'Course 5: Interlock to anchor held dial loops — creates cord' }
      ],
      needle_arrangement: {
        butt_pattern: 'Standard interlock',
        description: 'Standard interlock gating. Dial needles held (not activated) for several courses, creating trapped float which forms cord.'
      }
    },
    appearance: 'Pronounced horizontal ridges/ribs (cords). Textured, corduroy-like in relief. Used for structured coats, suits.'
  },

  {
    id: 'texipique',
    name: 'Texipique (Double Pique)',
    name_bn: 'টেক্সিপিকে (ডাবল পিকে)',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 180, max: 340 },
    count_formula: {
      type: 'regression',
      a: -0.150, b: 60.0,
      source: 'ESTIMATED',
      note: 'Double knit pique. More stable than single pique. Miss loops on back. Estimated from structure.'
    },
    ll_multiplier: 1.40,
    ll_source: 'ESTIMATED — K/M (miss) combination reduces yarn use compared to K/T (tuck)',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','K'],['K','M','K','M'],['K','K','K','K'],['K','M','K','M']],
        D: [['K','K','K','K'],['M','K','M','K'],['K','K','K','K'],['M','K','M','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K all', dial: 'K all', note: 'Course 1: full rib' },
        { feed: 2, cylinder: 'K/M alternate', dial: 'M/K alternate', note: 'Course 2: miss on alternate' },
        { feed: 3, cylinder: 'K all', dial: 'K all', note: 'Course 3: full rib' },
        { feed: 4, cylinder: 'K/M alternate (offset)', dial: 'M/K alternate (offset)', note: 'Course 4: miss at offset wales' }
      ],
      needle_arrangement: {
        butt_pattern: 'Standard interlock ABAB',
        description: 'Interlock gating with selective engagement via cam settings for miss courses.'
      }
    },
    appearance: 'Textured face, smooth back. More stable than single pique. Non-reversible.'
  },

  // ── Added from textileblog.com's weft-knit structure survey (2026-09-11
  // audit) — resolves a real naming collision: that article's "Single Pique"
  // is an INTERLOCK-machine structure (double bed), completely different
  // from this catalog's `pique_single` which is a single-bed double-tuck
  // structure that only happens to share the word "pique". Given a new,
  // disambiguated id rather than overloading `pique_single`, because that id
  // is already load-bearing across costing/quality/pattern/striper engines
  // (see backend/engine/domain/*.js) — reusing or renaming it would silently
  // break those, not fix a name.
  {
    id: 'pique_interlock',
    name: 'Cross-Tuck Pique (Interlock, Combined-Bed)',
    name_bn: 'ক্রস-টাক পিকে (ইন্টারলক)',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 28 },
    gsm_range: { min: 200, max: 380 },
    count_formula: {
      type: 'regression',
      a: -0.150, b: 63.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.55,
    ll_source: 'ESTIMATED — a 6-feed repeat with one combined cylinder+dial tuck course draws more yarn than Swiss/French Double Pique\'s 4-feed single-sided tuck',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 6,
      wales_per_repeat: 2,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K'],['K'],['T'],['K'],['K'],['T']],
        D: [['K'],['T'],['K'],['K'],['T'],['K']]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: 'Plain interlock ground course' },
        { feed: 2, cylinder: 'K', dial: 'T', note: 'Dial tucks — first cross-tuck cell' },
        { feed: 3, cylinder: 'T', dial: 'K', note: 'Cylinder tucks — mirrored cross-tuck cell' },
        { feed: 4, cylinder: 'K', dial: 'K', note: 'Plain interlock ground course' },
        { feed: 5, cylinder: 'K', dial: 'T', note: 'Dial tucks again' },
        { feed: 6, cylinder: 'T', dial: 'K', note: 'Cylinder tucks again — both faces now carry a tuck cell, unlike Swiss (dial-only) or French (cylinder-only) Pique' }
      ],
      needle_arrangement: {
        butt_pattern: 'Standard interlock ABAB, both beds independently cammed',
        description: 'Interlock gating with a tuck cell alternated onto BOTH beds across the 6-feed repeat, instead of one bed only — throws the fabric noticeably wider than plain interlock.'
      }
    },
    machine_note: '6-feeder minimum sequence. Because both beds carry a tuck course, the fabric relaxes roughly 15% wider than plain interlock at the same stitch length — machine settings and roll take-up must allow for it.',
    appearance: 'Textured cell visible on BOTH faces (unlike Swiss/French Double Pique, textured on only one face) — the generic double-bed "pique" hand, often just called "interlock pique". Stable, non-reversible, heavier than single-bed pique.'
  },

  // ============================================================
  // CATEGORY 3.5: PURL (LINKS-LINKS) — a 4th fundamental weft-knit family
  // ============================================================
  // Added 2026-09-11 from fibre2fashion.com's "Weft knitted fabrics and
  // derivatives" survey, which lists Purl alongside Plain/Rib/Interlock as
  // one of the 4 basic weft-knit structures — a genuine gap, not a variant
  // of anything already in this catalog.
  //
  // HONEST LIMITATION: Purl is not formed by a knit/tuck/miss CHOICE on a
  // fixed-orientation needle the way every other structure in this file is.
  // It needs a double-headed (latch on both ends) needle that physically
  // transfers the loop from one hook to the other between courses, flipping
  // which face the NEXT loop draws to. Every stitch is a full knit loop —
  // there is no tuck or miss involved — so the K/T/M `pattern` grid this
  // catalog uses everywhere else cannot represent the actual mechanism (it
  // has no vocabulary for "which face"). `pattern` below is filled with 'K'
  // (structurally correct — every stitch really is a knit loop) and the real
  // face/back alternation is carried separately in `loop_orientation`, a
  // field no other part of this codebase reads yet. Concretely: the 2D
  // fabric-visualizer.js render for this id falls through to the generic
  // single-jersey painter (a real fabric photo would show alternating
  // horizontal ridges of face/back loops, which that painter does not
  // attempt) — flagged here rather than silently left to look "fine".
  {
    id: 'purl_1x1',
    name: 'Purl (Links-Links, 1×1)',
    name_bn: 'পার্ল (লিংকস-লিংকস)',
    category: 'purl',
    base: 'purl',
    machine_type: 'purl_double_headed_needle', // flat or circular purl machine — mechanism is the same either way
    gauge_range: { min: 10, max: 18 }, // coarser than jersey/rib — double-headed needles need more room
    gsm_range: { min: 200, max: 420 },
    count_formula: {
      type: 'regression',
      a: -0.110, b: 52.0,
      source: 'ESTIMATED'
    },
    ll_multiplier: 1.45,
    ll_source: 'ESTIMATED — the loop-transfer action draws noticeably more yarn per stitch than a plain single-jersey knit loop, closer in magnitude to rib',
    typical_gauge: 14,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 2,
      wales_per_repeat: 1,
      beds: ['double_headed'], // not cylinder+dial — one set of transferable needles
      pattern: [
        ['K'], // Course 1 — every stitch IS a knit loop (see note above)
        ['K']  // Course 2 — also a knit loop, just drawn to the opposite face
      ],
      loop_orientation: [
        ['F'], // Course 1 — loop drawn to the FRONT (face)
        ['B']  // Course 2 — needle transfers, loop drawn to the BACK
      ],
      cam: [
        { feed: 1, cylinder: 'K (transfer to front hook)', note: 'Needle presents its front hook — new loop pulled through to the technical face' },
        { feed: 2, cylinder: 'K (transfer to back hook)', note: 'Needle physically transfers the held loop to its back hook — new loop pulled through to the technical back' }
      ],
      needle_arrangement: {
        butt_pattern: 'Double-headed latch needles (one set, not two opposing beds)',
        description: 'NOT cylinder+dial gating like rib/interlock — a single needle bed of needles that can present either hook, alternating which side of the fabric each course\'s loop is drawn to. This is why Purl is reversible (identical face and back) while remaining a true single-bed structure.'
      }
    },
    machine_note: 'Slower and mechanically more complex than any cylinder+dial or single-cylinder machine here — the transfer action limits production speed well below single jersey or rib.',
    appearance: 'Fully reversible — courses of face (smooth V) loops alternate with courses of back (semi-circle) loops, giving a horizontally-corrugated, garment-like texture (visually close to hand-knit "garter stitch"). Very high length-way stretch and recovery (opposite emphasis to single jersey\'s width-way stretch). Curls far less than single jersey; commonly used for baby wear, cuffs/collars, and fully-fashioned garments needing shape retention.'
  },

  // ============================================================
  // CATEGORY 4: WARP KNIT DERIVATIVES
  // NOTE: Warp knit uses entirely different machines and calculations.
  //       Circular knitting production formula does NOT apply.
  //       Counts typically in denier/dtex. Machine: warp beam looms.
  // ============================================================

  {
    id: 'tricot_plain',
    name: 'Tricot (Plain)',
    name_bn: 'ট্রাইকট',
    category: 'warp_knit',
    base: null,
    machine_type: 'warp_knit_tricot',
    gauge_range: { min: 24, max: 40 },
    gsm_range: { min: 50, max: 180 },
    count_formula: {
      type: 'denier_based',
      typical_yarns: ['40D/34f', '70D/34f', '78D/72f'],
      note: 'Yarn specified in denier/filaments. No Ne conversion applicable. GSM set by stitch density and machine speed.',
      source: 'INDUSTRY_STANDARD'
    },
    ll_multiplier: null,
    ll_source: 'N/A — warp knit uses course length instead of loop length',
    structure: {
      type: 'warp_knit',
      guide_bars: 2,
      lapping_pattern: {
        bar_1: { notation: '1-0/1-2', description: 'Front bar — 1-needle overlap (OL), 1-needle underlap right (UL)' },
        bar_2: { notation: '2-3/2-1', description: 'Back bar — 1-needle overlap counter, 1-needle underlap left' },
      },
      stitch_density: { courses_per_cm: 8, wales_per_cm: 12, stitches_per_cm2: 96 },
      course_length_formula: 'CL (mm) = (diameter_mm × π × wales_per_cm) / 100',
      note: 'Standard open-lap Tricot. Both bars run same speed. Very stable structure. Source: Spencer (2001) Table 14.1.',
    },
    appearance: 'Very smooth, run-resistant, sheer. Common in lingerie, swimwear lining.',
    machine_speed: { min: 400, max: 1200, typical: 800, unit: 'stitch/min' },
  },

  {
    id: 'locknit',
    name: 'Locknit (Tricot Derivative)',
    name_bn: 'লকনিট',
    category: 'warp_knit',
    base: 'tricot_plain',
    machine_type: 'warp_knit_tricot',
    gauge_range: { min: 28, max: 40 },
    gsm_range: { min: 60, max: 160 },
    count_formula: {
      type: 'denier_based',
      note: 'Combines 1-and-1 with 2-and-1 guide bar lapping. Fine denier yarns. No Ne applicable.',
      source: 'INDUSTRY_STANDARD'
    },
    structure: {
      type: 'warp_knit',
      guide_bars: 2,
      lapping_pattern: {
        bar_1: { notation: '1-0/2-3', description: 'Front bar — 1-needle overlap, 2-needle underlap (longer underlap for run-resistance)' },
        bar_2: { notation: '1-2/1-0', description: 'Back bar — counter-direction to bar 1, creates interlocking loops' },
      },
      stitch_density: { courses_per_cm: 8, wales_per_cm: 12, stitches_per_cm2: 96 },
      course_length_formula: 'CL (mm) = (diameter_mm × π × wales_per_cm) / 100',
      note: 'Run-resistant (ladder-proof) Tricot. Counter-lapping locks each loop. Source: Spencer (2001) Table 14.1.',
    },
    appearance: 'Ladder-proof, smooth face. Widely used for intimate apparel, lingerie lining.',
    machine_speed: { min: 400, max: 1200, typical: 800, unit: 'stitch/min' },
  },

  {
    id: 'sharkskin_tricot',
    name: 'Sharkskin (Tricot)',
    name_bn: 'শার্কস্কিন ট্রাইকট',
    category: 'warp_knit',
    base: 'tricot_plain',
    machine_type: 'warp_knit_tricot',
    gauge_range: { min: 24, max: 32 },
    gsm_range: { min: 100, max: 200 },
    count_formula: {
      type: 'denier_based',
      note: 'Heavier denier than plain tricot. Textured appearance from combination of yarn types.',
      source: 'INDUSTRY_STANDARD'
    },
    structure: {
      type: 'warp_knit',
      guide_bars: 3,
      lapping_pattern: {
        bar_1: { notation: '1-0/1-2', description: 'Ground structure front bar' },
        bar_2: { notation: '2-3/2-1', description: 'Ground structure back bar' },
        bar_3: { notation: '0-1/1-0', description: 'Texture bar — creates surface relief and abrasion resistance (independent timing)' },
      },
      stitch_density: { courses_per_cm: 10, wales_per_cm: 14, stitches_per_cm2: 140 },
      course_length_formula: 'CL (mm) = (diameter_mm × π × wales_per_cm) / 100',
      note: 'Textured Tricot. Third guide bar timing creates abrasion effect and rigid handle.',
    },
    appearance: 'Rigid, textured, slightly abrasive face. Resembles woven fabric. Used for performance sportswear, activewear.',
    machine_speed: { min: 400, max: 1200, typical: 800, unit: 'stitch/min' },
  },

  {
    id: 'spacer_fabric',
    name: 'Spacer Fabric (Raschel 3D)',
    name_bn: 'স্পেসার ফেব্রিক',
    category: 'warp_knit',
    base: null,
    machine_type: 'warp_knit_raschel_double_bar',
    gauge_range: { min: 12, max: 24 },
    gsm_range: { min: 200, max: 600 },
    count_formula: {
      type: 'denier_based',
      note: 'Two separate fabric faces + monofilament spacer yarns (50D–200D). Both faces usually 150-300D polyester.',
      source: 'INDUSTRY_STANDARD'
    },
    structure: {
      type: 'warp_knit_3d',
      guide_bars: 4,
      lapping_pattern: {
        bar_1: { notation: '1-0/1-2', description: 'Face fabric — front bed, bar 1 (plain tricot overlap)' },
        bar_2: { notation: '2-3/2-1', description: 'Face fabric — front bed, bar 2 (counter-direction)' },
        bar_3: { notation: '0-1/1-0', description: 'Monofilament spacer — diagonal pillar between bed faces (50D–200D)' },
        bar_4: { notation: '1-0/1-2', description: 'Back face fabric — back bed, mirror of bar 1' },
      },
      stitch_density: { courses_per_cm: 6, wales_per_cm: 10, stitches_per_cm2: 60 },
      course_length_formula: 'CL (mm) = (diameter_mm × π × wales_per_cm) / 100',
      typical_spacer_thickness_mm: { min: 2, max: 15 },
      note: '3D dual-face structure. Spacer height determined by needle bed separation. Slower production than standard Tricot.',
    },
    appearance: '3D sandwich structure. Two knit faces separated by spacer. Excellent cushioning, breathability, moisture transport.',
    machine_speed: { min: 200, max: 600, typical: 400, unit: 'stitch/min' },
    uses: 'Shoe uppers, padding, car seats, medical supports, thermal management.'
  },

  {
    id: 'powernet',
    name: 'Powernet (Elastic Raschel)',
    name_bn: 'পাওয়ারনেট',
    category: 'warp_knit',
    base: null,
    machine_type: 'warp_knit_raschel',
    gauge_range: { min: 18, max: 32 },
    gsm_range: { min: 100, max: 300 },
    count_formula: {
      type: 'denier_based',
      typical_yarns: {
        ground: '40-70D nylon or polyester',
        elastane: '140-280D Lycra/spandex',
        elastane_pct: '10-40%',
      },
      note: 'Ground base in nylon/polyester. Elastomeric inlay provides compression. Yarn % affects power rating.',
      source: 'INDUSTRY_STANDARD'
    },
    structure: {
      type: 'warp_knit',
      guide_bars: 3,
      lapping_pattern: {
        bar_1: { notation: '1-0/1-2', description: 'Ground mesh front bar (nylon/polyester base)' },
        bar_2: { notation: '2-3/2-1', description: 'Ground mesh back bar (nylon/polyester base, offset)' },
        bar_3: { notation: '0-2/2-0', description: 'Elastane inlay bar — 2-needle float underlap only, creating compression force' },
      },
      stitch_density: { courses_per_cm: 9, wales_per_cm: 13, stitches_per_cm2: 117 },
      course_length_formula: 'CL (mm) = (diameter_mm × π × wales_per_cm) / 100',
      elasticity_formula: 'Power = (elastane_denier × elastane_pct) / 100; typical 10-40% Lycra',
      stretch_recovery: '80-95% recovery typical for 10-40% elastane content',
      note: 'Open-mesh Raschel with elastomeric inlay. Third bar timing controls compression strength.',
    },
    appearance: 'Open mesh with high elasticity/compression. Smooth face, structured stretch.',
    machine_speed: { min: 400, max: 1400, typical: 900, unit: 'stitch/min' },
    uses: 'Shapewear, foundation garments, swimwear, medical compression wear.',
  },

  {
    id: 'rib_2x1',
    name: '2×1 Rib',
    name_bn: '২×১ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 14, max: 22 },
    gsm_range: { min: 140, max: 460 },
    count_formula: {
      type: 'regression',
      a: -0.115, b: 53.00,
      source: 'ESTIMATED',
      note: '2 cylinder needles active, 1 dial needle active.'
    },
    ll_multiplier: 1.43,
    ll_source: 'ESTIMATED — intermediate density between 1x1 and 2x2 ribs',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 3,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','M']],
        D: [['M','M','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on active, M on inactive', dial: 'K on active, M on inactive', note: '2 active cylinder needles alternate with 1 active dial needle' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAB_AAB',
        description: '2 active cylinder needles (A) followed by 1 deactivated slot (B) aligned with 1 active dial needle'
      }
    },
    appearance: 'Distinct vertical rib cords with 2-to-1 width ratio. Reversible but unbalanced structure.'
  },

  {
    id: 'rib_3x3',
    name: '3×3 Rib',
    name_bn: '৩×৩ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 12, max: 20 },
    gsm_range: { min: 160, max: 460 },
    count_formula: {
      type: 'regression',
      a: -0.110, b: 56.00,
      source: 'ESTIMATED',
      note: '3 cylinder needles active, 3 dial needles active.'
    },
    ll_multiplier: 1.48,
    ll_source: 'ESTIMATED — wider needle grouping increases loop length at rib transitions',
    typical_gauge: 16,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 6,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','M','M','M']],
        D: [['M','M','M','K','K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 3 needles, M on 3 needles', dial: 'M on 3 needles, K on 3 needles', note: 'Alternating blocks of 3 cylinder and 3 dial needles active' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAABBB_AAABBB',
        description: 'Blocks of 3 active cylinder needles alternating with blocks of 3 active dial needles. Rib gating offset.'
      }
    },
    appearance: 'Broad vertical panels. Bulky structure with high stretch recovery, common in knitwear collars.'
  },

  {
    id: 'rib_3x2',
    name: '3×2 Rib',
    name_bn: '৩×২ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 12, max: 20 },
    gsm_range: { min: 150, max: 450 },
    count_formula: {
      type: 'regression',
      a: -0.110, b: 55.00,
      source: 'ESTIMATED',
      note: '3 cylinder needles active, 2 dial needles active.'
    },
    ll_multiplier: 1.46,
    ll_source: 'ESTIMATED — asymmetrical rib spacing',
    typical_gauge: 16,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 5,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','M','M']],
        D: [['M','M','M','K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 3, M on 2', dial: 'M on 3, K on 2', note: 'Alternating block of 3 cylinder needles active and 2 dial needles active' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAABB_AAABB',
        description: '3 active cylinder needles followed by 2 active dial needles.'
      }
    },
    appearance: 'Rib cords with alternating widths of 3 wales (face) and 2 wales (back).'
  },

  {
    id: 'rib_4x1',
    name: '4×1 Rib',
    name_bn: '৪×১ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 14, max: 22 },
    gsm_range: { min: 140, max: 450 },
    count_formula: {
      type: 'regression',
      a: -0.115, b: 54.00,
      source: 'ESTIMATED',
      note: '4 cylinder needles active, 1 dial needle active.'
    },
    ll_multiplier: 1.42,
    ll_source: 'ESTIMATED — flat face appearance with sparse backing ribs',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 5,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','K','M']],
        D: [['M','M','M','M','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 4, M on 1', dial: 'M on 4, K on 1', note: '4 active cylinder needles and 1 active dial needle repeating sequence' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAAB_AAAAB',
        description: '4 active needles on cylinder bed, 1 active needle on dial bed.'
      }
    },
    appearance: 'Wide flat wale panels on technical face separated by narrow single wale channels.'
  },

  {
    id: 'rib_3x1',
    name: '3×1 Rib',
    name_bn: '৩×১ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 14, max: 22 },
    gsm_range: { min: 150, max: 480 },
    count_formula: {
      type: 'regression',
      a: -0.117, b: 53.50,
      source: 'ESTIMATED',
      note: '3 cylinder needles active, 1 dial needle active.'
    },
    ll_multiplier: 1.41,
    ll_source: 'ESTIMATED — interpolated between 2x1 and 4x1 rib multipliers',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 4,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','M']],
        D: [['M','M','M','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 3, M on 1', dial: 'M on 3, K on 1', note: '3 active cylinder needles alternate with 1 active dial needle' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAB_AAAB',
        description: '3 active cylinder needles followed by 1 active dial needle.'
      }
    },
    appearance: 'Wide vertical face cords with a narrow single-wale back rib. Between 2×1 and 4×1 in density.'
  },

  {
    id: 'rib_4x2',
    name: '4×2 Rib',
    name_bn: '৪×২ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 12, max: 20 },
    gsm_range: { min: 160, max: 500 },
    count_formula: {
      type: 'regression',
      a: -0.108, b: 55.50,
      source: 'ESTIMATED',
      note: '4 cylinder needles active, 2 dial needles active.'
    },
    ll_multiplier: 1.47,
    ll_source: 'ESTIMATED — wider block than 3x2, more yarn at each rib transition',
    typical_gauge: 16,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 6,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','K','M','M']],
        D: [['M','M','M','M','K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 4, M on 2', dial: 'M on 4, K on 2', note: 'Alternating block of 4 cylinder needles active and 2 dial needles active' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAABB_AAAABB',
        description: '4 active cylinder needles followed by 2 active dial needles.'
      }
    },
    appearance: 'Broad face panels with a moderate 2-wale back rib. Structured, sweater-weight ribbing.'
  },

  {
    id: 'rib_4x3',
    name: '4×3 Rib',
    name_bn: '৪×৩ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 10, max: 18 },
    gsm_range: { min: 170, max: 520 },
    count_formula: {
      type: 'regression',
      a: -0.106, b: 57.00,
      source: 'ESTIMATED',
      note: '4 cylinder needles active, 3 dial needles active.'
    },
    ll_multiplier: 1.49,
    ll_source: 'ESTIMATED — near-balanced wide block, between 3x3 and 5x4 in density',
    typical_gauge: 14,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 7,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','K','M','M','M']],
        D: [['M','M','M','M','K','K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 4, M on 3', dial: 'M on 4, K on 3', note: 'Alternating block of 4 cylinder needles active and 3 dial needles active' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAABBB_AAAABBB',
        description: '4 active cylinder needles followed by 3 active dial needles.'
      }
    },
    appearance: 'Near-balanced broad panels, heavier and bulkier than 3×3. Used in chunky knitwear ribbing.'
  },

  {
    id: 'rib_5x1',
    name: '5×1 Rib',
    name_bn: '৫×১ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 12, max: 20 },
    gsm_range: { min: 160, max: 480 },
    count_formula: {
      type: 'regression',
      a: -0.118, b: 53.00,
      source: 'ESTIMATED',
      note: '5 cylinder needles active, 1 dial needle active.'
    },
    ll_multiplier: 1.40,
    ll_source: 'ESTIMATED — very sparse backing rib, similar flat-face economy to 4x1',
    typical_gauge: 16,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 6,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','K','K','M']],
        D: [['M','M','M','M','M','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 5, M on 1', dial: 'M on 5, K on 1', note: '5 active cylinder needles and 1 active dial needle repeating sequence' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAAAB_AAAAAB',
        description: '5 active needles on cylinder bed, 1 active needle on dial bed.'
      }
    },
    appearance: 'Very wide flat face panels separated by narrow single-wale channels. Near single-jersey look with rib elasticity at the seam lines.'
  },

  {
    id: 'rib_5x3',
    name: '5×3 Rib',
    name_bn: '৫×৩ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 10, max: 18 },
    gsm_range: { min: 180, max: 540 },
    count_formula: {
      type: 'regression',
      a: -0.104, b: 58.00,
      source: 'ESTIMATED',
      note: '5 cylinder needles active, 3 dial needles active.'
    },
    ll_multiplier: 1.50,
    ll_source: 'ESTIMATED — wide asymmetric block, heavier than 4x3',
    typical_gauge: 14,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 8,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','K','K','M','M','M']],
        D: [['M','M','M','M','M','K','K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 5, M on 3', dial: 'M on 5, K on 3', note: 'Alternating block of 5 cylinder needles active and 3 dial needles active' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAAABBB_AAAAABBB',
        description: '5 active cylinder needles followed by 3 active dial needles.'
      }
    },
    appearance: 'Wide face cords with a substantial 3-wale back rib. Heavy, structured — outerwear and collar ribbing.'
  },

  {
    id: 'rib_5x4',
    name: '5×4 Rib',
    name_bn: '৫×৪ রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 8, max: 16 },
    gsm_range: { min: 190, max: 560 },
    count_formula: {
      type: 'regression',
      a: -0.100, b: 59.00,
      source: 'ESTIMATED',
      note: '5 cylinder needles active, 4 dial needles active.'
    },
    ll_multiplier: 1.52,
    ll_source: 'ESTIMATED — near-balanced very wide block, heaviest of the catalogued gauge combos',
    typical_gauge: 12,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 9,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','K','K','K','M','M','M','M']],
        D: [['M','M','M','M','M','K','K','K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 5, M on 4', dial: 'M on 5, K on 4', note: 'Alternating block of 5 cylinder needles active and 4 dial needles active' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAAABBBB_AAAAABBBB',
        description: '5 active cylinder needles followed by 4 active dial needles.'
      }
    },
    appearance: 'Near-balanced very wide panels. Bulky, heavyweight ribbing used in chunky cuffs, collars, and sweater bodies at coarse gauge.'
  },

  {
    id: 'lycra_rib_2x2',
    name: '2×2 Rib + Lycra (Elastane)',
    name_bn: 'লাইক্রা ২×২ রিব',
    category: 'rib',
    base: 'rib_2x2',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 14, max: 22 },
    gsm_range: { min: 180, max: 440 },
    count_formula: {
      type: 'regression',
      a: -0.108, b: 56.62,
      source: 'PDF_VERIFIED',
      note: 'Includes 5-8% elastane for compression and stretch recovery.'
    },
    ll_multiplier: 1.45,
    ll_source: 'PDF_VERIFIED — matches standard 2x2 rib base',
    typical_gauge: 18,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 1,
      wales_per_repeat: 4,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [['K','K','M','M']],
        D: [['M','M','K','K']]
      },
      cam: [
        { feed: 1, cylinder: 'K on 2, M on 2', dial: 'M on 2, K on 2', note: 'Knit with main spun yarn plated with elastane thread' }
      ],
      needle_arrangement: {
        butt_pattern: 'CC_DD_CC_DD',
        description: '2 active cylinder needles alternating with 2 active dial needles. Plating attachment engaged.'
      }
    },
    appearance: 'Heavy ribbed structure with exceptional widthwise elastic stretch and shape retention.'
  },

  {
    id: 'pointelle_eyelet',
    name: 'Eyelet Pointelle',
    name_bn: 'আইলেট পয়েন্টেল',
    category: 'single_jersey',
    base: 'pointelle',
    machine_type: 'single_bed_circular_or_flatbed',
    gauge_range: { min: 18, max: 32 },
    gsm_range: { min: 70, max: 180 },
    count_formula: {
      type: 'regression',
      a: -0.130, b: 48.00,
      source: 'ESTIMATED',
      note: 'Fine lace-like holes formed by single-needle loop transfer.'
    },
    ll_multiplier: 0.96,
    ll_source: 'ESTIMATED — open holes reduce weight per unit area',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder'],
      pattern: [
        ['K','K','K','K'],
        ['K','M','K','K'],
        ['K','K','K','K'],
        ['K','K','K','K']
      ],
      cam: [
        { feed: 1, cylinder: 'K', note: 'Base jersey course' },
        { feed: 2, cylinder: 'K/transfer', note: 'Selected needle loop is transferred to adjacent cylinder needle' },
        { feed: 3, cylinder: 'K', note: 'Base jersey course' },
        { feed: 4, cylinder: 'K', note: 'Locking course' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'All needles active. Needle selection logic drives transfer elements on course 2.'
      }
    },
    appearance: 'Lightweight fabric punctuated by tiny circular eyelet holes in a regular grid.'
  },

  {
    id: 'pointelle_chevron',
    name: 'Chevron Pointelle',
    name_bn: 'শেভরন পয়েন্টেল',
    category: 'single_jersey',
    base: 'pointelle',
    machine_type: 'single_bed_circular_or_flatbed',
    gauge_range: { min: 18, max: 32 },
    gsm_range: { min: 80, max: 200 },
    count_formula: {
      type: 'regression',
      a: -0.130, b: 49.00,
      source: 'ESTIMATED',
      note: 'Zig-zag lace holes formed by shifting transfer points.'
    },
    ll_multiplier: 0.98,
    ll_source: 'ESTIMATED — chevron design balances tension',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 8,
      wales_per_repeat: 8,
      beds: ['cylinder'],
      pattern: [
        ['K','K','K','K','K','K','K','K'],
        ['K','M','K','K','K','K','K','K'],
        ['K','K','M','K','K','K','K','K'],
        ['K','K','K','M','K','K','K','K'],
        ['K','K','K','K','K','K','K','K'],
        ['K','K','K','K','K','K','M','K'],
        ['K','K','K','K','K','M','K','K'],
        ['K','K','K','K','M','K','K','K']
      ],
      cam: [
        { feed: 1, cylinder: 'K', note: 'Plain knit course' },
        { feed: 2, cylinder: 'Transfer at W2', note: 'Transfer course for left wing' },
        { feed: 3, cylinder: 'Transfer at W3', note: 'Transfer course for left wing' },
        { feed: 4, cylinder: 'Transfer at W4', note: 'Transfer course for left wing' },
        { feed: 5, cylinder: 'K', note: 'Plain knit course' },
        { feed: 6, cylinder: 'Transfer at W7', note: 'Transfer course for right wing' },
        { feed: 7, cylinder: 'Transfer at W6', note: 'Transfer course for right wing' },
        { feed: 8, cylinder: 'Transfer at W5', note: 'Transfer course for right wing' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'Electronic selection controls transfer cams for V-shape geometry.'
      }
    },
    appearance: 'Distinct V-shaped zig-zag (chevron) lace tracks on a single-jersey base.'
  },

  {
    id: 'pointelle_diagonal',
    name: 'Diagonal Pointelle',
    name_bn: 'ডায়াগোনাল পয়েন্টেল',
    category: 'single_jersey',
    base: 'pointelle',
    machine_type: 'single_bed_circular_or_flatbed',
    gauge_range: { min: 18, max: 32 },
    gsm_range: { min: 70, max: 180 },
    count_formula: {
      type: 'regression',
      a: -0.135, b: 47.50,
      source: 'ESTIMATED',
      note: 'Mesh-like structure with diagonal hole lines.'
    },
    ll_multiplier: 0.95,
    ll_source: 'ESTIMATED — open diagonal mesh reduces density',
    typical_gauge: 24,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 6,
      wales_per_repeat: 6,
      beds: ['cylinder'],
      pattern: [
        ['K','K','K','K','K','K'],
        ['K','M','K','K','K','K'],
        ['K','K','K','M','K','K'],
        ['K','K','K','K','K','M'],
        ['K','K','K','K','K','K'],
        ['K','K','M','K','K','K']
      ],
      cam: [
        { feed: 1, cylinder: 'K', note: 'Knit' },
        { feed: 2, cylinder: 'Transfer W2', note: 'Diagonal hole step 1' },
        { feed: 3, cylinder: 'Transfer W4', note: 'Diagonal hole step 2' },
        { feed: 4, cylinder: 'Transfer W6', note: 'Diagonal hole step 3' },
        { feed: 5, cylinder: 'K', note: 'Knit' },
        { feed: 6, cylinder: 'Transfer W3', note: 'Diagonal hole step 4' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAAA',
        description: 'Electronic selection controls diagonal shifting.'
      }
    },
    appearance: 'Sporty, mesh-like appearance with diagonal lace tracks. High breathability.'
  },

  {
    id: 'waffle_knit',
    name: 'Waffle Knit',
    name_bn: 'ওয়াফেল নিট',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 12, max: 20 },
    gsm_range: { min: 180, max: 320 },
    count_formula: {
      type: 'regression',
      a: -0.105, b: 54.00,
      source: 'ESTIMATED',
      note: 'Three-dimensional cell structure formed by combining knit and tuck.'
    },
    ll_multiplier: 1.50,
    ll_source: 'ESTIMATED — heavy tucking on both cylinder and dial increases loop length',
    typical_gauge: 16,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 4,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [
          ['K','K','K','K'],
          ['K','T','K','T'],
          ['K','K','K','K'],
          ['K','T','K','T']
        ],
        D: [
          ['K','K','K','K'],
          ['T','K','T','K'],
          ['K','K','K','K'],
          ['T','K','T','K']
        ]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'K', note: 'Course 1: 1x1 rib knit course' },
        { feed: 2, cylinder: 'K on odd, T on even', dial: 'T on odd, K on even', note: 'Course 2: cylinder tucks even wales, dial tucks odd wales' },
        { feed: 3, cylinder: 'K', dial: 'K', note: 'Course 3: 1x1 rib knit course' },
        { feed: 4, cylinder: 'T on odd, K on even', dial: 'K on odd, T on even', note: 'Course 4: cylinder tucks odd wales, dial tucks even wales' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternating long (A) and short (B) butt needles on both cylinder and dial. Standard rib gating.'
      }
    },
    appearance: 'Pronounced three-dimensional square cell pattern resembling a waffle. High warmth and absorption.'
  },

  {
    id: 'cable_rib',
    name: 'Cable Rib (Mock Cable)',
    name_bn: 'ক্যাবল রিব',
    category: 'rib',
    base: 'rib_1x1',
    machine_type: 'double_bed_circular',
    gauge_range: { min: 10, max: 18 },
    gsm_range: { min: 200, max: 480 },
    count_formula: {
      type: 'regression',
      a: -0.095, b: 52.00,
      source: 'ESTIMATED',
      note: 'Mock cable effect created by selective tuck loops and needle grouping.'
    },
    ll_multiplier: 1.52,
    ll_source: 'ESTIMATED — bulky mock-cable structure',
    typical_gauge: 14,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 6,
      wales_per_repeat: 6,
      beds: ['cylinder', 'dial'],
      pattern: {
        C: [
          ['K','K','K','M','M','M'],
          ['K','K','K','M','M','M'],
          ['T','T','T','M','M','M'],
          ['K','K','K','M','M','M'],
          ['K','K','K','M','M','M'],
          ['T','T','T','M','M','M']
        ],
        D: [
          ['M','M','M','K','K','K'],
          ['M','M','M','K','K','K'],
          ['M','M','M','T','T','T'],
          ['M','M','M','K','K','K'],
          ['M','M','M','K','K','K'],
          ['M','M','M','T','T','T']
        ]
      },
      cam: [
        { feed: 1, cylinder: 'K', dial: 'M', note: 'Courses 1-2: Knit on cylinder panel' },
        { feed: 3, cylinder: 'T', dial: 'M', note: 'Course 3: Tuck on cylinder to accumulate yarn and raise design' },
        { feed: 4, cylinder: 'M', dial: 'K', note: 'Courses 4-5: Knit on dial panel' },
        { feed: 6, cylinder: 'M', dial: 'T', note: 'Course 6: Tuck on dial to raise panel' }
      ],
      needle_arrangement: {
        butt_pattern: 'AAABBB',
        description: 'Blocks of 3 active cylinder needles and 3 active dial needles. Cylinder A needles correspond to dial B slots.'
      }
    },
    appearance: 'Bulky mock cable patterns on technical face with a ribbed reverse. Heavyweight.'
  },

  {
    id: 'moss_stitch',
    name: 'Moss Stitch',
    name_bn: 'মস স্টিচ',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 16, max: 28 },
    gsm_range: { min: 140, max: 300 },
    count_formula: {
      type: 'regression',
      a: -0.138, b: 54.00,
      source: 'ESTIMATED',
      note: 'Grainy texture formed by alternating knit and tuck loops.'
    },
    ll_multiplier: 1.12,
    ll_source: 'ESTIMATED — tuck loops increase average loop length',
    typical_gauge: 22,
    structure: {
      type: 'weft_knit',
      courses_per_repeat: 4,
      wales_per_repeat: 2,
      beds: ['cylinder'],
      pattern: [
        ['K','T'],
        ['T','K'],
        ['K','T'],
        ['T','K']
      ],
      cam: [
        { feed: 1, cylinder: 'K on odd, T on even', note: 'Feed 1: odd needle knits, even needle tucks' },
        { feed: 2, cylinder: 'T on odd, K on even', note: 'Feed 2: odd needle tucks, even needle knits' },
        { feed: 3, cylinder: 'K on odd, T on even', note: 'Feed 3: same as feed 1' },
        { feed: 4, cylinder: 'T on odd, K on even', note: 'Feed 4: same as feed 2' }
      ],
      needle_arrangement: {
        butt_pattern: 'ABAB',
        description: 'Alternating long-butt (A) and short-butt (B) cylinder needles. Controlled by independent knit/tuck cam tracks.'
      }
    },
    appearance: 'Granular, seed-like, textured surface. Stable and less prone to curling than plain single jersey.'
  }
];

// ============================================================
// LOOP LENGTH MULTIPLIER SUMMARY TABLE
// For easy lookup by the calculation engine
// ============================================================
const LL_MULTIPLIERS_COMPLETE = {
  single_jersey:     { m: 1.00, gauge_ref: 24, source: 'PDF_VERIFIED' },
  pique_single:      { m: 1.25, gauge_ref: 24, source: 'ESTIMATED' },
  pique_double:      { m: 1.35, gauge_ref: 24, source: 'ESTIMATED' },
  lacoste_single:    { m: 1.15, gauge_ref: 24, source: 'ESTIMATED' },
  lacoste_double:    { m: 1.20, gauge_ref: 24, source: 'ESTIMATED' },
  french_terry:      { m: 1.60, gauge_ref: 18, source: 'ESTIMATED', note: 'Ground yarn reference' },
  fleece_2_thread:   { m: 1.60, gauge_ref: 20, source: 'ESTIMATED', note: 'Ground yarn reference' },
  fleece_3_thread:   { m: 1.65, gauge_ref: 18, source: 'ESTIMATED', note: 'Ground yarn reference' },
  fleece_diagonal:   { m: 1.65, gauge_ref: 18, source: 'ESTIMATED', note: 'Ground yarn reference' },
  terry_fabric:      { m: 1.55, gauge_ref: 20, source: 'ESTIMATED', note: 'Ground yarn reference' },
  pointelle:         { m: 0.95, gauge_ref: 28, source: 'ESTIMATED' },
  plated_jersey:     { m: 1.05, gauge_ref: 24, source: 'ESTIMATED' },
  single_jacquard:   { m: 1.20, gauge_ref: 24, source: 'ESTIMATED' },
  rib_1x1:           { m: 1.40, gauge_ref: 18, source: 'PDF_VERIFIED' },
  rib_2x2:           { m: 1.45, gauge_ref: 18, source: 'PDF_VERIFIED (approx)' },
  lycra_rib_1x1:     { m: 1.40, gauge_ref: 18, source: 'PDF_VERIFIED' },
  half_cardigan:     { m: 1.55, gauge_ref: 16, source: 'ESTIMATED' },
  full_cardigan:     { m: 1.65, gauge_ref: 14, source: 'ESTIMATED' },
  half_milano:       { m: 1.35, gauge_ref: 18, source: 'ESTIMATED' },
  full_milano:       { m: 1.45, gauge_ref: 18, source: 'ESTIMATED' },
  drop_needle_rib:   { m: 1.40, gauge_ref: 18, source: 'ESTIMATED' },
  interlock:         { m: 1.90, gauge_ref: 24, source: 'PDF_VERIFIED' },
  ponte_di_roma:     { m: 1.70, gauge_ref: 24, source: 'ESTIMATED' },
  eight_lock:        { m: 1.85, gauge_ref: 24, source: 'ESTIMATED' },
  bourrelet:         { m: 1.60, gauge_ref: 18, source: 'ESTIMATED' },
  texipique:         { m: 1.40, gauge_ref: 24, source: 'ESTIMATED' },
  single_cross_tuck: { m: 1.15, gauge_ref: 24, source: 'ESTIMATED' },
  mock_rib:          { m: 1.10, gauge_ref: 24, source: 'ESTIMATED' },
  knitted_twill:     { m: 1.22, gauge_ref: 20, source: 'ESTIMATED' },
  knitted_crepe:     { m: 1.15, gauge_ref: 24, source: 'ESTIMATED' },
  swiss_double_pique:{ m: 1.50, gauge_ref: 24, source: 'ESTIMATED' },
  french_double_pique:{m: 1.50, gauge_ref: 24, source: 'ESTIMATED' },
  lacoste_pique:     { m: 1.45, gauge_ref: 24, source: 'ESTIMATED' },
  gabardine_double:  { m: 1.60, gauge_ref: 18, source: 'ESTIMATED' },
  poplin_double:     { m: 1.55, gauge_ref: 20, source: 'ESTIMATED' },
  blister_single:    { m: 1.65, gauge_ref: 24, source: 'ESTIMATED' },
  relief_single:     { m: 1.60, gauge_ref: 18, source: 'ESTIMATED' },
  rib_2x1:           { m: 1.43, gauge_ref: 18, source: 'ESTIMATED' },
  rib_3x3:           { m: 1.48, gauge_ref: 16, source: 'ESTIMATED' },
  rib_3x2:           { m: 1.46, gauge_ref: 16, source: 'ESTIMATED' },
  rib_4x1:           { m: 1.42, gauge_ref: 18, source: 'ESTIMATED' },
  rib_3x1:           { m: 1.41, gauge_ref: 18, source: 'ESTIMATED' },
  rib_4x2:           { m: 1.47, gauge_ref: 16, source: 'ESTIMATED' },
  rib_4x3:           { m: 1.49, gauge_ref: 14, source: 'ESTIMATED' },
  rib_5x1:           { m: 1.40, gauge_ref: 16, source: 'ESTIMATED' },
  rib_5x3:           { m: 1.50, gauge_ref: 14, source: 'ESTIMATED' },
  rib_5x4:           { m: 1.52, gauge_ref: 12, source: 'ESTIMATED' },
  lycra_rib_2x2:     { m: 1.45, gauge_ref: 18, source: 'ESTIMATED' },
  pointelle_eyelet:  { m: 0.96, gauge_ref: 24, source: 'ESTIMATED' },
  pointelle_chevron: { m: 0.98, gauge_ref: 24, source: 'ESTIMATED' },
  pointelle_diagonal:{ m: 0.95, gauge_ref: 24, source: 'ESTIMATED' },
  waffle_knit:       { m: 1.50, gauge_ref: 16, source: 'ESTIMATED' },
  cable_rib:         { m: 1.52, gauge_ref: 14, source: 'ESTIMATED' },
  moss_stitch:       { m: 1.12, gauge_ref: 22, source: 'ESTIMATED' },
  weft_lockknit:     { m: 0.90, gauge_ref: 24, source: 'ESTIMATED' },
  birds_eye:         { m: 0.93, gauge_ref: 24, source: 'ESTIMATED' },
  popcorn_blister:   { m: 1.65, gauge_ref: 18, source: 'ESTIMATED' },
  pique_interlock:   { m: 1.55, gauge_ref: 24, source: 'ESTIMATED' },
  cellular_blister:  { m: 1.58, gauge_ref: 18, source: 'ESTIMATED' },
  jersey_blister:    { m: 0.95, gauge_ref: 22, source: 'ESTIMATED' },
  knop_honeycomb:    { m: 1.50, gauge_ref: 18, source: 'ESTIMATED' },
  velour_plush:      { m: 1.55, gauge_ref: 20, source: 'ESTIMATED', note: 'Ground yarn reference' },
  accordion_tuck:    { m: 1.05, gauge_ref: 22, source: 'ESTIMATED' },
  purl_1x1:          { m: 1.45, gauge_ref: 14, source: 'ESTIMATED' },
};

// ============================================================
// GSM → COUNT REGRESSION COMPLETE TABLE
// ============================================================
const GSM_COUNT_REGRESSION_COMPLETE = {
  single_jersey:   { a: -0.141, b: 50.22, source: 'PDF_VERIFIED',   gsm_range: [100,260] },
  pique_single:    { a: -0.146, b: 57.16, source: 'PDF_VERIFIED',   gsm_range: [130,300] },
  pique_double:    { a: -0.138, b: 55.00, source: 'ESTIMATED',      gsm_range: [160,320] },
  lacoste_single:  { a: -0.169, b: 56.65, source: 'LOOKUP_DERIVED', gsm_range: [160,250] },
  lacoste_double:  { a: -0.167, b: 64.36, source: 'PDF_VERIFIED',   gsm_range: [180,280] },
  pointelle:       { a: -0.130, b: 47.50, source: 'ESTIMATED',      gsm_range: [80,180] },
  plated_jersey:   { a: -0.141, b: 50.22, source: 'ESTIMATED',      gsm_range: [120,260], note: 'Use combined yarn Ne' },
  single_jacquard: { a: -0.130, b: 47.50, source: 'ESTIMATED',      gsm_range: [140,280] },
  rib_1x1:         { a: -0.123, b: 54.57, source: 'PDF_VERIFIED',   gsm_range: [130,300] },
  rib_2x2:         { a: -0.108, b: 56.62, source: 'PDF_VERIFIED',   gsm_range: [150,310] },
  lycra_rib_1x1:   { a: -0.119, b: 59.12, source: 'PDF_VERIFIED',   gsm_range: [150,280] },
  lycra_rib_2x2:   { a: -0.108, b: 56.62, source: 'PDF_VERIFIED',   gsm_range: [180,280] },
  half_cardigan:   { a: -0.115, b: 53.50, source: 'ESTIMATED',      gsm_range: [180,380] },
  full_cardigan:   { a: -0.108, b: 52.00, source: 'ESTIMATED',      gsm_range: [220,450] },
  half_milano:     { a: -0.120, b: 54.00, source: 'ESTIMATED',      gsm_range: [160,340] },
  full_milano:     { a: -0.110, b: 54.00, source: 'ESTIMATED',      gsm_range: [180,380] },
  drop_needle_rib: { a: -0.120, b: 54.00, source: 'ESTIMATED',      gsm_range: [150,300] },
  interlock:       { a: -0.206, b: 80.56, source: 'PDF_VERIFIED',   gsm_range: [150,380] },
  ponte_di_roma:   { a: -0.170, b: 68.00, source: 'ESTIMATED',      gsm_range: [200,350] },
  eight_lock:      { a: -0.190, b: 74.00, source: 'ESTIMATED',      gsm_range: [180,320] },
  bourrelet:       { a: -0.155, b: 62.00, source: 'ESTIMATED',      gsm_range: [220,420] },
  texipique:       { a: -0.150, b: 60.00, source: 'ESTIMATED',      gsm_range: [180,320] },
  single_cross_tuck:{ a: -0.150, b: 54.00, source: 'ESTIMATED',     gsm_range: [140,220] },
  mock_rib:        { a: -0.140, b: 52.00, source: 'ESTIMATED',      gsm_range: [130,200] },
  knitted_twill:   { a: -0.140, b: 54.00, source: 'ESTIMATED',      gsm_range: [160,280] },
  knitted_crepe:   { a: -0.140, b: 52.00, source: 'ESTIMATED',      gsm_range: [130,220] },
  swiss_double_pique:{ a: -0.150, b: 62.00, source: 'ESTIMATED',    gsm_range: [180,320] },
  french_double_pique:{a: -0.150, b: 62.00, source: 'ESTIMATED',    gsm_range: [180,320] },
  lacoste_pique:   { a: -0.160, b: 60.00, source: 'ESTIMATED',      gsm_range: [170,300] },
  gabardine_double:{ a: -0.130, b: 58.00, source: 'ESTIMATED',      gsm_range: [200,380] },
  poplin_double:   { a: -0.140, b: 60.00, source: 'ESTIMATED',      gsm_range: [160,320] },
  blister_single:  { a: -0.150, b: 64.00, source: 'ESTIMATED',      gsm_range: [200,360] },
  relief_single:   { a: -0.130, b: 60.00, source: 'ESTIMATED',      gsm_range: [220,400] },
  heavy_jersey:    { a: -0.0889, b: 37.11, source: 'LOOKUP_DERIVED', gsm_range: [260,350] },
  rib_2x1:         { a: -0.115, b: 53.00, source: 'ESTIMATED',      gsm_range: [140,300] },
  rib_3x3:         { a: -0.110, b: 56.00, source: 'ESTIMATED',      gsm_range: [160,320] },
  rib_3x2:         { a: -0.110, b: 55.00, source: 'ESTIMATED',      gsm_range: [150,310] },
  rib_4x1:         { a: -0.115, b: 54.00, source: 'ESTIMATED',      gsm_range: [140,300] },
  rib_3x1:         { a: -0.117, b: 53.50, source: 'ESTIMATED',      gsm_range: [150,300] },
  rib_4x2:         { a: -0.108, b: 55.50, source: 'ESTIMATED',      gsm_range: [160,320] },
  rib_4x3:         { a: -0.106, b: 57.00, source: 'ESTIMATED',      gsm_range: [170,330] },
  rib_5x1:         { a: -0.118, b: 53.00, source: 'ESTIMATED',      gsm_range: [160,300] },
  rib_5x3:         { a: -0.104, b: 58.00, source: 'ESTIMATED',      gsm_range: [180,340] },
  rib_5x4:         { a: -0.100, b: 59.00, source: 'ESTIMATED',      gsm_range: [190,350] },
  pointelle_eyelet:{ a: -0.130, b: 48.00, source: 'ESTIMATED',      gsm_range: [80,180] },
  pointelle_chevron:{a: -0.130, b: 49.00, source: 'ESTIMATED',      gsm_range: [90,200] },
  pointelle_diagonal:{a: -0.135, b: 47.50, source: 'ESTIMATED',     gsm_range: [80,170] },
  waffle_knit:     { a: -0.105, b: 54.00, source: 'ESTIMATED',      gsm_range: [180,350] },
  cable_rib:       { a: -0.095, b: 52.00, source: 'ESTIMATED',      gsm_range: [200,400] },
  moss_stitch:     { a: -0.138, b: 54.00, source: 'ESTIMATED',      gsm_range: [150,280] },
  weft_lockknit:   { a: -0.141, b: 50.22, source: 'ESTIMATED',      gsm_range: [120,220] },
  birds_eye:       { a: -0.140, b: 51.00, source: 'ESTIMATED',      gsm_range: [130,230] },
  popcorn_blister: { a: -0.130, b: 57.00, source: 'ESTIMATED',      gsm_range: [180,350] },
  pique_interlock: { a: -0.150, b: 63.00, source: 'ESTIMATED',      gsm_range: [200,380] },
  cellular_blister:{ a: -0.132, b: 56.50, source: 'ESTIMATED',      gsm_range: [190,330] },
  jersey_blister:  { a: -0.138, b: 53.00, source: 'ESTIMATED',      gsm_range: [140,260] },
  knop_honeycomb:  { a: -0.115, b: 55.00, source: 'ESTIMATED',      gsm_range: [190,340] },
  velour_plush:    { a: -0.100, b: 38.00, source: 'ESTIMATED',      gsm_range: [220,420], note: 'Ground yarn Ne' },
  accordion_tuck:  { a: -0.137, b: 51.50, source: 'ESTIMATED',      gsm_range: [130,260] },
  purl_1x1:        { a: -0.110, b: 52.00, source: 'ESTIMATED',      gsm_range: [200,420] },
};

module.exports = {
  FABRIC_DERIVATIVES,
  LL_MULTIPLIERS_COMPLETE,
  GSM_COUNT_REGRESSION_COMPLETE,
};
