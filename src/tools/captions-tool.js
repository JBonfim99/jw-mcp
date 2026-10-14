import { fetchWithTimeout } from './fetch-with-timeout.js';
import { getLocale, LANG_SCHEMA } from './locale.js';
import { fetchJsonCached } from './wol-http.js';

export const captionsTool = {
  name: 'get_jw_captions',
  description:
    'Legendas (transcrição) de um vídeo do JW.org, no idioma escolhido (padrão português). Aceita o ID do vídeo (ex.: "pub-jwbvod26_2_VIDEO", que get_meeting_week devolve em "videos") ou uma URL do jw.org com lank=/docid=. format="text" (padrão) devolve só o texto falado, mais econômico; "vtt" devolve o arquivo com tempos.',
  inputSchema: {
    type: 'object',
    properties: {
      video_id: {
        type: 'string',
        description: 'ID do vídeo (pub-..._VIDEO ou docid-..._VIDEO) ou URL do jw.org que o contenha.',
      },
      format: { type: 'string', enum: ['text', 'vtt'], description: 'Formato da legenda (padrão: text).', default: 'text' },
      lang: LANG_SCHEMA,
    },
    required: ['video_id'],
  },
};

export function extractVideoId(input) {
  if (!String(input).includes('http')) return String(input).trim();
  try {
    const url = new URL(input);
    const lank = url.searchParams.get('lank');
    if (lank) return lank;
    const docid = url.searchParams.get('docid');
    if (docid) return docid;
    const pathMatch = url.pathname.match(/\/(pub-[^/]+|docid-[^/]+)/);
    if (pathMatch) return pathMatch[1];
    return input;
  } catch {
    return input;
  }
}

/** Convert WebVTT to plain spoken text (no timings, no positioning, no repeated lines). */
export function vttToText(vtt) {
  const lines = String(vtt).replace(/\r/g, '').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === 'WEBVTT' || /^\d+$/.test(line) || line.includes('-->') || /^(NOTE|STYLE|REGION)\b/.test(line)) continue;
    const text = line.replace(/<[^>]+>/g, '').trim();
    if (text && out[out.length - 1] !== text) out.push(text);
  }
  // join lines into running text, keeping sentence breaks
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

export async function getCaptionsImplementation(video_id, { format = 'text', lang } = {}) {
  try {
    const loc = getLocale(lang);
    const id = extractVideoId(video_id);
    const mediaUrl = `https://b.jw-cdn.org/apis/mediator/v1/media-items/${loc.meps}/${encodeURIComponent(id)}?clientType=www`;
    const mediaData = await fetchJsonCached(mediaUrl);
    const media = mediaData?.media?.[0];

    if (!media || !media.files) {
      return { content: [{ type: 'text', text: `Vídeo "${id}" não encontrado em ${loc.code}.` }], isError: true };
    }

    const subtitlesUrl = media.files.find((f) => f.subtitles?.url)?.subtitles?.url;
    const video480 = media.files.find((f) => /480/.test(f.label || ''))?.progressiveDownloadURL || null;

    if (!subtitlesUrl) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ title: media.title, duration_seconds: media.duration, video_url: video480, subtitles: null, note: 'Vídeo sem legenda disponível neste idioma.' }, null, 2) }],
      };
    }

    const subtitlesResponse = await fetchWithTimeout(subtitlesUrl);
    if (!subtitlesResponse.ok) {
      return { content: [{ type: 'text', text: `Falha ao baixar a legenda: HTTP ${subtitlesResponse.status}` }], isError: true };
    }
    const vtt = await subtitlesResponse.text();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              video_id: id,
              title: media.title || null,
              lang: loc.code,
              duration_seconds: media.duration ?? null,
              thumbnail: media.images?.wss?.sm || null,
              video_url: video480,
              format,
              subtitles: format === 'vtt' ? vtt : vttToText(vtt),
            },
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
  if (request.params.name === 'get_jw_captions') {
    const { video_id, format, lang } = request.params.arguments || {};
    return getCaptionsImplementation(video_id, { format, lang });
  }
  return null;
}
