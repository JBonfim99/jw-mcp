/**
 * WOL (Watchtower Online Library) Bible scraper
 * Fetches and parses Bible study content (study notes, Research Guide,
 * Publications Index, cross references) from wol.jw.org in several languages.
 */

import * as cheerio from 'cheerio';
import { getBookName } from './bible-books.js';
import { bookNamePt } from './scripture-refs.js';
import { getLocale, wolUrl, absUrl } from './locale.js';
import { fetchWolHtml } from './wol-http.js';

const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** Pull a 4-digit year out of a Research Guide title ("A Sentinela, 15/9/2015, pp. 24-25"). */
function extractYear(title) {
  const years = [...String(title).matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  return years.length ? years[years.length - 1] : null;
}

function classifyPublication(title) {
  const t = title.toLowerCase();
  if (/sentinela|watchtower|atalaya/.test(t)) return 'watchtower';
  if (/despertai|awake|despertad/.test(t)) return 'awake';
  if (/perspicaz|insight|perspicacia/.test(t)) return 'insight';
  if (/textos bíblicos explicados|bible verses explained|textos bíblicos explicados/.test(t)) return 'bible_verses_explained';
  return 'publication';
}

export function parseChapterHtml(html, bookNum, chapterNum, loc) {
  const $ = cheerio.load(html);

  // ---- verses (a verse may be split across several span.v parts) ----
  const verseMap = new Map();
  $('span.v').each((_, elem) => {
    const id = $(elem).attr('id') || '';
    const m = id.match(/^v(\d+)-(\d+)-(\d+)/);
    if (!m || Number(m[1]) !== bookNum || Number(m[2]) !== chapterNum) return;
    const verse = Number(m[3]);
    const c = $(elem).clone();
    c.find('a.b, a.vl, a.cl, sup, .tt').remove();
    const text = clean(c.text()).replace(/^\d+\s+/, '');
    if (!text) return;
    verseMap.set(verse, verseMap.has(verse) ? `${verseMap.get(verse)} ${text}` : text);
  });
  const verses = [...verseMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([verse_num, verse_text]) => ({
      book_num: bookNum,
      book_name: loc.code === 'pt' ? bookNamePt(bookNum) : getBookName(bookNum),
      chapter: chapterNum,
      verse_num,
      verse_text,
    }));

  // ---- per-verse study sections ----
  const sections = {};
  $('div.section[data-key]').each((_, section) => {
    const parts = ($(section).attr('data-key') || '').split('-').map(Number);
    if (parts.length < 3 || parts[0] !== bookNum || parts[1] !== chapterNum || Number.isNaN(parts[2])) return;
    const verse = parts[2];

    const study_notes = [];
    $(section)
      .find('li.item.studyNote')
      .each((__, note) => {
        $(note)
          .find('p')
          .each((___, p) => {
            const t = clean($(p).text());
            if (t) study_notes.push(t);
          });
      });

    const cross_references = [];
    $(section)
      .find('li.item.marginal .marginal.title, li.item.marginal .title')
      .first()
      .each((__, el) => {
        clean($(el).text())
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s && s !== '+')
          .forEach((s) => cross_references.push(s));
      });

    const research_guide = [];
    $(section)
      .find('li.item.ref-rsg')
      .each((__, item) => extractResearchGuide($, item, research_guide));

    const publication_index = [];
    const publication_index_unlinked = [];
    $(section)
      .find('li.item.ref-dx')
      .each((__, item) => extractPublicationIndex($, item, publication_index, publication_index_unlinked));

    sections[verse] = { study_notes, cross_references, research_guide, publication_index, publication_index_unlinked };
  });

  const outline = [];
  $('#studyDiscover div.outline li').each((_, li) => {
    const t = clean($(li).text());
    if (t) outline.push(t);
  });

  return { verses, sections, outline };
}

/**
 * Research Guide entries. Structure:
 *   p.su  -> publication (possibly with pages), e.g. "Perspicaz, Volume 1, p. 1092"
 *   p.sk  -> issue/date + pages under the previous p.su, e.g. "15/9/2015, pp. 24-25"
 *   multi-anchor lines ("1/1/2006, pp. 20-24," + " 25-29") are continuations.
 */
