import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseChapterHtml } from '../src/tools/wol-scraper.js';
import { getLocale } from '../src/tools/locale.js';
import { parseCitation, formatCitation, citationIncludes } from '../src/tools/scripture-refs.js';
import {
  parseArticleBlocks,
  parseWatchtowerStudy,
  parseWorkbookWeek,
  parseMeetingsPage,
  parseSearchResults,
} from '../src/tools/wol-document.js';
import { selectParagraphs, isoWeek, parsePages, parseParagraphRefs } from '../src/tools/study-tools.js';
import { vttToText, extractVideoId, parseVtt, cuesToTimestamped } from '../src/tools/captions-tool.js';
import { parseBibleChapterJson, verseHtmlToText, sliceByVerse, itemsTouching, chapterDataUrl } from '../src/tools/bible-json.js';
import { parseDailyText, parseSongbookIndex, parseSong } from '../src/tools/wol-document.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
const pt = getLocale('pt');

// ---------------------------------------------------------------------------
test('locale aliases', () => {
  assert.equal(getLocale('T').code, 'pt');
  assert.equal(getLocale('pt-BR').code, 'pt');
  assert.equal(getLocale('E').meps, 'E');
  assert.throws(() => getLocale('xx'));
});

test('citation parser handles WOL formats', () => {
  const cases = {
    'Mateus 6:31, 32': 'Mateus 6:31, 32',
    'Mat. 6:25-34': 'Mateus 6:25-34',
    '1 Tim. 6:6-8': '1 Timóteo 6:6-8',
    'EFÉ. 6:12': 'Efésios 6:12',
    'Mt 5:20': 'Mateus 5:20',
    'Jo 6:27': 'João 6:27',
    'Jó 6:2': 'Jó 6:2',
    'Pro. 4:5, 6;': 'Provérbios 4:5, 6',
    'JEREMIAS 40-41': 'Jeremias 40-41',
    'LUC. 12:31': 'Lucas 12:31',
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(formatCitation(parseCitation(input)), expected, input);
  }
  const prev = parseCitation('Mar. 15:1,');
  assert.equal(formatCitation(parseCitation(' 13-15', prev)), 'Marcos 15:13-15');
  assert.ok(citationIncludes(parseCitation('Mat. 6:25-34'), 40, 6, 33));
  assert.ok(!citationIncludes(parseCitation('Mateus 6:31, 32'), 40, 6, 33));
  assert.ok(citationIncludes(parseCitation('JEREMIAS 40-41'), 24, 41, 5));
});

// ---------------------------------------------------------------------------
test('chapter: verses, notes, cross refs, research guide, publication index', () => {
  const r = parseChapterHtml(fixture('chapter-mt6-pt.html'), 40, 6, pt);

  assert.deepEqual(r.verses.map((v) => v.verse_num), [32, 33, 34]);
  const v33 = r.verses.find((v) => v.verse_num === 33).verse_text;
  assert.match(v33, /^“Persistam, então, em buscar primeiro o Reino/);
  assert.ok(!v33.includes('+'));
  assert.equal(r.verses[0].book_name, 'Mateus');
  assert.match(r.verses.find((v) => v.verse_num === 34).verse_text, /amanhã.*Bastam a cada dia/);

  const s = r.sections[33];
  assert.equal(s.study_notes.length, 3);
  assert.deepEqual(s.cross_references, ['Sal 37:25', 'Mal 3:10', 'Jo 6:27', 'He 13:5']);

  const titles = s.research_guide.map((a) => a.title);
  assert.ok(titles.includes('Textos Bíblicos Explicados, artigo 15'));
  assert.ok(titles.includes('A Sentinela (Público), N.° 2 2020 pp. 14-15'));
  assert.ok(titles.includes('Perspicaz, Volume 1, p. 1092'));
  assert.ok(titles.includes('A Sentinela (Estudo), 12/2016, p. 25'));
  assert.ok(titles.includes('A Sentinela, 15/9/2015, pp. 24-25'));
  assert.ok(titles.includes('A Sentinela, 1/1/2006, pp. 25-29'), titles.join(' | '));
  assert.ok(titles.includes('A Sentinela, 15/11/1987, pp. 11'));
  assert.ok(titles.includes('Despertai!, 6/2007, p. 9'));
  assert.equal(s.research_guide.length, 16, titles.join(' | '));
  assert.ok(s.research_guide.every((a) => a.url.startsWith('https://wol.jw.org/pt/wol/pc/')));
  assert.equal(s.research_guide.find((a) => a.title.includes('15/9/2015')).year, 2015);
  assert.equal(s.research_guide.find((a) => a.title.startsWith('Perspicaz')).type, 'insight');

  const refs = s.publication_index.map((x) => x.ref);
  assert.equal(refs.length, 11);
  assert.ok(refs.includes('w16.07 12'));
  assert.ok(refs.includes('kr 67'), refs.join(' | '));
  assert.equal(s.publication_index.find((x) => x.ref === 'w16.07 12').year, 2016);
  assert.equal(s.publication_index.find((x) => x.ref === 'it-1 1092').year, null);
  assert.deepEqual(s.publication_index_unlinked, ['g66 8/3 6', 'g65 22/4 29', 'ln 28']);
});

