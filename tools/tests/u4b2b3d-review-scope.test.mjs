import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertF1ReviewScope,assertAudioPreferenceReviewScope,assertR1ReviewScope,assertR2ReviewScope} from '../check-f1-review-scope.mjs';

const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const audioSource = readFileSync(new URL('../../js/kg-audio.js', import.meta.url), 'utf8');

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
  ['shared difficulty constants', 'const LEVELS = [', 'const LEVELS = [null,'],
  ['legacy difficulty formula', 'function levelProgress(sessions, level, levelUp = DEFAULT_RULES.level_up) {', 'function levelProgress(sessions, level, levelUp = DEFAULT_RULES.level_up) { return {};'],
  ['typing language definitions', 'const TYPING_LANG_TAGS = {', 'const TYPING_LANG_TAGS = { unexpected: "en",'],
  ['typing normalization', 'const typingNorm = (s) =>', 'const typingNorm = (s) => s ||'],
  ['typing matching', 'function typingMatch(typed, target) {', 'function typingMatch(typed, target) { return {};'],
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

test('F2E2d admits preference controls and typing-best helpers without opening adjacent source',()=>{
  for(const marker of ['    function AudioControls(', '    function mergeTypingBests(']){
    assert.ok(source.includes(marker));
    assert.doesNotThrow(()=>assertF1ReviewScope(source,source.replace(marker,marker+'/* reviewed preferences */')));
  }
  const marker='    // F2E2d — shared account preference state and exact recovery.';
  const header='    // Header: ♀/♂ voice + auto-play mute. Saved on the account (kg_chart_user_prefs).';
  const extended=source.includes(marker)?source:source.replace(header,
    marker+'\n    function PreferenceScopeFixture() { return null; }\n\n'+header);
  assert.doesNotThrow(()=>assertF1ReviewScope(source,extended));
  assert.throws(()=>assertF1ReviewScope(extended,extended+'\n'+marker));
  for(const boundary of ['    function AudioControls(', '    const TYPING_BEST_KEY =',
    '\n    const TYPING_LANG_TAGS =', '\n    // ==========================================\n    // AUTH CONTEXT\n']){
    assert.throws(()=>assertF1ReviewScope(source,source.replace(boundary,'/* missing preference boundary */')));
    assert.throws(()=>assertF1ReviewScope(source,source+'\n'+boundary));
  }
  assert.throws(()=>assertF1ReviewScope(source,
    source.replace("const TYPING_BEST_KEY = 'kg_chart_typing_best';","const TYPING_BEST_KEY = 'replacement';")),
    'The historical unowned mirror key must remain available for later reconciliation');
});

test('F2E2d admits only complete exact preference AppContent wiring at reviewed positions',()=>{
  // Reconstruct this earlier integration independently of F2E2e's later
  // recovery panel, which deliberately anchors beside the preference panel.
  let preferenceSource=source;
  const flagStart=preferenceSource.indexOf('    // F2E2e — exact restricted flag submissions and recovery.');
  if(flagStart!==-1){
    const flagEnd=preferenceSource.indexOf('    // Flag one word (item), one sentence or one colour phrase ({ id, native, meaning, hint }):');
    assert.ok(flagEnd>flagStart);
    preferenceSource=(preferenceSource.slice(0,flagStart)+preferenceSource.slice(flagEnd))
      .replace('          <FlagRecoveryPanel user={user} languageCode={selectedLanguage} policy={policy} />\n','');
  }
  const parts=[
    '      const preferences = usePersonalPreferences(user, policy, verified);\n',
    '        <KGPreferenceContext.Provider value={preferences}>\n',
    '        </KGPreferenceContext.Provider>\n',
    '          <PreferenceRecoveryPanel flow={preferences} />\n',
  ];
  const oldEffect='      useEffect(() => { if (user) window.KGAudio.initPrefs(supabase, user.id); }, [user]);\n';
  const manifestEffect='      useEffect(() => { if (selectedLanguage) window.KGAudio.loadManifest(selectedLanguage); }, [selectedLanguage]);\n';
  let previous=preferenceSource;
  for(const part of parts){
    assert.ok(preferenceSource.includes(part),'Exercise actual preference AppContent wiring');
    previous=previous.replace(part,'');
    assert.throws(()=>assertF1ReviewScope(preferenceSource,preferenceSource.replace(part,'')), 'Partial wiring must fail closed');
    assert.throws(()=>assertF1ReviewScope(preferenceSource,preferenceSource+'\n'+part), 'Duplicate wiring must fail closed');
    assert.throws(()=>assertF1ReviewScope(preferenceSource,preferenceSource.replace(part,'')+'\n'+part), 'Moved wiring must fail closed');
  }
  assert.ok(previous.includes(manifestEffect));
  previous=previous.replace(manifestEffect,manifestEffect+oldEffect);
  assert.doesNotThrow(()=>assertF1ReviewScope(previous,preferenceSource));
  for(const [before,after] of [
    ['usePersonalPreferences(user, policy, verified);','usePersonalPreferences(user, policy, true);'],
    ['<KGPreferenceContext.Provider value={preferences}>','<KGPreferenceContext.Provider value={{}}>'],
    ['<PreferenceRecoveryPanel flow={preferences} />','<PreferenceRecoveryPanel flow={null} />'],
  ]){
    const edited=preferenceSource.replace(before,after);
    assert.notEqual(edited,preferenceSource);
    assert.throws(()=>assertF1ReviewScope(preferenceSource,edited));
  }
  assert.throws(()=>assertF1ReviewScope(preferenceSource,preferenceSource.replace(manifestEffect,manifestEffect+oldEffect)),
    'New shared preference ownership cannot coexist with the unconditional legacy initializer');
  assert.throws(()=>assertF1ReviewScope(previous,previous.replace(oldEffect,'')),
    'Deleting the old initializer requires the complete new wiring');
});

