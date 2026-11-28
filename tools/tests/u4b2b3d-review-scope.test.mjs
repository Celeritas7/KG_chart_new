import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertF1ReviewScope} from '../check-f1-review-scope.mjs';

const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('reviewed F1 recovery and quiz behavior can change without broadening the surrounding source scope', () => {
  const edited = source.replace('Results saved', 'Results confirmed');
  assert.notEqual(edited, source);
  assert.doesNotThrow(() => assertF1ReviewScope(source, edited));
});

for (const [label, before, after] of [
  ['restricted flag activation', 'const U3C1_SCOPED_UI_ENABLED = false;', 'const U3C1_SCOPED_UI_ENABLED = true;'],
  ['authentication logic', 'function AuthProvider({ children }) {', 'function AuthProvider({ children }) { return children;'],
  ['authorization logic', 'function useLearnerAccess(user) {', 'function useLearnerAccess(user) { return { state: "legacy" };'],
  ['navigation scope', 'function Header({', 'function Header(/* changed */{'],
  ['unrelated quiz mode', 'function SayItView({', 'function SayItView(/* changed */{'],
  ['colour rendering helper', 'function ColourPicture({', 'function ColourPicture(/* changed */{'],
  ['preference helper', 'async function syncTypingBests(user, local) {', 'async function syncTypingBests(user, local) { return {};'],
  ['pronunciation helper', 'const PRON_MAX_SECONDS = 15;', 'const PRON_MAX_SECONDS = 16;'],
  ['unrelated script', '  <script src="./js/kg-sentence-access.js"></script>', '  <script src="./js/kg-sentence-access.js"></script><script src="./unexpected.js"></script>'],
]) test(`F1 scope rejects ${label}`, () => {
  const edited = source.replace(before, after);
  assert.notEqual(edited, source, 'Fixture must alter a real protected boundary');
  assert.throws(() => assertF1ReviewScope(source, edited));
});

test('missing or duplicate component boundaries fail closed', () => {
  assert.throws(() => assertF1ReviewScope(source, source.replace('    function WordQuizView(', '    function RenamedQuizView(')));
  assert.throws(() => assertF1ReviewScope(source, source + '\n    function SentenceQuizView('));
});

test('F2E1c scope admits the reviewed colour producer but not a missing boundary', () => {
  const edited = source.replace('data-colour-option={o.id}', 'data-colour-option={o.id} title="Option"');
  assert.notEqual(edited, source);
  assert.doesNotThrow(() => assertF1ReviewScope(source, edited));
  assert.throws(() => assertF1ReviewScope(source, source.replace('    function ColourQuizView(', '    function RenamedColourQuizView(')));
});

test('F2E2a admits reviewed rating hook and exact wiring only',()=>{
  const edited=source.replace('Rating confirmed.','Rating saved.');
  assert.notEqual(edited,source);
  assert.doesNotThrow(()=>assertF1ReviewScope(source,edited));
  assert.throws(()=>assertF1ReviewScope(source,source.replace('function ProgressView({','function ProgressView(/* changed */{')));
  assert.throws(()=>assertF1ReviewScope(source,source.replace('    function useUserRatings(','    function RenamedRatings(')));
  assert.throws(()=>assertF1ReviewScope(source,source.replace("restrictedRatings={policy.state === 'restricted'}","restrictedRatings={true}")));
});

test('F2E2b keeps the path recovery change bounded',()=>{
  const edited=source.replace('Topic completion confirmed by the server.','Confirmed topic completion.');
  assert.notEqual(edited,source);
  assert.doesNotThrow(()=>assertF1ReviewScope(source,edited));
  assert.throws(()=>assertF1ReviewScope(source,source.replace('function LockedTopicPanel({','function LockedTopicPanel(/* changed */{')));
});

test('F2E2a-R1 admits exact rating focus origins while protecting word-detail behavior',()=>{
  const chart='onClick={(e) => { e.stopPropagation(); onRate(item.id, r.id, undefined, e.currentTarget); }}';
  const detail='onClick={(e) => onRate(item.id, r.id, undefined, e.currentTarget)}';
  const strip='className="absolute bottom-0 left-0 right-0 bg-white/95 border-t border-gray-200 p-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"';
  assert.ok(source.includes(chart)&&source.includes(detail)&&source.includes(strip),'Exercise both actual reviewed rating callsites and focused strip');
  const previous=source.replace(chart,'onClick={(e) => { e.stopPropagation(); onRate(item.id, r.id); }}')
    .replace(detail,'onClick={() => onRate(item.id, r.id)}')
    .replace(strip,strip.replace(' group-focus-within:opacity-100',''));
  assert.doesNotThrow(()=>assertF1ReviewScope(previous,source));
  for(const [before,after] of [
    ['function VocabCard({','function VocabCard(/* changed */{'],
    ['function DetailModal({','function DetailModal(/* changed */{'],
    ['const saveDevanagari = async () => {','const saveDevanagari = async () => { return;'],
    [detail,'onClick={(e) => onRate(item.id, r.id, null, e.currentTarget)}'],
    [strip,strip.replace('bg-white/95','bg-black/95')],
  ]){
    const changed=source.replace(before,after);
    assert.notEqual(changed,source);
    assert.throws(()=>assertF1ReviewScope(source,changed));
  }
  assert.throws(()=>assertF1ReviewScope(source,source+'\n'+detail),'Duplicate origin markers fail closed');
});
