const { FABRIC_DERIVATIVES } = require('./fabric-derivatives');

/**
 * Dynamic Pattern Generation Engine
 * Analyzes the static pattern data in fabric-derivatives and generates
 * structural metadata, sequence timing, and cam requirements dynamically.
 */
class PatternEngine {
  constructor() {
    this.cache = new Map();
  }

  generatePattern(fabricId, gsm = null, gauge = null, composition = null) {
    const cacheKey = `${fabricId}_${gsm || ''}_${gauge || ''}_${composition || ''}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const fabric = FABRIC_DERIVATIVES.find(f => f.id === fabricId);
    if (!fabric || !fabric.structure) {
      return null;
    }

    // Clone the structure to prevent mutating global definitions
    const structure = JSON.parse(JSON.stringify(fabric.structure));

    // Apply dynamic adjustments based on gsm, gauge, and composition
    let dynamicNote = structure.note || '';
    
    // --- 1. Rib 2x2 & Lycra Rib 2x2: Drop Needle setup at very high GSM ---
    if ((fabricId === 'rib_2x2' || fabricId === 'lycra_rib_2x2') && gsm && gsm > 220 && gauge && gauge >= 18) {
      structure.courses_per_repeat = 1;
      structure.wales_per_repeat = 5;
      structure.pattern = {
        C: [['K', 'K', 'M', 'M', 'M']],
        D: [['M', 'M', 'K', 'K', 'M']]
      };
      structure.cam = [
        { feed: 1, cylinder: 'K on active, M on dropped', dial: 'K on active, M on dropped', note: '2 active cylinder then 2 active dial needles knit, dropping the 5th needle slot to prevent crowing/collision.' }
      ];
      structure.needle_arrangement = {
        butt_pattern: 'CC__DD__',
        description: 'Drop-needle setup: 2 active cylinder needles alternating with 2 active dial needles and 1 deactivated needle slot on both beds to accommodate thick yarn on fine gauge.'
      };
      dynamicNote = 'Heavy fabric drop-needle configuration active (4 wales + 1 dropped wale repeat) to prevent needle damage and jamming.';
    }

    // --- 2. Lycra Rib 1x1 & 2x2: Full-feed vs Half-feed Plating ---
    if (fabricId === 'lycra_rib_1x1' || fabricId === 'lycra_rib_2x2') {
      if (gsm && gsm >= 220) {
        structure.cam = [
          { feed: 1, cylinder: 'K', dial: 'K', note: 'Alternating needles plate main cotton yarn and Lycra on all feeds (Full-feed) for high recovery power.' }
        ];
        if (structure.needle_arrangement) {
          structure.needle_arrangement.description = 'Alternating beds gating. Plating carrier feeds Lycra on ALL feeds (Full-feed plating).';
        }
        dynamicNote = 'Full-feed Lycra plating engaged (all feeds). Provides maximum recovery power, thickness, and density.';
      } else if (gsm) {
        structure.cam = [
          { feed: 1, cylinder: 'K', dial: 'K', note: 'Alternating needles plate main cotton yarn and Lycra at alternate feeds (Half-feed) for lightweight stretch.' }
        ];
        if (structure.needle_arrangement) {
          structure.needle_arrangement.description = 'Alternating beds gating. Plating carrier feeds Lycra at alternate feeds only (Half-feed plating).';
        }
        dynamicNote = 'Half-feed Lycra plating engaged (alternate feeds). Balances elastic recovery with lightweight drapability.';
      }
    }

    // --- 3. Single Pique & Single Lacoste: Tuck-to-Miss weight reduction ---
    if (gsm && gsm > 220) {
      if (fabricId === 'pique_single') {
        structure.pattern = [
          ['K', 'T'],
          ['K', 'M'],
          ['T', 'K'],
          ['M', 'K']
        ];
        structure.cam = [
          { feed: 1, cylinder: 'K/T', note: 'Odd needles knit, even needles tuck' },
          { feed: 2, cylinder: 'K/M', note: 'Odd needles knit, even needles miss (tuck loop converted to miss to prevent stiff boardy fabric)' },
          { feed: 3, cylinder: 'T/K', note: 'Odd needles tuck, even needles knit' },
          { feed: 4, cylinder: 'M/K', note: 'Odd needles miss, even needles knit (tuck loop converted to miss to prevent stiff boardy fabric)' }
        ];
        dynamicNote = 'High GSM tuck-to-miss adaptation active. Secondary tuck loops replaced with miss loops to reduce fabric weight and stiffness, keeping the pique drapable.';
      } else if (fabricId === 'lacoste_single') {
        structure.pattern = [
          ['K', 'T'],
          ['K', 'K'],
          ['T', 'K'],
          ['M', 'M']
        ];
        structure.cam = [
          { feed: 1, cylinder: 'K/T', note: 'A needles knit, B needles tuck' },
          { feed: 2, cylinder: 'K', note: 'All needles knit' },
          { feed: 3, cylinder: 'T/K', note: 'A needles tuck, B needles knit' },
          { feed: 4, cylinder: 'M', note: 'All needles miss (knit course converted to miss to reduce density and weight)' }
        ];
        dynamicNote = 'High GSM knit-to-miss adaptation active. Courses modified to introduce miss loops, stabilizing fabric and preventing boardy thickness.';
      }
    }

    // --- 4. French Terry Pile Sinker Loop Height ---
    if (fabricId === 'french_terry' && gsm) {
      if (gsm < 240) {
        dynamicNote = 'Lightweight French Terry: loop height set to 1.6× ground stitch length to prevent grinning (pile showing on face).';
      } else {
        dynamicNote = 'Heavy French Terry: sinker loop height multiplier increased to 2.2× ground stitch length to construct high, dense piles on fabric back without grinning. Sinker push setting: 2.2 mm.';
      }
    }

    // Warp knit — return lapping-based pattern object instead of K/T/M grid
    if (fabric.category === 'warp_knit') {
      const s = structure;
      const warpData = {
        fabric_id: fabric.id,
        fabric_name: fabric.name,
        fabric_type: 'warp_knit',  // discriminator for renderer
        guide_bars: s.guide_bars,
        lapping_pattern: s.lapping_pattern || {},
        stitch_density: s.stitch_density,
        course_length_formula: s.course_length_formula,
        machine_speed: fabric.machine_speed,
        technical_notes: fabric.machine_note || '',
        appearance: fabric.appearance || '',
        structure_note: dynamicNote,
        pattern_cylinder: null,
        pattern_dial: null,
      };
      this.cache.set(cacheKey, warpData);
      return warpData;
    }

    const { pattern_cylinder, pattern_dial } = this._extractPatterns(structure);
    const { courses_per_repeat, wales_per_repeat } = this._resolveRepeat(structure, pattern_cylinder, pattern_dial);
    const generated = {
      fabric_id: fabric.id,
      fabric_name: fabric.name,
      courses_per_repeat,
      wales_per_repeat,
      beds: structure.beds,
      
      // The parsed structural matrix
      pattern_cylinder,
      pattern_dial,
      
      // Dynamically generated mechanical arrangement
      cam_arrangement: this._generateCamArrangement(structure, pattern_cylinder),
      needle_arrangement: this._generateNeedleArrangement(structure, wales_per_repeat),
      
      // Technical parameters
      technical_notes: fabric.machine_note || '',
      appearance: fabric.appearance || '',
      structure_note: dynamicNote,
    };

    this.cache.set(cacheKey, generated);
    return generated;
  }

  _generateCamArrangement(structure, pattern) {
    if (structure.cam) return structure.cam;
    if (!Array.isArray(pattern) || pattern.length === 0) return [];
    
    // If cam data isn't explicitly defined, reverse-engineer it from the pattern array
    const cams = [];
    
    const courseCount = typeof structure.courses_per_repeat === 'number'
      ? structure.courses_per_repeat
      : pattern.length;

    for (let c = 0; c < courseCount; c++) {
      const course = pattern[c];
      
      // Determine what's happening on this feeder
      let hasKnit = course.includes('K');
      let hasTuck = course.includes('T');
      let hasMiss = course.includes('M');
      
      let cylAction = '';
      if (hasKnit && !hasTuck && !hasMiss) cylAction = 'K';
      else if (!hasKnit && hasTuck && !hasMiss) cylAction = 'T';
      else if (!hasKnit && !hasTuck && hasMiss) cylAction = 'M';
      else if (hasKnit && hasTuck) cylAction = 'K/T alternate';
      else if (hasKnit && hasMiss) cylAction = 'K/M alternate';
      else cylAction = 'Complex';

      cams.push({
        feed: c + 1,
        cylinder: cylAction,
        note: `Generated sequence based on W${structure.wales_per_repeat} repeat.`
      });
    }
    
    return cams;
  }

  _generateNeedleArrangement(structure, walesPerRepeat) {
    if (structure.needle_arrangement) return structure.needle_arrangement;
    
    // Reverse-engineer butt pattern based on wale repeat
    let buttPattern = '';
    const letters = ['A', 'B', 'C', 'D'];
    const safeWales = this._coerceWales(structure, walesPerRepeat);
    
    if (safeWales === 1) {
      buttPattern = 'AAAA';
    } else if (safeWales === 2) {
      buttPattern = 'ABAB';
    } else if (typeof safeWales === 'number' && safeWales <= 4) {
      for(let i=0; i<safeWales; i++) {
        buttPattern += letters[i];
      }
    } else {
      buttPattern = 'Custom Jacquard/Multi-track';
    }

    return {
      butt_pattern: buttPattern,
      description: `Auto-generated for ${safeWales || 'variable'}-wale repeat using standard multi-track methodology.`
    };
  }

  _extractPatterns(structure) {
    let pattern_cylinder = null;
    let pattern_dial = null;

    if (Array.isArray(structure.pattern)) {
      pattern_cylinder = structure.pattern;
    } else if (structure.pattern && typeof structure.pattern === 'object') {
      pattern_cylinder = structure.pattern.C || structure.pattern.cylinder || null;
      pattern_dial = structure.pattern.D || structure.pattern.dial || null;
    }

    if (!pattern_cylinder && Array.isArray(structure.pattern_cylinder)) {
      pattern_cylinder = structure.pattern_cylinder;
    }
    if (!pattern_dial && Array.isArray(structure.pattern_dial)) {
      pattern_dial = structure.pattern_dial;
    }

    if (!pattern_cylinder && Array.isArray(structure.example_2color_pattern)) {
      pattern_cylinder = structure.example_2color_pattern;
    }

    return { pattern_cylinder, pattern_dial };
  }

  _resolveRepeat(structure, pattern_cylinder, pattern_dial) {
    let courses_per_repeat = structure.courses_per_repeat;
    let wales_per_repeat = structure.wales_per_repeat;
    const fallback = Array.isArray(pattern_cylinder) ? pattern_cylinder : Array.isArray(pattern_dial) ? pattern_dial : null;

    if (typeof courses_per_repeat !== 'number' && fallback) {
      courses_per_repeat = fallback.length;
    }

    if (typeof wales_per_repeat !== 'number' && fallback) {
      const firstRow = Array.isArray(fallback[0]) ? fallback[0] : [fallback[0]];
      wales_per_repeat = firstRow.length;
    }

    return { courses_per_repeat, wales_per_repeat };
  }

  _coerceWales(structure, overrideWales) {
    if (typeof overrideWales === 'number') return overrideWales;
    if (typeof structure.wales_per_repeat === 'number') return structure.wales_per_repeat;
    return null;
  }
}

const patternEngine = new PatternEngine();

module.exports = {
  getPattern: (fabricId, gsm, gauge, composition) => patternEngine.generatePattern(fabricId, gsm, gauge, composition)
};