const flagControllerMarker='    // F2E2e — exact restricted flag submissions and recovery.';
const singleFlagHeader='    // Flag one word (item), one sentence or one colour phrase ({ id, native, meaning, hint }):';
const flagPanel='          <FlagRecoveryPanel user={user} languageCode={selectedLanguage} policy={policy} />\n';
const preferencePanel='          <PreferenceRecoveryPanel flow={preferences} />\n';
const originalFlagButton='onClick={(e) => { e.stopPropagation(); onClick(); }} title="Flag wrong Devanagari, word, picture…"';
const focusedFlagButton='onClick={(e) => { e.stopPropagation(); e.currentTarget.focus({ preventScroll: true }); onClick(); }} title="Flag wrong Devanagari, word, picture…"';
const integratedFlags=source.includes(flagControllerMarker)?source:source
  .replace(singleFlagHeader,flagControllerMarker+'\n    function FlagRecoveryFixture() {}\n\n'+singleFlagHeader)
  .replace(preferencePanel,flagPanel+preferencePanel)
  .replace(originalFlagButton,focusedFlagButton);

test('F2E2e admits the bounded flag controller, single and batch dialogs',()=>{
  for(const marker of ['    function FlagModal(', '    function BatchFlagModal(']){
    assert.ok(source.includes(marker));
    assert.doesNotThrow(()=>assertF1ReviewScope(source,source.replace(marker,marker+'/* reviewed flag submission */')));
  }
  assert.doesNotThrow(()=>assertF1ReviewScope(source,integratedFlags));
  for(const marker of [singleFlagHeader,'    function FlagModal(',
    '    // Small 🚩 for quiz / Speak screens','    function BatchFlagModal(', '    function AddWordModal(']){
    assert.throws(()=>assertF1ReviewScope(source,source.replace(marker,'/* missing flag boundary */')));
    assert.throws(()=>assertF1ReviewScope(source,source+'\n'+marker));
  }
  assert.throws(()=>assertF1ReviewScope(integratedFlags,integratedFlags+'\n'+flagControllerMarker));
  const moved=integratedFlags.replace(flagControllerMarker,'    // Earlier flag boundary')
    .replace('    const FLAG_REASONS = [',flagControllerMarker+'\n    const FLAG_REASONS = [');
  assert.throws(()=>assertF1ReviewScope(integratedFlags,moved),'Moving the boundary cannot hide shared flag constants or compatibility logic');
});

test('F2E2e requires the exact complete flag panel wiring before the existing preference panel',()=>{
  const start=integratedFlags.indexOf(flagControllerMarker),end=integratedFlags.indexOf(singleFlagHeader);
  assert.ok(start>=0&&end>start&&integratedFlags.includes(flagPanel));
  const previous=(integratedFlags.slice(0,start)+integratedFlags.slice(end))
    .replace(flagPanel,'').replace(focusedFlagButton,originalFlagButton);
  assert.doesNotThrow(()=>assertF1ReviewScope(previous,integratedFlags));
  for(const edited of [
    integratedFlags.replace(flagPanel,''),
    integratedFlags.replace(flagControllerMarker,'    // Missing flag controller boundary'),
    integratedFlags+'\n'+flagPanel,
    integratedFlags.replace(flagPanel,'')+'\n'+flagPanel,
    integratedFlags.replace(flagPanel,flagPanel.replace('user={user}','user={null}')),
    integratedFlags.replace(flagPanel,flagPanel.replace('languageCode={selectedLanguage}','languageCode={currentLanguage}')),
    integratedFlags.replace(flagPanel,flagPanel.replace('policy={policy}','policy={{state:"legacy"}}')),
  ])assert.throws(()=>assertF1ReviewScope(integratedFlags,edited));
});

