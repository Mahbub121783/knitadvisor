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
console.log('Fabric DNA tests passed');
