/**
 * Study tools built on wol.jw.org: follow Research Guide references to the
 * exact paragraphs, full-text library search, and the structured meeting week.
 */
import { getLocale, wolUrl, assertWolUrl, LANG_SCHEMA } from './locale.js';
import { fetchWolHtml } from './wol-http.js';
import { parseCitation, citationIncludes, formatCitation, lookupBook } from './scripture-refs.js';
import {
  parseArticleBlocks,
  parseWatchtowerStudy,
  parseWorkbookWeek,
  parseMeetingsPage,
  parseSearchResults,
} from './wol-document.js';
import { publicScriptures } from './scripture-refs.js';

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

// ---------------------------------------------------------------------------
// Dates: ISO week in the user's timezone (meetings are indexed by ISO week)
// ---------------------------------------------------------------------------

const TZ = process.env.JW_MCP_TIMEZONE || 'America/Fortaleza';

export function todayInTz() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // YYYY-MM-DD
}

export function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day); // Thursday of this week
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

// ---------------------------------------------------------------------------
// get_reference
// ---------------------------------------------------------------------------

export const getReferenceTool = {
  name: 'get_reference',
  description:
    'Abre uma referência da Biblioteca On-line (link do Guia de Pesquisa / Índice das Publicações retornado por get_verse_with_study, link de busca, ou qualquer URL wol.jw.org/.../wol/d|pc/...) e devolve só os parágrafos relevantes: os que citam o versículo informado (com 1 parágrafo de contexto antes/depois), ou os das páginas informadas. Inclui título, publicação/data (citation), pergunta de estudo do parágrafo quando houver e os textos bíblicos citados. Use para cruzar o que as publicações dizem sobre um texto.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL da referência em wol.jw.org (ex.: https://wol.jw.org/pt/wol/pc/r5/lp-t/1204430/864/0)' },
      reference: { type: 'string', description: 'Versículo a localizar no artigo, ex.: "Mateus 6:33" ou "Mat. 6:33". Opcional se book/chapter/verse forem informados.' },
      book: { type: 'number', description: 'Número do livro (1-66). Alternativa a "reference".' },
      chapter: { type: 'number', description: 'Capítulo. Alternativa a "reference".' },
      verse: { type: 'number', description: 'Versículo. Alternativa a "reference".' },
      pages: { type: 'string', description: 'Páginas a extrair se não houver versículo, ex.: "pp. 14-15" ou "12". Pode ser o próprio título da referência.' },
      label: { type: 'string', description: 'O rótulo da referência como aparece na matéria, ex.: "w24.12 23 §§ 13-14", "jr 189 § 16", "cl 72-73 §§ 13-14". Os parágrafos (§) e páginas são lidos daqui.' },
      context: { type: 'number', description: 'Parágrafos de contexto antes/depois de cada trecho encontrado (padrão 1).', default: 1 },
      max_paragraphs: { type: 'number', description: 'Máximo de parágrafos devolvidos (padrão 8).', default: 8 },
      lang: LANG_SCHEMA,
    },
    required: ['url'],
  },
};

export function parsePages(str) {
  if (!str) return null;
  const s = String(str).replace(/ /g, ' ');
  // prefer the part after "p." / "pp." / "págs." if present
  const m =
    s.match(/(?:p{1,2}|págs?|pág)\.?\s*([\d\s,-]+)\s*$/i) || s.match(/(\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*)\s*$/);
  if (!m) return null;
  const pages = new Set();
  for (const part of m[1].split(',')) {
    const r = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!r) continue;
    const a = Number(r[1]);
    const b = r[2] ? Number(r[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b) && pages.size < 60; p++) pages.add(p);
  }
  return pages.size ? pages : null;
}

/** Does a parsed citation overlap the target (book/chapter + optional verse ranges)? */
export function citesTarget(c, target) {
  if (!c || !target || c.book !== target.book) return false;
  if (!target.ranges) return citationIncludes(c, target.book, target.chapter, null);
  return target.ranges.some(([a, b]) => {
    for (let v = a; v <= b; v++) if (citationIncludes(c, target.book, target.chapter, v)) return true;
    return false;
  });
}

/** Pick the paragraphs of a parsed document that matter for a target verse or page range. */
/** "§§ 13-14" / "§ 16" -> Set of paragraph numbers. */
export function parseParagraphRefs(str) {
  const m = String(str || '').match(/§§?\s*([\d\s,-]+)/);
  if (!m) return null;
  const set = new Set();
  for (const part of m[1].split(',')) {
    const r = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!r) continue;
    const a = Number(r[1]);
    const b = r[2] ? Number(r[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b) && set.size < 60; n++) set.add(n);
  }
  return set.size ? set : null;
}