export function extractResearchGuide($, item, out) {
  let currentPub = '';
  let pendingHeader = null; // bare publication line that may turn out to be a standalone entry
  const push = (title, href) => {
    const t = clean(title).replace(/[,;]\s*$/, '');
    if (!t || !href) return;
    out.push({ title: t, url: absUrl(href), type: classifyPublication(t), year: extractYear(t) });
  };
  const flushHeader = () => {
    if (pendingHeader && !pendingHeader.used) push(pendingHeader.title, pendingHeader.href);
    pendingHeader = null;
  };
  const stripPages = (t) => t.replace(/,?\s*(p|pp|pág|págs)\.?\s*[\d\s,-]+$/i, '').trim();

  $(item)
    .find('p')
    .each((_, p) => {
      const cls = ($(p).attr('class') || '').split(/\s+/);
      const anchors = $(p).find('a[href]').toArray();
      if (!anchors.length) return;

      if (cls.includes('su')) {
        flushHeader();
        const first = clean($(anchors[0]).text()).replace(/[,;]\s*$/, '');
        // A bare publication name ("A Sentinela,") is a header for the following p.sk lines.
        if (!/\d/.test(first) && anchors.length === 1) {
          currentPub = first;
          pendingHeader = { title: first, href: $(anchors[0]).attr('href'), used: false };
          return;
        }
        currentPub = '';
        const pubPrefix = stripPages(first);
        anchors.forEach((a, i) => {
          let text = clean($(a).text()).replace(/[,;]\s*$/, '');
          if (i > 0 && /^[\d\s,-]+$/.test(text)) text = `${pubPrefix}, pp. ${text}`;
          push(text, $(a).attr('href'));
        });
        return;
      }

      if (cls.includes('sk')) {
        if (pendingHeader) pendingHeader.used = true;
        const prefix = currentPub ? `${currentPub}, ` : '';
        let lastBase = '';
        anchors.forEach((a) => {
          const text = clean($(a).text()).replace(/[,;]\s*$/, '');
          if (/^[\d\s,-]+$/.test(text) && lastBase) {
            push(`${prefix}${lastBase}, pp. ${text}`, $(a).attr('href'));
          } else {
            lastBase = stripPages(text);
            push(`${prefix}${text}`, $(a).attr('href'));
          }
        });
      }
    });
  flushHeader();
}

/** Publications Index ("Índice das Publicações"): compact symbols like "w16.07 12". */
export function extractPublicationIndex($, item, out, unlinked) {
  let prevLabel = '';
  $(item)
    .find('p')
    .each((_, p) => {
      $(p)
        .find('a[href]')
        .each((__, a) => {
          let label = clean($(a).text()).replace(/[,;]\s*$/, '');
          if (!label) return;
          if (/^[\d\s,-]+$/.test(label) && prevLabel) {
            label = `${prevLabel.replace(/\s+[\d,-]+$/, '')} ${label}`;
          }
          prevLabel = label;
          out.push({ ref: label, url: absUrl($(a).attr('href')), year: symbolYear(label) });
        });
      $(p)
        .find('span.ni')
        .each((__, s) => {
          const t = clean($(s).text()).replace(/[,;]\s*$/, '');
          if (t) unlinked.push(t);
        });
    });
}

/** Publication symbols carry 2-digit years: w16.07 -> 2016, g66 -> 1966, it-1 -> null. */
function symbolYear(label) {
  const m = label.match(/^[a-z]+(\d{2})(?:[.\s]|$)/i);
  if (!m) return null;
  const yy = Number(m[1]);
  return yy > 50 ? 1900 + yy : 2000 + yy;
}

/**
 * WOL Scraper class (kept for backwards compatibility with the original tools).
 */
