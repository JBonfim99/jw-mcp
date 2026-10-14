/**
 * jw.org study-Bible data: the JSON the jw.org Bible pages load for a whole
 * chapter (<books base>/json/data/BBCCC000-BBCCC999). It carries verse text
 * (poetry line by line), superscriptions, footnotes, structured cross
 * references, study notes, chapter outline, study-Bible media and video clips
 * ("pubReferences", with timestamps) for each verse.
 *
 * The Research Guide and the Publications Index are NOT in this JSON; those
 * still come from wol.jw.org (wol-scraper.js).
 */
import * as cheerio from 'cheerio';
import { getLocale } from './locale.js';
import { fetchJsonCached } from './wol-http.js';

const BOOKS_BASE = {
  pt: 'https://www.jw.org/pt/biblioteca/biblia/biblia-de-estudo/livros/',
  en: 'https://www.jw.org/en/library/bible/study-bible/books/',
  es: 'https://www.jw.org/es/biblioteca/biblia/biblia-estudio/libros/',
};

const pad = (n, w) => String(n).padStart(w, '0');
const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

/** Decode an HTML fragment to text ("Mateus&nbsp;6:33" -> "Mateus 6:33"). */
export function htmlToText(html) {
  const s = String(html ?? '');
  if (!/[<&]/.test(s)) return clean(s);
  return clean(cheerio.load(s, null, false).root().text());
}

export function chapterDataUrl(book, chapter, lang) {
  const loc = getLocale(lang);
  const base = BOOKS_BASE[loc.code];
  if (!base) throw new Error(`Bíblia de estudo em JSON não configurada para ${loc.code}`);
  const id = `${book}${pad(chapter, 3)}`;
  return `${base}json/data/${id}000-${id}999`;
}

/** Verse HTML -> text without verse number or +/* markers; poetry keeps one printed line per "\n". */
export function verseHtmlToText(html) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  $('sup.verseNum, .chapterNum, xref, fn').remove();
  const spans = $('span[class*="style-"]').toArray();
  if (!spans.length) return clean($.root().text());
  const poetry = spans.some((s) => /\bstyle-[lz]\b/.test($(s).attr('class') || ''));
  const lines = spans.map((s) => clean($(s).text())).filter(Boolean);
  return lines.join(poetry ? '\n' : ' ');
}

function verseOf(vsId, book, chapter) {
  const s = String(vsId || '');
  const prefix = `${book}${pad(chapter, 3)}`;
  if (!s.startsWith(prefix) || s.length !== prefix.length + 3) return null;
  return Number(s.slice(-3));
}

