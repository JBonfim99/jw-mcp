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
  const readRe = new RegExp(`(?:^|[\\s(—–-])(?:${readWords.join('|')})\\W*$`, 'i');

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
