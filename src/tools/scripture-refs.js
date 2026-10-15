/**
 * Parse scripture citations as they appear in WOL documents
 * ("Mateus 6:31, 32", "1 Tim. 6:6-8", "EFÉ. 6:12", "Mt 5:20", " 13-15") into
 * book/chapter/verse structures, so we can find which paragraphs of an article
 * discuss a given verse.
 */
import { BIBLE_BOOKS, BOOK_ABBREVIATIONS } from './bible-books.js';
import { absUrl } from './locale.js';

// [number, full name, WOL abbreviation, official abbreviation] — from wol.jw.org/pt/wol/binav
const BOOKS_PT = [
  [1, 'Gênesis', 'Gên.', 'Gên'], [2, 'Êxodo', 'Êxo.', 'Êx'], [3, 'Levítico', 'Lev.', 'Le'], [4, 'Números', 'Núm.', 'Núm'],
  [5, 'Deuteronômio', 'Deut.', 'De'], [6, 'Josué', 'Jos.', 'Jos'], [7, 'Juízes', 'Juí.', 'Jz'], [8, 'Rute', 'Rute', 'Ru'],
  [9, '1 Samuel', '1 Sam.', '1Sa'], [10, '2 Samuel', '2 Sam.', '2Sa'], [11, '1 Reis', '1 Reis', '1Rs'], [12, '2 Reis', '2 Reis', '2Rs'],
  [13, '1 Crônicas', '1 Crô.', '1Cr'], [14, '2 Crônicas', '2 Crô.', '2Cr'], [15, 'Esdras', 'Esd.', 'Esd'], [16, 'Neemias', 'Nee.', 'Ne'],
  [17, 'Ester', 'Ester', 'Est'], [18, 'Jó', 'Jó', 'Jó'], [19, 'Salmos', 'Sal.', 'Sal'], [20, 'Provérbios', 'Pro.', 'Pr'],
  [21, 'Eclesiastes', 'Ecl.', 'Ec'], [22, 'Cântico de Salomão', 'Cân.', 'Cân'], [23, 'Isaías', 'Isa.', 'Is'], [24, 'Jeremias', 'Jer.', 'Je'],
  [25, 'Lamentações', 'Lam.', 'La'], [26, 'Ezequiel', 'Eze.', 'Ez'], [27, 'Daniel', 'Dan.', 'Da'], [28, 'Oseias', 'Ose.', 'Os'],
  [29, 'Joel', 'Joel', 'Jl'], [30, 'Amós', 'Amós', 'Am'], [31, 'Obadias', 'Obd.', 'Ob'], [32, 'Jonas', 'Jonas', 'Jon'],
  [33, 'Miqueias', 'Miq.', 'Miq'], [34, 'Naum', 'Naum', 'Na'], [35, 'Habacuque', 'Hab.', 'Hab'], [36, 'Sofonias', 'Sof.', 'Sof'],
  [37, 'Ageu', 'Ageu', 'Ag'], [38, 'Zacarias', 'Zac.', 'Za'], [39, 'Malaquias', 'Mal.', 'Mal'], [40, 'Mateus', 'Mat.', 'Mt'],
  [41, 'Marcos', 'Mar.', 'Mr'], [42, 'Lucas', 'Luc.', 'Lu'], [43, 'João', 'João', 'Jo'], [44, 'Atos', 'Atos', 'At'],
  [45, 'Romanos', 'Rom.', 'Ro'], [46, '1 Coríntios', '1 Cor.', '1Co'], [47, '2 Coríntios', '2 Cor.', '2Co'], [48, 'Gálatas', 'Gál.', 'Gál'],
  [49, 'Efésios', 'Efé.', 'Ef'], [50, 'Filipenses', 'Fil.', 'Fil'], [51, 'Colossenses', 'Col.', 'Col'], [52, '1 Tessalonicenses', '1 Tes.', '1Te'],
  [53, '2 Tessalonicenses', '2 Tes.', '2Te'], [54, '1 Timóteo', '1 Tim.', '1Ti'], [55, '2 Timóteo', '2 Tim.', '2Ti'], [56, 'Tito', 'Tito', 'Tit'],
  [57, 'Filêmon', 'Filêm.', 'Flm'], [58, 'Hebreus', 'Heb.', 'He'], [59, 'Tiago', 'Tia.', 'Tg'], [60, '1 Pedro', '1 Ped.', '1Pe'],
  [61, '2 Pedro', '2 Ped.', '2Pe'], [62, '1 João', '1 João', '1Jo'], [63, '2 João', '2 João', '2Jo'], [64, '3 João', '3 João', '3Jo'],
  [65, 'Judas', 'Judas', 'Ju'], [66, 'Apocalipse', 'Apo.', 'Ap'],
];

