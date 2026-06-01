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

  generatePattern(fabricId) {
    if (this.cache.has(fabricId)) {
      return this.cache.get(fabricId);
    }

    const fabric = FABRIC_DERIVATIVES.find(f => f.id === fabricId);
    if (!fabric || !fabric.structure) {
      return null;
    }

    // Warp knit — return lapping-based pattern object instead of K/T/M grid
    if (fabric.category === 'warp_knit') {
      const s = fabric.structure;
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
        structure_note: s.note || '',
        pattern_cylinder: null,
        pattern_dial: null,
      };
      this.cache.set(fabricId, warpData);
      return warpData;
    }

    const structure = fabric.structure;
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
      structure_note: structure.note || '',
    };

    this.cache.set(fabricId, generated);
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
  getPattern: (fabricId) => patternEngine.generatePattern(fabricId)
};
