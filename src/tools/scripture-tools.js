/**
 * Scripture Tools for JW-MCP
 * Provides Bible verse lookup and study content from wol.jw.org
 */

import { scraper } from './wol-scraper.js';
import { getLocale, LANG_SCHEMA } from './locale.js';
import { bookNamePt, parseReferenceInput, lookupBookLoose } from './scripture-refs.js';
import { fetchBibleChapter, sliceByVerse, itemsTouching } from './bible-json.js';
import {
  searchBooks,
  getBookName,
  getBookNumber,
  formatReference,
  validateReference,
  BIBLE_BOOKS
} from './bible-books.js';

// ============================================================================
// Tool 1: search_bible_books
// ============================================================================

export const searchBibleBooksTool = {
  name: 'search_bible_books',
  description: 'Search for Bible books by name or abbreviation. Returns book numbers (1-66) and names. Useful for finding the correct book number for other scripture tools. Examples: "matt" -> Matthew (40), "1 john" -> 1 John (62), "gen" -> Genesis (1).',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query - can be book name, abbreviation, or number. Examples: "matthew", "matt", "mt", "40", "1 john"'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10)',
        default: 10
      }
    },
    required: ['query']
  }
};

export async function searchBibleBooksImplementation(query, limit = 10) {
  try {
    if (!query || typeof query !== 'string') {
      return {
        content: [{
          type: 'text',
          text: 'Error: Query must be a non-empty string'
        }],
        isError: true
      };
    }

    const results = searchBooks(query, limit);
    // Portuguese names/symbols ("Sl", "salmo", "1ª Pedro", "apoc") first.
    const pt = lookupBookLoose(query.replace(/^\s*(?:i|1)\s*[ºª]\s*/i, '1 ').replace(/^\s*ii\s+/i, '2 ').replace(/^\s*iii\s+/i, '3 '));
    if (pt) {
      const i = results.findIndex((r) => r.number === pt);
      if (i >= 0) results.splice(i, 1);
      results.unshift({ number: pt, name: getBookName(pt), score: 100 });
    }

    if (results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No Bible books found matching "${query}". Try using a book name, abbreviation, or number (1-66).`
        }]
      };
    }

    // Format results
    const formattedResults = results.slice(0, limit).map(r => ({
      number: r.number,
      name: r.name,
      name_pt: bookNamePt(r.number),
      testament: r.number <= 39 ? 'Old Testament' : 'New Testament',
      relevance_score: r.score
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          query: query,
          results_count: formattedResults.length,
          books: formattedResults
        }, null, 2)
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error searching Bible books: ${error.message}`
      }],
      isError: true
    };
  }
}

// ============================================================================
// Shared: resolve book/chapter/verse or a "reference" string
// ============================================================================

const REFERENCE_SCHEMA = {
  type: 'string',
  description: 'Alternativa a book/chapter/verse, escrita como a pessoa digitou: "Mateus 6:33", "Mat. 6:31-34", "Salmo 46:2", "sl 46 2", "Sal 46.2", "1ª Pedro 5:7", "I Cor 13:4", "Sal. 23" (capítulo inteiro).'
};

/** book may come as a number (19) or a name ("Salmos", "Sl"). */
function bookArg(book) {
  if (book == null || book === '') return null;
  const n = Number(book);
  if (Number.isInteger(n) && n >= 1 && n <= 66) return n;
  return lookupBookLoose(String(book));
}

