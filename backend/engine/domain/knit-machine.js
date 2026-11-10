/**
 * KnitAdvisor — machine, needle-selection and cam engine (Fabric Studio)
 * ======================================================================
 *
 * A weft-knitted design is knitted by a machine, and the machine decides
 * what can be drawn. This engine is the link between the two:
 *
 *   MACHINE PROFILE   what a class of circular machine is built with: one or
 *                     two needle beds and their gating, how needles are
 *                     selected (cam tracks or needle by needle), how many
 *                     tracks, which cams each bed can take (knit / tuck /
 *                     miss), the needle (latch; with a transfer spring on a
 *                     pointelle machine; on selector jacks on a jacquard), the
 *                     sinker (jersey, fleece with a second level for the loop
 *                     yarn, terry with a high nib, none on a double bed), the
 *                     dial timing, and the usual build (feeders per inch,
 *                     gauge and diameter range).
 *   REQUIREMENTS      what the drawn notation asks of a machine: beds and
 *                     gating, needle sequences (tracks) per bed, the cams
 *                     each bed needs, transfers, empty needles, a loop yarn
 *                     that is tied in (fleece) or plated over the sinker (pile).
 *   FIT               every requirement checked against a profile: an error
 *                     where the machine cannot knit it, a warning where it can
 *                     but it is not what that machine is for.
 *   AUTO              the simplest profile that knits the design.
 *   BUTTS AND CAMS    the needle set-out (butt track per needle) and the cam
 *                     plan: which cam sits in each track at each feeder, and
 *                     how many knit, tuck and miss cams the whole machine
 *                     takes. On a selection (jacquard) machine there is no
 *                     cam per track: each needle is selected at each feeder.
 *   COMPILE           the reverse: a butt set-out and a cam chart give the
 *                     needle notation they knit — so a cam arrangement can be
 *                     designed on the machine side and checked.
 *
 * Profiles are machine CLASSES as the textbooks describe them (Spencer,
 * Knitting Technology; Ray, Fundamentals and Advances in Knitting Technology),
 * not makes. Their build figures (feeders per inch, gauge and diameter ranges)
 * are typical values — MODELLED, labelled so — and the user's own track
 * counts override the profile's.
 */
'use strict';

