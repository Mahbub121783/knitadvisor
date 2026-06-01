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
    gsm_range: { min: 100, max: 260 },
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
    gsm_range: { min: 260, max: 350 },
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
    name: 'Single Pique (Polo Pique)',
    name_bn: 'সিঙ্গেল পিকে',
    category: 'single_jersey',
    base: 'single_jersey',
    machine_type: 'single_bed_circular',
    gauge_range: { min: 18, max: 28 },
    gsm_range: { min: 130, max: 300 },
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
    gsm_range: { min: 160, max: 320 },
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
    gsm_range: { min: 160, max: 250 },
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
    gsm_range: { min: 180, max: 280 },
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
    gsm_range: { min: 200, max: 400 },
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
    gsm_range: { min: 200, max: 350 },
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
    gsm_range: { min: 200, max: 400 },
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
    gsm_range: { min: 200, max: 400 },
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
    gsm_range: { min: 200, max: 350 },
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
    gsm_range: { min: 80, max: 180 },
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
    gsm_range: { min: 120, max: 260 },
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
    gsm_range: { min: 140, max: 280 },
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
    gsm_range: { min: 140, max: 220 },
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
    gsm_range: { min: 130, max: 200 },
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
    gsm_range: { min: 160, max: 280 },
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
    gsm_range: { min: 130, max: 220 },
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
    gsm_range: { min: 130, max: 300 },
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
    gsm_range: { min: 150, max: 310 },
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
    gsm_range: { min: 150, max: 280 },
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
      note: 'Same as 1×1 rib, plus elastane (Lycra) inlaid — fed without forming needle loops, runs between needle loops',
      extra_feed: 'Elastane core feed (20D–40D) between ground yarn feeds',
      pattern: { C: [['K']], D: [['K']] }
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
    gsm_range: { min: 180, max: 380 },
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
    gsm_range: { min: 220, max: 450 },
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
    gsm_range: { min: 160, max: 340 },
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
    gsm_range: { min: 180, max: 380 },
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
    gsm_range: { min: 150, max: 300 },
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
    gsm_range: { min: 150, max: 380 },
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
    gsm_range: { min: 200, max: 350 },
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
    gsm_range: { min: 180, max: 320 },
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
    gsm_range: { min: 180, max: 320 },
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
    gsm_range: { min: 170, max: 300 },
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
    gsm_range: { min: 200, max: 380 },
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
    gsm_range: { min: 160, max: 320 },
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
    name: 'Single Blister Fabric',
    name_bn: 'সিঙ্গেল ব্লিস্টার',
    category: 'interlock',
    base: 'interlock',
    machine_type: 'double_bed_circular_interlock',
    gauge_range: { min: 16, max: 28 },
    gsm_range: { min: 200, max: 360 },
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
    gsm_range: { min: 220, max: 400 },
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
    gsm_range: { min: 180, max: 320 },
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
    gsm_range: { min: 220, max: 420 },
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
    gsm_range: { min: 180, max: 320 },
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
};

module.exports = {
  FABRIC_DERIVATIVES,
  LL_MULTIPLIERS_COMPLETE,
  GSM_COUNT_REGRESSION_COMPLETE,
};
