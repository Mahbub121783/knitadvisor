/**
 * KnitAdvisor — Repellency engine: what a drop of water does on the cloth (the lotus drop), with and without a water-repellent finish.
 *
 * A drop sits on the tops of the loops, not on a flat film: the cloth is part solid, part air. Its apparent contact angle comes from the fibre's own
 * (flat) angle and from how much of the surface is solid:
 *
 *   hydrophobic fibre or finish (flat angle ≥ 90°)  Cassie–Baxter: cos θ = f·(cos θ₀ + 1) − 1, f the solid share of the surface the drop touches. The more
 *                                                    air under the drop, the higher the angle.
 *   hydrophilic fibre (flat angle < 90°)              Wenzel: cos θ = r·cos θ₀, r the roughness of the loops (about 1.8): the roughness makes a
 *                                                    wetting surface wet more, and a cellulose fibre wicks the drop in.
 *
 * From the angle: the spray rating a spray test would give (100 = no wetting … 0 = wetted through), the angle the cloth must be tilted to before
 * a drop rolls off, and whether the drop wicks. A water-repellent finish (DWR) coats the fibre: a fluorocarbon (C6) to a flat angle of about 118°,
 * a non-fluorinated one (wax, silicone, a dendrimer) to about 108°. A hydrophilic softener brings it to about 10°. The open area at rest and stretched
 * 20 % (the loops open, the solid share falls) shows how stretch helps or hurts.
 *
 * Basis: law = the two wetting equations; estimate = the flat angles of the fibres and the finishes, the solid share of the surface, the roughness and the
 * roll-off and spray-rating scales: a contact-angle and a spray reading on the mill's own cloth replace them. No outside source is named.
 */
'use strict';

class RepellencyError extends Error { constructor(m) { super(m); this.name = 'RepellencyError'; } }

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V = (value, unit, basis, extra) => (value == null || !Number.isFinite(value) ? null : { value, unit, basis, ...(extra || {}) });
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

// the flat (Young) contact angle of each fibre, degrees (estimate); a scoured cellulosic fibre is a wick
const FLAT = { cotton: 20, linen: 20, viscose: 20, modal: 20, tencel: 20, bamboo: 20, polyester: 75, cdp: 75, nylon: 70, acrylic: 70, wool: 90, silk: 60, polypropylene: 100, elastane: 85 };
const FINISH = {
  none: { label: 'No finish', flat: null },
  c0: { label: 'Water repellent, non-fluorinated (wax / silicone)', flat: 108 },
  c6: { label: 'Water repellent, fluorocarbon (C6)', flat: 118 },
  hydrophilic: { label: 'Hydrophilic softener (wicking)', flat: 10 },
};
const ROUGH = 1.8;

function fibreFlat(fibres) {
  const e = Object.entries(fibres || { cotton: 100 }).filter(([, v]) => +v > 0);
  const tot = e.reduce((t, [, v]) => t + +v, 0) || 100;
  const cos = e.reduce((t, [k, v]) => t + (+v / tot) * Math.cos(rad(FLAT[k] != null ? FLAT[k] : 60)), 0);
  return deg(Math.acos(clamp(cos, -1, 1)));
}
function apparent(flat, open) {
  const fs = clamp((1 - open) * 0.45, 0.12, 0.5);                      // the solid share of the surface a drop touches
  if (flat >= 90) return { angle: deg(Math.acos(clamp(fs * (Math.cos(rad(flat)) + 1) - 1, -1, 1))), regime: 'Cassie–Baxter (the drop rides on the loop tops, air beneath)', fs };
  const c = ROUGH * Math.cos(rad(flat));
  return { angle: c >= 1 ? 0 : deg(Math.acos(c)), regime: c >= 1 ? 'Wenzel, fully wetting (the drop spreads and wicks in)' : 'Wenzel (the roughness of the loops makes a wetting surface wet more)', fs };
}
const rollOff = (th) => (th <= 90 ? null : clamp(90 * Math.exp(-(th - 90) / 25), 3, 90));
const spray = (th) => (th >= 145 ? 100 : th >= 135 ? 90 : th >= 120 ? 80 : th >= 100 ? 70 : th >= 90 ? 50 : 0);