const LATCH = 'latch needle';
const PROFILES = {
  sj_2track: {
    label: 'Single jersey, 2-track', kind: 'single', gatings: ['single'], selection: 'tracks', tracks: { C: 2 }, cams: { C: ['K', 'T', 'M'] },
    needle: { C: LATCH }, sinker: 'jersey', transfer: false, fpi: 3.2, sf: 960, gauges: [14, 40], dia: [14, 44],
    use: 'plain jersey and simple two-sequence tuck / miss structures (cross tuck, cross miss)',
  },
  sj_4track: {
    label: 'Single jersey, 4-track', kind: 'single', gatings: ['single'], selection: 'tracks', tracks: { C: 4 }, cams: { C: ['K', 'T', 'M'] },
    needle: { C: LATCH }, sinker: 'jersey', transfer: false, fpi: 3.0, sf: 900, gauges: [14, 36], dia: [14, 44],
    use: 'piqué, lacoste, honeycomb, twill and other repeats of up to four needle sequences',
  },
  fleece_3t: {
    label: 'Fleece, 3-thread (4-track)', kind: 'single', gatings: ['single'], selection: 'tracks', tracks: { C: 4 }, cams: { C: ['K', 'T', 'M'] },
    needle: { C: LATCH }, sinker: 'fleece', transfer: false, loopYarn: true, fpi: 3.0, sf: 800, gauges: [12, 28], dia: [20, 42],
    use: 'two- and three-thread fleece and French terry: the loop yarn is tucked in and floats behind',
  },
  terry: {
    label: 'Plush / terry, sinker loop (2-track)', kind: 'single', gatings: ['single'], selection: 'tracks', tracks: { C: 2 }, cams: { C: ['K', 'T', 'M'] },
    needle: { C: LATCH }, sinker: 'terry', transfer: false, pile: true, fpi: 2.0, sf: 650, gauges: [12, 28], dia: [20, 38],
    use: 'towel terry and velour: the pile yarn is plated over the high sinker nib',
  },
  sj_jacquard: {
    label: 'Single jersey, electronic jacquard', kind: 'single', gatings: ['single'], selection: 'needle', tracks: { C: Infinity }, cams: { C: ['K', 'T', 'M'] },
    needle: { C: 'latch needle on a selector jack' }, sinker: 'jersey', transfer: false, technique: '3way', fpi: 2.0, sf: 700, gauges: [16, 32], dia: [26, 38],
    use: 'any knit / tuck / miss repeat, needle by needle at every feeder (3-way selection)',
  },
  sj_jacquard_2way: {
    label: 'Single jersey, electronic jacquard, 2-way selection', kind: 'single', gatings: ['single'], selection: 'needle', tracks: { C: Infinity }, cams: { C: ['K', 'T', 'M'] },
    needle: { C: 'latch needle on a selector jack' }, sinker: 'jersey', transfer: false, technique: '2way', fpi: 2.4, sf: 750, gauges: [16, 32], dia: [26, 38],
    use: 'knit / miss or tuck / miss patterns needle by needle: each feeder\'s cam is knit OR tuck, the selection raises a needle to it or leaves it down',
  },
  pointelle: {
    label: 'Single jersey, transfer (pointelle)', kind: 'single', gatings: ['single'], selection: 'needle', tracks: { C: Infinity }, cams: { C: ['K', 'T', 'M', 'E'] },
    needle: { C: 'latch needle with a transfer spring' }, sinker: 'jersey', transfer: true, transferDirs: ['right', 'left'], technique: '3way', fpi: 1.2, sf: 450, gauges: [18, 28], dia: [26, 34],
    use: 'pointelle eyelets: loops transferred to the next needle, needle by needle',
  },
  rib_dj: {
    label: 'Double jersey, rib gating (cylinder 4 + dial 2 tracks)', kind: 'double', gatings: ['rib'], selection: 'tracks', tracks: { C: 4, D: 2 }, cams: { C: ['K', 'T', 'M'], D: ['K', 'T', 'M'] },
    needle: { C: LATCH, D: LATCH }, sinker: 'none', transfer: false, timing: ['delayed', 'synchronised'], fpi: 2.0, sf: 780, gauges: [10, 40], dia: [14, 40],
    use: 'rib, cardigan, milano and double piqué on rib gating',
  },
  interlock_2x2: {
    label: 'Interlock, classic (cylinder 2 + dial 2 tracks)', kind: 'double', gatings: ['interlock'], selection: 'tracks', tracks: { C: 2, D: 2 }, cams: { C: ['K', 'M'], D: ['K', 'M'] },
    needle: { C: 'latch needle, long and short butts', D: 'latch needle, long and short butts' }, sinker: 'none', transfer: false, timing: ['synchronised'], butts: { A: 'long butt', B: 'short butt' }, fpi: 2.0, sf: 800, gauges: [14, 40], dia: [14, 40],
    use: 'interlock and its knit / miss derivatives (eight-lock, ponte with knit / miss only)',
  },
  dj_multi: {
    label: 'Double jersey, convertible rib / interlock (cylinder 4 + dial 2 tracks)', kind: 'double', gatings: ['rib', 'interlock'], selection: 'tracks', tracks: { C: 4, D: 2 }, cams: { C: ['K', 'T', 'M'], D: ['K', 'T', 'M'] },
    needle: { C: LATCH, D: LATCH }, sinker: 'none', transfer: false, timing: ['delayed', 'synchronised'], fpi: 2.0, sf: 750, gauges: [14, 32], dia: [20, 38],
    use: 'ponte di Roma, double piqué, Swiss piqué, milano on either gating',
  },
  dj_jacquard: {
    label: 'Double jersey, electronic jacquard (cylinder selection, dial 2 tracks)', kind: 'double', gatings: ['rib', 'interlock'], selection: 'needle', tracks: { C: Infinity, D: 2 }, cams: { C: ['K', 'T', 'M'], D: ['K', 'T', 'M'] },
    needle: { C: 'latch needle on a selector jack', D: LATCH }, sinker: 'none', transfer: false, timing: ['delayed', 'synchronised'], technique: '3way', fpi: 1.6, sf: 600, gauges: [14, 28], dia: [30, 38],
    use: 'double jacquard, blister, any cylinder repeat with a 2-track dial',
  },
};
// simplest first: auto picks the first that knits the design without an error
const ORDER = ['sj_2track', 'sj_4track', 'fleece_3t', 'terry', 'sj_jacquard_2way', 'sj_jacquard', 'pointelle', 'rib_dj', 'interlock_2x2', 'dj_multi', 'dj_jacquard'];