// ---------------------------------------------------------------------------
test('reference doc: finds the paragraphs that cite Mateus 6:33', () => {
  const doc = parseArticleBlocks(fixture('reference-w16-07-pt.html'), { readWords: pt.read });
  assert.equal(doc.title, 'Busque primeiro o Reino e não as outras coisas');
  assert.equal(doc.citation, 'w16 julho págs. 7-12');

  const target = parseCitation('Mateus 6:33');
  const { matchedBy, paragraphs } = selectParagraphs(doc, { target, context: 0 });
  assert.equal(matchedBy, 'verse');
  assert.deepEqual(paragraphs.map((p) => p.number), [18, 20]); // "Leia Mateus 6:33" and "Mat. 6:25-34"
  const p18 = paragraphs[0];
  assert.equal(p18.page, 12);
  assert.equal(p18.section, 'VOCÊ COLOCA O REINO EM PRIMEIRO LUGAR?');
  assert.ok(p18.cites_target);
  assert.ok(p18.scriptures.includes('Mateus 6:33 (leitura)'), p18.scriptures.join(' | '));
  assert.match(p18.text, /^Leia Mateus 6:33\. Os discípulos/);

  const withContext = selectParagraphs(doc, { target, context: 1 });
  assert.deepEqual(withContext.paragraphs.map((p) => p.number), [17, 18, 19, 20]);

  const byPages = selectParagraphs(doc, { pages: 'p. 12' });
  assert.equal(byPages.matchedBy, 'pages');
  assert.deepEqual(byPages.paragraphs.map((p) => p.number), [18, 19, 20]);
});

test('page parser', () => {
  assert.deepEqual([...parsePages('A Sentinela, 15/9/2015, pp. 24-25')], [24, 25]);
  assert.deepEqual([...parsePages('7/2016, p. 12')], [12]);
  assert.deepEqual([...parsePages('w16.07 12')], [12]);
});

