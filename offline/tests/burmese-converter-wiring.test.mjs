import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const [learnerHtml, adminHtml, burmeseJs] = await Promise.all([
  fs.readFile(path.join(root, 'index.html'), 'utf8'),
  fs.readFile(path.join(root, 'kg-chart-admin.html'), 'utf8'),
  fs.readFile(path.join(root, 'offline/language-utils/burmese.js'), 'utf8'),
]);

const expected = [
  ['ပီဇာ', 'पीझा'],
  ['ဒိန်ခဲ', 'देंघे'],
  ['ကြက်ဥ', "च'ऊ"],
  ['ဒိန်ချဥ်', "देंछ'"],
  ['ဟမ်ဘာဂါ', 'हॅभागा'],
];

function section(source, from, until) {
  const start = source.indexOf(from);
  const end = source.indexOf(until, start);
  assert(start >= 0 && end > start, `Missing converter section: ${from}`);
  return source.slice(start, end);
}

function loader(source, kind) {
  const learner = kind === 'learner';
  const code = learner
    ? section(source, "const LANG_UTILS_BASE = 'https://celeritas7.github.io/language-utils';", '// Load all converters at startup')
    : section(source, '// ---- Shared repo URL ----', '// ---- Scanner UI ----');
  const ctx = {
    console: { log() {}, warn() {} },
    SCRIPT_RANGES: { my: { file: 'burmese', type: 'standard' }, si: { file: 'sinhala', type: 'standard' } },
    fetch: async url => ({
      ok: true,
      text: async () => url.endsWith('/burmese.js') ? burmeseJs
        : 'export function toDev() { return "literal"; }\nexport function toPronunciation() { return "spoken"; }',
    }),
  };
  return vm.runInNewContext(`${code}\n${learner ? 'loadLanguageConverter' : 'loadConverterJS'}`, ctx);
}

for (const [kind, html] of [['learner', learnerHtml], ['admin', adminHtml]]) {
  test(`${kind} uses the merged Burmese pronunciation corrections`, async () => {
    const getConverter = loader(html, kind);
    const burmese = await getConverter('my');
    assert(burmese);
    assert.equal(burmese.usePronunciation, false, 'Burmese still reads native_text, not the Chinese pinyin field');
    for (const [native, devanagari] of expected) {
      assert.equal(burmese.toDevanagari(native), devanagari, native);
    }
    const sinhala = await getConverter('si');
    assert.equal(sinhala.toDevanagari('example'), 'literal', 'Other languages retain their existing toDev converter');
  });
}

test('admin flag list shows a live value without changing the original report', () => {
  assert.match(adminHtml, /const shown=f\.shown_devanagari\|\|'';/);
  assert.match(adminHtml, /Now \(JS\): \$\{escH\(current\)\}/);
  assert.match(adminHtml, /if\(S\.page==='flags'\)loadFlagConverters\(\)/);
});
