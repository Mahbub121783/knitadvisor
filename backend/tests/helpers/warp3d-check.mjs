// knit3d's warp topology from a real lapping: paths built, all coordinates finite;
// the macro view gets the warp repeat; a double-needle-bar spacer draws both faces.
const T = await import('../../../frontend/assets/js/knit3d/topology-builder.js');
const W = (await import('module')).createRequire(import.meta.url)('../../engine/domain/warp-studio.js');
const fin = (r) => r.paths.every((p) => p.points.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)));
const con = { type: 'tricot', base: 'warp' };
const bars = [{ pairs: W.parseNotation('2-3/1-0//', 1) }, { pairs: W.parseNotation('1-0/1-2//', 1) }];
const r = T.buildYarnPaths({ construction: con, pattern: { lapping: { bars } }, wales: 10, courses: 12, sample: () => 'knit' });
const net = [{ pairs: W.parseNotation('1-0/0-1/1-0/1-2/2-1/1-2//', 1), threading: 'X.' }, { pairs: W.parseNotation('1-2/2-1/1-2/1-0/0-1/1-0//', 1), threading: '.X' }];
const rep = T.structureRepeat(con, { lapping: { bars: net } });
const sp = W.TEMPLATES.find((t) => t.id === 'spacer');
const spl = { bars: sp.bars.map((b) => ({ pairs: W.parseNotation(b.notation, 1), threading: b.threading })), beds: 2, gap: 4 };
const d = T.buildYarnPaths({ construction: con, pattern: { lapping: spl }, wales: 10, courses: 8, sample: () => 'knit' });
const zs = d.paths.flatMap((p) => p.points.map((v) => v.z));
console.log(JSON.stringify({ paths: r.paths.length, finite: fin(r) && fin(d), repeat: rep, spacerRepeat: T.structureRepeat(con, { lapping: spl }), depth: Math.max(...zs) - Math.min(...zs) }));