/** analyse({ fibres, open_rest, open_20, finish: 'none' | 'c0' | 'c6' | 'hydrophilic', hairiness }) */
function analyse(input) {
  const p = input && typeof input === 'object' ? input : {};
  const fin = Object.prototype.hasOwnProperty.call(FINISH, p.finish) ? p.finish : 'none';
  const open0 = clamp(+p.open_rest || 0, 0, 0.9), open20 = clamp(+p.open_20 || open0, 0, 0.95);
  const fibreFlatDeg = fibreFlat(p.fibres);
  const flat = FINISH[fin].flat != null ? FINISH[fin].flat : fibreFlatDeg;
  const rest = apparent(flat, open0), s20 = apparent(flat, open20);
  const th = rest.angle, th20 = s20.angle;
  const warnings = [];
  const say = (level, text) => warnings.push({ level, text });
  const wicks = th < 30;
  const word = th >= 145 ? 'superhydrophobic: drops bead up and roll off at the slightest tilt' : th >= 120 ? 'water repellent: drops bead up and roll off' : th >= 90 ? 'water resistant: drops bead but cling' : th >= 30 ? 'wettable: drops spread and soak in slowly' : 'hydrophilic: drops soak in at once (wicking)';
  if (fin === 'none' && fibreFlatDeg < 90) say('note', 'An untreated cloth of this fibre is wetted: a water-repellent finish (DWR) is what makes it shed water.');
  if (fin !== 'none' && fin !== 'hydrophilic' && th < 110) say('warn', `The finish reaches only ${r1(th)}° on this cloth: a tight, smooth surface leaves too little air under the drop. A rougher or looser surface (a more open loop, a brushed face) raises it.`);
  if (fin === 'c6') say('note', 'Fluorocarbon (C6) finishes give the highest angle and a long wash life but are being phased out in many markets; a non-fluorinated one is a few degrees lower.');
  if (open20 > open0 * 1.5 && th20 > th + 1.5 && flat >= 90) say('note', `Stretched 20 % the loops open and the angle rises to ${r1(th20)}° (more air under the drop); but a large open area lets a drop through under pressure.`);
  return {
    success: true,
    finish: { id: fin, label: FINISH[fin].label },
    flat_angle: V(r1(flat), '° on a flat film of this surface', 'estimate', { fibre: r1(fibreFlatDeg) }),
    contact_angle: V(r1(th), '° on the cloth', 'estimate', { regime: rest.regime, solid_share: r2(rest.fs) }),
    contact_angle_stretched_20: V(r1(th20), '° at 20 % stretch', 'estimate'),
    spray_rating: V(spray(th), 'of 100 (spray-test style)', 'estimate'),
    roll_off: { value: rollOff(th) == null ? null : r1(rollOff(th)), unit: '° tilt at which a drop rolls off', basis: 'estimate', sticks: rollOff(th) == null || rollOff(th) > 60 },
    wicks, word, warnings,
    derivations: [
      { id: 'flat', quantity: 'Flat angle of the surface', formula: 'cos θ₀ = Σ share × cos θ(fibre), or the finish\'s own', working: `fibres ${r1(fibreFlatDeg)}°${FINISH[fin].flat != null ? ', finish ' + FINISH[fin].flat + '°' : ''}`, result: r1(flat), unit: '°', basis: 'estimate' },
      { id: 'angle', quantity: 'Contact angle on the cloth', formula: flat >= 90 ? 'Cassie–Baxter: cos θ = f (cos θ₀ + 1) − 1' : `Wenzel: cos θ = r cos θ₀, r = ${ROUGH}`, working: `f = ${r2(rest.fs)} (open area ${r1(open0 * 100)} %)`, result: r1(th), unit: '°', basis: 'law' },
    ],
    basis: { law: ['Cassie–Baxter and Wenzel wetting'], estimated: ['the flat angles of the fibres and the finishes', 'the solid share of the surface', 'the roughness', 'the roll-off and spray-rating scales'], replaced_by: 'a contact-angle and a spray-test reading on the mill\'s own cloth' },
  };
}

function catalogue() { return { finishes: Object.entries(FINISH).map(([id, f]) => ({ id, label: f.label })) }; }

module.exports = { analyse, catalogue, RepellencyError, FINISH, FLAT };