export function selectParagraphs(doc, { target = null, pages = null, paragraphs: paragraphRefs = null, context = 1, maxParagraphs = 8 } = {}) {
  const questions = new Map(doc.blocks.filter((b) => b.type === 'question').map((b) => [b.pid, b.text]));
  const attached = new Set(doc.blocks.filter((b) => b.question_pid).map((b) => b.question_pid));
  const textBlocks = doc.blocks.filter(
    (b) => ['paragraph', 'theme', 'box'].includes(b.type) || (b.type === 'question' && !attached.has(b.pid))
  );
  const hits = (b) => (b.scriptures || []).some((s) => citesTarget(s._parsed, target));

  let matchedBy = 'start';
  const picked = new Set();

  if (target) {
    textBlocks.forEach((b, i) => {
      if (!hits(b)) return;
      for (let j = Math.max(0, i - context); j <= Math.min(textBlocks.length - 1, i + context); j++) picked.add(j);
    });
    if (picked.size) matchedBy = 'verse';
  }

  if (!picked.size && paragraphRefs) {
    const set = paragraphRefs instanceof Set ? paragraphRefs : parseParagraphRefs(paragraphRefs);
    if (set) {
      textBlocks.forEach((b, i) => {
        if (b.par_num != null && set.has(b.par_num)) picked.add(i);
      });
      if (picked.size) matchedBy = 'paragraphs';
    }
  }

  if (!picked.size && pages) {
    const set = parsePages(String(pages).replace(/§§?\s*[\d\s,-]+/, ''));
    if (set) {
      textBlocks.forEach((b, i) => {
        if (b.page != null && set.has(b.page)) picked.add(i);
      });
      if (picked.size) matchedBy = 'pages';
    }
  }

  if (!picked.size) {
    for (let i = 0; i < Math.min(maxParagraphs, textBlocks.length); i++) picked.add(i);
  }

  const headingFor = (block) => {
    let h = null;
    for (const b of doc.blocks) {
      if (b === block) break;
      if (b.type === 'heading2' || b.type === 'heading3') h = b.text;
    }
    return h;
  };

  const paragraphs = [...picked]
    .sort((a, b) => a - b)
    .slice(0, maxParagraphs)
    .map((i) => {
      const b = textBlocks[i];
      const out = { page: b.page ?? null };
      if (b.par_num) out.number = b.par_num;
      const h = headingFor(b);
      if (h) out.section = h;
      if (b.question_pid && questions.has(b.question_pid)) out.study_question = questions.get(b.question_pid);
      out.text = b.text;
      if (b.scriptures) {
        out.scriptures = publicScriptures(b.scriptures).map((s) => (s.read ? `${s.reference || s.text} (leitura)` : s.reference || s.text));
      }
      if (target && hits(b)) out.cites_target = true;
      return out;
    });

  return { matchedBy, paragraphs, total: textBlocks.length };
}