const SINKER = {
  jersey: 'Single-level jersey sinker: its throat holds the old loop down while the needle rises, its belly is the knock-over level the new loop is drawn over.',
  fleece: 'Fleece sinker with a second, higher edge: the loop yarn is laid on it, above the ground yarn\'s knock-over level, so it floats behind the fabric and is caught only by the tucking needles.',
  terry: 'Terry sinker with a high nib: the pile yarn is drawn over the nib, the ground yarn over the belly — the nib height sets the pile loop.',
  none: 'No sinkers: the two beds hold the fabric for each other, and each needle knocks over across the edge (verge) of its own trick.',
};
const SYM_NAME = { K: 'knit', T: 'tuck', M: 'miss', E: 'transfer' };

function trackSeqs(g) {
  if (!g) return null;
  const seqs = [], setout = [];
  for (let j = 0; j < g[0].length; j++) {
    const seq = g.map((row) => row[j]).join('');
    if (/^-+$/.test(seq)) { setout.push('-'); continue; }
    let t = seqs.indexOf(seq);
    if (t < 0) { seqs.push(seq); t = seqs.length - 1; }
    setout.push(String.fromCharCode(65 + t));
  }
  return { setout, sequences: seqs.map((q, i) => ({ track: String.fromCharCode(65 + i), sequence: q })) };
}

/** What the drawn notation asks of a machine. */
function requirements(st, gating, feedRows, opts = {}) {
  const used = (g) => (g ? [...new Set(g.flat().filter((x) => x !== '-'))] : []);
  const C = st.beds.C, D = st.beds.D || null;
  // a transfer is selection, not a cam track: count tracks without it
  const tC = trackSeqs(C.map((r) => r.map((x) => (x === 'E' ? 'M' : x))));
  const tD = trackSeqs(D);
  const roles = feedRows.map((f) => f.role);
  return {
    kind: D ? 'double' : 'single', gating: D ? gating : 'single',
    tracks: { C: tC.sequences.length, D: tD ? tD.sequences.length : 0 },
    cams: { C: used(C), D: used(D) },
    transfer: C.some((r) => r.includes('E')),
    empty: [C, D].filter(Boolean).some((g) => g[0].some((_, j) => g.every((r) => r[j] === '-'))),
    fleece: !D && roles.some((r, i) => r === 'loop' && !C[i].includes('K')),
    pile: !!opts.pile,
    transferDir: opts.transferDir || 'right',
    // the symbols each feed uses on the cylinder (for a 2-way selection)
    feedSyms: C.map((r) => [...new Set(r)]),
    feeds: st.feeds, width: st.width,
  };
}