/** "40006001-40006004" or "40004023,40006002" -> verse numbers of this chapter. */
function versesInSource(source, book, chapter) {
  const out = new Set();
  for (const part of String(source || '').split(',')) {
    const [a, b] = part.split('-').map((x) => x.trim());
    const va = verseOf(a, book, chapter);
    const vb = b ? verseOf(b, book, chapter) : va;
    if (va == null && vb == null) continue;
    const start = va ?? 1;
    const end = vb ?? va;
    for (let v = start; v <= end && v - start < 200; v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

function rangeLabel(verses) {
  if (!verses.length) return null;
  const first = verses[0];
  const last = verses[verses.length - 1];
  return first === last ? `${first}` : `${first}-${last}`;
}

function parseClipUrl(url) {
  try {
    const u = new URL(url);
    const lank = u.searchParams.get('lank');
    const ts = u.searchParams.get('ts');
    let start = null;
    let end = null;
    if (ts) [start, end] = ts.split('-');
    return { video_id: lank, start, end };
  } catch {
    return { video_id: null, start: null, end: null };
  }
}

/** Parse the chapter JSON into per-verse structures. */
export function parseBibleChapterJson(json, book, chapter) {
  const range = Object.values(json?.ranges || {})[0];
  if (!range) throw new Error('JSON da Bíblia sem "ranges"');

  const verses = [];
  for (const v of range.verses || []) {
    const n = Number(v.verseNumber ?? verseOf(v.vsID, book, chapter));
    const text = verseHtmlToText(v.content);
    if (!Number.isFinite(n) || !text) continue;
    const prev = verses.find((x) => x.verse === n);
    if (prev) prev.text = `${prev.text}\n${text}`;
    else verses.push({ verse: n, text });
  }

  const superscription =
    (range.superscriptions || [])
      .filter((s) => verseOf(s.source, book, chapter) === 0)
      .map((s) => htmlToText(s.content))
      .join(' ') || null;

  const perVerse = () => new Map();
  const footnotes = perVerse();
  for (const f of range.footnotes || []) {
    const v = verseOf(f.source, book, chapter);
    if (v == null) continue;
    footnotes.set(v, [...(footnotes.get(v) || []), htmlToText(f.content)]);
  }

  const crossRefs = perVerse();
  for (const x of range.crossReferences || []) {
    const v = verseOf(x.source, book, chapter);
    if (v == null) continue;
    const targets = (x.targets || []).map((t) => htmlToText(t.standardCitation)).filter(Boolean);
    crossRefs.set(v, [...(crossRefs.get(v) || []), ...targets]);
  }

  const notes = perVerse();
  for (const c of range.commentaries || []) {
    const v = verseOf(c.source, book, chapter);
    if (v == null || !c.content) continue;
    const $ = cheerio.load(c.content, null, false);
    const paras = $('p')
      .toArray()
      .map((p) => clean($(p).text()))
      .filter(Boolean);
    notes.set(v, [...(notes.get(v) || []), ...(paras.length ? paras : [htmlToText(c.content)])]);
  }

  const outline = [];
  for (const o of range.chapterOutlines || []) {
    const $ = cheerio.load(o.content || '', null, false);
    $('li > p, p').each((_, p) => {
      const t = clean($(p).text());
      if (t && !outline.includes(t)) outline.push(t);
    });
  }

  const media = (range.multimedia || []).map((m) => {
    const vs = versesInSource(m.source, book, chapter);
    return {
      type: m.type || 'image',
      title: clean(m.label),
      caption: htmlToText(m.caption) || null,
      verses: vs,
      image_url: m.resource?.src || null,
    };
  });

  const videoClips = (range.pubReferences || [])
    .filter((p) => p.url)
    .map((p) => {
      const vs = versesInSource(p.source, book, chapter);
      const clip = parseClipUrl(p.url);
      return {
        title: htmlToText(p.content),
        verses: vs,
        type: p.type || 'video',
        video_id: clip.video_id,
        start: clip.start,
        end: clip.end,
        url: p.url,
      };
    });

  return {
    citation: htmlToText(range.citation),
    link: range.link || null,
    verses,
    superscription,
    footnotes,
    cross_references: crossRefs,
    study_notes: notes,
    outline,
    media,
    video_clips: videoClips,
  };
}

// The study-Bible JSON sits behind CloudFront. From some datacenter IPs a
// cache miss can take much longer than a browser would wait, while a hit is
// instant. So each chapter request keeps running in the background (up to
// BACKGROUND_TIMEOUT_MS) even after the tool gives up waiting (WAIT_MS) and
// falls back to wol.jw.org; the result lands in a long-lived cache, so the next
// call for that chapter is complete. Bible text is static: cache for 30 days.
const WAIT_MS = Number(process.env.JW_BIBLE_JSON_WAIT_MS) > 0 ? Number(process.env.JW_BIBLE_JSON_WAIT_MS) : 10000;
const BACKGROUND_TIMEOUT_MS = 120000;
const CHAPTER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHAPTER_CACHE_MAX = 600;

const chapterCache = new Map(); // key -> { at, value }
const inflight = new Map(); // key -> Promise

function cacheKey(book, chapter, lang) {
  return `${getLocale(lang).code}:${book}:${chapter}`;
}

function getCachedChapter(key) {
  const hit = chapterCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CHAPTER_TTL_MS) {
    chapterCache.delete(key);
    return null;
  }
  return hit.value;
}

function loadChapter(book, chapter, lang, key) {
  if (inflight.has(key)) return inflight.get(key);
  const url = chapterDataUrl(book, chapter, lang);
  const p = fetchJsonCached(url, { fresh: true, timeoutMs: BACKGROUND_TIMEOUT_MS, bare: true })
    .then((json) => {
      const value = { url, ...parseBibleChapterJson(json, book, chapter) };
      chapterCache.set(key, { at: Date.now(), value });
      while (chapterCache.size > CHAPTER_CACHE_MAX) chapterCache.delete(chapterCache.keys().next().value);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function fetchBibleChapter(book, chapter, lang, { fresh = false, waitMs = WAIT_MS } = {}) {
  const key = cacheKey(book, chapter, lang);
  if (!fresh) {
    const cached = getCachedChapter(key);
    if (cached) return cached;
  }
  const p = loadChapter(book, chapter, lang, key);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('o jw.org ainda está carregando este capítulo (continua em segundo plano; peça de novo em ~30 s para vir completo)')),
      waitMs
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Start loading chapters in the background (e.g. all texts of this week's meetings). */
export function prewarmChapters(list, lang, { concurrency = 2 } = {}) {
  const queue = [];
  const seen = new Set();
  for (const { book, chapter } of list) {
    const key = cacheKey(book, chapter, lang);
    if (seen.has(key) || getCachedChapter(key) || inflight.has(key)) continue;
    seen.add(key);
    queue.push({ book, chapter, key });
  }
  let running = 0;
  const next = () => {
    while (running < concurrency && queue.length) {
      const { book, chapter, key } = queue.shift();
      running++;
      loadChapter(book, chapter, lang, key)
        .catch((e) => console.error(`[bible-json] prewarm ${key}: ${e.message}`))
        .finally(() => {
          running--;
          next();
        });
    }
  };
  next();
  return queue.length + running;
}

/** Helpers to slice per-verse maps / lists to a verse range. */
export function sliceByVerse(map, start, end) {
  const out = {};
  for (const [v, list] of map) if (v >= start && v <= end && list.length) out[v] = list;
  return out;
}

export function itemsTouching(list, start, end) {
  return list
    .filter((m) => m.verses.some((v) => v >= start && v <= end))
    .map(({ verses, ...rest }) => ({ ...rest, verses: rangeLabel(verses) }));
}
