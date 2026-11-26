// Use the actual F1 module, not a hand-written approximation of its payload.
import '../../js/kg-quiz-save.js';
const api = globalThis.KGQuizSave;
const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const word = '10000000-0000-4000-8000-000000000001';
const sentence = '20000000-0000-4000-8000-000000000001';
function draft(n, kind, type, extras = {}) {
  let next = n * 10, tick = 0;
  const records = new Map();
  const storage = {
    get length() { return records.size; },
    key(i) { return [...records.keys()][i] ?? null; },
    getItem(k) { return records.get(k) ?? null; },
    setItem(k, v) { records.set(k, String(v)); },
    removeItem(k) { records.delete(k); },
  };
  const store = api.createStore({ storage,
    uuid: () => '99630000-0000-4000-8000-' + String(next++).padStart(12, '0'),
    now: () => new Date(Date.UTC(2026, 10, 26, 10, 0, tick++)).toISOString() });
  let d = store.start({ ownerId: owner, languageCode: 'my', kind, session: {
    topic_id: kind === 'word' ? 'food' : null, quiz_type: type, ...extras } });
  for (const correct of [true,false]) {
    d = store.append(d, { vocabulary_id: kind === 'word' ? word : null,
      sentence_id: kind === 'sentence' ? sentence : null, selected_vocabulary_id: null,
      is_correct: correct, answer_text: correct ? 'correct' : "learner's attempt" });
    store.write(d);
  }
  store.write({ ...d, sealed: true });
  const recovered = store.list(owner, 'my', kind)[0];
  api.validateDraft(recovered);
  return recovered;
}
console.log(JSON.stringify({
  word: draft(1,'word','native_to_image',{difficulty:1}),
  sentence: draft(2,'sentence','sentence_to_meaning'),
  copy: draft(3,'word','type_word',{quiz_level:'copy'}),
  dev: draft(4,'word','type_word',{quiz_level:'dev'}),
  memory: draft(5,'word','type_word',{quiz_level:'memory'}),
  partial: draft(6,'word','native_to_image'),
  conflict: draft(7,'word','type_word',{quiz_level:'copy'}),
  denied: draft(8,'sentence','build_sentence'),
  rollback: draft(9,'word','native_to_image'),
  race: draft(10,'word','type_word',{quiz_level:'dev'}),
  unknown: draft(11,'word','type_word'),
  legacyOmission: draft(12,'word','native_to_image'),
}));