// Other ways people write book names in Portuguese (Almeida-style symbols,
// singular forms, older spellings). Typed by users, not used by WOL itself.
const PT_ALIASES = [
  [1, 'Gn', 'Gen'], [2, 'Ex', 'Êxodo'], [3, 'Lv'], [4, 'Nm'], [5, 'Dt'], [6, 'Js'], [7, 'Jz'], [8, 'Rt'],
  [9, '1Sm'], [10, '2Sm'], [11, '1Re'], [12, '2Re'], [13, '1Cr'], [14, '2Cr'], [15, 'Ed'], [16, 'Ne'], [17, 'Et'],
  [19, 'Sl', 'Slm', 'Salmo'], [20, 'Pv', 'Prov', 'Provérbio'], [21, 'Ecles'],
  [22, 'Ct', 'Cânticos', 'Cântico', 'Cantares', 'Cântico dos Cânticos', 'Cânticos de Salomão', 'Cantares de Salomão'],
  [24, 'Jr'], [25, 'Lm'], [27, 'Dn'], [28, 'Oséias'], [31, 'Abdias', 'Abd'], [33, 'Mq', 'Miquéias'], [35, 'Hc'],
  [36, 'Sf'], [38, 'Zc'], [39, 'Ml'], [41, 'Mc'], [42, 'Lc'], [44, 'Atos dos Apóstolos'], [45, 'Rm'], [48, 'Gl'],
  [50, 'Fp', 'Flp'], [51, 'Cl'], [52, '1Ts'], [53, '2Ts'], [54, '1Tm'], [55, '2Tm'], [56, 'Tt'], [57, 'Fm', 'Flm'],
  [58, 'Hb'], [60, '1Pd'], [61, '2Pd'], [65, 'Jd'], [66, 'Apoc', 'Revelação'],
];

export function bookNamePt(num) {
  return BOOKS_PT[num - 1]?.[1] || null;
}