function resolveReference(args = {}) {
  const c = args.reference ? parseReferenceInput(String(args.reference)) : null;
  if (args.reference && !c && !(args.book && args.chapter)) {
    throw new Error(`Não entendi a referência "${args.reference}". Exemplos: "Mateus 6:33", "Salmo 46:2", "Sal. 23:1-4".`);
  }
  if (c) {
    if (c.ranges) {
      const a = Math.min(...c.ranges.map((r) => r[0]));
      const b = Math.max(...c.ranges.map((r) => r[1]));
      return { book: c.book, chapter: c.chapter, verseStart: a, verseEnd: b };
    }
    return { book: c.book, chapter: c.chapter, verseStart: 1, verseEnd: 999 };
  }
  const book = bookArg(args.book);
  const chapter = Number(args.chapter);
  if (!book || !chapter) throw new Error('Informe "reference" ou book + chapter (+ verse).');
  const v = args.verse == null || args.verse === '' ? null : String(args.verse);
  if (!v) return { book, chapter, verseStart: 1, verseEnd: 999 };
  const m = v.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!m) throw new Error(`Versículo inválido: "${v}". Use "14" ou "14-16".`);
  return { book, chapter, verseStart: Number(m[1]), verseEnd: Number(m[2] || m[1]) };
}

function displayRef(book, chapter, a, b, lang) {
  const name = getLocale(lang).code === 'pt' ? bookNamePt(book) : getBookName(book);
  if (a === 1 && b >= 999) return `${name} ${chapter}`;
  return `${name} ${chapter}:${a === b ? a : `${a}-${b}`}`;
}

/** Verse text: study-Bible JSON first, WOL page as fallback. */
async function loadVerses(book, chapter, lang, fresh) {
  try {
    const data = await fetchBibleChapter(book, chapter, lang, { fresh });
    return { source: 'jw.org study Bible', data };
  } catch (error) {
    console.error(`[bible-json] ${book}:${chapter} falhou (${error.message}); usando wol.jw.org`);
    const wol = await scraper.extractChapterContent(book, chapter, lang, { fresh });
    const toMap = (key) => new Map(Object.entries(wol.sections).map(([v, s]) => [Number(v), s[key] || []]));
    return {
      source: 'wol.jw.org',
      fallback_reason: `Texto veio do wol.jw.org sem poesia linha a linha, mídia e trechos de vídeo: ${error.message}`,
      data: {
        url: wol.url,
        verses: wol.verses.map((v) => ({ verse: v.verse_num, text: v.verse_text })),
        superscription: null,
        footnotes: new Map(),
        cross_references: toMap('cross_references'),
        study_notes: toMap('study_notes'),
        outline: wol.outline,
        media: [],
        video_clips: [],
      },
    };
  }
}

// ============================================================================
// Tool 2: get_bible_verse
// ============================================================================

export const getBibleVerseTool = {
  name: 'get_bible_verse',
  description: 'Texto bíblico (Tradução do Novo Mundo, edição de estudo) de um versículo, trecho ou capítulo inteiro, no idioma escolhido (padrão português). Salmos e poesia vêm linha por linha. Para notas de estudo, referências e pesquisa, use get_verse_with_study.',
  inputSchema: {
    type: 'object',
    properties: {
      reference: REFERENCE_SCHEMA,
      book: { type: ['number', 'string'], description: 'Número (1-66) ou nome do livro ("Salmos", "Sl"). Prefira "reference".' },
      chapter: { type: 'number', description: 'Capítulo' },
      verse: { type: 'string', description: 'Versículo ("14") ou trecho ("14-16"). Omitido = capítulo inteiro.' },
      lang: LANG_SCHEMA
    }
  }
};

