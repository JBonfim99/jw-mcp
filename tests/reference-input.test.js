import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReferenceInput, formatCitation, lookupBookLoose } from '../src/tools/scripture-refs.js';

const cases = {
  // the same verse written many ways
  'Sal. 46:2': 'Salmos 46:2',
  'Salmo 46:2': 'Salmos 46:2',
  'Salmos 46:2': 'Salmos 46:2',
  'salmo 46:2': 'Salmos 46:2',
  'salmo 46 2': 'Salmos 46:2',
  'SALMO 46:2': 'Salmos 46:2',
  'sl 46:2': 'Salmos 46:2',
  'Sl 46.2': 'Salmos 46:2',
  'salmos 46, 2': 'Salmos 46:2',
  'Salmo 46 : 2': 'Salmos 46:2',
  'Salmo 46 vers 2': 'Salmos 46:2',
  'Salmo 46, versículo 2': 'Salmos 46:2',
  'Sal 46:2a': 'Salmos 46:2',
  'salmo 46:2 e 3': 'Salmos 46:2, 3',
  'Sal 46:2 a 4': 'Salmos 46:2-4',
  'Salmo 46.2-4': 'Salmos 46:2-4',
  'Sal. 46:2; Mt 6:33': 'Salmos 46:2',
  // other books and abbreviations
  'jo 3 16': 'João 3:16',
  'Joao 17 3': 'João 17:3',
  'Jó 38:4': 'Jó 38:4',
  'mateus 24 14': 'Mateus 24:14',
  'Mc 13:10': 'Marcos 13:10',
  'Lc 21:24': 'Lucas 21:24',
  'ap 21 4': 'Apocalipse 21:4',
  'apoc. 21:3, 4': 'Apocalipse 21:3, 4',
  'genesis 1 1': 'Gênesis 1:1',
  'prov. 3 5 6': 'Provérbios 3:5, 6',
  'Pv 3:5': 'Provérbios 3:5',
  'Cantares 2:1': 'Cântico de Salomão 2:1',
  'fp 4:6': 'Filipenses 4:6',
  'Filemon 1:6': 'Filêmon 1:6',
  'Is 41:10': 'Isaías 41:10',
  'Lamentações 3:22': 'Lamentações 3:22',
  // numbered books
  '1 jo 4:8': '1 João 4:8',
  'primeira joão 4:8': '1 João 4:8',
  'I Pedro 5:7': '1 Pedro 5:7',
  '1ª Pedro 5:7': '1 Pedro 5:7',
  'II Timóteo 3:16': '2 Timóteo 3:16',
  'segunda timoteo 3 16': '2 Timóteo 3:16',
  'I Coríntios 13:4': '1 Coríntios 13:4',
  '1 cor 13 4-7': '1 Coríntios 13:4-7',
  // whole chapters
  'salmo 23': 'Salmos 23',
  'Mt 24': 'Mateus 24',
  'Salmos 46-48': 'Salmos 46-48',
  'Jer 40 a 41': 'Jeremias 40-41',
};

test('typed references are understood in many forms', () => {
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(formatCitation(parseReferenceInput(input)), expected, input);
  }
});

test('unknown references stay null', () => {
  for (const input of ['xyz 3:4', 'salmo', '', '46:2']) assert.equal(parseReferenceInput(input), null, input);
});

test('loose book lookup', () => {
  assert.equal(lookupBookLoose('salm'), 19);
  assert.equal(lookupBookLoose('lament'), 25);
  assert.equal(lookupBookLoose('Jo'), 43);
  assert.equal(lookupBookLoose('Jó'), 18);
  assert.equal(lookupBookLoose('fil'), 50); // NWT symbol for Filipenses
  assert.equal(lookupBookLoose('1 corin'), 46);
});
