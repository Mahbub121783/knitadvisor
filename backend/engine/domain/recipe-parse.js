// One work-order row of the mill's R&D sheet → a recipe record. Columns of "MAIN DATA":
//  0 process · 2 fabric type (standard name) · 4/5, 6/7, 8/9 count and fibre of up to three spun yarns
//  10/11 filament denier and material · 12/13 elastane denier and feeder · 16 colour · 17 GSM · 18 dia × gauge
//  19 stitch length(s): one, or face / loop, or face / binder / loop (mm).
'use strict';

const cell = (row, j) => (row[j] == null ? '' : String(row[j]).trim());

/** "30/1" → { ne: 30, ply: 1 } ("60/2" is two ends of 60s) */
function readCount(s) {
  const m = String(s).match(/^\(?\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  if (!m) return null;
  const ne = +m[1], ply = +m[2];
  return ply >= 1 && ply <= 4 && ne >= 5 && ne <= 100 ? { ne, ply } : null;
}

/** a yarn's fibre shares (%) and spinning style from its name on the sheet */
function readYarnName(name) {
  const u = String(name || '').toUpperCase();
  let mix = null, m;
  if ((m = u.match(/PCV\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/))) mix = { polyester: +m[1], cotton: +m[2], viscose: +m[3] };
  else if ((m = u.match(/CVC\s*(\d+)\s*\/\s*(\d+)/))) mix = { cotton: +m[1], polyester: +m[2] };
  else if ((m = u.match(/PC\s*(\d+)\s*\/\s*(\d+)/))) mix = { polyester: +m[1], cotton: +m[2] };
  else if ((m = u.match(/PV\s*(\d+)\s*\/\s*(\d+)/))) mix = { polyester: +m[1], viscose: +m[2] };
  else if ((m = u.match(/MODAL\s*(\d+)\s*\/\s*(\d+)/))) mix = { cotton: +m[1], modal: +m[2] };
  else if (/MODAL/.test(u)) mix = { modal: 100 };
  else if (/VISCOSE|BAMBOO|TENCEL|LYOCELL/.test(u)) mix = { viscose: 100 };
  else if (/SPUN\s*POLY|^POLYESTER/.test(u)) mix = { polyester: 100 };
  else mix = { cotton: 100 };                     // combed, carded, compact, melange, slub, recycled, organic cotton
  const style = /MELAN|MAEL|HUAFU|\bGM\d/.test(u) ? 'melange' : /\bKC\b|CARDED/.test(u) ? 'carded' : /ROTOR/.test(u) ? 'rotor' : 'combed';
  return { mix, style, slub: /SLUB|INJECT/.test(u) };
}

/** the fabric type of the sheet → the cloth it is (key) and its variants */
function readCloth(std) {
  const u = String(std || '').toLowerCase();
  if (!u) return null;
  if (/collar|cuff|tape|drawstring|binding|neck/.test(u)) return null;
  const flags = {
    el: /elastane|lycra|spandex/.test(u), half: /half feeder/.test(u), yd: /yarn dyed/.test(u),
    stripe: /stripe/.test(u), slub: /slub/.test(u), flat: /flat knit/.test(u),
  };
  let base = null, m;
  if (/fleece \(brushed back\) 2-tuck|diagonal fleece|fleece \(loop back\)|fleece/.test(u)) base = /diagonal/.test(u) ? 'fleece_diagonal' : /loop back/.test(u) ? 'fleece_loopback' : /brushed/.test(u) ? 'fleece_brushed' : 'fleece_other';
  else if (/^terry \(loop back\)/.test(u)) base = 'terry_2t';
  else if (/ponte/.test(u)) base = 'ponte_di_roma';
  else if (/^interlock(?! pique)/.test(u)) base = 'interlock';
  else if (/^single lacoste/.test(u)) base = 'lacoste_single';
  else if (/^pique/.test(u)) base = 'pique';
  else if ((m = u.match(/^(\d)x(\d)\s*(flat knit )?rib/))) base = `rib_${m[1]}x${m[2]}`;
  else if (/^heavy jersey/.test(u)) base = 'heavy_jersey';
  else if (/^plated jersey/.test(u)) base = 'plated_jersey';
  else if (/^single jersey/.test(u)) base = 'single_jersey';
  else if (/waffle/.test(u)) base = /missed/.test(u) ? 'waffle_miss' : /tuck cam/.test(u) ? 'waffle_tuck' : 'waffle_fancy';
  else base = u.replace(/\s*(with elastane|\(full feeder\)|\(half feeder\)|\(yarn dyed\)|engineered|stripe|slub)\s*/g, ' ').trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { base, ...flags };
}

function readRow(row) {
  const cloth = readCloth(cell(row, 2));
  if (!cloth) return { skip: 'cloth' };
  const gm = cell(row, 17).match(/^\s*(\d{2,3})(?!\d)/);
  const gsm = gm && +gm[1] >= 70 && +gm[1] <= 700 ? +gm[1] : null;
  if (!gsm) return { skip: 'no_gsm' };
  const yarns = [];
  for (const [a, b] of [[4, 5], [6, 7], [8, 9]]) {
    const c = readCount(cell(row, a));
    if (c) { const f = readYarnName(cell(row, b)); yarns.push({ ...c, mix: f.mix, style: f.style, ...(f.slub ? { slub: true } : {}) }); }
  }
  const filRaw = cell(row, 10).match(/^(\d+)\s*D(?:\s*\/\s*(\d+)\s*F)?/i);
  const fil = filRaw ? { d: +filRaw[1], f: filRaw[2] ? +filRaw[2] : null, mat: /nylon/i.test(cell(row, 11)) ? 'nylon' : /sewing|spun/i.test(cell(row, 11)) ? 'spun polyester' : 'polyester' } : null;
  if (!yarns.length && !fil) return { skip: 'no_count' };
  const elm = cell(row, 12).match(/^(\d+)\s*D/i);
  const el = elm ? +elm[1] : null;
  const mc = cell(row, 18).match(/^\s*(\d{2})\s*[xX*]\s*(\d{1,2})\s*$/);
  const dia = mc && +mc[1] >= 10 && +mc[1] <= 48 ? +mc[1] : null;
  const g = mc && +mc[2] >= 5 && +mc[2] <= 44 ? +mc[2] : null;
  const parts = cell(row, 19).split(/[/+&,]/).map((p) => p.trim()).filter(Boolean).map(Number);
  const sl = parts.length && parts.every((v) => v >= 0.5 && v <= 12) ? parts : [];
  const col = cell(row, 16).toUpperCase();
  const colour = col === 'WHITE' || col === 'RFD' ? 'white' : col === 'GM' || yarns.some((y) => y.style === 'melange') ? 'melange' : col === 'YD' || cloth.yd ? 'yd' : 'other';
  return { rec: { cloth: cloth.base, el_cloth: cloth.el, half: cloth.half, yd: cloth.yd, stripe: cloth.stripe, slub: cloth.slub || yarns.some((y) => y.slub), flat: cloth.flat, yarns, fil, el, colour, gsm, dia, g, sl } };
}

module.exports = { readRow, readCloth, readCount, readYarnName };
