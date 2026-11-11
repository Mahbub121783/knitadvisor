/**
 * No outside source is named in what the API sends.
 *
 * KnitAdvisor's engines are built on books, papers and sites; the knowledge stays inside — no author, book,
 * page reference or source site reaches a visitor or an API customer. Each engine is meant to say "measured",
 * "law", "typical" in its own words; this is the net under them, so a citation left in an engine (or added
 * tomorrow) never gets out:
 *
 *   citation keys     source / sources / citation(s) / reference(s) / author(s) / book / book_page / *_source …
 *                     are dropped when what they hold is a citation (a name, a year in brackets, a table or a
 *                     page) — a key like `source: { feed: 1 }` or `sl_source: 'your setting'` is not one, and stays
 *   names in text     the specific citations the engines use are replaced by plain words ("published fibre-property
 *                     tables", "the knitting literature" …), and "Page 354 states:" falls away
 *   source sites      links to the sites the knowledge was gathered from are removed
 *
 * It matches citations, never bare surnames, so a mill or a person called Chowdhury, or a colour called
 * Starfish, is left alone.
 */
'use strict';

const NAME = /Morton|Hearle|Munden|Postle|Gokarneshan|Spencer|Peirce|Knapton|Adderley|Beste|Hoffman|Understanding Textile|Marchandiser|textile ?learner|Heap\/Starfish|Doyle|Eltahan|GardenTex/i;
const CITATION = new RegExp(`${NAME.source}|\\(\\s*(?:19|20)\\d{2}\\s*\\)|\\bTables?\\s+\\d|\\bp\\.\\s?\\d|\\bpages?\\s+\\d|\\bedn\\b|https?:\\/\\/`, 'i');
const KEY = /^(?:sources?|citations?|references?|authors?|book|book_page|pages?|table|tables)$|_source$|^source_/;

const PHRASES = [
  [/\bW\.\s?E\.\s?Morton and J\.\s?W\.\s?S\.\s?Hearle\b/g, ''],
  [/\bMorton\s*(?:&|and)\s*Hearle\b(?:,?\s*Physical Properties of Textile Fibres)?(?:,?\s*4th edn)?(?:\s*\(\d{4}\))?(?:,?\s*(?:Tables?|Fig\.?)\s*[\d.]+(?:\s*(?:\(p\.\s?\d+\)))?(?:\s*(?:and|&)\s*[\d.]+(?:\s*\(p\.\s?\d+\))?)?)?(?:,?\s*p\.\s?\d+)?/g, 'published fibre-property tables'],
  [/\b(?:John\s+|William\s+)?(?:[A-Z]\.\s?){1,3}(?:Morton|Hearle)\b/g, ''],
  [/\b(?:Morton|Hearle)\b/g, ''],
  [/\bMunden(?:\s*\(\d{4}\))?(?:['’]s)?\s+/g, 'published '],
  [/\bMunden(?:\s*\(\d{4}\))?/g, 'published values'],
  [/\bPostle\b/g, 'published'],
  [/\bHeap\/Starfish relaxation DB\b/g, 'relaxation data'],
  [/\bGokarneshan\b(?:,?\s*Fabric Structure and Design)?(?:\s*\(\d{4}\))?(?:,?\s*p\.\s?\d+)?/g, 'a published structure reference'],
  [/\bSpencer\b(?:,?\s*Knitting Technology)?(?:\s*\(\d{4}\))?(?:,?\s*(?:eq\.|Table|Fig\.?|p\.)\s*[\d.]+)?/g, 'the knitting literature'],
  [/\*?Understanding Textile for Marchandiser\*?(?:\s*\(Chapter \d+\))?(?:,?\s*(?:p\.|pp\.|page)\s*[\d–-]+)?/gi, 'the merchandising reference'],
  [/\bPeirce(?:['’]s)?\b/g, 'the classic'],
  [/\b(?:Adderley|Beste and Hoffman|Knapton)\b/g, 'a published study'],
  [/https?:\/\/(?:www\.)?textilelearner\.net\S*/gi, ''],
  [/\btextile ?learner(?:\.net)?\b/gi, 'a public reference'],
  [/\b[Pp]ages?\s+\d+(?:\s*[-–&]\s*\d+)?\s+(?:states|shows|says|notes|explains|lists|gives)[:,]?\s*/g, ''],
];

function cleanText(s) {
  if (typeof s !== 'string' || !NAME.test(s) && !/[Pp]ages?\s+\d+\s+(?:states|shows|says|notes|explains|lists|gives)/.test(s)) return s;
  let t = s;
  for (const [re, by] of PHRASES) t = t.replace(re, by);
  return t.replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/^\s*[;,]\s*/, '').trim();
}
/** Is this key, holding this value, a citation? A page number only beside a book's table; a pagination `page: 3` is not. */
function dropKey(k, x, parent) {
  if (!KEY.test(k)) return false;
  if (k === 'book_page') return true;
  if (k === 'page' || k === 'pages') return typeof x === 'number' ? typeof parent.table === 'string' && /^Tables?\s/.test(parent.table) : typeof x === 'string' && (/^\s*\d+(?:\s*[-–,]\s*\d+)*\s*$/.test(x) || CITATION.test(x));
  if (k === 'table' || k === 'tables') return typeof x === 'string' && /^(?:Tables?\s|Fig)/.test(x);
  if (typeof x === 'string') return CITATION.test(x);
  if (Array.isArray(x)) return x.length > 0 && x.every((s) => typeof s === 'string' && CITATION.test(s));
  return false;
}

/** The value with every citation taken out — a new value; the original is not touched. */
function scrub(v, depth = 0) {
  if (depth > 40 || v == null) return v;
  if (typeof v === 'string') return cleanText(v);
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  if (typeof v !== 'object' || v instanceof Date || Buffer.isBuffer(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (dropKey(k, x, v)) continue;
    out[k] = scrub(x, depth + 1);
  }
  return out;
}

/** Express: every JSON answer under /api passes through scrub(). */
function middleware(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(scrub(body));
  next();
}

module.exports = { scrub, cleanText, middleware, NAME };