/** Every requirement against one profile: [{level, text}] (empty = knits as drawn). */
function fit(P, req) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  if (req.kind === 'double' && P.kind === 'single') { add('error', `${P.label} has no dial: a design on two beds cannot be knitted on it.`); return out; }
  if (req.kind === 'single' && P.kind === 'double') add('warn', `${P.label}: with the dial needles out of action it knits single jersey, but a single jersey machine is the usual (and faster) choice.`);
  if (req.kind === 'double' && !P.gatings.includes(req.gating)) add('error', `${P.label} is built for ${P.gatings.join(' / ')} gating; the design is drawn on ${req.gating} gating.`);
  for (const b of ['C', 'D']) {
    if (!req.cams[b].length || !P.cams[b]) continue;
    const bed = b === 'C' ? 'cylinder' : 'dial';
    const cap = P.tracks[b];
    if (req.tracks[b] > cap) add('error', `${P.label}: the ${bed} needs ${req.tracks[b]} different needle sequences (tracks) and the machine has ${cap} cam tracks. Simplify the repeat to ${cap}, or use needle-by-needle (jacquard) selection.`);
    for (const s of req.cams[b]) {
      if (s === 'E') { if (!P.transfer) add('error', `${P.label}: a transfer (E) needs transfer needles (with a spring) and loop-transfer selection — a pointelle machine.`); continue; }
      if (!P.cams[b].includes(s)) add('error', `${P.label}: the ${bed} takes ${P.cams[b].map((x) => SYM_NAME[x]).join(' and ')} cams only — no ${SYM_NAME[s]} cam for the ${SYM_NAME[s]} stitches drawn on it.`);
    }
  }
  if (P.technique === '2way' && P.selection === 'needle') {
    const mixed = (req.feedSyms || []).map((r, i) => (r.includes('K') && r.includes('T') ? i + 1 : 0)).filter(Boolean);
    if (mixed.length) add('error', `${P.label}: a 2-way selection raises a selected needle to the ONE cam height of that feeder (knit or tuck) and leaves the rest down (miss) — feed${mixed.length > 1 ? 's' : ''} ${mixed.join(', ')} mix knit and tuck. Use a 3-way (knit / tuck / miss) machine, or split the feed.`);
  }
  if (req.transfer && P.transfer && req.transferDir && P.transferDirs && !P.transferDirs.includes(req.transferDir)) add('error', `${P.label}: transfers go ${P.transferDirs.join(' or ')} only.`);
  if (req.pile && P.sinker !== 'terry') add('error', `${P.label}: a sinker-loop pile needs terry sinkers with a high nib to draw the pile yarn over.`);
  if (!req.pile && P.sinker === 'terry') add('warn', `${P.label}: no pile is drawn — the terry sinkers knit a plain ground; a jersey machine is the usual choice.`);
  if (req.fleece && P.sinker !== 'fleece') add('warn', `${P.label}: a tied-in loop yarn (fleece back) is knitted with fleece sinkers, which lay it on a second, higher level. On jersey sinkers the coarse loop yarn is drawn down with the ground and grins through.`);
  if (req.empty && P.selection === 'tracks') add('note', 'Empty needle positions (–): those needles are taken out of the cylinder or dial (or left in a track with no cams).');
  return out;
}

function autoProfile(req) {
  for (const id of ORDER) if (!fit(PROFILES[id], req).some((c) => c.level !== 'note' && c.level !== 'ok')) return id;
  for (const id of ORDER) if (!fit(PROFILES[id], req).some((c) => c.level === 'error')) return id;
  return req.kind === 'double' ? 'dj_jacquard' : 'pointelle';
}

/** The profile in use: the user's choice, or auto; the user's track counts override it. */
function resolve(machine, req) {
  const m = machine || {};
  const asked = PROFILES[m.profile] ? m.profile : null;
  const id = asked || autoProfile(req);
  const base = PROFILES[id];
  const P = { ...base, id, tracks: { ...base.tracks }, auto: !asked };
  if (base.selection === 'tracks') {
    if (+m.tracks_cyl > 0) P.tracks.C = +m.tracks_cyl;
    if (+m.tracks_dial > 0 && P.tracks.D) P.tracks.D = +m.tracks_dial;
  } else if (+m.tracks_dial > 0 && P.tracks.D) P.tracks.D = +m.tracks_dial;
  return P;
}

/**
 * Needle set-out and cam plan for a resolved profile.
 * @param needlesTotal  needles on the cylinder (dial the same) — from the solve
 * @param feeders       feeders round the machine
 */