export class WOLScraper {
  async extractChapterContent(bookNum, chapterNum, lang, { fresh = false } = {}) {
    const loc = getLocale(lang);
    const url = wolUrl(loc, 'b', 'nwtsty', bookNum, chapterNum);
    console.error(`[scraper] Fetching ${url}`);
    const { html } = await fetchWolHtml(url, loc, { fresh });
    const parsed = parseChapterHtml(html, bookNum, chapterNum, loc);
    console.error(`[scraper] Parsed ${bookNum}:${chapterNum} (${loc.code}) — ${parsed.verses.length} verses, ${Object.keys(parsed.sections).length} study sections`);
    return { ...parsed, url, loc };
  }

  async getSingleVerse(bookNum, chapterNum, verseNum, lang) {
    const content = await this.extractChapterContent(bookNum, chapterNum, lang);
    const verse = content.verses.find((v) => v.verse_num === verseNum);
    if (!verse) throw new Error(`Verse ${bookNum}:${chapterNum}:${verseNum} not found`);
    return verse;
  }

  /**
   * @param {string|number} verseInput "14" or "14-16"
   * @param {Object} options { fields, limit, lang, fresh }
   */
  async getVerseWithStudy(bookNum, chapterNum, verseInput, options = {}) {
    const { fields = ['verses', 'study_notes'], limit = null, lang, fresh = false } = options;

    let verseStart;
    let verseEnd;
    if (typeof verseInput === 'string' && verseInput.includes('-')) {
      const [a, b] = verseInput.split('-');
      verseStart = parseInt(a, 10);
      verseEnd = parseInt(b, 10);
    } else {
      verseStart = verseEnd = parseInt(verseInput, 10);
    }

    const content = await this.extractChapterContent(bookNum, chapterNum, lang, { fresh });
    const inRange = (v) => v >= verseStart && v <= verseEnd;

    const result = {
      book_num: bookNum,
      book_name: content.loc.code === 'pt' ? bookNamePt(bookNum) : getBookName(bookNum),
      chapter: chapterNum,
      verse_range: verseStart === verseEnd ? `${verseStart}` : `${verseStart}-${verseEnd}`,
      lang: content.loc.code,
      source_url: content.url,
    };

    const versesInRange = content.verses.filter((v) => inRange(v.verse_num));
    if (fields.includes('verses')) result.verses = versesInRange;
    if (fields.includes('combined_text')) {
      result.combined_text = versesInRange.map((v) => `${v.verse_num}. ${v.verse_text}`).join(' ');
    }

    const perVerse = (key) => {
      const out = {};
      for (let v = verseStart; v <= verseEnd; v++) {
        const list = content.sections[v]?.[key];
        if (list && list.length) out[v] = list;
      }
      return out;
    };

    if (fields.includes('study_notes')) result.study_notes = perVerse('study_notes');
    if (fields.includes('cross_references')) result.cross_references = perVerse('cross_references');

    if (fields.includes('study_articles')) {
      const seen = new Set();
      const all = [];
      for (let v = verseStart; v <= verseEnd; v++) {
        for (const a of content.sections[v]?.research_guide || []) {
          const key = a.title.toLowerCase();
          if (seen.has(a.url) || seen.has(key)) continue;
          seen.add(a.url);
          seen.add(key);
          all.push(a);
        }
      }
      result.study_articles_total = all.length;
      result.study_articles = limit && all.length > limit ? all.slice(0, limit) : all;
    }

    if (fields.includes('publication_index')) {
      const seen = new Set();
      const all = [];
      const unlinked = [];
      for (let v = verseStart; v <= verseEnd; v++) {
        for (const r of content.sections[v]?.publication_index || []) {
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          all.push(r);
        }
        unlinked.push(...(content.sections[v]?.publication_index_unlinked || []));
      }
      result.publication_index_total = all.length;
      result.publication_index = limit && all.length > limit ? all.slice(0, limit) : all;
      if (unlinked.length) result.publication_index_unlinked = unlinked;
    }

    if (fields.includes('chapter_level')) result.chapter_level = { outline: content.outline };

    return result;
  }
}

export const scraper = new WOLScraper();
