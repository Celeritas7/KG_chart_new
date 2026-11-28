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
  // pronunciation, colour rendering helpers and authorization outside.
  ['    function ColourQuizView(', '\n    // ==========================================\n    // TYPING TEST (timed)'],
  ['    function SpeakView(', '\n    // ==========================================\n    // COLOUR + NOUN QUIZ'],
  ['    function TypingView(', '\n    // ==========================================\n    // CARDS:'],
  ['    function useLevels(', '\n    // ==========================================\n    // WORD BUILDER QUIZ\n'],
  ['    function WordQuizView(', '\n    // ==========================================\n    // SENTENCE QUIZ (kg_chart_sentences)\n'],
  ['    function SentenceQuizView(', '\n    // ==========================================\n    // SPEAK A PARAGRAPH (any sentence group, read in order)\n'],
  // F2E2d: only the account typing-best helpers, not typing normalization,
  // matching, settings or the shared duration/language definitions.
  ['    const TYPING_BEST_KEY =', '\n    const TYPING_LANG_TAGS ='],
  // F2E2e: preserve FlagButton, AddWordModal and Chart behavior around the
  // reviewed batch dialog. The single dialog/controller has separate bounds.
  ['    function BatchFlagModal(', '\n    function AddWordModal('],
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
  // Only the flag controller/recovery shell and single dialog may change
  // here. Reasons, keyboard/modal detection and legacy compatibility stay
  // above this boundary; FlagButton and DetailModal remain protected.
  const flagStart = uniquePosition(source,
    '    // F2E2e — exact restricted flag submissions and recovery.', true);
  const flagHeader = uniquePosition(source,
    '    // Flag one word (item), one sentence or one colour phrase ({ id, native, meaning, hint }):');
  const flagModal = uniquePosition(source, '    function FlagModal(');
  const flagButtonHeader = uniquePosition(source, '    // Small 🚩 for quiz / Speak screens');
  const singleFlagStart = flagStart === -1 ? flagHeader : flagStart;
  assert(singleFlagStart <= flagHeader && flagHeader < flagModal && flagModal < flagButtonHeader,
    'Invalid reviewed flag component boundary');
  source = source.slice(0, singleFlagStart) + '    /* reviewed flag controller and single dialog */\n' + source.slice(flagButtonHeader);
  // The new account preference controller sits beside AudioControls. Keep
  // SpeakButton, Header, AuthContext and all authentication code outside.
  const preferenceStart = uniquePosition(source,
    '    // F2E2d — shared account preference state and exact recovery.', true);
  const audioHeader = uniquePosition(source,
    '    // Header: ♀/♂ voice + auto-play mute. Saved on the account (kg_chart_user_prefs).');
  const audioControls = uniquePosition(source, '    function AudioControls(');
  const authHeader = uniquePosition(source,
    '\n    // ==========================================\n    // AUTH CONTEXT\n');
  const audioStart = preferenceStart === -1 ? audioHeader : preferenceStart;
  assert(audioStart <= audioHeader && audioHeader < audioControls && audioControls < authHeader,
    'Invalid reviewed account preference component boundary');
  source = source.slice(0, audioStart) + '    /* reviewed account preference components */\n' + source.slice(authHeader);
  // Old unowned storage must remain available for later reconciliation.
  uniquePosition(source, "    const TYPING_BEST_KEY = 'kg_chart_typing_best';");
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
  // F2E2e: an exact standalone recovery panel is the only AppContent edit.
  // Normalize it first so the earlier preference wiring's position checks
  // still protect the unchanged surrounding providers and panel.
  const flagPanel = '          <FlagRecoveryPanel user={user} languageCode={selectedLanguage} policy={policy} />\n';
  const preferencePanel = '          <PreferenceRecoveryPanel flow={preferences} />\n';
  const flagPanelAt = uniquePosition(source, flagPanel, true);
  assert((flagStart !== -1) === (flagPanelAt !== -1), 'Flag recovery controller and AppContent panel wiring must be complete');
  if (flagPanelAt !== -1) {
    uniquePosition(source, flagPanel + preferencePanel);
    source = source.replace(flagPanel + preferencePanel, preferencePanel);
  }
  // Safari pointer activation does not reliably focus the report button.
  // Admit this one focus call without opening its styling or callbacks.
  const focusedFlagButton = 'onClick={(e) => { e.stopPropagation(); e.currentTarget.focus({ preventScroll: true }); onClick(); }} title="Flag wrong Devanagari, word, picture…"';
  const originalFlagButton = 'onClick={(e) => { e.stopPropagation(); onClick(); }} title="Flag wrong Devanagari, word, picture…"';
  uniquePosition(source, focusedFlagButton, true);
  source = source.replace(focusedFlagButton, originalFlagButton);
  // F2E2d: admit only the complete preference controller/provider/panel wiring
  // at its reviewed AppContent positions. App authorization and navigation
  // remain byte-for-byte protected, including when a marker is moved.
  const oldPreferenceEffect = '      useEffect(() => { if (user) window.KGAudio.initPrefs(supabase, user.id); }, [user]);\n';
  const preferenceWiring = [
    ['      const preferences = usePersonalPreferences(user, policy, verified);\n',
      '      const verified = !access.loading && !access.error && window.KGLearnerAccess.ready(policy);\n', ''],
    ['        <KGPreferenceContext.Provider value={preferences}>\n',
      '      return (\n', '        <RulesContext.Provider value={rules}>\n'],
    ['        </KGPreferenceContext.Provider>\n',
      '        </RulesContext.Provider>\n', '      );'],
    ['          <PreferenceRecoveryPanel flow={preferences} />\n',
      '', '          <PictureDownloads vocabulary={vocabulary} loading={loadingVocab || !priv.loaded} />\n'],
  ];
  const preferenceParts = preferenceWiring.map(([marker]) => uniquePosition(source, marker, true));
  const oldPreferenceAt = uniquePosition(source, oldPreferenceEffect, true);
  if (preferenceParts.some(at => at !== -1)) {
    assert(preferenceParts.every(at => at !== -1) && oldPreferenceAt === -1,
      'Preference AppContent wiring must be complete and replace the legacy init effect');
    for (const [marker, before, after] of preferenceWiring) {
      uniquePosition(source, before + marker + after);
      source = source.replace(before + marker + after, before + after);
    }
  } else {
    assert(oldPreferenceAt !== -1, 'Missing preference AppContent wiring');
    source = source.replace(oldPreferenceEffect, '');
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
  // F2E2a-R1: transient focus origins at the two existing Chart rating
  // callsites and visibility of the inline strip on focus. Keep the rest of
  // VocabCard and DetailModal protected.
  const ratingOrigins = [
    ['onClick={(e) => { e.stopPropagation(); onRate(item.id, r.id, undefined, e.currentTarget); }}',
      'onClick={(e) => { e.stopPropagation(); onRate(item.id, r.id); }}'],
    ['onClick={(e) => onRate(item.id, r.id, undefined, e.currentTarget)}',
      'onClick={() => onRate(item.id, r.id)}'],
    ['className="absolute bottom-0 left-0 right-0 bg-white/95 border-t border-gray-200 p-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"',
      'className="absolute bottom-0 left-0 right-0 bg-white/95 border-t border-gray-200 p-2 opacity-0 group-hover:opacity-100 transition-opacity"'],
  ];
  for(const [next,old] of ratingOrigins){
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
    'Learner source outside the reviewed quiz/level/rating/recovery/preference/flag regions changed; separate review is required');
}

