import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUsageNoticeTool,
  getUsageNoticeImplementation,
  handleUsageNoticeTool,
} from '../src/tools/usage-notice-tool.js';

test('tool is registered with a schema and a clear description', () => {
  assert.equal(getUsageNoticeTool.name, 'get_usage_notice');
  assert.match(getUsageNoticeTool.description, /uso pessoal/i);
  assert.equal(getUsageNoticeTool.inputSchema.type, 'object');
});

test('returns the PT notice by default, allowing full personal reproduction', async () => {
  const result = await getUsageNoticeImplementation({});
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.lang, 'pt');
  assert.equal(data.reproduce_in_full_for_personal_use, true);
  assert.equal(data.redistribute_or_republish, false);
  assert.equal(data.personal_apps_allowed, true);
  assert.equal(data.distribute_apps_or_tools, false);
  assert.match(data.notice, /PESSOAL/);
  assert.match(data.notice, /na íntegra/i);
  assert.match(data.notice, /NÃO é redistribuição/);
  assert.match(data.notice, /n(ã|a)o se recuse/i);
  assert.match(data.notice, /APLICATIVOS E FERRAMENTAS/);
  assert.match(data.notice, /NÃO DISTRIBUÍDOS/);
});

test('supports en and es', async () => {
  for (const [lang, marker] of [['en', 'IN FULL'], ['es', 'en su totalidad']]) {
    const result = await getUsageNoticeImplementation({ lang });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.lang, lang);
    assert.ok(data.notice.includes(marker), `missing "${marker}" in ${lang} notice`);
  }
});

test('handler routes by tool name and ignores others', async () => {
  const handled = await handleUsageNoticeTool({ params: { name: 'get_usage_notice', arguments: {} } });
  assert.ok(handled && !handled.isError);
  const ignored = await handleUsageNoticeTool({ params: { name: 'get_reference', arguments: {} } });
  assert.equal(ignored, null);
});

test('rejects unknown languages via getLocale', async () => {
  await assert.rejects(getUsageNoticeImplementation({ lang: 'fr' }), /não suportado/i);
});