export async function getReferenceImplementation(args = {}) {
  try {
    const loc = getLocale(args.lang);
    const url = assertWolUrl(args.url);
    const context = Math.max(0, Math.min(Number(args.context ?? 1), 3));
    const maxParagraphs = Math.max(1, Math.min(Number(args.max_paragraphs ?? 8), 25));

    let target = null;
    if (args.reference) target = parseCitation(args.reference);
    if (!target && args.book && args.chapter) {
      target = {
        book: Number(args.book),
        chapter: Number(args.chapter),
        chapter_end: null,
        ranges: args.verse ? [[Number(args.verse), Number(args.verse)]] : null,
      };
    }

    const { html, finalUrl } = await fetchWolHtml(url, loc);
    const doc = parseArticleBlocks(html, { readWords: loc.read });
    const label = args.label || args.pages || null;
    const { matchedBy, paragraphs, total } = selectParagraphs(doc, {
      target,
      paragraphs: label ? parseParagraphRefs(label) : null,
      pages: label,
      context,
      maxParagraphs,
    });

    return ok({
      title: doc.title,
      citation: doc.citation,
      url: finalUrl,
      target: target ? formatCitation(target, loc.code) : null,
      matched_by: matchedBy,
      note: matchedBy === 'start' ? 'Nenhum parágrafo cita o versículo/páginas pedidos; devolvendo o início do documento.' : undefined,
      total_paragraphs: total,
      paragraphs,
    });
  } catch (error) {
    return fail(`Erro ao abrir a referência: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// search_library
// ---------------------------------------------------------------------------

export const searchLibraryTool = {
  name: 'search_library',
  description:
    'Busca de texto na Biblioteca On-line inteira (todas as publicações e a Bíblia no idioma escolhido). Use para aprofundar um tema ("viúvas Jeová cuida", "ansiedade confiança"). Coloque entre aspas para frase exata. Retorna título, publicação/data, nº de ocorrências, trecho e URL — abra o resultado com get_reference.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Termos de busca. Use aspas para frase exata.' },
      sort: { type: 'string', enum: ['occurrences', 'newest', 'oldest'], description: 'Ordenação (padrão: occurrences).', default: 'occurrences' },
      collection: {
        type: 'string',
        enum: ['all', 'bible', 'watchtower', 'awake', 'insight', 'books', 'workbooks', 'index', 'glossary', 'yearbooks'],
        description: 'Restringir a uma coleção (padrão: all).',
        default: 'all',
      },
      match: { type: 'string', enum: ['sentence', 'paragraph', 'article'], description: 'Todas as palavras na mesma frase, parágrafo (padrão) ou artigo.', default: 'paragraph' },
      limit: { type: 'number', description: 'Máximo de resultados (padrão 10).', default: 10 },
      lang: LANG_SCHEMA,
    },
    required: ['query'],
  },
};

const SORT_PARAM = { occurrences: 'occ', newest: 'newest', oldest: 'oldest' };
const COLLECTION_PARAM = { bible: 'bi', watchtower: 'w', awake: 'g', insight: 'it', books: 'bk', workbooks: 'mwb', index: 'dx', glossary: 'gloss', yearbooks: 'yb' };
const MATCH_PARAM = { sentence: 'sen', paragraph: 'par', article: 'doc' };

export async function searchLibraryImplementation(args = {}) {
  try {
    if (!args.query || !String(args.query).trim()) return fail('Informe "query".');
    const loc = getLocale(args.lang);
    const limit = Math.max(1, Math.min(Number(args.limit ?? 10), 50));
    const sort = SORT_PARAM[args.sort] || 'occ';
    const fc = COLLECTION_PARAM[args.collection] ? `&fc%5B%5D=${COLLECTION_PARAM[args.collection]}` : '';
    const match = MATCH_PARAM[args.match] || 'par';
    const url = `${wolUrl(loc, 's')}?q=${encodeURIComponent(String(args.query).trim())}${fc}&p=${match}&r=${sort}`;
    const { html } = await fetchWolHtml(url, loc);
    const results = parseSearchResults(html).slice(0, limit);
    return ok({ query: args.query, lang: loc.code, search_url: url, results_count: results.length, results });
  } catch (error) {
    return fail(`Erro na busca: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// get_meeting_week
// ---------------------------------------------------------------------------

export const getMeetingWeekTool = {
  name: 'get_meeting_week',
  description:
    'Matéria das reuniões de uma semana, estruturada a partir da Biblioteca On-line: (1) apostila Vida e Ministério — seções, partes numeradas com minutos, perguntas, referências (abrir com get_reference), textos bíblicos e vídeos (video_id para get_jw_captions); (2) estudo de A Sentinela — perguntas com os parágrafos correspondentes, textos marcados como "(leitura)", imagens descritas e o quadro de recapitulação. Padrão: semana atual.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Qualquer data da semana (AAAA-MM-DD). Padrão: hoje.' },
      offset_weeks: { type: 'number', description: 'Deslocamento em semanas a partir da data (ex.: -1 = semana passada, 1 = próxima).', default: 0 },
      part: { type: 'string', enum: ['all', 'workbook', 'watchtower'], description: 'Qual reunião trazer (padrão: all).', default: 'all' },
      lang: LANG_SCHEMA,
    },
  },
};

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export async function getMeetingWeekImplementation(args = {}) {
  try {
    const loc = getLocale(args.lang);
    let date = args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : todayInTz();
    if (args.offset_weeks) date = shiftDate(date, 7 * Number(args.offset_weeks));
    const { year, week } = isoWeek(date);
    const part = args.part || 'all';

    const meetingsUrl = wolUrl(loc, 'meetings', year, week);
    const { html } = await fetchWolHtml(meetingsUrl, loc);
    const links = parseMeetingsPage(html);

    const out = { date, iso_year: year, iso_week: week, lang: loc.code, meetings_url: meetingsUrl };

    if (part !== 'watchtower') {
      if (links.workbook) {
        const { html: wb } = await fetchWolHtml(links.workbook.url, loc);
        out.workbook = { url: links.workbook.url, ...parseWorkbookWeek(wb, { readWords: loc.read }) };
      } else out.workbook = null;
    }
    if (part !== 'workbook') {
      if (links.watchtower) {
        const { html: wt } = await fetchWolHtml(links.watchtower.url, loc);
        out.watchtower = { url: links.watchtower.url, ...parseWatchtowerStudy(wt, { readWords: loc.read }) };
      } else out.watchtower = null;
    }
    const songNumbers = (list) => [...new Set((list || []).map((t) => Number((String(t).match(/\d+/) || [])[0])).filter(Boolean))];
    if (out.workbook) out.workbook.song_numbers = songNumbers(out.workbook.songs);
    if (out.watchtower) out.watchtower.song_numbers = songNumbers(out.watchtower.songs);
    if (!links.workbook && !links.watchtower) {
      out.note = 'Nenhuma matéria encontrada para essa semana (pode ser semana de congresso/assembleia ou ainda não publicada).';
    }
    return ok(out);
  } catch (error) {
    return fail(`Erro ao buscar a semana de reuniões: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------

export const studyTools = [getMeetingWeekTool, getReferenceTool, searchLibraryTool];

export async function handleStudyTools(request) {
  const args = request.params.arguments || {};
  switch (request.params.name) {
    case 'get_reference':
      return getReferenceImplementation(args);
    case 'search_library':
      return searchLibraryImplementation(args);
    case 'get_meeting_week':
      return getMeetingWeekImplementation(args);
    default:
      return null;
  }
}

// exported for tests
export { lookupBook };