export async function getBibleVerseImplementation(args = {}) {
  try {
    const { book, chapter, verseStart, verseEnd } = resolveReference(args);
    const validation = validateReference(book, chapter, verseStart);
    if (!validation.valid) return { content: [{ type: 'text', text: `Validation error: ${validation.error}` }], isError: true };

    const { data, source, fallback_reason } = await loadVerses(book, chapter, args.lang, false);
    const verses = data.verses.filter((v) => v.verse >= verseStart && v.verse <= verseEnd);
    if (!verses.length) return { content: [{ type: 'text', text: `Versículo não encontrado: ${displayRef(book, chapter, verseStart, verseEnd, args.lang)}` }], isError: true };

    const result = {
      reference: displayRef(book, chapter, verseStart, Math.min(verseEnd, verses[verses.length - 1].verse), args.lang),
      book_number: book,
      chapter,
      source,
      verses
    };
    if (fallback_reason) result.note = fallback_reason;
    if (verseStart <= 1 && data.superscription) result.superscription = data.superscription;
    if (verses.length === 1) result.text = verses[0].text;
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Erro ao buscar o versículo: ${error.message}` }], isError: true };
  }
}

// ============================================================================
// Tool 3: get_verse_with_study
// ============================================================================

const STUDY_FIELDS = ['verses', 'study_notes', 'study_articles', 'publication_index', 'cross_references', 'footnotes', 'media', 'video_clips', 'chapter_level', 'combined_text'];
const DEFAULT_STUDY_FIELDS = ['verses', 'study_notes', 'study_articles', 'cross_references', 'footnotes', 'media', 'video_clips'];

export const getVerseWithStudyTool = {
  name: 'get_verse_with_study',
  description: 'Pesquisa completa de um versículo/trecho da Bíblia de Estudo (TNM), no idioma escolhido (padrão português): texto, notas de estudo, notas de rodapé, referências cruzadas, mídia da Bíblia de estudo (imagens com legenda), trechos de vídeo que explicam o texto (video_clips com video_id e minutagem — abra com get_jw_captions passando start/end), TODAS as referências do Guia de Pesquisa (study_articles, com ano; as mais recentes vêm primeiro) e, se pedido, o Índice das Publicações (publication_index, inclui publicações antigas). Abra uma referência com get_reference passando o versículo para receber só os parágrafos que o explicam. Prefira publicações recentes: o entendimento de alguns textos foi ajustado ao longo do tempo.',
  inputSchema: {
    type: 'object',
    properties: {
      reference: REFERENCE_SCHEMA,
      book: { type: ['number', 'string'], description: 'Número (1-66) ou nome do livro. Prefira "reference".' },
      chapter: { type: 'number', description: 'Capítulo' },
      verse: { type: 'string', description: 'Versículo ("14") ou trecho ("14-16").' },
      fields: {
        type: 'array',
        items: { type: 'string', enum: STUDY_FIELDS },
        description: `Campos. Padrão: ${JSON.stringify(DEFAULT_STUDY_FIELDS)}. Extras: "publication_index", "chapter_level" (esboço do capítulo), "combined_text".`,
        default: DEFAULT_STUDY_FIELDS
      },
      limit: { type: 'number', description: 'Máximo de referências em study_articles e publication_index (padrão: sem limite).' },
      fetch: { type: 'boolean', description: 'Ignorar o cache e buscar de novo.', default: false },
      lang: LANG_SCHEMA
    }
  }
};

export async function getVerseWithStudyImplementation(args = {}) {
  try {
    const { book, chapter, verseStart, verseEnd } = resolveReference(args);
    const validation = validateReference(book, chapter, verseStart);
    if (!validation.valid) return { content: [{ type: 'text', text: `Validation error: ${validation.error}` }], isError: true };

    const fields = Array.isArray(args.fields) && args.fields.length ? args.fields : DEFAULT_STUDY_FIELDS;
    const invalid = fields.filter((f) => !STUDY_FIELDS.includes(f));
    if (invalid.length) {
      return { content: [{ type: 'text', text: `Campos inválidos: ${invalid.join(', ')}. Válidos: ${STUDY_FIELDS.join(', ')}` }], isError: true };
    }
    const fresh = Boolean(args.fetch);
    const limit = args.limit ? Number(args.limit) : null;
    const needWol = fields.includes('study_articles') || fields.includes('publication_index');

    const [bible, wol] = await Promise.all([
      loadVerses(book, chapter, args.lang, fresh),
      needWol
        ? scraper
            .getVerseWithStudy(book, chapter, `${verseStart}-${Math.min(verseEnd, 200)}`, {
              fields: fields.filter((f) => f === 'study_articles' || f === 'publication_index'),
              limit,
              lang: args.lang,
              fresh
            })
            .catch((e) => ({ error: e.message }))
        : Promise.resolve(null)
    ]);
    const { data, source, fallback_reason } = bible;
    const verses = data.verses.filter((v) => v.verse >= verseStart && v.verse <= verseEnd);
    const lastVerse = verses.length ? verses[verses.length - 1].verse : verseStart;

    const response = {
      reference: displayRef(book, chapter, verseStart, Math.min(verseEnd, lastVerse), args.lang),
      lang: getLocale(args.lang).code,
      book_number: book,
      chapter,
      verse_range: verseStart === lastVerse ? `${verseStart}` : `${verseStart}-${lastVerse}`,
      text_source: source,
      jw_org_link: data.link || null
    };
    if (fallback_reason) response.note = fallback_reason;

    if (fields.includes('verses')) {
      response.verses = verses;
      if (verseStart <= 1 && data.superscription) response.superscription = data.superscription;
    }
    if (fields.includes('combined_text')) response.combined_text = verses.map((v) => `${v.verse}. ${v.text}`).join(' ');
    if (fields.includes('study_notes')) response.study_notes = sliceByVerse(data.study_notes, verseStart, verseEnd);
    if (fields.includes('footnotes')) {
      const fn = sliceByVerse(data.footnotes, verseStart, verseEnd);
      if (Object.keys(fn).length) response.footnotes = fn;
    }
    if (fields.includes('cross_references')) response.cross_references = sliceByVerse(data.cross_references, verseStart, verseEnd);
    if (fields.includes('media')) {
      const media = itemsTouching(data.media, verseStart, verseEnd);
      if (media.length) response.media = media;
    }
    if (fields.includes('video_clips')) {
      const clips = itemsTouching(data.video_clips, verseStart, verseEnd);
      if (clips.length) response.video_clips = clips;
    }
    if (fields.includes('chapter_level')) response.chapter_level = { outline: data.outline };

    if (wol?.error) response.research_error = `Guia de Pesquisa indisponível agora: ${wol.error}`;
    else if (wol) {
      if (wol.study_articles) {
        response.study_articles = wol.study_articles;
        response.study_articles_count = wol.study_articles.length;
        response.study_articles_total = wol.study_articles_total;
      }
      if (wol.publication_index) {
        response.publication_index = wol.publication_index;
        response.publication_index_total = wol.publication_index_total;
        if (wol.publication_index_unlinked) response.publication_index_unlinked = wol.publication_index_unlinked;
      }
      response.research_source_url = wol.source_url;
    }

    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Erro ao buscar o conteúdo de estudo: ${error.message}` }], isError: true };
  }
}

