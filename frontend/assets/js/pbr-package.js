/**
 * Fabric Studio — the pieces of a material package that are plain data: packing the baked maps, a glTF 2.0 binary (.glb) and a ZIP. No dependencies, no
 * browser calls: the page and the node tests both use it, so what is tested is what is written.
 *
 * window.KAPbr / module.exports:
 *   pack.albedo(coverRGBA, hex)            RGBA: the dye colour, alpha = opacity (255 where there is yarn)
 *   pack.gray(srcRGBA, channel)            RGBA grey from one channel of a map
 *   pack.roughness(aoRGBA, base)           RGBA grey: the base roughness, a little rougher in the cavities
 *   pack.orm(aoRGBA, roughRGBA)            R = occlusion, G = roughness, B = metallic (0), for glTF
 *   plane({ width_m, height_m, tile_cm })  a flat swatch whose UVs repeat the tile
 *   draped(mesh, tile_cm)                  the lattice of a draped sample (drape-engine.js) as triangles, UVs from the flat lattice
 *   glb(geometry, images, material, extras)  Uint8Array of a glTF 2.0 binary
 *   zip(files)                             Uint8Array of a ZIP (stored, no compression) from [{ name, bytes }]
 *   crc32(bytes)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.KAPbr = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── packing the maps (RGBA, top-down rows) ─────────────────────────────────────────────────────────
  function hexRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16) || 0; }); }
  var pack = {
    albedo: function (cover, hex) {
      var c = hexRgb(/^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#808080'), out = new Uint8ClampedArray(cover.length);
      for (var i = 0; i < cover.length; i += 4) { out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = cover[i] > 127 ? 255 : 0; }
      return out;
    },
    gray: function (src, ch) {
      var out = new Uint8ClampedArray(src.length), k = ch || 0;
      for (var i = 0; i < src.length; i += 4) { var v = src[i + k]; out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255; }
      return out;
    },
    // levels: the 2nd to the 99.5th percentile of one channel stretched to the full range (a height map sits mostly near the top)
    stretch: function (src, ch) {
      var k = ch || 0, hist = new Uint32Array(256), n = 0, i;
      for (i = 0; i < src.length; i += 4) { hist[src[i + k]]++; n++; }
      var lo = 0, hi = 255, acc = 0;
      for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
      acc = 0; for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.995) { hi = i; break; } }
      if (hi <= lo) { lo = 0; hi = 255; }
      var out = new Uint8ClampedArray(src.length);
      for (i = 0; i < src.length; i += 4) { var v = Math.max(0, Math.min(255, Math.round(((src[i + k] - lo) / (hi - lo)) * 255))); out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255; }
      return out;
    },
    roughness: function (ao, base) {
      var out = new Uint8ClampedArray(ao.length), b = Math.min(1, Math.max(0, base));
      for (var i = 0; i < ao.length; i += 4) { var r = Math.min(1, b + 0.14 * (1 - ao[i] / 255)); var v = Math.round(r * 255); out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255; }
      return out;
    },
    orm: function (ao, rough) {
      var out = new Uint8ClampedArray(ao.length);
      for (var i = 0; i < ao.length; i += 4) { out[i] = ao[i]; out[i + 1] = rough[i]; out[i + 2] = 0; out[i + 3] = 255; }
      return out;
    },
  };

  // ── geometry ───────────────────────────────────────────────────────────────────────────────────────
  function plane(o) {
    var w = o.width_m, h = o.height_m, tw = o.tile_cm.w / 100, th = o.tile_cm.h / 100, u = w / tw, v = h / th;
    return {
      positions: new Float32Array([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, v, u, v, u, 0, 0, 0]),                  // v runs down the image: the top row of a map is the top of the swatch
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
  }
  function draped(mesh, tile) {
    var n = mesh.x.length, id = {}, k, P = new Float32Array(n * 3), UV = new Float32Array(n * 2), N = new Float32Array(n * 3), tris = [];
    var h = mesh.h_cm;
    for (k = 0; k < n; k++) { id[mesh.i[k] + ',' + mesh.j[k]] = k; P[3 * k] = mesh.x[k] / 100; P[3 * k + 1] = mesh.z[k] / 100; P[3 * k + 2] = -mesh.y[k] / 100; UV[2 * k] = (mesh.i[k] * h) / tile.w; UV[2 * k + 1] = -(mesh.j[k] * h) / tile.h; }
    for (k = 0; k < n; k++) {
      var b = id[(mesh.i[k] + 1) + ',' + mesh.j[k]], c = id[(mesh.i[k] + 1) + ',' + (mesh.j[k] + 1)], d = id[mesh.i[k] + ',' + (mesh.j[k] + 1)];
      if (b == null || c == null || d == null) continue;
      tris.push(k, b, c, k, c, d);
    }
    // vertex normals from the faces (the cloth's Z is up in the lattice; glTF's Y is up: x → x, z → y, y → −z)
    for (var t = 0; t < tris.length; t += 3) {
      var a0 = tris[t], a1 = tris[t + 1], a2 = tris[t + 2];
      var ux = P[3 * a1] - P[3 * a0], uy = P[3 * a1 + 1] - P[3 * a0 + 1], uz = P[3 * a1 + 2] - P[3 * a0 + 2], vx = P[3 * a2] - P[3 * a0], vy = P[3 * a2 + 1] - P[3 * a0 + 1], vz = P[3 * a2 + 2] - P[3 * a0 + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      [a0, a1, a2].forEach(function (q) { N[3 * q] += nx; N[3 * q + 1] += ny; N[3 * q + 2] += nz; });
    }
    for (k = 0; k < n; k++) { var l = Math.hypot(N[3 * k], N[3 * k + 1], N[3 * k + 2]); if (l < 1e-12) { N[3 * k + 1] = 1; continue; } N[3 * k] /= l; N[3 * k + 1] /= l; N[3 * k + 2] /= l; }
    return { positions: P, normals: N, uvs: UV, indices: new Uint32Array(tris) };
  }

  // ── glTF 2.0 binary ────────────────────────────────────────────────────────────────────────────────
  var pad4 = function (n) { return (n + 3) & ~3; };
  function glb(geo, images, mat, extras) {
    var chunks = [], views = [], offset = 0;
    var add = function (bytes, target) { var o = offset; chunks.push({ o: o, bytes: bytes }); offset = pad4(offset + bytes.length); views.push({ buffer: 0, byteOffset: o, byteLength: bytes.length, ...(target ? { target: target } : {}) }); return views.length - 1; };
    var asBytes = function (a) { return new Uint8Array(a.buffer, a.byteOffset, a.byteLength); };
    var vP = add(asBytes(geo.positions), 34962), vN = add(asBytes(geo.normals), 34962), vU = add(asBytes(geo.uvs), 34962), vI = add(asBytes(geo.indices), 34963);
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < geo.positions.length; i += 3) for (var d = 0; d < 3; d++) { min[d] = Math.min(min[d], geo.positions[i + d]); max[d] = Math.max(max[d], geo.positions[i + d]); }
    var imgViews = images.map(function (im) { return add(im.bytes, null); });
    var nv = geo.positions.length / 3;
    var accessors = [
      { bufferView: vP, componentType: 5126, count: nv, type: 'VEC3', min: min, max: max },
      { bufferView: vN, componentType: 5126, count: nv, type: 'VEC3' },
      { bufferView: vU, componentType: 5126, count: nv, type: 'VEC2' },
      { bufferView: vI, componentType: 5125, count: geo.indices.length, type: 'SCALAR' },
    ];
    var byName = {}; images.forEach(function (im, k) { byName[im.name] = k; });
    var tex = function (name) { return { index: byName[name] }; };
    var m = mat || {};
    var material = {
      name: m.name || 'knit', doubleSided: m.double_sided !== false, alphaMode: m.alpha_mode || 'OPAQUE',
      pbrMetallicRoughness: { baseColorTexture: tex('albedo'), baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, metallicRoughnessTexture: tex('orm') },
      normalTexture: tex('normal'), occlusionTexture: tex('orm'),
    };
    if (material.alphaMode === 'MASK') material.alphaCutoff = m.alpha_cutoff != null ? m.alpha_cutoff : 0.5;
    var used = [];
    if (m.sheen) {
      var c = m.sheen_colour || [0.8, 0.8, 0.8];
      material.extensions = { KHR_materials_sheen: { sheenColorFactor: c, sheenRoughnessFactor: m.sheen.roughness != null ? m.sheen.roughness : 0.5 } };
      used.push('KHR_materials_sheen');
    }
    var json = {
      asset: { version: '2.0', generator: 'KnitAdvisor Fabric Studio' },
      scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: (m.name || 'knit') }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
      materials: [material],
      textures: images.map(function (_, k) { return { sampler: 0, source: k }; }),
      images: images.map(function (im, k) { return { bufferView: imgViews[k], mimeType: im.mime || 'image/png', name: im.name }; }),
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
      accessors: accessors, bufferViews: views, buffers: [{ byteLength: offset }],
    };
    if (used.length) json.extensionsUsed = used;
    if (extras) json.extras = extras;
    var jb = new TextEncoder().encode(JSON.stringify(json)), jl = pad4(jb.length), bl = offset, total = 12 + 8 + jl + 8 + bl;
    var out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jb, 20); for (var p = 20 + jb.length; p < 20 + jl; p++) out[p] = 0x20;
    var bo = 20 + jl; dv.setUint32(bo, bl, true); dv.setUint32(bo + 4, 0x004E4942, true);
    chunks.forEach(function (c2) { out.set(c2.bytes, bo + 8 + c2.o); });
    return out;
  }

  // ── ZIP, stored ────────────────────────────────────────────────────────────────────────────────────
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }());
  function crc32(bytes) { var c = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = (((d.getFullYear() - 1980) & 0x7F) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.bytes), size = f.bytes.length;
      var lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034B50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true); dv.setUint16(10, time, true); dv.setUint16(12, date, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true); dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true); lh.set(name, 30);
      parts.push(lh, f.bytes);
      var ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014B50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, time, true); cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
      central.push(ch);
      offset += lh.length + size;
    });
    var cdSize = central.reduce(function (t, c) { return t + c.length; }, 0);
    var end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054B50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    var all = parts.concat(central, [end]), total = all.reduce(function (t, p) { return t + p.length; }, 0), out = new Uint8Array(total), o = 0;
    all.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }

  // ── PNG, not premultiplied (a canvas would lose the colour under a transparent hole, and the edge of every hole would go dark) ──────────
  function encodePng(w, h, rgba) {
    var row = w * 4, raw = new Uint8Array((row + 1) * h);
    for (var y = 0; y < h; y++) { raw[y * (row + 1)] = 0; raw.set(rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1); }
    var cs = new CompressionStream('deflate');                       // zlib-wrapped deflate: what PNG's IDAT holds
    var wr = cs.writable.getWriter(); wr.write(raw); wr.close();
    return new Response(cs.readable).arrayBuffer().then(function (buf) {
      var z = new Uint8Array(buf);
      var chunk = function (type, data) {
        var out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer), t = new TextEncoder().encode(type);
        dv.setUint32(0, data.length); out.set(t, 4); out.set(data, 8);
        var body = new Uint8Array(4 + data.length); body.set(t, 0); body.set(data, 4); dv.setUint32(8 + data.length, crc32(body));
        return out;
      };
      var ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer); hv.setUint32(0, w); hv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
      var parts = [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
      var total = parts.reduce(function (t, p) { return t + p.length; }, 0), o = 0, res = new Uint8Array(total);
      parts.forEach(function (p) { res.set(p, o); o += p.length; });
      return res;
    });
  }

  return { pack: pack, plane: plane, draped: draped, glb: glb, zip: zip, crc32: crc32, encodePng: encodePng };
}));
