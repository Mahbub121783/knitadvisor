/**
 * KnitAdvisor — SCOTDIC Database v1.0
 * ============================================
 *
 * This database acts as a foundational framework for the SCOTDIC
 * (Standard Color of Textile Dictionarie Internationale de la Couleur) system.
 *
 * NOTE: Since SCOTDIC is a proprietary physical standard, an exhaustive
 * public mapping to HEX/RGB does not exist freely. This file provides
 * the architecture and a sample dataset. You can expand this array
 * with your own factory's SCOTDIC to HEX mappings.
 */

'use strict';

// Example SCOTDIC data structure
// c: Code (Hue, Lightness, Chroma)
// h: HEX value (approximate/measured)
// n: Name (if any, though SCOTDIC usually just uses codes)
const SCOTDIC_COLORS = [
  { c: '01 A 01', h: '#F5F5DC', n: 'Off White' },
  { c: '02 B 02', h: '#E6E6FA', n: 'Light Lilac' },
  { c: '05 C 04', h: '#87CEEB', n: 'Sky Blue' },
  { c: '10 D 05', h: '#000080', n: 'Navy Blue' },
  { c: '15 E 06', h: '#800000', n: 'Maroon' },
  { c: '20 F 08', h: '#006400', n: 'Dark Green' },
  { c: '25 G 03', h: '#A9A9A9', n: 'Dark Gray' },
  { c: '30 H 01', h: '#000000', n: 'Black' },
  // ADD MORE SCOTDIC COLORS HERE AS NEEDED
];

const TOTAL_COLORS = SCOTDIC_COLORS.length;

// Indexes for fast lookup
const _byCode = {};

SCOTDIC_COLORS.forEach(entry => {
  _byCode[entry.c.toUpperCase().replace(/\s+/g, ' ')] = entry;
});

module.exports = {
  SCOTDIC_COLORS,
  TOTAL_COLORS,
  _byCode
};
