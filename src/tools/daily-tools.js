/**
 * get_daily_text (Examine as Escrituras Diariamente) and get_song (Cante de Coração).
 */
import { getLocale, wolUrl, LANG_SCHEMA } from './locale.js';
import { fetchWolHtml } from './wol-http.js';
import { parseDailyText, parseSongbookIndex, parseSong, parseArticleBlocks } from './wol-document.js';
import { selectParagraphs, parseParagraphRefs, todayInTz } from './study-tools.js';

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

// ---------------------------------------------------------------------------

export const dailyTextTool = {
  name: 'get_daily_text',
  description:
    'Texto diário (Examine as Escrituras Diariamente) de hoje ou de uma data: texto do dia, comentário, textos citados e a matéria de origem (ex.: "w24.12 23 §§ 13-14"). Com sources=true, também traz os parágrafos de origem já recortados.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'AAAA-MM-DD (padrão: hoje, fuso America/Fortaleza).' },
      sources: { type: 'boolean', description: 'Trazer os parágrafos da matéria de origem (padrão false).', default: false },
      lang: LANG_SCHEMA,
    },
  },
};

export async function dailyTextImplementation(args = {}) {
  try {
    const loc = getLocale(args.lang);
    const date = args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : todayInTz();
    const [y, m, d] = date.split('-').map(Number);
    const url = wolUrl(loc, 'dt', y, m, d);
    const { html } = await fetchWolHtml(url, loc);
    const dt = parseDailyText(html, { readWords: loc.read, lang: loc.code });
    if (!dt) return fail(`Texto diário não encontrado para ${date}.`);

    const out = { date, lang: loc.code, ...dt };
    if (args.sources && dt.sources.length) {
      out.source_paragraphs = [];
      for (const src of dt.sources.slice(0, 3)) {
        try {
          const { html: docHtml, finalUrl } = await fetchWolHtml(src.url, loc);
          const doc = parseArticleBlocks(docHtml, { readWords: loc.read });
          const sel = selectParagraphs(doc, { paragraphs: parseParagraphRefs(src.label), pages: src.label, context: 0, maxParagraphs: 6 });
          out.source_paragraphs.push({ label: src.label, title: doc.title, citation: doc.citation, url: finalUrl, matched_by: sel.matchedBy, paragraphs: sel.paragraphs });
        } catch (error) {
          out.source_paragraphs.push({ label: src.label, error: error.message });
        }
      }
    }
    return ok(out);
  } catch (error) {
    return fail(`Erro ao buscar o texto diário: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------

export const songTool = {
  name: 'get_song',
  description:
    'Letra de um cântico do "Cante de Coração para Jeová" pelo número (os cânticos da semana vêm em get_meeting_week): título, texto bíblico em que se baseia, estrofes e refrão.',
  inputSchema: {
    type: 'object',
    properties: {
      number: { type: 'number', description: 'Número do cântico (1-163...).' },
      lang: LANG_SCHEMA,
    },
    required: ['number'],
  },
};

export async function songImplementation(args = {}) {
  try {
    const loc = getLocale(args.lang);
    const n = Number(args.number);
    if (!Number.isInteger(n) || n < 1) return fail('Informe "number" (ex.: 33).');
    const { html: indexHtml } = await fetchWolHtml(wolUrl(loc, 'publication', 'sjj'), loc);
    const index = parseSongbookIndex(indexHtml);
    const url = index[String(n)];
    if (!url) return fail(`Cântico ${n} não encontrado no cancioneiro (${Object.keys(index).length} cânticos listados).`);
    const { html } = await fetchWolHtml(url, loc);
    return ok({ lang: loc.code, url, ...parseSong(html) });
  } catch (error) {
    return fail(`Erro ao buscar o cântico: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------

export const dailyTools = [dailyTextTool, songTool];

export async function handleDailyTools(request) {
  const args = request.params.arguments || {};
  switch (request.params.name) {
    case 'get_daily_text':
      return dailyTextImplementation(args);
    case 'get_song':
      return songImplementation(args);
    default:
      return null;
  }
}
