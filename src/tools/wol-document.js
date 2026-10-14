/**
 * Parsers for WOL documents (/wol/d/...): generic articles, the Watchtower
 * study article and the Life and Ministry meeting workbook.
 */
import * as cheerio from 'cheerio';
import { absUrl } from './locale.js';
import { extractScriptures, publicScriptures } from './scripture-refs.js';

export const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function pageNumbers($, el) {
  return $(el)
    .find('span.pageNum')
    .toArray()
    .map((s) => Number($(s).attr('data-no')))
    .filter((n) => !Number.isNaN(n));
}

function blockText($, el) {
  const c = $(el).clone();
  c.find('span.parNum, span.pageNum, .gen-field').remove();
  // WOL markup often has no whitespace between inline elements
  // (<strong>Cântico 33</strong><strong>e oração</strong>), so pad them.
  c.find('a, strong, span, em, b, i').each((_, n) => {
    $(n).append(' ');
  });
  return clean(c.text())
    .replace(/\s+([.,;:!?)\]”’])/g, '$1')
    .replace(/([(\[“‘])\s+/g, '$1');
}

function extractRefs($, el) {
  return $(el)
    .find('a[href*="/wol/pc/"]')
    .toArray()
    .map((a) => ({ label: clean($(a).text()), url: absUrl($(a).attr('href')) }))
    .filter((r) => r.label);
}

function extractVideos($, el) {
  return $(el)
    .find('a[data-video], a[href*="lank="]')
    .toArray()
    .map((a) => {
      const href = $(a).attr('href') || '';
      let lank = null;
      try {
        lank = new URL(href, 'https://www.jw.org').searchParams.get('lank');
      } catch {
        /* ignore */
      }
      const p = $(a).closest('p');
      const em = p.find('em').first();
      const title = clean(em.text()) || clean($(a).text());
      return { title: title.replace(/[.:]\s*$/, ''), video_id: lank, url: href.startsWith('http') ? href : absUrl(href) };
    })
    .filter((v) => v.video_id || v.url);
}

function documentMeta($) {
  const citation = clean($('li.documentLocation').first().text()) || null;
  const navTitle = clean($('.resultsNavigationSelected .navContent').first().text());
  const h1 = clean($('article h1').first().text());
  const pageTitle = clean($('title').text()).replace(/\s+[—-]\s+(BIBLIOTECA ON-LINE|Watchtower ONLINE LIBRARY|BIBLIOTECA EN LÍNEA).*$/i, '');
  return { title: navTitle || h1 || pageTitle || null, citation };
}

/**
 * Generic linear walk of an article: every element with data-pid (headings,
 * paragraphs, questions) plus figures, in document order, tracking the page.
 */
export function parseArticleBlocks(html, { readWords } = {}) {
  const $ = cheerio.load(html);
  const meta = documentMeta($);
  const root = $('article').first().length ? $('article').first() : $('body');
  // The first page marker usually sits in the <header>, which is skipped below.
  let page = pageNumbers($, root)[0] ?? null;
  root.find('.pswp, #questionContainer, #galleryModalContainer, header').remove();

  const blocks = [];
  const seen = new Set();

  root.find('h1, h2, h3, p, figure').each((_, el) => {
    const $el = $(el);
    if (el.name !== 'figure' && $el.closest('figure').length) return; // captions handled with figure
    if (el.name === 'p' && $el.parents('p').length) return;

    const pid = $el.attr('data-pid') || $el.closest('[data-pid]').attr('data-pid') || null;
    const pages = pageNumbers($, el);
    const startPage = page;
    if (pages.length) {
      // a page marker at the very start of the element means it starts on that page
      const firstMarker = $el.find('span.pageNum').first();
      const textBefore = firstMarker.length ? clean(firstMarker.prevAll().text()) : '';
      page = pages[pages.length - 1];
      if (!textBefore && startPage !== pages[0]) {
        // element begins on the new page
        return pushBlock(pages[0]);
      }
    }
    return pushBlock(startPage ?? pages[0] ?? null);

    function pushBlock(blockPage) {
      if (el.name === 'figure') {
        const img = $el.find('img').first();
        blocks.push({
          type: 'figure',
          pid: clean($el.find('figcaption [data-pid]').attr('data-pid')) || null,
          alt: clean(img.attr('alt')) || null,
          caption: clean($el.find('figcaption').text()) || null,
          page: blockPage,
        });
        return;
      }
      const key = `${el.name}:${pid}`;
      if (pid && seen.has(key)) return;
      if (pid) seen.add(key);

      const cls = ($el.attr('class') || '').split(/\s+/);
      let type = 'paragraph';
      if (/^h[1-3]$/.test(el.name)) type = `heading${el.name[1]}`;
      else if (cls.includes('qu')) type = 'question';
      else if (cls.includes('themeScrp')) type = 'theme';
      else if (cls.includes('pubRefs') || cls.includes('contextTtl')) type = 'meta';
      if ($el.closest('aside, .boxContent, .blockTeach').length && type === 'paragraph') type = 'box';

      const text = blockText($, el);
      if (!text) return;

      const parNum = $el.find('span.parNum').attr('data-pnum');
      const relPid = ($el.attr('data-rel-pid') || '').replace(/[[\]\s]/g, '').split(',').filter(Boolean);
      const hasAnswerField = $el.next('.gen-field').length > 0 || $el.parent().next('.gen-field').length > 0;

      const block = {
        type,
        pid,
        page: blockPage,
        text,
      };
      if (parNum) block.par_num = Number(parNum);
      if (relPid.length) block.question_pid = relPid[0];
      if (hasAnswerField && type !== 'question') block.asks_answer = true;
      const scriptures = extractScriptures($, el, { readWords });
      if (scriptures.length) block.scriptures = scriptures;
      const refs = extractRefs($, el);
      if (refs.length) block.refs = refs;
      const videos = extractVideos($, el);
      if (videos.length) block.videos = videos;
      blocks.push(block);
    }
  });

  return { ...meta, blocks };
}

export function stripBlock(b) {
  const out = { ...b };
  if (out.scriptures) out.scriptures = publicScriptures(out.scriptures);
  return out;
}

const shortScriptures = (list) =>
  list?.length ? publicScriptures(list).map((s) => (s.read ? `${s.reference || s.text} (leitura)` : s.reference || s.text)) : undefined;

// ---------------------------------------------------------------------------
// Watchtower study article
// ---------------------------------------------------------------------------

export function parseWatchtowerStudy(html, opts = {}) {
  const { title, citation, blocks } = parseArticleBlocks(html, opts);
  const $ = cheerio.load(html);

  const result = {
    title,
    citation,
    week: null,
    songs: [],
    theme_scripture: null,
    objective: null,
    sections: [],
    figures: [],
    review_questions: [],
    videos: [],
  };

  // header bits (removed from the block walk because they live in <header>)
  const ctx = clean($('header .contextTtl, p.contextTtl').first().text());
  if (ctx) result.week = ctx;
  const h1 = clean($('article header h1, article h1').first().text());
  if (h1) result.title = h1;
  $('article p.pubRefs').each((_, p) => {
    const t = clean($(p).text());
    if (/c[âa]ntico|song|c[aá]ntico/i.test(t)) result.songs.push(t);
  });

  const questionsByPid = new Map();
  let section = { heading: null, items: [] };
  result.sections.push(section);
  let objectiveNext = false;

  for (const b of blocks) {
    if (b.type === 'meta') {
      if (/^(objetivo|objective|objetivo)$/i.test(b.text)) objectiveNext = true;
      else if (objectiveNext) {
        result.objective = b.text;
        objectiveNext = false;
      } else if (/c[âa]ntico|song/i.test(b.text) && !result.songs.includes(b.text)) result.songs.push(b.text);
      continue;
    }
    if (b.type === 'theme') {
      result.theme_scripture = { text: b.text, scriptures: shortScriptures(b.scriptures) };
      continue;
    }
    if (b.type === 'heading2' || b.type === 'heading3') {
      if (/qual é a sua resposta|can you answer|qué respondería/i.test(b.text)) {
        section = { heading: b.text, items: [], review: true };
        continue;
      }
      section = { heading: b.text, items: [] };
      result.sections.push(section);
      continue;
    }
    if (b.type === 'heading1') continue;
    if (b.type === 'figure') {
      result.figures.push({ page: b.page, description: b.alt, caption: b.caption });
      continue;
    }
    if (b.type === 'question') {
      const m = b.text.match(/^([\d,\s-]+)\.\s*(.*)$/);
      const numbers = m
        ? m[1]
            .split(/[,\s-]+/)
            .filter(Boolean)
            .map(Number)
        : [];
      const item = {
        paragraphs_numbers: numbers,
        question: m ? m[2] : b.text,
        question_scriptures: shortScriptures(b.scriptures),
        paragraphs: [],
      };
      questionsByPid.set(b.pid, item);
      section.items.push(item);
      continue;
    }
    if (section.review || b.type === 'box') {
      if (b.asks_answer || section.review) result.review_questions.push(b.text);
      continue;
    }
    if (b.type === 'paragraph') {
      const para = {
        number: b.par_num ?? null,
        page: b.page,
        text: b.text,
        scriptures: shortScriptures(b.scriptures),
      };
      if (b.videos) result.videos.push(...b.videos);
      const owner = (b.question_pid && questionsByPid.get(b.question_pid)) || section.items[section.items.length - 1];
      if (owner) owner.paragraphs.push(para);
      else section.items.push({ paragraphs_numbers: [], question: null, paragraphs: [para] });
    }
  }

  result.sections = result.sections.filter((s) => s.items.length || s.heading);
  if (result.sections[0] && !result.sections[0].heading && !result.sections[0].items.length) result.sections.shift();
  return result;
}

// ---------------------------------------------------------------------------
// Life and Ministry meeting workbook (one week)
// ---------------------------------------------------------------------------

export function parseWorkbookWeek(html, opts = {}) {
  const $ = cheerio.load(html);
  const header = {
    week: clean($('article header h1').first().text()) || null,
    bible_reading: clean($('article header h2').first().text()) || null,
  };
  const { title, citation, blocks } = parseArticleBlocks(html, opts);

  const result = {
    title: title || header.week,
    citation,
    week: header.week,
    weekly_bible_reading: header.bible_reading,
    songs: [],
    sections: [],
    videos: [],
  };

  let section = { title: null, parts: [] };
  result.sections.push(section);
  let part = null;

  const songRe = /(c[âa]ntico|song)\s+\d+/i;

  for (const b of blocks) {
    if (b.type === 'heading2') {
      section = { title: b.text, parts: [] };
      result.sections.push(section);
      part = null;
      continue;
    }
    if (b.type === 'heading3') {
      const songs = (b.text.match(/(c[âa]ntico|song)\s+\d+/gi) || []).map((s) => s.trim());
      result.songs.push(...songs);
      const m = b.text.match(/^(\d+)\.\s*(.*)$/);
      const minutes = b.text.match(/\((\d+)\s*min\)/i);
      part = {
        number: m ? Number(m[1]) : null,
        title: (m ? m[2] : b.text).replace(/\(\d+\s*min\)/i, '').trim(),
        minutes: minutes ? Number(minutes[1]) : null,
        content: [],
        questions: [],
        references: [],
        scriptures: [],
        images: [],
      };
      if (b.refs) part.references.push(...b.refs.filter((r) => !songRe.test(r.label)));
      section.parts.push(part);
      continue;
    }
    if (!part) continue;

    if (b.type === 'figure') {
      part.images.push({ description: b.alt, caption: b.caption });
      continue;
    }

    let text = b.text;
    const minutes = text.match(/^\((\d+)\s*min\)\s*/i);
    if (minutes) {
      part.minutes = part.minutes ?? Number(minutes[1]);
      text = text.slice(minutes[0].length).trim();
    }
    if (b.refs) part.references.push(...b.refs);
    if (b.scriptures) part.scriptures.push(...shortScriptures(b.scriptures));
    if (b.videos) {
      part.videos = [...(part.videos || []), ...b.videos];
      result.videos.push(...b.videos.map((v) => ({ ...v, part: part.number })));
    }
    if (!text) continue;
    if (b.asks_answer) part.questions.push(text.replace(/^•\s*/, ''));
    else part.content.push(text);
  }

  for (const s of result.sections) {
    for (const p of s.parts) {
      for (const k of ['content', 'questions', 'references', 'scriptures', 'images']) if (!p[k].length) delete p[k];
    }
  }
  result.sections = result.sections.filter((s) => s.parts.length);
  return result;
}

// ---------------------------------------------------------------------------
// Meetings page (/wol/meetings/.../YYYY/WW) and search results
// ---------------------------------------------------------------------------

export function parseMeetingsPage(html) {
  const $ = cheerio.load(html);
  const out = { workbook: null, watchtower: null, other: [] };
  $('.todayItem').each((_, item) => {
    const cls = $(item).attr('class') || '';
    const a = $(item).find('a[href*="/wol/d/"]').first();
    if (!a.length) return;
    const entry = {
      title: clean($(a).find('.cardLine1').text()) || clean($(a).text()),
      publication: clean($(a).find('.cardLine2').text()) || null,
      url: absUrl($(a).attr('href')),
    };
    if (/\bpub-mwb\b/.test(cls) && !out.workbook) out.workbook = entry;
    else if (/\bpub-w\b/.test(cls) && !out.watchtower) out.watchtower = entry;
    else out.other.push(entry);
  });
  return out;
}

export function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const results = [];
  $('ul.results').each((_, ul) => {
    const caption = $(ul).find('li.caption').first();
    const a = caption.find('a.lnk, a').first();
    if (!a.length) return;
    const href = a.attr('href') || '';
    const url = absUrl(href.split('?')[0]);
    const count = clean(caption.find('.count').text()).match(/\d+/);
    const resultLi = $(ul).find('li.searchResult').first();
    const cls = resultLi.attr('class') || '';
    const pub = (cls.match(/\bpub-([a-z0-9-]+)\b/gi) || []).map((s) => s.slice(4)).find((s) => s && /\d/.test(s)) || null;
    const snippet = resultLi
      .find('.document')
      .children()
      .toArray()
      .map((el) => clean($(el).text()))
      .filter(Boolean)
      .join(' ');
    results.push({
      title: clean(a.text()),
      citation: clean($(ul).find('li.ref').first().text()) || null,
      publication_symbol: pub,
      occurrences: count ? Number(count[0]) : null,
      snippet: snippet || null,
      url,
    });
  });
  return results;
}
