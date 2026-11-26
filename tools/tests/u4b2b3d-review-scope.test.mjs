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
  ['unrelated quiz mode', 'function ColourQuizView({', 'function ColourQuizView(/* changed */{'],
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