function plan(P, st, gating, needlesTotal, feeders) {
  const W = st.width, F = st.feeds;
  const repeats = needlesTotal ? needlesTotal / W : null, rounds = feeders ? feeders / F : null;
  const beds = {};
  for (const b of ['C', 'D']) {
    const g = st.beds[b];
    if (!g) continue;
    const sel = P.selection === 'needle' && b === 'C' ? 'needle' : 'tracks';
    const T = trackSeqs(b === 'C' && !P.transfer ? g.map((r) => r.map((x) => (x === 'E' ? 'M' : x))) : g);
    const perTrack = T.sequences.map((s) => {
      const n = T.setout.filter((x) => x === s.track).length;
      return { track: s.track, butt: (P.butts && P.butts[s.track]) || null, sequence: s.sequence, needles_per_repeat: n, needles_on_machine: repeats ? Math.round(n * repeats) : null };
    });
    const empty = T.setout.filter((x) => x === '-').length;
    // cams for one feeder repeat: what sits in each track at each feeder
    const totals = { K: 0, T: 0, M: 0, E: 0 };
    const perFeeder = Array.from({ length: F }, (_, i) => {
      const row = {};
      T.sequences.forEach((s) => { const x = s.sequence[i]; row[s.track] = x; totals[x] = (totals[x] || 0) + 1; });
      return row;
    });
    const scale = rounds || 1;
    beds[b] = {
      selection: sel,
      setout: T.setout.join(' '), tracks_used: T.sequences.length, tracks_available: Number.isFinite(P.tracks[b]) ? P.tracks[b] : null,
      per_track: perTrack, empty_per_repeat: empty, empty_on_machine: repeats ? Math.round(empty * repeats) : null,
      cams_per_feeder: perFeeder,
      cam_totals_machine: sel === 'tracks' ? { knit: totals.K * scale, tuck: totals.T * scale, miss: totals.M * scale } : null,
      selection_note: sel === 'needle'
        ? `Needle-by-needle selection: at each of the ${feeders || F} feeders an actuator sets every needle to ${P.transfer ? 'knit, tuck, miss or transfer' : 'knit, tuck or miss'} — the ${F}-feed × ${W}-needle repeat is a selection file, not a cam set-up.`
        : `${T.sequences.length} of ${P.tracks[b]} cam tracks used. Each feeder carries one cam per track: ${Object.entries({ knit: totals.K, tuck: totals.T, miss: totals.M }).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ')} cam position${totals.K + totals.T + totals.M > 1 ? 's' : ''} per ${F}-feeder repeat${rounds ? ` — ${Math.round((totals.K + totals.T + totals.M) * scale)} round the machine` : ''}.`,
    };
  }
  // interlock gating: each cylinder needle faces a dial needle; in a classic
  // interlock a long-butt cylinder needle faces a short-butt dial needle, so
  // the two knit on alternate feeds and never rise together
  if (beds.C && beds.D && gating === 'interlock') {
    const c = beds.C.setout.split(' '), d = beds.D.setout.split(' ');
    const pairs = {};
    c.forEach((t, j) => { if (t !== '-' && d[j] && d[j] !== '-') pairs[t] = pairs[t] || new Set(), pairs[t].add(d[j]); });
    beds.facing = Object.entries(pairs).map(([t, set]) => ({ cylinder: t, dial: [...set] }));
    // the dial needle facing a long-butt cylinder needle has the short butt, and the other way round
    const OPP = { 'long butt': 'short butt', 'short butt': 'long butt' };
    if (P.butts) beds.D.per_track.forEach((t) => { const f = beds.facing.find((x) => x.dial.includes(t.track)); t.butt = f && P.butts[f.cylinder] ? OPP[P.butts[f.cylinder]] : null; });
    const dButt = (k) => { const t = beds.D.per_track.find((x) => x.track === k); return t && t.butt ? ` (${t.butt})` : ''; };
    beds.facing_note = 'Interlock gating: each cylinder needle faces a dial needle. ' + beds.facing.map((f) => `Cylinder track ${f.cylinder}${P.butts && P.butts[f.cylinder] ? ` (${P.butts[f.cylinder]})` : ''} faces dial track ${f.dial.map((k) => k + dButt(k)).join(' / ')}`).join('; ') + '. Facing needles must never rise at the same feed, so each pair knits on alternate feeds.';
  }
  return beds;
}

/**
 * Feed system for every feeder: how the yarn is delivered.
 *   positive tape feed   the yarn is metered at a set length per revolution
 *                        (the quality pulley / VDQ) — every knitting feeder
 *                        whose take is the same every revolution; feeders
 *                        with the same course length share one belt
 *   storage feeder       the needles take what they need from a wound store —
 *                        a needle-selection (jacquard) feeder, whose take
 *                        changes from course to course with the pattern
 *   elastane feeder      a positive roller feeder for the bare elastane; the
 *                        draft is the knitting speed over its delivery speed
 *   plating feeder       one guide with two yarn holes, face yarn and the
 *                        plated yarn laid at two heights
 */
function feedPlan(P, st, feeds, opts = {}) {
  const sel = P.selection === 'needle';
  return feeds.map((f, i) => {
    const sys = sel ? 'storage feeder' : 'positive tape feed';
    const why = sel
      ? 'the needles selected at this feeder change with the pattern, so the yarn taken changes from course to course: a storage feeder lets the needles draw what they need'
      : 'the yarn taken is the same every revolution, so it is metered at the course length by the quality pulley';
    const extra = [];
    if (opts.elastaneFeeds && opts.elastaneFeeds.includes(i)) extra.push('elastane positive roller feeder (bare elastane, draft set by the speed ratio), through a plating feeder with two yarn holes');
    if (opts.pileFeed === i) extra.push('plating feeder: ground yarn and pile yarn laid at two heights, the pile over the sinker nib');
    return { feed: i + 1, role: f.role, system: sys, why, extra };
  });
}

