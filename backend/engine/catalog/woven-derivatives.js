/**
 * WOVEN CLOTH CATALOG
 * ===================
 * The selectable woven qualities, beside FABRIC_DERIVATIVES rather than inside
 * it. A woven cloth has no gauge, no stitch length and no course or wale, so a
 * woven row in the knit catalog would be a row where half the populated columns
 * mean something different from every other row. The two lists are merged only
 * at the API edge, where both are just "a fabric you can pick".
 *
 * HOW A ROW EARNS ITS NUMBERS
 * ---------------------------
 * `weave` is a SPECIFICATION, not a stored grid. The grid is generated from it
 * on demand by buildWeaveGrid(), so plain, rib, matt, twill, satin, sateen,
 * pointed twill and corkscrew all come out of the book's stated rules rather
 * than out of a figure someone transcribed by eye. The draft, the peg plan and
 * the denting then follow from the grid with no freedom at all.
 *
 * `weave.kind === 'figure'` marks the honest gap: the motif weaves — honeycomb,
 * huckaback, crepe, Bedford cord, mock leno, the pile and double cloths — are
 * hand-drawn in the book and no rule generates them. Those rows carry every
 * other thing the book gives (sett, counts, crimp, draft type, healds, end
 * uses, page) and report `grid_status: 'FIGURE_NOT_TRANSCRIBED'` instead of a
 * guessed grid. A wrong grid would be worse than a missing one: it would look
 * exactly as authoritative as a right one.
 *
 * `sett` is the book's own construction wherever the book prints one, with the
 * page on the row. Where it does not, the row says so and the sett is the
 * user's to supply.
 */
'use strict';

const woven = require('../formulas/woven');
const design = require('../formulas/woven-design');

// ─────────────────────────────────────────────────────────────
// GRID RESOLUTION
// ─────────────────────────────────────────────────────────────

/**
 * Turn a weave specification into a grid, or say plainly that it cannot.
 * Every branch returns its provenance, so a caller can tell a generated
 * structure from a missing one without inspecting the catalog.
 */
function buildWeaveGrid(spec) {
  switch (spec.kind) {
    case 'plain':
      return { ...woven.generateTwill(1, 1), notation: 'plain 1/1', page: 16, grid_status: 'GENERATED' };
    case 'twill':
      return { ...woven.generateTwill(spec.warp, spec.weft, { direction: spec.direction || 'Z' }),
               grid_status: 'GENERATED' };
    case 'satin': {
      const g = woven.generateSatin(spec.repeat, spec.move, { face: spec.face || 'warp' });
      return g.error ? { grid: null, grid_status: 'INVALID_MOVE_NUMBER', ...g } : { ...g, grid_status: 'GENERATED' };
    }
    case 'warp_rib':  return { ...design.generateWarpRib(spec.a, spec.b), grid_status: 'GENERATED' };
    case 'weft_rib':  return { ...design.generateWeftRib(spec.a, spec.b), grid_status: 'GENERATED' };
    case 'matt':      return { ...design.generateMatt(spec.a, spec.b), grid_status: 'GENERATED' };
    case 'pointed_twill':
      return { ...design.generatePointedTwill(spec.warp, spec.weft, { direction: spec.direction || 'Z' }),
               grid_status: 'GENERATED' };
    case 'corkscrew':
      return { ...design.generateCorkscrew(spec.warp, spec.weft, { move: spec.move || 2 }),
               grid_status: 'GENERATED' };
    case 'figure':
      return {
        grid: null,
        grid_status: 'FIGURE_NOT_TRANSCRIBED',
        page: spec.page,
        figure: spec.figure || null,
        note: `The book draws this weave as ${spec.figure ? 'Fig ' + spec.figure : 'a figure'} on p.${spec.page}. No rule generates it, and the PDF text layer scrambles the grid, so no structure is stored rather than a guessed one. Everything else on this row — sett, counts, draft, healds, end uses — is the book's.`,
      };
    default:
      return { grid: null, grid_status: 'UNKNOWN_SPEC' };
  }
}

