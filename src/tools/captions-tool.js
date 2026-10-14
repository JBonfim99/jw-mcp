import { fetchWithTimeout } from './fetch-with-timeout.js';
import { getLocale, LANG_SCHEMA } from './locale.js';
import { fetchJsonCached } from './wol-http.js';
import { normKey } from './scripture-refs.js';

const MEDIATOR = 'https://b.jw-cdn.org/apis/mediator/v1';

export const VIDEO_CATEGORIES = {
  broadcast: 'StudioMonthlyPrograms',
  morning_worship: 'VODPgmEvtMorningWorship',
  talks: 'StudioTalks',
  news: 'StudioNewsReports',
};

const CATEGORY_HINTS = [
  [/transmiss|broadcast|programa mensal|monthly program/, 'broadcast'],
  [/adoracao matinal|morning worship|adoracion matutina/, 'morning_worship'],
  [/boletim|corpo governante|governing body|update|noticia|news|anuncio/, 'news'],
  [/discurso|talk/, 'talks'],
];

const MONTHS = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// ---------------------------------------------------------------------------
// list_jw_videos
// ---------------------------------------------------------------------------

export const listVideosTool = {
  name: 'list_jw_videos',
  description:
    'Lista os vídeos mais recentes do JW Broadcasting por categoria — "broadcast" (programa mensal), "morning_worship" (Adoração Matinal), "talks" (discursos), "news" (boletins do Corpo Governante e anúncios). Devolve video_id, título, data e duração; abra a transcrição com get_jw_captions.',
  inputSchema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: Object.keys(VIDEO_CATEGORIES), description: 'Categoria (padrão: broadcast).', default: 'broadcast' },
      limit: { type: 'number', description: 'Quantidade (padrão 10).', default: 10 },
      lang: LANG_SCHEMA,
    },
  },
};

export async function fetchCategory(category, loc) {
  const key = VIDEO_CATEGORIES[category] || category;
  const data = await fetchJsonCached(`${MEDIATOR}/categories/${loc.meps}/${encodeURIComponent(key)}?detailed=0&clientType=www`);
  const media = (data?.category?.media || []).slice();
  media.sort((a, b) => String(b.firstPublished).localeCompare(String(a.firstPublished)));
  return { name: data?.category?.name || key, media };
}

const summarize = (m) => ({
  video_id: m.languageAgnosticNaturalKey || m.naturalKey,
  title: m.title,
  published: String(m.firstPublished || '').slice(0, 10) || null,
  duration_minutes: m.duration ? Math.round(m.duration / 6) / 10 : null,
});

export async function listVideosImplementation(args = {}) {
  try {
    const loc = getLocale(args.lang);
    const category = args.category || 'broadcast';
    const { name, media } = await fetchCategory(category, loc);
    const limit = Math.max(1, Math.min(Number(args.limit ?? 10), 50));
    return {
      content: [{ type: 'text', text: JSON.stringify({ category, category_name: name, lang: loc.code, videos: media.slice(0, limit).map(summarize) }, null, 2) }],
    };
  } catch (error) {
    return { content: [{ type: 'text', text: `Erro ao listar vídeos: ${error.message}` }], isError: true };
  }
}

// ---------------------------------------------------------------------------
// get_jw_captions
// ---------------------------------------------------------------------------

export const captionsTool = {
  name: 'get_jw_captions',
  description:
    'Transcrição (legendas) de um vídeo do JW.org no idioma escolhido (padrão português). video_id aceita: o ID ("pub-jwbvod26_2_VIDEO", que get_meeting_week e get_verse_with_study devolvem), uma URL do jw.org, ou atalhos como "última transmissão", "transmissão de setembro de 2026", "última adoração matinal", "último boletim do Corpo Governante". start/end recortam só um trecho (ex.: "14:54" a "15:58" — os video_clips da Bíblia de estudo já trazem isso). Textos longos vêm paginados (offset/next_offset).',
  inputSchema: {
    type: 'object',
    properties: {
      video_id: { type: 'string', description: 'ID, URL ou atalho do vídeo.' },
      format: {
        type: 'string',
        enum: ['text', 'timestamps', 'vtt'],
        description: '"text" (padrão): texto corrido; "timestamps": parágrafos com [m:ss]; "vtt": arquivo original.',
        default: 'text',
      },
      start: { type: 'string', description: 'Início do trecho ("14:54", "00:14:54.39" ou segundos).' },
      end: { type: 'string', description: 'Fim do trecho.' },
      offset: { type: 'number', description: 'Caractere inicial para paginação (use o next_offset da resposta anterior).', default: 0 },
      max_chars: { type: 'number', description: 'Tamanho máximo do texto por resposta (padrão 20000).', default: 20000 },
      lang: LANG_SCHEMA,
    },
    required: ['video_id'],
  },
};

export function extractVideoId(input) {
  const s = String(input || '').trim();
  if (!s.includes('http')) return { id: s, ts: null };
  try {
    const url = new URL(s);
    const ts = url.searchParams.get('ts');
    const lank = url.searchParams.get('lank');
    if (lank) return { id: lank, ts };
    const docid = url.searchParams.get('docid');
    if (docid) return { id: docid, ts };
    const pathMatch = url.pathname.match(/\/(pub-[^/]+|docid-[^/]+)/);
    if (pathMatch) return { id: pathMatch[1], ts };
    return { id: s, ts };
  } catch {
    return { id: s, ts: null };
  }
}

