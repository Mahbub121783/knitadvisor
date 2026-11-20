// Fabric DNA: a weft design as an open schema-3.0 document, and back (fabric-dna.js).
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const DNA = require('../engine/domain/fabric-dna');

console.log('--- Running Fabric DNA Tests ---');
const tpl = (id, extra) => {
  const t = S.listTemplates().find((x) => x.id === id);
  return { bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: Math.round((t.gsm_range.min + t.gsm_range.max) / 2) }, machine: {}, ...(extra || {}) };
};
const bare = (d) => { const x = JSON.parse(JSON.stringify(d)); delete x.knitadvisor; return x; };

{
  const inp = tpl('single_jersey');
  const out = S.analyse(JSON.parse(JSON.stringify(inp)));
  const d = DNA.toDNA(inp, out);
  assert.strictEqual(d.schemaVersion, '3.0.0-UNIVERSAL');
  assert.strictEqual(d.manufacturingClass, 'CIRCULAR_WEFT');
  assert.strictEqual(d.yarns.length, 1);
  assert.strictEqual(d.yarns[0].fiberBlend[0].fiber, 'COTTON');
  assert.strictEqual(d.unitCell.topologyGraph.yarnPaths.length, 1);
  assert.strictEqual(d.unitCell.topologyGraph.yarnPaths[0].ops.cylinder, 'K');
  assert(Math.abs(d.universalLaw.agreement_pct) < 2, `jersey: the law Σ(L·Tex)/A_cell agrees with the Studio (${d.universalLaw.agreement_pct} %)`);
  assert.strictEqual(d.feasibilityVerdict.gate1Cohesion, 'PASS');
  assert(d.feasibilityVerdict.gate2PackingPhi > 0);
  assert(d.environment.standard === 'ISO_139');
  console.log('✓ a jersey written as Fabric DNA: one channel, one path, the law agrees with the Studio within', d.universalLaw.agreement_pct, '%');
}
{
  // round trip without the KnitAdvisor block: the DNA alone rebuilds the same cloth
  for (const id of ['single_jersey', 'pique_single', 'rib_1x1', 'interlock', 'fleece_3_thread', 'terry_fabric', 'lycra_rib_1x1']) {
    const inp = tpl(id, id === 'lycra_rib_1x1' ? { elastane: { denier: 40, draft: 2.8 } } : {});
    const out = S.analyse(JSON.parse(JSON.stringify(inp)));
    assert(out.success, id + ': ' + out.error);
    const back = DNA.fromDNA(bare(DNA.toDNA(inp, out)));
    const again = S.analyse(back.input);
    assert(again.success, id + ' re-analysed: ' + again.error);
    assert(Math.abs(again.fabric.gsm / out.fabric.gsm - 1) < 0.02, `${id}: ${out.fabric.gsm} → ${again.fabric.gsm} GSM`);
    assert.deepStrictEqual(again.structure.beds.C, out.structure.beds.C, id + ': the cylinder programme survives');
    if (id === 'lycra_rib_1x1') assert(back.input.elastane && back.input.elastane.denier === 40 && back.input.elastane.draft === 2.8, 'the elastane channel and its draft come back');
  }
  console.log('✓ seven structures go to DNA and back with the same programme and weight');
}
{
  // a hand-written DNA in the PRD's own shape (ops as a list, Ne count) opens
  const prd = {
    schemaVersion: '3.0.0-UNIVERSAL', manufacturingClass: 'CIRCULAR_WEFT',
    unitCell: { widthMm: 0.714, heightMm: 0.556, thicknessMm: 0.62, zLayers: 1, topologyGraph: { nodes: [], yarnPaths: [{ yarnId: 'Y1', ops: ['K'], arcLengthMm: 2.90, zOrder: 0 }] } },
    yarns: [{ yarnId: 'Y1', fiberBlend: [{ fiber: 'COTTON', fraction: 1.0 }], spinning: 'COMPACT', count: 30, unit: 'Ne', tex: 19.68 }],
    machineCompiler: { machineParams: { gaugeOrReed: 28, diameterOrWidthInch: 30, rpmOrPicksPerMin: 26, gatingOrShed: 'SINGLE_BED' } },
  };
  const back = DNA.fromDNA(prd);
  assert.strictEqual(back.input.bed, 'single');
  assert.strictEqual(back.input.yarn.type, 'compact');
  assert.strictEqual(back.input.machine.gauge, 28);
  // no weight given: the unit cell by the law, 2.90 × 19.68 ÷ (0.714 × 0.556) ≈ 144 GSM
  assert(Math.abs(back.input.target.gsm - 144) <= 1, 'target from the unit-cell law: ' + back.input.target.gsm);
  assert(back.notes.some((n) => /law/.test(n)));
  const r = S.analyse(back.input);
  assert(r.success, r.error);
  console.log('✓ a DNA in the PRD\'s own shape opens: the law gives', back.input.target.gsm, 'GSM, the Studio knits it at', r.fabric.gsm);
}
{
  // blends and other machine classes
  const blend = DNA.fromDNA({ schemaVersion: '3.0.0', unitCell: { topologyGraph: { yarnPaths: [{ yarnId: 'Y1', ops: { cylinder: 'KT' }, role: 'ground' }] } }, yarns: [{ yarnId: 'Y1', fiberBlend: [{ fiber: 'COTTON', fraction: 0.6 }, { fiber: 'POLYESTER', fraction: 0.4 }], count: 24, unit: 'Ne' }], fabric: { gsm: 180 } });
  assert(blend.input.yarn.blend && blend.input.yarn.mix.cotton === 60 && blend.input.yarn.mix.polyester === 40);
  assert.throws(() => DNA.fromDNA({ schemaVersion: '3.0.0', manufacturingClass: 'WOVEN_LOOM' }), /woven/i);
  assert.throws(() => DNA.fromDNA({ schemaVersion: '2.0' }), /3\.x/);
  assert.throws(() => DNA.fromDNA({ schemaVersion: '3.0.0', unitCell: { topologyGraph: { yarnPaths: [{ yarnId: 'Y1', ops: 'KXQ' }] } }, yarns: [{ yarnId: 'Y1', count: 30, unit: 'Ne' }], fabric: { gsm: 150 } }), /needle row/);
  console.log('✓ a 60/40 blend channel becomes a blend yarn; woven, old schemas and bad rows are refused with a reason');
}
{
  // a fleece's courses count the knitting yarn only: the unit-cell law holds, and the loop yarn's layer makes it thicker than a jersey
  for (const id of ['fleece_3_thread', 'fleece_2_thread', 'french_terry', 'fleece_diagonal']) {
    const inp = tpl(id), out = S.analyse(JSON.parse(JSON.stringify(inp)));
    const d = DNA.toDNA(inp, out);
    assert(Math.abs(d.universalLaw.agreement_pct) <= 3, `${id}: law vs Studio ${d.universalLaw.agreement_pct} %`);
    assert(out.fabric.cpc < 1.3 * out.fabric.wpc * 1.6 && out.fabric.cpc > 12, `${id}: cpc ${out.fabric.cpc}`);
    assert(out.feasibility.packing.thickness_mm > 0.9, `${id}: thickness ${out.feasibility.packing.thickness_mm}`);
    assert(out.feasibility.packing.phi < 0.5, `${id}: phi ${out.feasibility.packing.phi}`);
  }
  console.log('✓ fleece, loopback: the unit-cell law is within 3 % of the weight, courses are the knitted ones, thickness about 1.1 mm, Φ about 0.3');
}
{
  // the PRD's yarn node, topology nodes and active chemicals are all there, with numbers a yarn engineer can check
  const inp = tpl('single_jersey', { elastane: { denier: 40, draft: 3, every: 'all' }, look: { shade: 'dark', colour: '#2a4d8f' } });
  const out = S.analyse(JSON.parse(JSON.stringify(inp))), d = DNA.toDNA(inp, out);
  const y = d.yarns[0];
  for (const k of ['twistDir', 'tm', 'csp', 'uster', 'melangePercent', 'slub', 'elastaneDraftRatio', 'tensionCN', 'colorLab']) assert(k in y, 'missing yarn field ' + k);
  assert.strictEqual(y.twistDir, 'Z');
  assert(y.tm > 2.5 && y.tm < 4.5, 'alpha_e ' + y.tm);
  assert(y.csp > 1500 && y.csp < 4000, 'CSP ' + y.csp);
  assert(y.uster.uPercent > 5 && y.uster.uPercent < 20 && y.uster.ipi > 0 && y.uster.hairinessH > 0);
  assert(y.tensionCN > 1 && y.colorLab.L > 0 && y.colorLab.L < 100);
  assert.strictEqual(y.melangePercent, null);
  const el = d.yarns.find((x) => /elastane/i.test(x.label));
  assert(el.elastaneDraftRatio === 3 && el.twistDir === null && el.tm === null);
  assert(d.unitCell.topologyGraph.nodes.length === 1 && d.unitCell.topologyGraph.nodes[0].op === 'K' && d.unitCell.topologyGraph.nodes[0].yarnId === 'Y1');
  const rib = tpl('rib_1x1'), ro = S.analyse(JSON.parse(JSON.stringify(rib))), rd = DNA.toDNA(rib, ro);
  assert(rd.unitCell.topologyGraph.nodes.some((n) => n.bed === 'dial') && rd.unitCell.topologyGraph.nodes.some((n) => n.bed === 'cylinder'));
  assert(Array.isArray(d.wetProcessingPipeline.activeChemicals) && d.wetProcessingPipeline.activeChemicals.length > 3 && d.wetProcessingPipeline.activeChemicals[0].name);
  // a melange yarn reports its coloured share; a given CSP survives the round trip
  const MEL = require('../engine/domain/melange-engine');
  const mi = tpl('single_jersey', { melange: { ground: JSON.parse(JSON.stringify(MEL.PRESETS.find((p) => p.id === 'grey_90_10').spec)) } });
  const md = DNA.toDNA(mi, S.analyse(JSON.parse(JSON.stringify(mi))));
  assert(md.yarns[0].melangePercent > 8 && md.yarns[0].melangePercent < 12, 'melange ' + md.yarns[0].melangePercent);
  const ci = tpl('single_jersey', { yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne', csp: 2650 } });
  const cd = DNA.toDNA(ci, S.analyse(JSON.parse(JSON.stringify(ci))));
  assert.strictEqual(cd.yarns[0].csp, 2650);
  const back = DNA.fromDNA(JSON.parse(JSON.stringify(cd)));
  assert.strictEqual(back.input.yarn.csp, 2650);
  console.log('✓ DNA yarn node: twist, αe, CSP, Uster, melange share, tension, colour; stitch-graph nodes for both beds; the chemicals of the route; a given CSP survives the round trip');
}
console.log('Fabric DNA tests passed');