/**
 * Compile a machine set-up into needle notation.
 * @param setup { setout: {C:'A B A B', D:'A B'}, cams: [{C:{A:'K',B:'T'}, D:{...}}, ...] }
 * @returns {{grid:{C:string[], D:string[]|null}, errors:string[]}}
 */
function compile(setup, P) {
  const errors = [];
  const F = Array.isArray(setup.cams) ? setup.cams.length : 0;
  if (!F) return { grid: null, errors: ['Give at least one feeder in the cam chart.'] };
  const grid = {};
  for (const b of ['C', 'D']) {
    const raw = setup.setout && setup.setout[b];
    if (raw == null || raw === '') { grid[b] = null; continue; }
    const set = String(raw).toUpperCase().replace(/[^A-Z-]/g, '').split('');
    if (!set.length) { errors.push(`${b === 'C' ? 'Cylinder' : 'Dial'} set-out is empty.`); continue; }
    const tracks = [...new Set(set.filter((x) => x !== '-'))];
    if (P && Number.isFinite(P.tracks[b]) && tracks.length > P.tracks[b]) errors.push(`${b === 'C' ? 'Cylinder' : 'Dial'}: the set-out uses ${tracks.length} tracks (${tracks.join(' ')}); the machine has ${P.tracks[b]}.`);
    grid[b] = setup.cams.map((row, i) => set.map((t) => {
      if (t === '-') return '-';
      const c = row && row[b] && row[b][t];
      if (!c) { errors.push(`Feeder ${i + 1}: no cam given for ${b === 'C' ? 'cylinder' : 'dial'} track ${t} — taken as miss.`); return 'M'; }
      const s = String(c).toUpperCase()[0];
      if (!['K', 'T', 'M'].includes(s)) { errors.push(`Feeder ${i + 1}, track ${t}: "${c}" is not a cam — use knit, tuck or miss.`); return 'M'; }
      if (P && P.cams[b] && !P.cams[b].includes(s)) errors.push(`Feeder ${i + 1}, ${b === 'C' ? 'cylinder' : 'dial'} track ${t}: the machine has no ${SYM_NAME[s]} cam on this bed.`);
      return s;
    }).join(''));
  }
  if (!grid.C) errors.push('Give the cylinder needle set-out.');
  if (grid.C && grid.D && grid.C[0].length !== grid.D[0].length) errors.push(`The cylinder set-out covers ${grid.C[0].length} needles and the dial ${grid.D[0].length}: draw both over the same repeat.`);
  return { grid: grid.C ? { C: grid.C, D: grid.D || null } : null, errors };
}

// the cylinder's surface speed, m/s, at a speed factor (RPM × diameter in inches)
const surface = (sf) => (Math.PI * 0.0254 * sf) / 60;
function speedLimit(P) { return { sf: P.sf, rpm_at: (dia) => Math.round(P.sf / dia), surface_m_s: Math.round(surface(P.sf) * 100) / 100, max_m_s: Math.round(surface(P.sf) * 1.25 * 100) / 100 }; }

function describe(P) {
  return {
    id: P.id, label: P.label, auto: !!P.auto, kind: P.kind, gatings: P.gatings, selection: P.selection,
    tracks: { C: Number.isFinite(P.tracks.C) ? P.tracks.C : 'needle selection', D: P.tracks.D == null ? null : Number.isFinite(P.tracks.D) ? P.tracks.D : 'needle selection' },
    cams: P.cams, needle: P.needle, sinker: { type: P.sinker, text: SINKER[P.sinker] }, transfer: P.transfer, timing: P.timing || null,
    build: { feeders_per_inch: P.fpi, speed_factor: P.sf, surface_speed_m_s: speedLimit(P).surface_m_s, gauges: P.gauges, dia: P.dia, basis: 'typical build for this class of machine (modelled)' }, use: P.use,
    technique: P.technique || null, transfer_dirs: P.transferDirs || null, butts: P.butts || null,
  };
}

function list() { return ORDER.map((id) => describe({ ...PROFILES[id], id })); }

module.exports = { PROFILES, ORDER, requirements, fit, autoProfile, resolve, plan, compile, describe, list, trackSeqs, feedPlan, SINKER, speedLimit };