// ---------------------------------------------------------------------------
test('watchtower study: questions grouped with paragraphs', () => {
  const wt = parseWatchtowerStudy(fixture('watchtower-study-pt.html'), { readWords: pt.read });
  assert.equal(wt.title, 'Você pode vencer a luta contra Satanás e os demônios');
  assert.equal(wt.week, '12-18 DE OUTUBRO DE 2026');
  assert.equal(wt.citation, 'w26 agosto págs. 8-13');
  assert.deepEqual(wt.songs, ['CÂNTICO 129 Eu vou perseverar', 'CÂNTICO 149 Um cântico de vitória']);
  assert.match(wt.theme_scripture.text, /Temos uma luta/);
  assert.match(wt.objective, /^Ver o que podemos fazer/);

  const items = wt.sections.flatMap((s) => s.items);
  assert.deepEqual(items.map((i) => i.paragraphs_numbers), [[1], [2], [3], [4], [5, 6]]);
  assert.equal(items[0].question, 'Contra quem todos nós temos que lutar? (Efésios 6:11, 12)');
  assert.deepEqual(items[4].paragraphs.map((p) => p.number), [5, 6]);
  assert.ok(items[0].paragraphs[0].scriptures.includes('Efésios 6:11, 12 (leitura)'), items[0].paragraphs[0].scriptures.join(' | '));
  assert.ok(items[0].paragraphs[0].scriptures.includes('Isaías 2:4'));
  assert.ok(items[4].paragraphs[0].scriptures.includes('Tiago 3:14-16 (leitura)'));

  const headings = wt.sections.map((s) => s.heading);
  assert.ok(headings.includes('SATANÁS TENTA DESTRUIR NOSSA UNIÃO'));
  assert.equal(items[2].paragraphs[0].page, 8);
  assert.equal(wt.figures.length, 1);
  assert.match(wt.figures[0].description, /Saul fica com ciúmes/);
  assert.equal(wt.review_questions.length, 2);
});

// ---------------------------------------------------------------------------
test('workbook week: sections, parts, minutes, questions, videos', () => {
  const wb = parseWorkbookWeek(fixture('workbook-week-pt.html'), { readWords: pt.read });
  assert.equal(wb.week, '5-11 DE OUTUBRO');
  assert.equal(wb.weekly_bible_reading, 'JEREMIAS 40-41');
  assert.deepEqual(wb.songs, ['Cântico 33', 'Cântico 17', 'Cântico 38']);

  const sectionTitles = wb.sections.map((s) => s.title);
  assert.deepEqual(sectionTitles, [null, 'TESOUROS DA PALAVRA DE DEUS', 'FAÇA SEU MELHOR NO MINISTÉRIO', 'NOSSA VIDA CRISTÃ']);

  const parts = wb.sections.flatMap((s) => s.parts);
  const byNum = Object.fromEntries(parts.filter((p) => p.number).map((p) => [p.number, p]));
  assert.equal(byNum[1].title, 'Tenha o ponto de vista correto sobre a proteção de Jeová');
  assert.equal(byNum[1].minutes, 10);
  assert.equal(byNum[1].content.length, 4);
  assert.ok(byNum[1].references.some((r) => r.label === 'jr 189 § 16'), JSON.stringify(byNum[1].references));
  assert.equal(byNum[1].images.length, 1);
  assert.equal(byNum[2].questions.length, 2);
  assert.equal(byNum[3].minutes, 4);
  assert.match(byNum[3].content[0], /^Jer\. 40:1-10/);
  assert.equal(byNum[8].minutes, 15);
  assert.equal(byNum[8].questions.length, 2);
  assert.equal(byNum[8].videos[0].video_id, 'pub-jwbvod26_2_VIDEO');
  assert.match(byNum[8].videos[0].title, /^Recuperei a Alegria/);
  assert.equal(byNum[9].minutes, 30);
  assert.equal(wb.videos.length, 1);
  assert.equal(wb.videos[0].part, 8);

  const opening = parts[0];
  assert.equal(opening.number, null);
  assert.equal(opening.minutes, 1);
});

// ---------------------------------------------------------------------------
test('meetings page and search results', () => {
  const m = parseMeetingsPage(fixture('meetings-2026-42-pt.html'));
  assert.equal(m.workbook.url, 'https://wol.jw.org/pt/wol/d/r5/lp-t/202026257');
  assert.equal(m.watchtower.url, 'https://wol.jw.org/pt/wol/d/r5/lp-t/2026521');

  const results = parseSearchResults(fixture('search-pt.html'));
  assert.equal(results.length, 3);
  assert.equal(results[0].title, '5-11 de outubro');
  assert.equal(results[0].url, 'https://wol.jw.org/pt/wol/d/r5/lp-t/202026256');
  assert.equal(results[0].occurrences, 7);
  assert.equal(results[0].publication_symbol, 'mwb26');
  assert.equal(results[1].citation, 'w03 1/9 págs. 23-28 - A Sentinela — 2003');
  assert.match(results[2].snippet, /órfãos e de viúvas/);
});