export function normKey(s, { stripAccents = true } = {}) {
  let t = String(s).normalize('NFC');
  if (stripAccents) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildIndex(stripAccents) {
  const index = new Map();
  const add = (name, num) => {
    const k = normKey(name, { stripAccents });
    if (!k) return;
    if (!index.has(k)) index.set(k, num);
    const compact = k.replace(/\s+/g, '');
    if (!index.has(compact)) index.set(compact, num);
  };
  // Portuguese first: on collisions PT wins. Within PT, official symbols
  // ("Jo" = João) are registered before full names ("Jó") so the
  // accent-insensitive index keeps the more common reading.
  for (const [num, , , official] of BOOKS_PT) add(official, num);
  for (const [num, full, abbr] of BOOKS_PT) {
    add(full, num);
    add(abbr, num);
  }
  for (const [num, ...names] of PT_ALIASES) names.forEach((n) => add(n, num));
  for (const [num, name] of Object.entries(BIBLE_BOOKS)) add(name, Number(num));
  for (const [abbr, num] of Object.entries(BOOK_ABBREVIATIONS)) add(abbr, num);
  return index;
}

// Exact (accent-aware) index first, accent-insensitive as fallback:
// "Jó 6:2" -> Jó (18), "Jo 6:27" -> João (43), "EFÉ." / "EFE." -> Efésios.
const EXACT_INDEX = buildIndex(false);
const LOOSE_INDEX = buildIndex(true);

export function lookupBook(name) {
  for (const [index, strip] of [[EXACT_INDEX, false], [LOOSE_INDEX, true]]) {
    const k = normKey(name, { stripAccents: strip });
    const hit = index.get(k) ?? index.get(k.replace(/\s+/g, ''));
    if (hit) return hit;
  }
  return null;
}

// Full names (PT + EN), accent-stripped and without spaces, for prefix matching.
const PREFIX_NAMES = [
  ...BOOKS_PT.map(([num, full]) => [num, full]),
  ...PT_ALIASES.flatMap(([num, ...names]) => names.filter((n) => n.length > 3).map((n) => [num, n])),
  ...Object.entries(BIBLE_BOOKS).map(([num, name]) => [Number(num), name]),
].map(([num, name]) => [num, normKey(name).replace(/\s+/g, '')]);

/**
 * Book lookup for text typed by people: exact symbols/names first, then an
 * unambiguous prefix of a full name ("apoc", "lament", "1 corin", "salm").
 */
export function lookupBookLoose(name) {
  const exact = lookupBook(name);
  if (exact) return exact;
  const k = normKey(name).replace(/\s+/g, '');
  if (k.replace(/^\d/, '').length < 3) return null;
  const hits = new Set(PREFIX_NAMES.filter(([, n]) => n.startsWith(k)).map(([num]) => num));
  return hits.size === 1 ? [...hits][0] : null;
}

/** "I Pedro", "1ª Pedro", "primeira Pedro", "II Cor." -> "1 Pedro", "2 Cor." */
function normalizeOrdinal(s) {
  const m = s.match(/^\s*(primeir[oa]|segund[oa]|terceir[oa]|iii|ii|i|[123])\s*[ºª°]?(?:[oa](?=[\s.]))?\.?\s*(?=[a-zà-ÿ])/i);
  if (!m) return s;
  const w = m[1].toLowerCase();
  const n = /^(primeir|i$|1)/.test(w) ? 1 : /^(segund|ii$|2)/.test(w) ? 2 : 3;
  // "I" / "II" / "III" only count as numbers when followed by a space ("Is 41:10" is Isaías).
  if (/^i+$/.test(w) && !/^\s*i+\s/i.test(s)) return s;
  return `${n} ${s.slice(m[0].length)}`;
}

/**
 * Parse a reference typed by a person, tolerant to the many ways it gets
 * written: "Sal. 46:2", "Salmo 46:2", "salmos 46 2", "Sl 46.2", "salmo 46,2",
 * "Salmo 46 versículo 2", "Sal 46:2 e 3", "Sal 46:2 a 4", "1ª Pedro 5:7",
 * "I Coríntios 13:4", "apoc 21 4", "Salmo 23" (whole chapter).
 */
export function parseReferenceInput(raw) {
  const original = String(raw ?? '').replace(/\u00a0/g, ' ').trim();
  if (!original) return null;
  // Several citations ("Sal. 46:2; Mt 6:33"): use the first one.
  if (original.includes(';')) return parseReferenceInput(original.split(';')[0]);
  const direct = parseCitation(original);
  if (direct) return direct;

  let s = normalizeOrdinal(original.normalize('NFC'));
  const m = s.match(/^(\d?\s*[^\d]+?)\s*(\d+)(.*)$/);
  if (!m) return null;
  const bookText = m[1].replace(/[\s,.:;]*(?:cap[ií]tulo|cap)\.?\s*$/i, '').replace(/[\s,.:;]+$/, '');
  const book = lookupBookLoose(bookText);
  if (!book) return null;
  const chapter = Number(m[2]);

  let rest = m[3]
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/(\d)[a-d]\b/g, '$1') // "2a" (first half of a verse)
    .replace(/\b(?:vers[ií]culos?|vers|vv?|ver)\b\.?/g, ':')
    .replace(/\s+(?:a|at[eé])\s+/g, '-')
    .replace(/\s+e\s+/g, ',')
    .trim();
  // Chapter range: "Salmos 46-48", "Jer 40 a 41" (no verse separator).
  const chapterRange = rest.match(/^-\s*(\d+)$/);
  if (chapterRange) return { book, chapter, chapter_end: Number(chapterRange[1]), ranges: null };
  if (!rest) return { book, chapter, chapter_end: null, ranges: null };
  // Separator between chapter and verses: ":", ".", "," or just a space.
  const vm = rest.match(/^(?:[,.]?\s*:?\s*)(\d[\d\s,.\-]*)$/);
  if (!vm) return null;
  const ranges = parseVerseList(vm[1].replace(/\./g, ',').replace(/(\d)\s+(?=\d)/g, '$1,'));
  if (!ranges.length) return null;
  return { book, chapter, chapter_end: null, ranges };
}

function parseVerseList(str) {
  const ranges = [];
  for (const part of str.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    ranges.push([Math.min(a, b), Math.max(a, b)]);
  }
  return ranges;
}

