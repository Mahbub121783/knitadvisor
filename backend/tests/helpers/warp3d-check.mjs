// knit3d's warp topology from a real lapping: paths built, all coordinates finite.
const T = await import('../../../frontend/assets/js/knit3d/topology-builder.js');
const W = (await import('module')).createRequire(import.meta.url)('../../engine/domain/warp-studio.js');
const bars = [{ pairs: W.parseNotation('2-3/1-0//', 1) }, { pairs: W.parseNotation('1-0/1-2//', 1) }];
const r = T.buildYarnPaths({ construction: { type: 'tricot', base: 'warp' }, pattern: { lapping: { bars } }, wales: 10, courses: 12, sample: () => 'knit' });
const finite = r.paths.every((p) => p.points.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)));
console.log(JSON.stringify({ paths: r.paths.length, finite }));