test('F2E2e admits only the exact report-button focus call and protects its callback and style',()=>{
  assert.ok(integratedFlags.includes(focusedFlagButton));
  assert.doesNotThrow(()=>assertF1ReviewScope(integratedFlags.replace(focusedFlagButton,originalFlagButton),integratedFlags));
  for(const edited of [
    integratedFlags.replace(focusedFlagButton,focusedFlagButton.replace('preventScroll: true','preventScroll: false')),
    integratedFlags.replace(focusedFlagButton,focusedFlagButton.replace('onClick();','onClick(e);')),
    integratedFlags.replace('function FlagButton({','function FlagButton(/* changed */{'),
    integratedFlags.replace("'w-8 h-8 rounded-full text-sm text-gray-400 hover:bg-red-50 hover:text-red-500 transition'",
      "'w-8 h-8 rounded-full text-sm text-red-600 hover:bg-red-50 hover:text-red-500 transition'"),
    integratedFlags+'\n'+focusedFlagButton,
  ]){
    assert.notEqual(edited,integratedFlags);
    assert.throws(()=>assertF1ReviewScope(integratedFlags,edited));
  }
});

for(const [label,before,after] of [
  ['flag reason definitions','    const FLAG_REASONS = [','    const FLAG_REASONS = [null,'],
  ['legacy missing-column helper','const isMissingColumn = (error) => !!error &&','const isMissingColumn = (error) => false &&'],
  ['shared modal shortcut detection','const kgModalOpen = () =>','const kgModalOpen = () => false &&'],
  ['word-detail flag action','onClick={() => onFlag(item)}','onClick={() => onFlag(null)}'],
  ['adjacent word creation','function AddWordModal({','function AddWordModal(/* changed */{'],
])test(`F2E2e scope rejects ${label}`,()=>{
  const edited=integratedFlags.replace(before,after);
  assert.notEqual(edited,integratedFlags,'Fixture must alter actual protected flag-adjacent source');
  assert.throws(()=>assertF1ReviewScope(integratedFlags,edited));
});

test('F2E2d audio scope admits only preference state, lifecycle and exact bridge exports',()=>{
  for(const [before,after] of [
    ["let prefs = { voice: 'f', muted: false };","let prefs = { voice: 'f', muted: false }; /* reviewed preferences */"],
    ['  async function initPrefs(', '  async function initPrefs(/* reviewed preferences */'],
  ]){
    const edited=audioSource.replace(before,after);
    assert.notEqual(edited,audioSource);
    assert.doesNotThrow(()=>assertAudioPreferenceReviewScope(audioSource,edited));
  }
  const bridge='    setPreferenceScope, applyPreferenceState,\n';
  const media='    requireVerifiedMediaPolicy, setVerifiedMediaPolicy,\n';
  const before=audioSource.replace(bridge,'');
  const after=before.replace(media,bridge+media);
  assert.notEqual(after,before);
  assert.doesNotThrow(()=>assertAudioPreferenceReviewScope(before,after));
  assert.throws(()=>assertAudioPreferenceReviewScope(after,after+bridge));
  assert.throws(()=>assertAudioPreferenceReviewScope(after,
    after.replace(bridge,'    setPreferenceScope, applyPreferenceState, unexpectedMediaExport,\n')));
});

