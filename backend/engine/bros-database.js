/**
 * KnitAdvisor — BROS Melange Database v1.0
 * ============================================
 *
 * This database contains industry-standard BROS melange yarn references.
 * BROS codes (e.g., M01, M02, M03) are widely used in knitwear to denote
 * specific ratios of raw white to dyed black/color fibers.
 * 
 * HEX values here are approximate visual representations for the UI.
 * Melange fabrics are inherently multi-colored, so these represent the
 * perceived average optical blend.
 */

'use strict';

const BROS_COLORS = [
  // Standard Grey Melange Series
  { c: 'M01', h: '#E2E2E2', n: 'Lightest Grey Melange (5% Black)' },
  { c: 'M02', h: '#D4D4D4', n: 'Light Grey Melange (10% Black)' },
  { c: 'M03', h: '#C6C6C6', n: 'Mid Light Grey Melange (15% Black)' },
  { c: 'M04', h: '#B0B0B0', n: 'Mid Grey Melange (20% Black)' },
  { c: 'M05', h: '#969696', n: 'Mid Dark Grey Melange (30% Black)' },
  { c: 'M06', h: '#7A7A7A', n: 'Dark Grey Melange (40% Black)' },
  { c: 'M07', h: '#5E5E5E', n: 'Charcoal Melange (60% Black)' },
  { c: 'M08', h: '#424242', n: 'Dark Charcoal Melange (80% Black)' },
  { c: 'M09', h: '#2E2E2E', n: 'Very Dark Charcoal Melange' },
  { c: 'M10', h: '#1C1C1C', n: 'Black Melange' },
  
  // Common Ecru/Oatmeal/Beige Series
  { c: 'M20', h: '#F3E5AB', n: 'Light Oatmeal Melange' },
  { c: 'M21', h: '#E4D5B7', n: 'Oatmeal Melange' },
  { c: 'M22', h: '#D2B48C', n: 'Beige Melange' },
  { c: 'M23', h: '#C19A6B', n: 'Camel Melange' },
  
  // Other standard melanges
  { c: 'M30', h: '#3C4A5A', n: 'Navy Melange' },
  { c: 'M40', h: '#556B2F', n: 'Olive Melange' },
  { c: 'M50', h: '#8B0000', n: 'Maroon Melange' }
];

const TOTAL_COLORS = BROS_COLORS.length;
const _byCode = {};

BROS_COLORS.forEach(entry => {
  _byCode[entry.c.toUpperCase()] = entry;
});

module.exports = {
  BROS_COLORS,
  TOTAL_COLORS,
  _byCode
};