test('iso week (meetings are indexed by ISO week)', () => {
  assert.deepEqual(isoWeek('2026-10-14'), { year: 2026, week: 42 });
  assert.deepEqual(isoWeek('2026-10-11'), { year: 2026, week: 41 });
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
});

test('captions helpers', () => {
  assert.deepEqual(extractVideoId('https://www.jw.org/finder?lank=pub-jwbvod26_2_VIDEO&wtlocale=T'), { id: 'pub-jwbvod26_2_VIDEO', ts: null });
  assert.deepEqual(extractVideoId('https://www.jw.org/finder?&wtlocale=T&lank=pub-gnj_5_VIDEO&ts=00:14:54.39-00:15:58.83'), {
    id: 'pub-gnj_5_VIDEO',
    ts: '00:14:54.39-00:15:58.83',
  });
  const vtt =
    'WEBVTT\r\n\r\n00:00:02.314 --> 00:00:05.317 line:90%\r\nTínhamos uma vida divertida.\r\n\r\n00:00:05.317 --> 00:00:06.944\r\nTivemos dois filhos.\r\n\r\n00:01:10.000 --> 00:01:12.500\r\nE então tudo mudou.\r\n';
  assert.equal(vttToText(vtt), 'Tínhamos uma vida divertida. Tivemos dois filhos. E então tudo mudou.');
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 3);
  assert.equal(cues[2].start, 70);
  assert.equal(cuesToTimestamped(cues), '[0:02] Tínhamos uma vida divertida. Tivemos dois filhos.\n\n[1:10] E então tudo mudou.');
});

// ---------------------------------------------------------------------------
test('study-Bible JSON: verses, notes, cross refs, media, video clips', () => {
  const json = JSON.parse(fixture('bible-json-mt6-pt.json'));
  const d = parseBibleChapterJson(json, 40, 6);
  assert.equal(d.citation, 'Mateus 6:1-34');
  assert.deepEqual(d.verses.map((v) => v.verse), [1, 32, 33, 34]);
  assert.equal(
    d.verses.find((v) => v.verse === 33).text,
    '“Persistam, então, em buscar primeiro o Reino e a justiça de Deus, e todas essas outras coisas lhes serão acrescentadas.'
  );
  assert.match(d.verses[0].text, /^“Tomem cuidado/); // chapter number removed
  assert.deepEqual(sliceByVerse(d.cross_references, 33, 33), { 33: ['Salmo 37:25', 'Malaquias 3:10', 'João 6:27', 'Hebreus 13:5'] });
  assert.equal(sliceByVerse(d.study_notes, 33, 33)[33].length, 3);
  assert.match(sliceByVerse(d.study_notes, 33, 33)[33][0], /^Persistam \. \. \. em buscar:/);
  assert.deepEqual(sliceByVerse(d.footnotes, 13, 13), { 13: ['Ou: “salva-nos”.'] });
  assert.deepEqual(d.outline.slice(0, 2), ['D. Sermão do Monte (5:1–7:29)', 'Jesus começa o Sermão do Monte']);

  const media = itemsTouching(d.media, 1, 34);
  assert.equal(media.length, 1);
  assert.equal(media[0].title, 'Sinagoga do século 1 d.C.');
  assert.equal(media[0].verses, '2');
  assert.equal(itemsTouching(d.media, 33, 33).length, 0);

  const clips = itemsTouching(d.video_clips, 3, 3);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].video_id, 'pub-gnj_5_VIDEO');
  assert.equal(clips[0].start, '00:14:54.39');
  assert.equal(clips[0].end, '00:15:58.83');
  assert.equal(clips[0].verses, '1-4');
  assert.match(clips[0].title, /^Não pratiquem a justiça só para chamar atenção/);

  assert.equal(chapterDataUrl(40, 6, 'pt'), 'https://www.jw.org/pt/biblioteca/biblia/biblia-de-estudo/livros/json/data/40006000-40006999');
  assert.equal(chapterDataUrl(1, 1, 'en'), 'https://www.jw.org/en/library/bible/study-bible/books/json/data/1001000-1001999');
});