for(const [label,before,after] of [
  ['public audio origin', '  const BASE =', '  const BASE = "https://unexpected.invalid/" +'],
  ['historical audio mirror key', "const PREFS_KEY = 'kg_chart_audio_prefs';", "const PREFS_KEY = 'replacement';"],
  ['playback speed', '  const SLOW_RATE = 0.7;', '  const SLOW_RATE = 1;'],
  ['clip hash', '  function hash(text) {', '  function hash(text) { return "changed";'],
  ['public media gate', '  function canUsePublicMedia() {', '  function canUsePublicMedia() { return true;'],
  ['protected media gate', '  function isProtectedMedia() {', '  function isProtectedMedia() { return false;'],
  ['verified media policy', '  function setVerifiedMediaPolicy(access) {', '  function setVerifiedMediaPolicy(access) { return;'],
  ['manifest loading', '  function loadManifest(lang) {', '  function loadManifest(lang) { return;'],
  ['clip resolution', '  function resolve(text, lang, voice) {', '  function resolve(text, lang, voice) { return null;'],
  ['offline lease cleanup', 'offlineLease?.release?.();', '/* removed offline lease cleanup */'],
])test(`F2E2d audio scope rejects ${label}`,()=>{
  const edited=audioSource.replace(before,after);
  assert.notEqual(edited,audioSource,'Fixture must alter the real protected audio source');
  assert.throws(()=>assertAudioPreferenceReviewScope(audioSource,edited));
});

test('F2E2d audio boundaries fail closed when missing, duplicated or moved across media policy',()=>{
  for(const marker of [
    '  // ---- prefs: voice m/f + mute (',
    '\n  // U3C2B1: installed sources remain legacy until the separate U3D/U4',
    '  async function initPrefs(',
    '\n  // ---- manifests: audio/<lang>/clips.json -> { m: [hash], f: [hash] } ----',
  ]){
    assert.throws(()=>assertAudioPreferenceReviewScope(audioSource,audioSource.replace(marker,'/* missing audio boundary */')));
    assert.throws(()=>assertAudioPreferenceReviewScope(audioSource,audioSource+'\n'+marker));
  }
  const marker='  // F2E2d preference scope';
  const without=audioSource.replace(marker,'  // Earlier preference scope');
  const moved=without.replace('  function canUsePublicMedia() {',marker+'\n  function canUsePublicMedia() {');
  assert.throws(()=>assertAudioPreferenceReviewScope(audioSource,moved),
    'Moving the preference boundary must not hide media-policy edits');
});

test('R1 scope admits only authentication, gate and snapshot boundaries at the reviewed checkpoint', () => {
  const authEdit = source.replace('    function AuthProvider({ children }) {', '    function AuthProvider({ children }) { /* reviewed change */');
  const accessEdit = authEdit.replace('    function useLearnerAccess(user) {', '    function useLearnerAccess(user) { /* reviewed change */');
  const gateEdit = accessEdit.replace('    function AuthGate({ children }) {', '    function AuthGate({ children }) { /* reviewed change */');
  assert.notEqual(gateEdit, source);
  assert.doesNotThrow(() => assertR1ReviewScope(source, gateEdit));
  assert.throws(() => assertF1ReviewScope(source, gateEdit));
  for (const changed of [
    gateEdit.replace('const U3C1_SCOPED_UI_ENABLED = false;', 'const U3C1_SCOPED_UI_ENABLED = true;'),
    gateEdit.replace('Results saved', 'Results altered'),
    gateEdit.replace('    function useLearnerAccess(user) {', '    function RenamedAccess(user) {'),
    gateEdit.replace('    function Header({', '    function Header(/* changed */{'),
  ]) {
    assert.notEqual(changed, gateEdit);
    assert.throws(() => assertR1ReviewScope(source, changed));
  }
});

test('R2 scope admits only shared rating and flag modal lifecycle changes', () => {
  const rating=source.replace('    function RatingConfirmationDialog(', '    function RatingConfirmationDialog(/* R2 */');
  const changed=rating.replace('    function FlagDialogShell(', '    function FlagDialogShell(/* R2 */');
  assert.notEqual(changed,source);
  // Boundary markers include only the function name and opening parenthesis.
  assert.doesNotThrow(()=>assertR2ReviewScope(source,changed));
  for(const edited of [
    changed.replace('const U3C1_SCOPED_UI_ENABLED = false;','const U3C1_SCOPED_UI_ENABLED = true;'),
    changed.replace('const requestRestricted=async','const requestRestricted= /* changed */ async'),
    changed.replace('function useFlagSubmission(', 'function useFlagSubmission(/* changed */'),
    changed.replace('function useLearnerAccess(', 'function useLearnerAccess(/* changed */'),
    changed.replace('function FlagModal(', 'function FlagModal(/* changed */'),
    changed.replace('function RatingRecoveryPanel(', 'function RatingRecoveryPanel(/* changed */'),
  ]){
    assert.notEqual(edited,changed);
    assert.throws(()=>assertR2ReviewScope(source,edited));
  }
});
