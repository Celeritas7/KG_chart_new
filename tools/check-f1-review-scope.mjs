// Extend historical phase-only CI boundaries for the explicitly reviewed F1
// component changes, while requiring all other learner source to be unchanged.
// This is a source-scope check, not authorization or physical-device evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const ranges = [
  ['    function useLearningPath(', '\n    function LockedTopicPanel('],
  ['    function useUserRatings(', '\n    // ==========================================\n    // COMPONENTS'],
  ['    function FlashcardView(', '\n    function ProgressView('],
  // F2E1b/c: explicitly reviewed timed and colour producers only; keep Say It,
  // pronunciation, colour rendering helpers, preferences and authorization outside.
  ['    function ColourQuizView(', '\n    // ==========================================\n    // TYPING TEST (timed)'],
  ['    function SpeakView(', '\n    // ==========================================\n    // COLOUR + NOUN QUIZ'],
  ['    function TypingView(', '\n    // ==========================================\n    // CARDS:'],
  ['    function useLevels(', '\n    // ==========================================\n    // WORD BUILDER QUIZ\n'],
  ['    function WordQuizView(', '\n    // ==========================================\n    // SENTENCE QUIZ (kg_chart_sentences)\n'],
  ['    function SentenceQuizView(', '\n    // ==========================================\n    // SPEAK A PARAGRAPH (any sentence group, read in order)\n'],
];
const recoveryStart = '    // Separate recovery records; never reuse or clear the installed offline outbox.\n';
const script = '  <script src="./js/kg-quiz-save.js"></script>\n';
const sentenceWiring = 'sentenceAccess={props.sentenceAccess} onSessionSaved={props.onSessionSaved} />';
const keyedQuiz = '<QuizView key={`${user?.id || \'guest\'}:${selectedLanguage}`} topics=';

function uniquePosition(source, marker, optional = false) {
  const first = source.indexOf(marker);
  assert(first !== -1 || optional, 'Missing reviewed F1 source boundary: ' + marker);
  assert(first === -1 || source.indexOf(marker, first + marker.length) === -1,
    'Ambiguous reviewed F1 source boundary: ' + marker);
  return first;
}

export function normalizeF1Source(input) {
  let source = input;
  uniquePosition(source, script, true);
  source = source.replace(script, '');
  const recovery = uniquePosition(source, recoveryStart, true);
  if (recovery !== -1) {
    const end = uniquePosition(source, '    function WordQuizView(');
    assert(end > recovery, 'Recovery helpers must precede the word quiz');
    source = source.slice(0, recovery) + source.slice(end);
  }
  for (const [startMarker, endMarker] of ranges) {
    const start = uniquePosition(source, startMarker);
    const end = uniquePosition(source, endMarker);
    assert(end > start, 'Invalid F1 source range: ' + startMarker);
    source = source.slice(0, start) + '    /* reviewed F1 component */\n' + source.slice(end);
  }
  // Only the exact F2E2a AppContent rating wiring may change.
  const ratingWiring = [
    ['const { ratings, ratingsLoaded, updateRating, clearRating, ratingFlow } = useUserRatings(selectedLanguage, policy);',
      'const { ratings, ratingsLoaded, updateRating, clearRating } = useUserRatings(selectedLanguage);'],
    ['          <RatingRecoveryPanel flow={ratingFlow} vocabulary={vocabulary} />\n',''],
    ["<FlashcardView key={\`${user?.id || 'guest'}:${selectedLanguage}:${policy.state === 'restricted' ? policy.revision : 'legacy'}\`} topics=",
      '<FlashcardView key={selectedLanguage} topics='],
    [" restrictedRatings={policy.state === 'restricted'} />",' />'],
  ];
  for(const [next,old] of ratingWiring){
    uniquePosition(source,next,true);source=source.replace(next,old);
  }
  // F2E2b: restricted path helper and recovery panel, exact callsite only.
  const completionStart = '    // F2E2b: this hook is inactive for the activation-off legacy path.';
  const at = uniquePosition(source, completionStart, true);
  if(at!==-1){
    // Locate the end via the unchanged LockedTopicPanel boundary rather than
    // any other reviewed component placeholder.
    const boundary=uniquePosition(source,'\n    function LockedTopicPanel(');
    assert(boundary>at);
    source=source.slice(0,at)+'    /* reviewed F1 component */\n'+source.slice(boundary);
  }
  const completionWiring=[
    ['const path = useLearningPath({ user, languageCode: selectedLanguage, topics, vocabulary, rules, policy });',
      'const path = useLearningPath({ user, languageCode: selectedLanguage, topics, vocabulary, rules });'],
    ['          <CompletionRecoveryPanel flow={path.completionFlow} topics={topics} />\n',''],
    ['            ) : path.error ? (\n              <div role="alert" className="max-w-2xl mx-auto p-6">Confirmed learning path unavailable. Reconnect and refresh progress.</div>\n',''],
  ];
  for(const [next,old] of completionWiring){
    uniquePosition(source,next,true);source=source.replace(next,old);
  }
  uniquePosition(source, sentenceWiring, true);
  source = source.replace(sentenceWiring, 'sentenceAccess={props.sentenceAccess} />');
  uniquePosition(source, keyedQuiz, true);
  return source.replace(keyedQuiz, '<QuizView topics=');
}

export function assertF1ReviewScope(before, after) {
  assert(after.includes('const U3C1_SCOPED_UI_ENABLED = false;'), 'Restricted UI activation must remain OFF');
  assert.equal(normalizeF1Source(after), normalizeF1Source(before),
    'Learner source outside the reviewed F1/F2E1b/c/F2E2a quiz/level/rating/recovery regions changed; separate review is required');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  assert(base && /^[a-f0-9]{40}$/.test(base), 'Pass the full merge-base SHA');
  const before = execFileSync('git', ['show', `${base}:index.html`], {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  assertF1ReviewScope(before, readFileSync('index.html', 'utf8'));
  console.log('F1_REVIEW_SCOPE_PASS: non-F1 learner source and restricted UI gate preserved');
}