// ============================================================================
// Tool 4: get_bible_verse_url
// ============================================================================

export const getBibleVerseURLTool = {
  name: 'get_bible_verse_url',
  description: 'Get the jw.org URL for a Bible verse or range of verses. Returns a direct link to view the scripture on jw.org. Supports single verses (e.g., verse: "18"), verse ranges (e.g., verse: "14-16"), and comma-separated verses (e.g., verse: "1,3,5" - will convert to range if contiguous). Use search_bible_books to find book numbers. Perfect for adding clickable scripture links to markdown documents.',
  inputSchema: {
    type: 'object',
    properties: {
      reference: REFERENCE_SCHEMA,
      book: {
        type: ['number', 'string'],
        description: 'Bible book number (1-66) or name ("Salmos", "Sl"). Alternative to "reference".'
      },
      chapter: {
        type: 'number',
        description: 'Chapter number within the book'
      },
      verse: {
        type: 'string',
        description: 'Optional verse reference. Can be: single verse ("18"), verse range ("14-16"), or comma-separated verses ("1,3,5"). If omitted, returns URL for the entire chapter.'
      },
      lang: LANG_SCHEMA
    },
    required: []
  }
};

export async function getBibleVerseURLImplementation(book, chapter, verse, lang) {
  try {
    // Validate the reference (use verse 1 if no verse provided for validation)
    const verseForValidation = verse ? (verse.toString().split(/[-,]/)[0]) : 1;
    const validation = validateReference(book, chapter, parseInt(verseForValidation));
    if (!validation.valid) {
      return {
        content: [{
          type: 'text',
          text: `Validation error: ${validation.error}`
        }],
        isError: true
      };
    }

    // Format book and chapter with zero-padding
    const bookNum = book.toString();
    const chapterNum = chapter.toString().padStart(3, '0');

    let bibleParam;
    let verseDisplay;

    if (verse) {
      // Parse verse parameter
      const verseStr = verse.toString();

      // Check if it contains a comma (multiple verses)
      if (verseStr.includes(',')) {
        const verseArray = verseStr.split(',').map(v => parseInt(v.trim())).sort((a, b) => a - b);

        // Check if verses are contiguous
        const isContiguous = verseArray.every((v, i) => i === 0 || v === verseArray[i - 1] + 1);

        if (isContiguous && verseArray.length > 1) {
          // Convert to range
          const startVerse = verseArray[0].toString().padStart(3, '0');
          const endVerse = verseArray[verseArray.length - 1].toString().padStart(3, '0');
          bibleParam = `${bookNum}${chapterNum}${startVerse}-${bookNum}${chapterNum}${endVerse}`;
          verseDisplay = `${verseArray[0]}-${verseArray[verseArray.length - 1]}`;
        } else {
          // Use just the first verse for non-contiguous
          const firstVerse = verseArray[0].toString().padStart(3, '0');
          bibleParam = `${bookNum}${chapterNum}${firstVerse}`;
          verseDisplay = verseArray[0].toString();
        }
      }
      // Check if it contains a dash (range)
      else if (verseStr.includes('-')) {
        const [startVerse, endVerse] = verseStr.split('-').map(v => v.trim());
        const startVersePadded = startVerse.padStart(3, '0');
        const endVersePadded = endVerse.padStart(3, '0');
        bibleParam = `${bookNum}${chapterNum}${startVersePadded}-${bookNum}${chapterNum}${endVersePadded}`;
        verseDisplay = `${startVerse}-${endVerse}`;
      }
      // Single verse
      else {
        const versePadded = verseStr.padStart(3, '0');
        bibleParam = `${bookNum}${chapterNum}${versePadded}`;
        verseDisplay = verseStr;
      }
    } else {
      // Chapter only (no verse specified)
      bibleParam = `${bookNum}${chapterNum}`;
      verseDisplay = null;
    }

    // Build the jw.org/finder URL
    const url = `https://www.jw.org/finder?wtlocale=${getLocale(lang).meps}&prefer=lang&bible=${bibleParam}&pub=nwtsty`;

    return {
      content: [{
        type: 'text',
        text: url
      }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error generating Bible verse URL: ${error.message}`
      }],
      isError: true
    };
  }
}

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleScriptureTools(request) {
  const toolName = request.params.name;
  const args = request.params.arguments || {};

  switch (toolName) {
    case 'search_bible_books':
      return await searchBibleBooksImplementation(args.query, args.limit);

    case 'get_bible_verse':
      return await getBibleVerseImplementation(args);

    case 'get_verse_with_study':
      return await getVerseWithStudyImplementation(args);

    case 'get_bible_verse_url':
      if (args.reference) {
        const c = parseReferenceInput(String(args.reference));
        if (c) {
          const verse = c.ranges ? c.ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',') : undefined;
          return await getBibleVerseURLImplementation(c.book, c.chapter, verse, args.lang);
        }
      }
      return await getBibleVerseURLImplementation(bookArg(args.book), Number(args.chapter), args.verse, args.lang);

    default:
      return null;
  }
}
