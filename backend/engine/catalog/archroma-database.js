/**
 * KnitAdvisor — Archroma Color Atlas Framework v1.0
 * ====================================================
 *
 * This framework supports the "Color Atlas by Archroma" system.
 * Archroma codes typically use a 3-digit by 3-digit coordinate
 * format representing the position in their physical books.
 * Example: "104-150", "434-140".
 *
 * NOTE: Archroma's 5,760 colors are proprietary. This database
 * contains standard structures and demonstration colors. Factory
 * .ase or .csv exports can be injected directly into this array.
 */

'use strict';

const ARCHROMA_COLORS = [
  // Example Archroma mappings (Placeholder HEX for demo)
  { c: '104-150', h: '#E4D5B7', n: 'Archroma Beige' },
  { c: '434-140', h: '#3C4A5A', n: 'Archroma Navy' },
  { c: '324-361', h: '#8B0000', n: 'Archroma Maroon' },
  { c: '100-100', h: '#F5F5F5', n: 'Archroma White' },
  { c: '900-900', h: '#111111', n: 'Archroma Black' },
];

const TOTAL_COLORS = ARCHROMA_COLORS.length;
const _byCode = {};

ARCHROMA_COLORS.forEach(entry => {
  // Normalize formatting
  const code = entry.c.replace(/\s+/g, '-').toUpperCase();
  _byCode[code] = entry;
});

module.exports = {
  ARCHROMA_COLORS,
  TOTAL_COLORS,
  _byCode
};