test('study-Bible JSON: poetry keeps lines and superscription', () => {
  const d = parseBibleChapterJson(JSON.parse(fixture('bible-json-ps23-pt.json')), 19, 23);
  assert.equal(d.superscription, 'Salmo de Davi.');
  assert.equal(d.verses[0].text, 'Jeová é o meu Pastor.\nNada me faltará.');
  assert.equal(d.verses[1].text, 'Ele me faz deitar em verdes pastagens\nE me conduz a lugares de descanso bem regados.');
  assert.equal(verseHtmlToText('<span class="style-b"><sup class="verseNum">5 </sup> Texto.<xref id="1"></xref></span>'), 'Texto.');
});

// ---------------------------------------------------------------------------
test('paragraph references (§)', () => {
  assert.deepEqual([...parseParagraphRefs('w24.12 23 §§ 13-14')], [13, 14]);
  assert.deepEqual([...parseParagraphRefs('jr 189 § 16')], [16]);
  assert.equal(parseParagraphRefs('lmd lição 2 ponto 3'), null);
  const doc = parseArticleBlocks(fixture('reference-w16-07-pt.html'), { readWords: pt.read });
  const sel = selectParagraphs(doc, { paragraphs: parseParagraphRefs('w16.07 12 §§ 18-19'), pages: 'w16.07 12 §§ 18-19' });
  assert.equal(sel.matchedBy, 'paragraphs');
  assert.deepEqual(sel.paragraphs.map((p) => p.number), [18, 19]);
});

test('daily text', () => {
  const dt = parseDailyText(fixture('daily-text-pt.html'), { readWords: pt.read });
  assert.equal(dt.date_heading, 'Quarta-feira, 14 de outubro');
  assert.equal(dt.publication, 'Examine as Escrituras Diariamente — 2026');
  assert.match(dt.theme_scripture, /^Jeová está perto dos que têm coração quebrantado/);
  assert.equal(dt.theme_reference, 'Salmos 34:18');
  assert.match(dt.comment, /^Você está se sentindo abalado/);
  assert.ok(!dt.comment.includes('w24.12'));
  assert.deepEqual(dt.scriptures_cited, ['Isaías 65:17']);
  assert.deepEqual(dt.sources, [{ label: 'w24.12 23 §§ 13-14', url: 'https://wol.jw.org/pt/wol/pc/r5/lp-t/1102026209/13/0' }]);
});

test('songbook', () => {
  const index = parseSongbookIndex(fixture('songbook-index-pt.html'));
  assert.equal(index['33'], 'https://wol.jw.org/pt/wol/d/r5/lp-t/1102016833');
  assert.equal(index['163'], 'https://wol.jw.org/pt/wol/d/r5/lp-t/1102022963');
  assert.equal(Object.keys(index).length, 4);

  const song = parseSong(fixture('song-33-pt.html'));
  assert.equal(song.number, 33);
  assert.equal(song.title, 'Deixe Jeová levar seus fardos');
  assert.equal(song.based_on, 'Salmo 55');
  assert.equal(song.stanzas.length, 2);
  assert.deepEqual(song.stanzas[0], ['Ouve a minha oração, Pai.', 'Presta atenção em mim.', 'Alivia essa angústia', 'Que parece não ter fim.']);
  assert.deepEqual(song.chorus, ['Deixe Deus levar seus fardos;', 'Ele está sempre ao seu lado.', 'Quem confia em Jeová', 'Jamais sozinho ficará.']);
  assert.equal(song.see_also, 'Veja também Sal. 22:5; 31:1-24.');
});