// ─────────────────────────────────────────────────────────────
// THE CATALOG
// ─────────────────────────────────────────────────────────────

const WOVEN_DERIVATIVES = [

  // ── PLAIN AND ITS DERIVATIVES ─────────────────────────────
  {
    id: 'woven_plain_shirting',
    name: 'Plain Shirting (Poplin)',
    name_bn: 'প্লেইন শার্টিং',
    category: 'woven',
    family: 'plain',
    weave_slug: 'plain',
    weave: { kind: 'plain' },
    sett: { epi: 84, ppi: 80, warp_count: '2/80s', weft_count: '2/80s',
            material: 'polyester cotton', page: 130, table: 'Appendix II', source: 'BOOK_VERIFIED' },
    end_uses: ['shirting', 'cambric', 'muslin', 'dhothi', 'saree'],
    characteristics: ['maximum number of binding points', 'strongest simple combination of threads',
                      'thread density is limited', 'cloth thickness is limited'],
    book_page: 16,
  },
  {
    id: 'woven_sheeting',
    name: 'Plain Sheeting / Calico',
    name_bn: 'শিটিং / ক্যালিকো',
    category: 'woven',
    family: 'plain',
    weave_slug: 'plain',
    weave: { kind: 'plain' },
    sett: { epi: 60, ppi: 56, warp_count: '20s', weft_count: '20s', material: 'cotton',
            source: 'USER_SUPPLIED',
            note: 'The book does not print a sheeting construction. This sett is a working default — replace it with the quality actually being quoted.' },
    end_uses: ['bed sheeting', 'canvas', 'blanket'],
    book_page: 16,
  },
  {
    id: 'woven_warp_rib',
    name: 'Warp Rib 2/2 (cross ribs)',
    name_bn: 'ওয়ার্প রিব',
    category: 'woven',
    family: 'plain_derivative',
    weave_slug: 'warp_rib',
    weave: { kind: 'warp_rib', a: 2, b: 2 },
    sett: { epi: 126, ppi: 38, warp_count: '30s', weft_count: '15s', material: 'cotton',
            page: 19, source: 'BOOK_VERIFIED' },
    end_uses: ['poplin', 'rep', 'furnishing'],
    characteristics: ['plain weave extended in the warp direction', 'cords run across the cloth',
                      'a high ends-to-picks ratio buries the coarse weft'],
    book_page: 17,
  },
  {
    id: 'woven_weft_rib',
    name: 'Weft Rib 2/2 (longitudinal ribs)',
    name_bn: 'ওয়েফট রিব',
    category: 'woven',
    family: 'plain_derivative',
    weave_slug: 'weft_rib',
    weave: { kind: 'weft_rib', a: 2, b: 2 },
    sett: { epi: 56, ppi: 100, warp_count: '2/14s', weft_count: '18s', material: 'cotton',
            page: 19, source: 'BOOK_VERIFIED',
            note: 'The book prints the warp as "2/14s & 36s" — two warps in the same cloth. The 2/14s is taken here; the calculation is only as good as that choice.' },
    end_uses: ['ottoman', 'furnishing', 'ribbon'],
    characteristics: ['plain weave extended in the weft direction', 'cords run down the cloth'],
    book_page: 18,
  },
  {
    id: 'woven_matt',
    name: 'Matt / Hopsack 2/2',
    name_bn: 'ম্যাট / হপস্যাক',
    category: 'woven',
    family: 'plain_derivative',
    weave_slug: 'matt_rib',
    weave: { kind: 'matt', a: 2, b: 2 },
    sett: { epi: 44, ppi: 44, warp_count: '20s', weft_count: '20s', material: 'cotton',
            page: 130, table: 'Appendix II', source: 'BOOK_VERIFIED' },
    end_uses: ['oxford shirting', 'canvas', 'sail cloth', 'jacketing'],
    characteristics: ['plain weave extended in both directions at once',
                      'softer and more pliable than plain at the same sett',
                      'threads slip more readily, so the sett is limited'],
    book_page: 19,
  },
  {
    id: 'woven_oxford',
    name: 'Oxford (2/1 warp rib)',
    name_bn: 'অক্সফোর্ড',
    category: 'woven',
    family: 'plain_derivative',
    weave_slug: 'warp_rib',
    weave: { kind: 'warp_rib', a: 2, b: 1 },
    sett: { epi: 100, ppi: 56, warp_count: '2/60s', weft_count: '20s', material: 'cotton',
            source: 'USER_SUPPLIED',
            note: 'Oxford is a named shirting quality rather than one of the book’s constructions; the weave is the book’s irregular warp rib, the sett is a working default.' },
    end_uses: ['shirting'],
    book_page: 17,
  },

  // ── TWILLS ────────────────────────────────────────────────
  {
    id: 'woven_denim',
    name: 'Denim (3/1 Z twill)',
    name_bn: 'ডেনিম',
    category: 'woven',
    family: 'twill',
    weave_slug: 'twill',
    weave: { kind: 'twill', warp: 3, weft: 1, direction: 'Z' },
    sett: { epi: 56, ppi: 44, warp_count: '8s', weft_count: '6s', material: 'cotton',
            page: 130, table: 'Appendix II', source: 'BOOK_VERIFIED' },
    end_uses: ['jeans', 'jacketing', 'workwear'],
    characteristics: ['warp faced, so the indigo warp carries the colour',
                      'fewer intersections than plain, so it may be set more closely',
                      'a pronounced diagonal on the face and a pale back'],
    book_page: 22,
  },
  {
    id: 'woven_drill',
    name: 'Drill / Chino (2/1 Z twill)',
    name_bn: 'ড্রিল / চিনো',
    category: 'woven',
    family: 'twill',
    weave_slug: 'twill',
    weave: { kind: 'twill', warp: 2, weft: 1, direction: 'Z' },
    sett: { epi: 96, ppi: 56, warp_count: '20s', weft_count: '16s', material: 'cotton',
            source: 'USER_SUPPLIED',
            note: 'The book gives the 2/1 twill as its worked repeat example (p.8) but prints no drill construction; this sett is a working default.' },
    end_uses: ['chino trousers', 'uniform', 'workwear'],
    book_page: 8,
  },
  {
    id: 'woven_gabardine',
    name: 'Gabardine (2/2 steep twill)',
    name_bn: 'গ্যাবার্ডিন',
    category: 'woven',
    family: 'twill',
    weave_slug: 'twill',
    weave: { kind: 'twill', warp: 2, weft: 2, direction: 'Z' },
    sett: { epi: 108, ppi: 56, warp_count: '2/40s', weft_count: '20s', material: 'cotton',
            source: 'USER_SUPPLIED',
            note: 'Gabardine appears in the book’s glossary (p.135) rather than its construction tables. The steep twill comes from setting the ends far denser than the picks — the p.24 rule this row is calculated against.' },
    end_uses: ['trousering', 'suiting', 'raincoat'],
    characteristics: ['a steep twill: ends greatly exceed picks, so the diagonal rises above 45 degrees'],
    book_page: 24,
  },
  {
    id: 'woven_serge',
    name: 'Serge (2/2 twill, 45 degree)',
    name_bn: 'সার্জ',
    category: 'woven',
    family: 'twill',
    weave_slug: 'twill',
    weave: { kind: 'twill', warp: 2, weft: 2, direction: 'Z' },
    sett: { epi: 64, ppi: 64, warp_count: '2/30s', weft_count: '2/30s', material: 'worsted',
            source: 'USER_SUPPLIED',
            note: 'Equal ends and picks, which is the book’s own condition (p.24) for a 45 degree twill. Sett is a working default.' },
    end_uses: ['suiting', 'uniform', 'skirting'],
    book_page: 24,
  },
  {
    id: 'woven_pointed_twill',
    name: 'Pointed / Zigzag Twill 2/2',
    name_bn: 'পয়েন্টেড টুইল',
    category: 'woven',
    family: 'twill',
    weave_slug: 'twill',
    weave: { kind: 'pointed_twill', warp: 2, weft: 2 },
    sett: { epi: 72, ppi: 68, warp_count: '2/40s', weft_count: '2/40s', material: 'cotton',
            source: 'USER_SUPPLIED' },
    end_uses: ['dress fabric', 'furnishing', 'shirting'],
    characteristics: ['the base twill read through a pointed draft, so the diagonal reverses',
                      'needs only as many healds as the base twill repeat'],
    book_page: 11,
  },
  {
    id: 'woven_corkscrew',
    name: 'Warp Corkscrew (5-end)',
    name_bn: 'কর্কস্ক্রু',
    category: 'woven',
    family: 'rearranged_twill',
    weave_slug: 'corkscrew',
    weave: { kind: 'corkscrew', warp: 3, weft: 2, move: 2 },
    sett: { epi: 96, ppi: 40, warp_count: '2/40s', weft_count: '20s', material: 'worsted',
            source: 'USER_SUPPLIED',
            note: 'The book states the two constraints (odd repeat, floats differing by one, p.31) and draws the result; the construction here is derived from those constraints and asserted to produce one unbroken warp float per end.' },
    end_uses: ['worsted suiting', 'trousering'],
    characteristics: ['continuous warp floats form vertical cords', 'warp faced'],
    book_page: 31,
  },

  // ── SATIN AND SATEEN ──────────────────────────────────────
  {
    id: 'woven_satin_5',
    name: 'Satin 5-end (move 2)',
    name_bn: 'স্যাটিন ৫',
    category: 'woven',
    family: 'rearranged_twill',
    weave_slug: 'satin_sateen',
    weave: { kind: 'satin', repeat: 5, move: 2, face: 'warp' },
    sett: { epi: 88, ppi: 48, warp_count: '2/40s', weft_count: '2/20s', material: 'cotton',
            page: 130, table: 'Appendix II', source: 'BOOK_VERIFIED' },
    end_uses: ['dress fabric', 'lining', 'furnishing'],
    characteristics: ['one binding point per pick, so the surface is unbroken',
                      'warp faced; the reverse side is the sateen',
                      'long floats, so it may be set very closely but snags easily'],
    book_page: 27,
  },
  {
    id: 'woven_sateen_5',
    name: 'Sateen 5-end (weft faced)',
    name_bn: 'স্যাটিন (ওয়েফট)',
    category: 'woven',
    family: 'rearranged_twill',
    weave_slug: 'satin_sateen',
    weave: { kind: 'satin', repeat: 5, move: 2, face: 'weft' },
    sett: { epi: 64, ppi: 104, warp_count: '2/60s', weft_count: '30s', material: 'cotton',
            source: 'USER_SUPPLIED',
            note: 'The book prints only the satin construction; a sateen is set with the picks dominant instead, which is what this default does.' },
    end_uses: ['sateen lining', 'dress fabric'],
    characteristics: ['the reverse of the satin — the book states the two are the same weave seen from either side'],
    book_page: 27,
  },
  {
    id: 'woven_satin_8',
    name: 'Satin 8-end (move 3)',
    name_bn: 'স্যাটিন ৮',
    category: 'woven',
    family: 'rearranged_twill',
    weave_slug: 'satin_sateen',
    weave: { kind: 'satin', repeat: 8, move: 3, face: 'warp' },
    sett: { epi: 120, ppi: 60, warp_count: '2/60s', weft_count: '2/40s', material: 'cotton',
            source: 'USER_SUPPLIED',
            note: 'Move 3 is the only move an 8-end satin admits — the book’s p.30 table gives 8:3 and the p.28 rules re-derive it exactly.' },
    end_uses: ['satin drill', 'furnishing', 'lining'],
    book_page: 30,
  },

  // ── FIGURED AND FANCY: STRUCTURE NOT TRANSCRIBED ──────────
  {
    id: 'woven_honeycomb',
    name: 'Honeycomb (ordinary)',
    name_bn: 'হানিকম্ব',
    category: 'woven',
    family: 'honeycomb',
    weave_slug: 'honeycomb_ordinary',
    weave: { kind: 'figure', page: 37, figure: '9.1' },
    draft_hint: { slug: 'pointed', healds: 8, note: 'The book puts ordinary honeycomb on a pointed draft (p.11).' },
    sett: { epi: 88, ppi: 82, warp_count: '25s', weft_count: '16s', material: 'cotton',
            page: 40, source: 'BOOK_VERIFIED', variant: 'lighter cloth' },
    end_uses: ['towel', 'bed cover', 'quilt'],
    characteristics: ['ridges and hollows form cells that hold water',
                      'both long warp and long weft floats, on both faces',
                      'reversible — the same on either side'],
    book_page: 37,
  },
  {
    id: 'woven_huckaback',
    name: 'Huckaback',
    name_bn: 'হাকাব্যাক',
    category: 'woven',
    family: 'huckaback',
    weave_slug: 'huckaback',
    weave: { kind: 'figure', page: 42, figure: '10.1' },
    draft_hint: { slug: 'straight', healds: 8, note: 'The repeat divides into four equal parts, two plain and two floating.' },
    sett: { epi: 44, ppi: 30, warp_count: '10s', weft_count: '10s', material: 'cotton',
            page: 130, table: 'Appendix II', source: 'BOOK_VERIFIED' },
    end_uses: ['towel', 'glass cloth', 'huckaback linen'],
    characteristics: ['rough absorbent surface from short floats on a plain ground',
                      'the plain sections give it strength the floats would not'],
    book_page: 42,
  },
  {
    id: 'woven_crepe',
    name: 'Crepe',
    name_bn: 'ক্রেপ',
    category: 'woven',
    family: 'crepe',
    weave_slug: 'crepe',
    weave: { kind: 'figure', page: 46 },
    sett: { epi: 56, ppi: 56, warp_count: '18s', weft_count: '18s', material: 'cotton',
            page: 48, source: 'BOOK_VERIFIED',
            note: 'The book adds that the warp should carry a little more twist than the weft.' },
    end_uses: ['dress fabric', 'saree', 'blouse'],
    characteristics: ['a broken, seedy surface with no visible direction',
                      'floats scattered so no two are adjacent'],
    book_page: 46,
  },
  {
    id: 'woven_bedford_cord',
    name: 'Bedford Cord',
    name_bn: 'বেডফোর্ড কর্ড',
    category: 'woven',
    family: 'cord',
    weave_slug: 'bedford_cord',
    weave: { kind: 'figure', page: 50 },
    draft_hint: { slug: 'divided', note: 'Two series of warp threads, so the shafts divide into two groups (p.12).' },
    sett: { epi: 92, ppi: 82, warp_count: '2/20s', weft_count: '18s', material: 'worsted',
            page: 51, source: 'BOOK_VERIFIED', variant: 'worsted dress fabric' },
    end_uses: ['trousering', 'riding breeches', 'dress fabric', 'upholstery'],
    characteristics: ['rounded cords running down the cloth, raised by wadding ends'],
    book_page: 50,
  },
  {
    id: 'woven_mock_leno',
    name: 'Mock Leno',
    name_bn: 'মক লেনো',
    category: 'woven',
    family: 'leno',
    weave_slug: 'mock_leno',
    weave: { kind: 'figure', page: 60 },
    sett: { epi: 48, ppi: 44, warp_count: '2/40s', weft_count: '2/40s', material: 'cotton',
            source: 'USER_SUPPLIED' },
    end_uses: ['dress fabric', 'blouse', 'curtain'],
    characteristics: ['an open, gauze-like appearance made on an ordinary loom',
                      'threads group together and leave gaps, without the crossing a true leno needs'],
    book_page: 60,
  },
  {
    id: 'woven_velveteen',
    name: 'Velveteen (plain back)',
    name_bn: 'ভেলভেটিন',
    category: 'woven',
    family: 'pile',
    weave_slug: 'velveteen',
    weave: { kind: 'figure', page: 73 },
    pile: { type: 'weft', picks_include_pile: true, tufts_per_sq_inch: 1060, weft_contraction_pct: 12.5 },
    sett: { epi: 72, ppi: 82, warp_count: '2/30s', weft_count: '50s', material: 'cotton',
            page: 75, source: 'BOOK_VERIFIED', picks_note: 'ground weft only' },
    end_uses: ['dress fabric', 'jacketing', 'upholstery'],
    characteristics: ['cut weft floats stand up as a dense short pile'],
    book_page: 73,
  },
  {
    id: 'woven_corduroy',
    name: 'Corduroy',
    name_bn: 'কর্ডরয়',
    category: 'woven',
    family: 'pile',
    weave_slug: 'velveteen',
    weave: { kind: 'figure', page: 79 },
    pile: { type: 'weft', picks_include_pile: true, tufts_per_sq_inch: 568, weft_crimp_pct: 20 },
    sett: { epi: 30, ppi: 426, warp_count: '2/10s', weft_count: '18s', material: 'cotton',
            page: 79, source: 'BOOK_VERIFIED', picks_note: 'includes ground and pile picks' },
    end_uses: ['trousering', 'jacketing', 'upholstery'],
    characteristics: ['the pile is cut into cords running down the cloth'],
    book_page: 79,
  },
  {
    id: 'woven_terry',
    name: 'Terry Towelling (3 pick)',
    name_bn: 'টেরি টাওয়েল',
    category: 'woven',
    family: 'pile',
    weave_slug: 'terry',
    weave: { kind: 'figure', page: 81 },
    pile: { type: 'warp', two_warps: true, width_shrinkage_pct: 12,
            pile_warp_m_per_100cm: 500, ground_warp_m_per_100cm: 120 },
    draft_hint: { slug: 'divided', note: 'Ground and pile warps are separate series, so the shafts divide (p.12).' },
    sett: { epi: 50, ppi: 56, warp_count: '2/10s', weft_count: '16s', material: 'cotton',
            page: 84, source: 'BOOK_VERIFIED',
            note: 'The pile warp is a second series of two ends of 2/10s and runs about 500 m per 100 cm of cloth against the ground warp’s 120 — the pile, not the ground, is where the yarn goes.' },
    end_uses: ['towel', 'bath robe', 'beach wear'],
    characteristics: ['uncut warp loops on both faces', 'loop height set by the fell distance of 10-15 mm'],
    book_page: 81,
  },
  {
    id: 'woven_double_cloth',
    name: 'Double Cloth',
    name_bn: 'ডাবল ক্লথ',
    category: 'woven',
    family: 'double',
    weave_slug: 'double_cloth',
    weave: { kind: 'figure', page: 108 },
    draft_hint: { slug: 'divided', note: 'Two complete cloths, so two groups of shafts (p.12).' },
    sett: { epi: 96, ppi: 88, warp_count: '2/40s', weft_count: '2/40s', material: 'wool',
            source: 'USER_SUPPLIED',
            note: 'Both figures are for the combined cloth; a double cloth carries two full sets of warp and weft.' },
    end_uses: ['overcoating', 'blanket', 'upholstery'],
    characteristics: ['two separate cloths woven one above the other and stitched together',
                      'a different colour or weave on each face'],
    book_page: 108,
  },
];

const byId = new Map(WOVEN_DERIVATIVES.map(f => [f.id, f]));

module.exports = {
  WOVEN_DERIVATIVES,
  buildWeaveGrid,
  getWovenFabric: id => byId.get(id) || null,
  isWovenId: id => byId.has(id),
};
