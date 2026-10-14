// Live check: calls every tool against the real jw.org / wol.jw.org and prints
// a compact summary per tool as GitHub annotations (::notice / ::error), so the
// results can be read from the Checks API. Run with: node scripts/live-check.mjs
import { getMeetingWeekImplementation, getReferenceImplementation, searchLibraryImplementation } from '../src/tools/study-tools.js';
import { getVerseWithStudyImplementation, getBibleVerseImplementation } from '../src/tools/scripture-tools.js';
import { getCaptionsImplementation, listVideosImplementation } from '../src/tools/captions-tool.js';
import { dailyTextImplementation, songImplementation } from '../src/tools/daily-tools.js';

const results = [];
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
const cut = (s, n = 160) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}…` : String(s ?? ''));

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const summary = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true });
    console.log(`::notice title=OK ${name} (${ms} ms)::${esc(JSON.stringify(summary, null, 1))}`);
    return summary;
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`::error title=FAIL ${name}::${esc(error.stack || error.message)}`);
    return null;
  }
}

function parse(res) {
  const text = res?.content?.[0]?.text ?? '';
  if (res?.isError) throw new Error(text);
  return JSON.parse(text);
}

let week;
await check('get_meeting_week (atual)', async () => {
  week = parse(await getMeetingWeekImplementation({}));
  const wb = week.workbook;
  const wt = week.watchtower;
  const parts = wb?.sections.flatMap((s) => s.parts) || [];
  const items = wt?.sections.flatMap((s) => s.items) || [];
  if (!wb || !wt) throw new Error(`faltou matéria: workbook=${!!wb} watchtower=${!!wt} ${JSON.stringify(week).slice(0, 400)}`);
  if (!items.length || !parts.length) throw new Error('estrutura vazia');
  return {
    iso_week: week.iso_week,
    workbook: { week: wb.week, reading: wb.weekly_bible_reading, parts: parts.map((p) => `${p.number ?? '-'}:${cut(p.title, 40)}(${p.minutes ?? '?'}m)`), songs: wb.song_numbers, videos: wb.videos.map((v) => v.video_id) },
    watchtower: {
      title: wt.title,
      week: wt.week,
      questions: items.length,
      first_question: cut(items[0].question, 90),
      first_paragraph: cut(items[0].paragraphs[0]?.text, 90),
      first_scriptures: items[0].paragraphs[0]?.scriptures,
      figures: wt.figures.length,
      review: wt.review_questions.length,
      songs: wt.song_numbers,
    },
  };
});

await check('get_meeting_week (semana passada)', async () => {
  const w = parse(await getMeetingWeekImplementation({ offset_weeks: -1, part: 'workbook' }));
  return { iso_week: w.iso_week, week: w.workbook?.week, videos: w.workbook?.videos?.map((v) => `${v.video_id} ${cut(v.title, 50)}`) };
});

let study;
await check('get_verse_with_study Mateus 6:33', async () => {
  study = parse(await getVerseWithStudyImplementation({ reference: 'Mateus 6:33', fields: ['verses', 'study_notes', 'study_articles', 'publication_index', 'cross_references', 'footnotes', 'media', 'video_clips'] }));
  if (study.research_error) throw new Error(study.research_error);
  return {
    text_source: study.text_source,
    verse: cut(study.verses?.[0]?.text, 120),
    notes: study.study_notes?.['33']?.length,
    cross: study.cross_references?.['33'],
    guide_total: study.study_articles_total,
    guide_first: study.study_articles?.slice(0, 3).map((a) => `${a.title} [${a.year ?? '-'}]`),
    pub_index_total: study.publication_index_total,
    clips: study.video_clips,
  };
});

await check('get_verse_with_study Mateus 6:1-4 (trechos de vídeo e mídia)', async () => {
  const s = parse(await getVerseWithStudyImplementation({ reference: 'Mat. 6:1-4', fields: ['verses', 'media', 'video_clips'] }));
  if (!s.video_clips?.length) throw new Error('sem video_clips');
  return { clips: s.video_clips, media: s.media?.map((m) => m.title) };
});

await check('get_bible_verse Salmo 23 (poesia)', async () => {
  const v = parse(await getBibleVerseImplementation({ reference: 'Sal. 23:1-2' }));
  if (!v.verses?.[0]?.text.includes('\n')) throw new Error(`poesia sem quebra de linha: ${JSON.stringify(v.verses)}`);
  return { source: v.source, superscription: v.superscription, verses: v.verses };
});

await check('get_reference (Guia de Pesquisa → parágrafo do versículo)', async () => {
  const art = study?.study_articles?.find((a) => /Sentinela/.test(a.title)) || study?.study_articles?.[0];
  if (!art) throw new Error('sem referência do Guia de Pesquisa');
  const r = parse(await getReferenceImplementation({ url: art.url, reference: 'Mateus 6:33', label: art.title }));
  return { ref: art.title, title: r.title, citation: r.citation, matched_by: r.matched_by, paragraphs: r.paragraphs.map((p) => `§${p.number ?? '-'} p.${p.page ?? '-'} ${p.cites_target ? '*' : ''} ${cut(p.text, 80)}`) };
});

await check('get_reference (rótulo da apostila com §)', async () => {
  const parts = week?.workbook?.sections.flatMap((s) => s.parts) || [];
  const ref = parts.flatMap((p) => p.references || []).find((r) => /§/.test(r.label));
  if (!ref) return { note: 'semana sem referência com §' };
  const r = parse(await getReferenceImplementation({ url: ref.url, label: ref.label }));
  return { label: ref.label, title: r.title, matched_by: r.matched_by, paragraphs: r.paragraphs.map((p) => `§${p.number ?? '-'} ${cut(p.text, 80)}`) };
});

await check('search_library', async () => {
  const s = parse(await searchLibraryImplementation({ query: 'viúvas Jeová cuida', limit: 5 }));
  if (!s.results_count) throw new Error('nenhum resultado');
  const n = parse(await searchLibraryImplementation({ query: 'ansiedade', collection: 'watchtower', sort: 'newest', limit: 3 }));
  return { first: s.results.slice(0, 3).map((r) => `${r.title} — ${r.citation} (${r.occurrences})`), newest_wt: n.results.map((r) => r.citation) };
});

await check('get_daily_text (com fontes)', async () => {
  const d = parse(await dailyTextImplementation({ sources: true }));
  return { heading: d.date_heading, theme: d.theme_reference, comment: cut(d.comment, 100), sources: d.source_paragraphs?.map((s) => `${s.label} → ${s.matched_by} ${s.paragraphs?.map((p) => p.number).join(',')}`) };
});

await check('get_song', async () => {
  const n = week?.workbook?.song_numbers?.[0] || 33;
  const s = parse(await songImplementation({ number: n }));
  if (!s.stanzas?.length) throw new Error('sem estrofes');
  return { number: s.number, title: s.title, based_on: s.based_on, stanzas: s.stanzas.length, first: s.stanzas[0].slice(0, 2), chorus: s.chorus?.slice(0, 2) };
});

await check('get_jw_captions (vídeo da apostila)', async () => {
  const id = week?.workbook?.videos?.[0]?.video_id || 'pub-jwbvod26_2_VIDEO';
  const c = parse(await getCaptionsImplementation(id, {}));
  return { id, title: c.title, chars: c.total_chars, start: cut(c.subtitles, 140) };
});

await check('get_jw_captions (trecho com minutagem)', async () => {
  const clip = study?.video_clips?.[0] || { video_id: 'pub-gnj_5_VIDEO', start: '00:14:54.39', end: '00:15:58.83' };
  const c = parse(await getCaptionsImplementation(clip.video_id, { start: clip.start, end: clip.end, format: 'timestamps' }));
  return { id: clip.video_id, title: c.title, clip: c.clip, chars: c.total_chars, text: cut(c.subtitles, 220) };
});

await check('list_jw_videos + "última transmissão"', async () => {
  const l = parse(await listVideosImplementation({ category: 'broadcast', limit: 3 }));
  const mw = parse(await listVideosImplementation({ category: 'morning_worship', limit: 2 }));
  const c = parse(await getCaptionsImplementation('última transmissão', { max_chars: 5000 }));
  return { broadcasts: l.videos.map((v) => `${v.published} ${v.title}`), morning_worship: mw.videos.map((v) => v.title), latest: { title: c.title, chars: c.total_chars, next_offset: c.next_offset } };
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length ? 1 : 0);