function rangesToString(ranges) {
  return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

/**
 * Parse one citation. `prev` is the previous citation in the same paragraph,
 * used for continuations like " 13-15" (same chapter) or "7:2" (same book).
 * Returns { book, chapter, chapter_end, ranges } or null.
 */
export function parseCitation(raw, prev = null) {
  const text = String(raw)
    .replace(/ /g, ' ')
    .replace(/\+/g, '')
    .replace(/[;.,\s]+$/, '')
    .replace(/^[\s,;]+/, '')
    .trim();
  if (!text) return null;

  let m = text.match(/^(.*?\D)\s*(\d+):(\d[\d\s,–-]*)$/);
  if (m) {
    const book = lookupBook(m[1]);
    if (book) return { book, chapter: Number(m[2]), chapter_end: null, ranges: parseVerseList(m[3]) };
  }

  m = text.match(/^(\d+):(\d[\d\s,–-]*)$/);
  if (m && prev) return { book: prev.book, chapter: Number(m[1]), chapter_end: null, ranges: parseVerseList(m[2]) };

  m = text.match(/^\d[\d\s,–-]*$/);
  if (m && prev && prev.ranges) return { book: prev.book, chapter: prev.chapter, chapter_end: null, ranges: parseVerseList(text) };

  // Whole chapter(s): "JEREMIAS 40-41", "Salmo 23"
  m = text.match(/^(.*?\D)\s*(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (m) {
    const book = lookupBook(m[1].replace(/^salmo$/i, 'Salmos'));
    if (book) return { book, chapter: Number(m[2]), chapter_end: m[3] ? Number(m[3]) : null, ranges: null };
  }
  return null;
}

/** Does a parsed citation include book/chapter/verse? (verse optional) */
export function citationIncludes(c, book, chapter, verse) {
  if (!c || c.book !== book) return false;
  if (!c.ranges) {
    const end = c.chapter_end ?? c.chapter;
    return chapter >= c.chapter && chapter <= end;
  }
  if (c.chapter !== chapter) return false;
  if (verse == null) return true;
  return c.ranges.some(([a, b]) => verse >= a && verse <= b);
}

export function formatCitation(c, lang = 'pt') {
  if (!c) return null;
  const name = lang === 'pt' ? bookNamePt(c.book) : BIBLE_BOOKS[c.book];
  if (!c.ranges) return `${name} ${c.chapter}${c.chapter_end ? `-${c.chapter_end}` : ''}`;
  return `${name} ${c.chapter}:${rangesToString(c.ranges)}`;
}

/**
 * Extract all scripture links (a.b) inside a cheerio element.
 * `readWords` marks citations preceded by "Leia"/"Read" (texts read aloud).
 */
export function extractScriptures($, el, { readWords = ['leia', 'read', 'lea'], lang = 'pt' } = {}) {
  const out = [];
  let prev = null;
  const readRe = new RegExp(`(?:^|[^a-zà-ÿ])(?:${readWords.join('|')})\\W*$`, 'i');

  $(el)
    .find('a.b')
    .each((_, a) => {
      const label = $(a).text().replace(/ /g, ' ').trim();
      if (!label || label === '+') return;
      const parsed = parseCitation(label, prev);
      if (parsed) prev = parsed;

      let before = '';
      let node = a.prev;
      while (node && before.trim().length < 12) {
        before = $(node).text() + before;
        node = node.prev;
      }
      if (!before.trim()) {
        // "Leia" may be the last text of the parent <strong> (e.g. <strong>(Leia</strong><a>)
        const parentPrev = a.parent && a.parent.name === 'strong' ? a.parent.prev : null;
        if (parentPrev) before = $(parentPrev).text();
      }

      out.push({
        text: label.replace(/[;,]\s*$/, ''),
        reference: parsed ? formatCitation(parsed, lang) : null,
        book: parsed?.book ?? null,
        chapter: parsed?.chapter ?? null,
        verses: parsed?.ranges ? rangesToString(parsed.ranges) : null,
        read: readRe.test(before.replace(/ /g, ' ')),
        url: absUrl($(a).attr('href')),
        _parsed: parsed,
      });
    });
  return out;
}

/** Remove internal fields before serializing. */
export function publicScriptures(list) {
  return list.map(({ _parsed, url, ...rest }) => rest);
}