// F2E2d permits preference lifecycle changes in KGAudio, not a change to
// playback, public/private source resolution or media authorization.
export function normalizeAudioPreferenceSource(input) {
  let source = input;
  const exports = '    setPreferenceScope, applyPreferenceState,\n';
  uniquePosition(source, exports, true);
  source = source.replace(exports, '');
  const initial = uniquePosition(source,
    '  // ---- prefs: voice m/f + mute (');
  const policy = uniquePosition(source, '\n  // U3C2B1: installed sources remain legacy until the separate U3D/U4');
  assert(policy > initial, 'Invalid reviewed audio preference state boundary');
  source = source.slice(0, initial) + '  /* reviewed audio preference state */\n' + source.slice(policy);
  const bridge = uniquePosition(source, '  // F2E2d preference scope', true);
  const init = uniquePosition(source, '  async function initPrefs(');
  const manifests = uniquePosition(source,
    '\n  // ---- manifests: audio/<lang>/clips.json -> { m: [hash], f: [hash] } ----');
  const start = bridge === -1 ? init : bridge;
  assert(start <= init && init < manifests, 'Invalid reviewed audio preference lifecycle boundary');
  return source.slice(0, start) + '  /* reviewed audio preference lifecycle */\n' + source.slice(manifests);
}

export function assertAudioPreferenceReviewScope(before, after) {
  assert.equal(normalizeAudioPreferenceSource(after), normalizeAudioPreferenceSource(before),
    'Audio source outside the reviewed account preference state/lifecycle and exact exports changed; playback and media authorization remain protected');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  assert(base && /^[a-f0-9]{40}$/.test(base), 'Pass the full merge-base SHA');
  const before = execFileSync('git', ['show', `${base}:index.html`], {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  assertF1ReviewScope(before, readFileSync('index.html', 'utf8'));
  const audioBefore = execFileSync('git', ['show', `${base}:js/kg-audio.js`], {encoding: 'utf8', maxBuffer: 1024 * 1024});
  assertAudioPreferenceReviewScope(audioBefore, readFileSync('js/kg-audio.js', 'utf8'));
  console.log('F1_REVIEW_SCOPE_PASS: unrelated learner source, restricted UI gate and audio playback/security preserved');
}