/** Resolve shortcuts like "última transmissão" or "transmissão de setembro de 2026" to a video id. */
export async function resolveVideoShortcut(input, loc) {
  const raw = String(input || '').trim();
  if (/^(pub|docid)-/i.test(raw) || raw.includes('http')) return null;
  const k = normKey(raw).replace(/^latest:\s*/, '');
  let category = Object.keys(VIDEO_CATEGORIES).find((c) => k === c);
  if (!category) category = CATEGORY_HINTS.find(([re]) => re.test(k))?.[1];
  if (!category) return null;

  const { media } = await fetchCategory(category, loc);
  if (!media.length) throw new Error(`Nenhum vídeo na categoria ${category}.`);

  const month = Object.entries(MONTHS).find(([name]) => new RegExp(`\\b${name}\\b`).test(k))?.[1];
  const year = (k.match(/\b(20\d{2})\b/) || [])[1];
  let pick = media[0];
  if (month || year) {
    const found = media.find((m) => {
      const d = String(m.firstPublished || '');
      const t = normKey(m.title || '');
      const monthOk = !month || Number(d.slice(5, 7)) === month || Object.entries(MONTHS).some(([n, v]) => v === month && t.includes(n));
      const yearOk = !year || d.startsWith(year) || t.includes(year);
      return monthOk && yearOk;
    });
    if (!found) throw new Error(`Não achei vídeo de ${category} para "${raw}".`);
    pick = found;
  }
  return pick.languageAgnosticNaturalKey || pick.naturalKey;
}

function toSeconds(t) {
  if (t == null || t === '') return null;
  const s = String(t).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const fmt = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Parse WebVTT into cues { start, end, text }. */
export function parseVtt(vtt) {
  const cues = [];
  const blocks = String(vtt).replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0) continue;
    const [a, b] = lines[timing].split('-->').map((x) => x.trim().split(/\s+/)[0]);
    const text = lines
      .slice(timing + 1)
      .map((l) => l.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)
      .join(' ');
    if (text) cues.push({ start: toSeconds(a), end: toSeconds(b), text });
  }
  return cues;
}

/** Plain spoken text (no timings, no repeated lines). */
export function vttToText(vtt) {
  const out = [];
  for (const c of parseVtt(vtt)) if (out[out.length - 1] !== c.text) out.push(c.text);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Paragraphs of ~45 s each, prefixed with [m:ss]. */
export function cuesToTimestamped(cues) {
  const paras = [];
  let cur = null;
  for (const c of cues) {
    if (!cur || c.start - cur.start > 45) {
      cur = { start: c.start, text: [] };
      paras.push(cur);
    }
    if (cur.text[cur.text.length - 1] !== c.text) cur.text.push(c.text);
  }
  return paras.map((p) => `[${fmt(p.start)}] ${p.text.join(' ')}`).join('\n\n');
}

export async function getCaptionsImplementation(video_id, { format = 'text', lang, start, end, offset = 0, max_chars = 20000 } = {}) {
  try {
    const loc = getLocale(lang);
    let { id, ts } = extractVideoId(video_id);
    const shortcut = await resolveVideoShortcut(video_id, loc);
    if (shortcut) id = shortcut;

    if (ts && !start && !end) [start, end] = ts.split('-');

    const mediaUrl = `${MEDIATOR}/media-items/${loc.meps}/${encodeURIComponent(id)}?clientType=www`;
    const mediaData = await fetchJsonCached(mediaUrl);
    const media = mediaData?.media?.[0];
    if (!media || !media.files) {
      return { content: [{ type: 'text', text: `Vídeo "${id}" não encontrado em ${loc.code}.` }], isError: true };
    }

    const subtitlesUrl = media.files.find((f) => f.subtitles?.url)?.subtitles?.url;
    const video480 = media.files.find((f) => /480/.test(f.label || ''))?.progressiveDownloadURL || null;
    const meta = {
      video_id: id,
      title: media.title || null,
      lang: loc.code,
      published: String(media.firstPublished || '').slice(0, 10) || null,
      duration_seconds: media.duration ?? null,
      video_url: video480,
    };

    if (!subtitlesUrl) {
      return { content: [{ type: 'text', text: JSON.stringify({ ...meta, subtitles: null, note: 'Vídeo sem legenda disponível neste idioma.' }, null, 2) }] };
    }

    const subtitlesResponse = await fetchWithTimeout(subtitlesUrl);
    if (!subtitlesResponse.ok) {
      return { content: [{ type: 'text', text: `Falha ao baixar a legenda: HTTP ${subtitlesResponse.status}` }], isError: true };
    }
    const vtt = await subtitlesResponse.text();

    let cues = parseVtt(vtt);
    const s = toSeconds(start);
    const e = toSeconds(end);
    if (s != null || e != null) {
      cues = cues.filter((c) => (s == null || c.end > s - 0.5) && (e == null || c.start < e + 0.5));
      meta.clip = { start: s != null ? fmt(s) : null, end: e != null ? fmt(e) : null };
    }

    let body;
    if (format === 'vtt' && s == null && e == null) body = vtt;
    else if (format === 'timestamps') body = cuesToTimestamped(cues);
    else {
      const out = [];
      for (const c of cues) if (out[out.length - 1] !== c.text) out.push(c.text);
      body = out.join(' ').replace(/\s+/g, ' ').trim();
    }

    const from = Math.max(0, Number(offset) || 0);
    const size = Math.max(1000, Math.min(Number(max_chars) || 20000, 60000));
    const page = body.slice(from, from + size);
    const next = from + size < body.length ? from + size : null;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ...meta, format, total_chars: body.length, offset: from, next_offset: next, subtitles: page },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return { content: [{ type: 'text', text: `Erro: ${error.message}` }], isError: true };
  }
}

export async function handleCaptionsTool(request) {
  const args = request.params.arguments || {};
  if (request.params.name === 'get_jw_captions') {
    return getCaptionsImplementation(args.video_id, args);
  }
  if (request.params.name === 'list_jw_videos') return listVideosImplementation(args);
  return null;
}
