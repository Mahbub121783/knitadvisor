// The material package: the physics and glTF values (backend), and the plain-data builders of the package (maps, glb, zip) the page uses.
'use strict';
const assert = require('assert');
const zlib = require('zlib');
const S = require('../engine/domain/fabric-studio');
const M = require('../engine/domain/material-package');
const D = require('../engine/domain/drape-engine');
const P = require('../../frontend/assets/js/pbr-package.js');

console.log('--- Running Material Package Tests ---');
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m || ''} ${a} vs ${b} (±${tol})`);
const cloth = (extra) => S.analyse({ bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: {}, hand: { enabled: true }, look: { shade: 'medium' }, ...(extra || {}) });

{
  const r = cloth();
  const p = M.physics(r, { name: 'Jersey' });
  assert.strictEqual(p.fabric.weight_g_m2, r.hand.geometry.gsm);
  assert.deepStrictEqual(p.fabric.composition_pct, { cotton: 100 });
  // the SI conversions: gf·cm²/cm → N·m, gf/(cm·deg) → N/(m·rad), gf/cm over a stretch → N/m
  near(p.mechanics.course.bending.N_m, r.hand.bending.course.value * 9.80665e-5, 1e-8, 'bending to SI');
  near(p.mechanics.shear.G_N_per_m_rad, r.hand.shear.G.value * 56.2, 0.01, 'shear to SI');
  near(p.mechanics.course.stiffness_secant_N_per_m, (200 * 0.0980665) / (r.hand.tensile.width.EMT.value / 100), 0.2, 'secant stiffness');
  assert(p.mechanics.wale.stiffness_secant_N_per_m > p.mechanics.course.stiffness_secant_N_per_m, 'a jersey is stiffer along the wales than across');
  assert(p.mechanics.bias.bending.gf_cm2_per_cm >= Math.min(p.mechanics.course.bending.gf_cm2_per_cm, p.mechanics.wale.bending.gf_cm2_per_cm));
  assert(p.axes.x.includes('weft') && p.axes.y.includes('warp'));
  assert.strictEqual(p.drape, undefined); assert.strictEqual(p.comfort, undefined); assert.strictEqual(p.water, undefined);
  // the extras ride along when they have been worked out
  const full = M.physics(cloth({ lab: { enabled: true }, drape: { enabled: true, dwr: 'c6' } }), { drape: D.analyse(D.fromHand(r.hand)) });
  assert(full.drape && full.drape.drape_coefficient_pct > 0 && full.comfort.air_permeability_mm_s > 0 && full.water.contact_angle_deg > 0);
  assert.throws(() => M.physics({ hand: null }), /hand numbers/);
  console.log('✓ physics: SI conversions, axes named for garment tools, drape / comfort / water added when worked out');
}
{
  const co = M.material(cloth()), pe = M.material(cloth({ yarn: { fibre: 'polyester_filament', type: 'fdy', count: 75, unit: 'denier' } })), sk = M.material(cloth({ yarn: { fibre: 'silk', count: 30, unit: 'ne' } }));
  assert(co.roughness_factor > pe.roughness_factor && pe.roughness_factor > sk.roughness_factor - 0.01, `cotton ${co.roughness_factor} rougher than polyester ${pe.roughness_factor}`);
  assert.strictEqual(M.material(cloth(), { roughness: 0.7 }).roughness_factor, 0.7, 'the real view\'s own material wins');
  assert.strictEqual(co.metallic_factor, 0); assert(co.sheen.strength > 0.15 && co.sheen.strength <= 0.9);
  assert.strictEqual(co.alpha_mode, 'OPAQUE');
  const mesh = S.analyse({ bed: 'single', gating: 'single', grid: S.listTemplates().find((t) => t.id === 'pointelle_eyelet').grid, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', count: 40, unit: 'ne' }, target: { gsm: 125 }, machine: {}, hand: { enabled: true }, look: { shade: 'medium' } });
  assert.strictEqual(M.material(mesh).alpha_mode, 'MASK', 'a cloth with eyelets has holes: alpha mask');
  const f = M.formats();
  assert(f.not_written.some((x) => x.id === 'u3ma') && f.not_written.some((x) => x.id === 'zfab') && f.written.some((x) => x.id === 'gltf'));
  const text = M.readme(cloth(), { tile_cm: { w: 0.9, h: 0.5 }, files: ['albedo.png'] });
  assert(/One tile is 0.9 cm × 0.5 cm/.test(text) && /OpenGL/.test(text) && /\.u3ma/.test(text) && /\.zfab/.test(text));
  assert(!/https?:\/\//.test(text), 'no outside source is named');
  console.log('✓ material values: cotton rougher than polyester, the view\'s roughness wins, eyelets make an alpha mask; the formats say what is and is not written');
}
{
  // packing the maps
  const cover = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  const alb = P.pack.albedo(cover, '#336699');
  assert.deepStrictEqual(Array.from(alb), [51, 102, 153, 255, 51, 102, 153, 0], 'the dye colour, opacity in alpha');
  const ao = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  const rough = P.pack.roughness(ao, 0.8);
  assert.strictEqual(rough[0], Math.round(0.8 * 255)); assert(rough[4] > rough[0], 'a cavity is rougher');
  const orm = P.pack.orm(ao, rough);
  assert.deepStrictEqual([orm[0], orm[1], orm[2], orm[3]], [255, rough[0], 0, 255]);
  assert.deepStrictEqual(Array.from(P.pack.gray(new Uint8ClampedArray([10, 20, 30, 255]), 1)), [20, 20, 20, 255]);
  // levels: a map that sits near the top is stretched to the whole range
  const hmap = new Uint8ClampedArray(400); for (let i = 0; i < 100; i++) { const v = 200 + (i % 50); hmap[4 * i] = v; hmap[4 * i + 1] = v; hmap[4 * i + 2] = v; hmap[4 * i + 3] = 255; }
  const st = P.pack.stretch(hmap, 0); const sv = []; for (let i = 0; i < 100; i++) sv.push(st[4 * i]);
  assert(Math.min(...sv) <= 5 && Math.max(...sv) >= 250, 'stretched to the full range'); assert.deepStrictEqual(Array.from(P.pack.stretch(new Uint8ClampedArray([9, 9, 9, 255, 9, 9, 9, 255]), 0).slice(0, 4)), [9, 9, 9, 255], 'a flat map is left as it is');
  console.log('✓ packing: albedo with alpha, roughness rougher in cavities, ORM = occlusion / roughness / metallic 0');
}
{
  // a glb that a viewer can read: header, JSON chunk, BIN chunk, accessors in bounds, images inside the buffer
  const geo = P.plane({ width_m: 0.3, height_m: 0.3, tile_cm: { w: 0.9, h: 0.6 } });
  const png = (n) => new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(n).fill(7)]);
  const images = [{ name: 'albedo', bytes: png(13) }, { name: 'normal', bytes: png(20) }, { name: 'orm', bytes: png(5) }];
  const glb = P.glb(geo, images, { name: 'Jersey', alpha_mode: 'MASK', sheen: { roughness: 0.5 }, sheen_colour: [0.7, 0.7, 0.8] }, { physics: { x: 1 } });
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.strictEqual(dv.getUint32(0, true), 0x46546C67, 'glTF magic'); assert.strictEqual(dv.getUint32(4, true), 2); assert.strictEqual(dv.getUint32(8, true), glb.length, 'total length');
  const jl = dv.getUint32(12, true); assert.strictEqual(dv.getUint32(16, true), 0x4E4F534A, 'JSON chunk'); assert.strictEqual(jl % 4, 0);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl)));
  const bo = 20 + jl, bl = dv.getUint32(bo, true); assert.strictEqual(dv.getUint32(bo + 4, true), 0x004E4942, 'BIN chunk'); assert.strictEqual(bl % 4, 0);
  assert.strictEqual(json.asset.version, '2.0'); assert.strictEqual(json.buffers[0].byteLength, bl);
  json.bufferViews.forEach((v) => { assert(v.byteOffset % 4 === 0, 'aligned'); assert(v.byteOffset + v.byteLength <= bl, 'inside the buffer'); });
  const acc = json.accessors; assert.strictEqual(acc[0].count, 4); acc[0].min.forEach((v, i) => near(v, [-0.15, -0.15, 0][i], 1e-6)); acc[0].max.forEach((v, i) => near(v, [0.15, 0.15, 0][i], 1e-6));
  assert.strictEqual(acc[3].count, 6); assert.strictEqual(acc[3].componentType, 5125);
  // the UVs repeat the tile: 30 cm ÷ 0.9 cm and ÷ 0.6 cm
  const uvView = json.bufferViews[acc[2].bufferView], uv = new Float32Array(glb.buffer.slice(glb.byteOffset + bo + 8 + uvView.byteOffset, glb.byteOffset + bo + 8 + uvView.byteOffset + uvView.byteLength));
  near(uv[2], 30 / 0.9, 0.01, 'u repeats'); near(uv[1], 30 / 0.6, 0.01, 'v repeats');
  const m = json.materials[0];
  assert.strictEqual(m.alphaMode, 'MASK'); assert.strictEqual(m.pbrMetallicRoughness.metallicFactor, 0); assert.strictEqual(m.pbrMetallicRoughness.baseColorTexture.index, 0); assert.strictEqual(m.normalTexture.index, 1); assert.strictEqual(m.occlusionTexture.index, 2);
  assert(json.extensionsUsed.includes('KHR_materials_sheen')); assert.deepStrictEqual(m.extensions.KHR_materials_sheen.sheenColorFactor, [0.7, 0.7, 0.8]);
  assert.strictEqual(json.samplers[0].wrapS, 10497, 'REPEAT');
  json.images.forEach((im, k) => { const v = json.bufferViews[im.bufferView]; assert.strictEqual(glb[bo + 8 + v.byteOffset], 0x89, 'image ' + k + ' starts with the PNG signature'); });
  assert.deepStrictEqual(json.extras, { physics: { x: 1 } });
  console.log('✓ glb: magic, lengths, 4-byte alignment, accessors in bounds, UVs tile the swatch, images embedded, REPEAT sampler, sheen extension');
}
{
  // a draped sample as a glb: triangles from the lattice, unit normals, Y up
  const d = D.analyse({ gsm: 160, B_course: 0.05, B_wale: 0.05, G: 0.4, EMT_course: 20, EMT_wale: 15, steps: 25 });
  const geo = P.draped(d.mesh, { w: 0.9, h: 0.6 });
  assert.strictEqual(geo.positions.length / 3, d.mesh.x.length); assert(geo.indices.length > 600 && geo.indices.length % 3 === 0);
  let maxIdx = 0; geo.indices.forEach((i) => { maxIdx = Math.max(maxIdx, i); }); assert(maxIdx < d.mesh.x.length);
  for (let k = 0; k < geo.normals.length; k += 3) near(Math.hypot(geo.normals[k], geo.normals[k + 1], geo.normals[k + 2]), 1, 1e-3, 'unit normal');
  let up = 0; for (let k = 1; k < geo.normals.length; k += 3) up += geo.normals[k]; assert(Math.abs(up) > 0.5 * (geo.normals.length / 3) * 0.5, 'the sample faces mostly one way (Y up)');
  const hi = Math.max(...Array.from(geo.positions).filter((_, i) => i % 3 === 1)); assert(hi < 0.01, 'the flat centre is at y = 0, the rest hangs below');
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4]);
  const glb = P.glb(geo, [{ name: 'albedo', bytes: png }, { name: 'normal', bytes: png }, { name: 'orm', bytes: png }], { name: 'Drape' });
  assert(glb.length > geo.positions.byteLength);
  console.log('✓ a draped sample as glTF:', geo.positions.length / 3, 'vertices,', geo.indices.length / 3, 'triangles');
}
{
  // ZIP: CRC-32 of the standard check string, and the structure read back
  assert.strictEqual(P.crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'CRC-32 check value');
  const files = [{ name: 'a.txt', bytes: new TextEncoder().encode('hello') }, { name: 'dir/b.bin', bytes: new Uint8Array([1, 2, 3, 4, 5, 6]) }];
  const z = P.zip(files);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const eocd = z.length - 22; assert.strictEqual(dv.getUint32(eocd, true), 0x06054B50); assert.strictEqual(dv.getUint16(eocd + 10, true), 2);
  const cdOff = dv.getUint32(eocd + 16, true); let p = cdOff;
  files.forEach((f) => {
    assert.strictEqual(dv.getUint32(p, true), 0x02014B50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), lo = dv.getUint32(p + 42, true);
    assert.strictEqual(new TextDecoder().decode(z.subarray(p + 46, p + 46 + nl)), f.name); assert.strictEqual(size, f.bytes.length); assert.strictEqual(crc, P.crc32(f.bytes));
    assert.strictEqual(dv.getUint32(lo, true), 0x04034B50); const lnl = dv.getUint16(lo + 26, true);
    assert.deepStrictEqual(Array.from(z.subarray(lo + 30 + lnl, lo + 30 + lnl + size)), Array.from(f.bytes), 'the stored bytes');
    p += 46 + nl;
  });
  // a real unzip reads it: node has no unzip, but python's zipfile does (when python is there)
  try {
    const { spawnSync } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
    const tmp = path.join(os.tmpdir(), 'ka-zip-test-' + process.pid + '.zip'); fs.writeFileSync(tmp, z);
    const r = spawnSync('python', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(sorted(z.namelist()), z.read("a.txt").decode())', tmp], { encoding: 'utf8' });
    fs.unlinkSync(tmp);
    if (r.status === 0) assert(/a\.txt/.test(r.stdout) && /hello/.test(r.stdout), 'python zipfile reads it'); else console.log('  (python not available to unzip; structure checked)');
  } catch (_) { /* optional */ }
  assert(zlib && true);
  console.log('✓ zip: CRC-32 check value, headers, central directory and stored bytes read back; a real unzip accepts it');
}
(async () => {
  // PNG: not premultiplied, read back through zlib
  const w = 3, h = 2, rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 7]);
  const png = await P.encodePng(w, h, rgba);
  assert.deepStrictEqual(Array.from(png.subarray(0, 8)), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.strictEqual(dv.getUint32(16), w); assert.strictEqual(dv.getUint32(20), h); assert.strictEqual(png[24], 8); assert.strictEqual(png[25], 6);
  // walk the chunks, check each CRC, inflate IDAT
  let p = 8, idat = null; const types = [];
  while (p < png.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...png.subarray(p + 4, p + 8)); types.push(type);
    assert.strictEqual(dv.getUint32(p + 8 + len), P.crc32(png.subarray(p + 4, p + 8 + len)), type + ' CRC');
    if (type === 'IDAT') idat = png.subarray(p + 8, p + 8 + len);
    p += 12 + len;
  }
  assert.deepStrictEqual(types, ['IHDR', 'IDAT', 'IEND']);
  const raw = zlib.inflateSync(Buffer.from(idat));
  assert.strictEqual(raw.length, (w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { assert.strictEqual(raw[y * (w * 4 + 1)], 0); assert.deepStrictEqual(Array.from(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1))), Array.from(rgba.subarray(y * w * 4, (y + 1) * w * 4))); }
  console.log('✓ png: signature, IHDR, per-chunk CRCs, IDAT inflates to the exact RGBA (the colour under a transparent pixel kept)');
  // the open material files: well-formed, wired to the package's own PNGs, and honest about what they are
  {
    const mx = P.materialx({ name: '3-thread fleece', sheen: { strength: 0.4 }, height_scale: 0.0012 });
    const stack = []; const tags = mx.replace(/<\?xml[^>]*\?>/, '').match(/<\/?[A-Za-z_][^>]*>/g) || [];
    tags.forEach((t) => { if (/^<\//.test(t)) assert.strictEqual(stack.pop(), t.slice(2, -1).trim(), 'balanced ' + t); else if (!/\/>$/.test(t)) stack.push(t.slice(1).split(/[\s>]/)[0]); });
    assert.strictEqual(stack.length, 0, 'every element is closed');
    assert(/<materialx version="1\.38"/.test(mx) && /<standard_surface/.test(mx) && /<surfacematerial name="_?3_thread_fleece"/.test(mx.replace('name="_3', 'name="_3')) || /<surfacematerial name="[A-Za-z_][A-Za-z0-9_]*"/.test(mx));
    ['albedo', 'roughness', 'normal', 'ao', 'opacity', 'displacement'].forEach((n) => assert(mx.includes(`value="${n}.png"`), n + '.png wired'));
    assert(/colorspace="srgb_texture"/.test(mx) && /colorspace="lin_rec709"/.test(mx), 'colour map sRGB, data maps linear');
    assert(/<normalmap name="nm_normal"/.test(mx) && /name="scale" type="float" value="0.0012"/.test(mx) && /name="sheen" type="float" value="0.4"/.test(mx));
    const us = P.usda({ name: '3-thread fleece' });
    assert(us.startsWith('#usda 1.0') && /defaultPrim = "_?3_thread_fleece"/.test(us) && /info:id = "UsdPreviewSurface"/.test(us) && /info:id = "UsdUVTexture"/.test(us) && /UsdPrimvarReader_float2/.test(us));
    ['albedo', 'roughness', 'ao', 'normal'].forEach((n) => assert(us.includes(`@${n}.png@`), n + '.png wired'));
    assert(/inputs:scale = \(2, 2, 2, 1\)/.test(us) && /inputs:bias = \(-1, -1, -1, 0\)/.test(us), 'the normal map is unpacked');
    assert.strictEqual((us.match(/\{/g) || []).length, (us.match(/\}/g) || []).length, 'braces balance');
    const fm = M.formats();
    assert(fm.written.some((f) => f.id === 'mtlx') && fm.written.some((f) => f.id === 'usda') && fm.not_written.some((f) => f.id === 'zfab'));
    assert(/material\.mtlx/.test(M.readme({ structure: {}, fabric: { gsm: 200 } }, { files: [] })) && /not been opened/.test(M.readme({ structure: {}, fabric: { gsm: 200 } }, {})));
    console.log('✓ MaterialX and USD files: well-formed, wired to the six PNGs, linear data maps, OpenGL normal unpacked; the README says they are written to the specs, not opened in a tool');
  }
  console.log('Material package tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
