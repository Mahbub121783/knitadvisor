# KnitAdvisor Color Engine Documentation

## Overview
The KnitAdvisor Color Engine (`color-engine.js` & `tcx-database.js`) is an advanced, offline, zero-dependency module for processing, matching, and generating textile color data. It is specifically designed to support the textile and knitting industry by translating industry-standard color codes (Pantone TCX, SCOTDIC, Archroma, BROS) into web-visualization-ready formats.

## Databases Included
1. **Pantone TCX (`tcx-database.js`)**: ~2,626 exact Pantone TCX/TPG colors with their HEX, name, code, page group, and family data.
2. **SCOTDIC (`scotdic-database.js`)**: Standard colors for cotton and polyester.
3. **BROS (`bros-database.js`)**: Melange yarn standard colors.
4. **Archroma (`archroma-database.js`)**: Archroma color standards.

## Core Capabilities

### 1. Color Lookup & Parsing
- `lookupTCX(code)`: Resolves any TCX/TPG code (e.g., `19-3910 TCX`, `193910`) to its full HEX, RGB, LAB, shade, and family data.
- `lookupSCOTDIC(code)`, `lookupBROS(code)`, `lookupArchroma(code)`: Similar lookups for other standards.
- `lookupMelangePercentage(pct)`: Dynamically generates a color mix based on a generic percentage of Melange Black vs Snow White (e.g., 5% Grey Melange).

### 2. Search & Matching
- `searchByName(query)`: Fuzzy search across the TCX database.
- `searchByFamily(family)`: Get a list of TCX colors belonging to a specific family (e.g., 'red', 'navy', 'gray').
- `nearestTCX(hex_or_rgb)`: Uses **Delta-E 2000 (CIE2000)** algorithms to find the closest matching Pantone TCX code to any arbitrary HEX or RGB color.

### 3. Classification & Shade Analysis
- **Shade Tiers**: Every color is classified into one of 6 tiers (`black`, `dark_navy`, `light_medium`, `white_melange`, `fluorescent`, `melange`).
- **Temperature**: Determines if a color is `warm`, `cool`, or `neutral` based on the Hue angle in the HSL color space.
- **Color Family**: Detects base families (Red, Orange, Yellow, Green, Blue, Pink, Teal, Purple, Black, White, Gray).

### 4. Color Science Conversions
The engine provides high-precision conversions between color spaces without external libraries:
- `hexToRgb()`, `rgbToHex()`
- `rgbToHsl()`, `hslToRgb()`
- `rgbToLab()`, `labToRgb()` (D65 Illuminant standard used for textile colorimetry)

### 5. Utilities for UI/UX
- `_contrastTextColor()`: Calculates WCAG-compliant contrast text color (returns `#FFFFFF` or `#000000`) for overlaying text on color swatches.
- `mixColors(hex1, hex2, ratio)`: Physically blends two colors based on a specific ratio.

## Usage Guide for AI Agents
When generating technical spec sheets or visualizations for knitwear:
- If the user specifies a color like "Navy Blue" or "19-3920 TCX", use `lookupTCX()` to fetch the correct hex for the frontend.
- If the user provides a random HEX code, use `nearestTCX()` to suggest the closest Pantone TCX alternative.
- Always use the provided `swatch_css` or `hex` values when rendering UI swatches.
