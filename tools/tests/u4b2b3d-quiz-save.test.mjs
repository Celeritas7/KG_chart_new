import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Invented records only. The fake models atomic INSERT and persistent rows;
// it never opens a socket or uses an application Supabase configuration.
const context = {window: {}, console, setTimeout, clearTimeout};
vm.createContext(context);
vm.runInContext(await fs.readFile(new URL('../../js/kg-quiz-save.js', import.meta.url), 'utf8'), context);
const API = context.KGQuizSave || context.window.KGQuizSave;
const SESSION_TABLE = 'kg_chart_quiz_sessions';
const ANSWER_TABLE = 'kg_chart_quiz_answers';
const OWNER = '11000000-0000-4000-8000-000000000001';
const OTHER = '22000000-0000-4000-8000-000000000002';
const AT = '2026-11-26T10:00:00.000Z';
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const deny = {code: '42501', message: 'new row violates row-level security policy'};
const lost = {code: '', message: 'network response lost'};
let nextId = 1;
const uuid = () => `33000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;

function memoryStorage() {
  const entries = new Map();
  const storage = {
    entries, failSet: false, failRemove: false,
    get length() { return entries.size; },
    key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) {
      if (storage.failSet) throw new Error('Synthetic quota failure');
      entries.set(String(key), String(value));
    },
    removeItem(key) {
      if (storage.failRemove) throw new Error('Synthetic removal failure');
      entries.delete(String(key));
    },
  };
  return storage;
}

function fakeClient({ownerId = OWNER, destination} = {}) {
  const tables = {[SESSION_TABLE]: new Map(), [ANSWER_TABLE]: new Map()};
  const client = {
    ownerId, permitted: true, calls: [], faults: [], tables,
    auth: {async getSession() {
      client.calls.push({op: 'auth', ownerId: client.ownerId});
      return {data: {session: client.ownerId ? {user: {id: client.ownerId}} : null}, error: null};
    }},
    failNext(table, op, fault) { client.faults.push({table, op, ...fault}); },
    from(table) {
      assert.ok(tables[table], `Unexpected table ${table}`);
      const state = {op: 'read', rows: null, filters: [], columns: '*', one: false};
      let execution;
      const query = {
        insert(rows) { state.op = 'insert'; state.rows = copy(Array.isArray(rows) ? rows : [rows]); return query; },
        select(columns = '*') { state.columns = columns; return query; },
        eq(key, value) { state.filters.push([key, value]); return query; },
        in(key, values) { state.filters.push([key, copy(values)]); return query; },
        single() { state.one = true; return execute(); },
        maybeSingle() { state.one = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      function execute() {
        return execution ||= (async () => {
          const call = {table, op: state.op, rows: copy(state.rows), filters: copy(state.filters), ownerId: client.ownerId};
          client.calls.push(call);
          const faultIndex = client.faults.findIndex(f => f.table === table && f.op === state.op);
          const fault = faultIndex === -1 ? null : client.faults.splice(faultIndex, 1)[0];
          if (fault?.before) await fault.before(client, call);
          const result = (data, error = null) => ({data: copy(data), error: copy(error), ...(destination ? {saveDestination: destination} : {})});
          if (fault?.throwBefore) throw new Error('Synthetic transport exception');
          if (fault?.error && !fault.commit) return result(null, fault.error);
          if (state.op === 'insert') {
            // Current authorization is evaluated for every retry, including a
            // duplicate ID. A permission error may not be converted to an ACK.
            if (!client.permitted || !client.ownerId) return result(null, deny);
            for (const row of state.rows) {
              const parent = table === ANSWER_TABLE && tables[SESSION_TABLE].get(row.session_id);
              if (table === SESSION_TABLE ? row.user_id !== client.ownerId : !parent || parent.user_id !== client.ownerId) return result(null, deny);
            }
            // PostgreSQL INSERT of a batch is atomic: any duplicate rejects
            // the entire statement; no partial inserts from this operation.
            if (state.rows.some(row => tables[table].has(row.id))) return result(null, {code: '23505', message: 'duplicate key value'});
            for (const row of state.rows) tables[table].set(row.id, copy(row));
            if (fault?.after) await fault.after(client, call);
            if (fault?.throwAfter) throw new Error('Synthetic reply lost after commit');
            if (fault?.error) return result(null, fault.error);
            if (fault && Object.hasOwn(fault, 'data')) return result(fault.data);
            return result(state.one ? state.rows[0] : state.rows);
          }
          let rows = [...tables[table].values()].filter(row => {
            const parent = table === ANSWER_TABLE && tables[SESSION_TABLE].get(row.session_id);
            const own = table === SESSION_TABLE ? row.user_id === client.ownerId : parent?.user_id === client.ownerId;
            return own && state.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
          });
          if (fault?.missing || !client.permitted) rows = [];
          if (fault?.mutate) rows = rows.map(row => fault.mutate(copy(row)));
          if (fault?.after) await fault.after(client, call);
          return result(state.one ? rows[0] ?? null : rows);
        })();
      }
      return query;
    },
  };
  return client;
}

function setup(kind = 'word') {
  const storage = memoryStorage();
  const options = {storage, uuid, now: () => AT};
  const store = API.createStore(options);
  let draft = store.start({
    ownerId: OWNER, languageCode: 'my', kind,
    session: {topic_id: kind === 'word' ? 'food' : null,
      quiz_type: kind === 'word' ? 'native_to_image' : 'sentence_to_meaning',
      ...(kind === 'word' ? {difficulty: 2} : {})},
  });
  for (const [i, correct] of [true, false].entries()) {
    draft = store.append(draft, {
      vocabulary_id: kind === 'word' ? `word-${i}` : null,
      ...(kind === 'sentence' ? {sentence_id: `sentence-${i}`} : {}),
      selected_vocabulary_id: kind === 'word' ? `selected-${i}` : null,
      is_correct: correct,
      answer_text: `invented response ${i}`,
      answered_at: AT,
    });
  }
  store.write(draft);
  const client = fakeClient();
  const save = (value = draft, target = client, targetStore = store) => API.save({client: target, draft: value, store: targetStore});
  const reload = () => API.createStore(options);
  return {storage, store, draft, client, save, reload, kind};
}

function assertRows(client, draft, {sessions = 1, answers = draft.answers.length} = {}) {
  assert.equal(client.tables[SESSION_TABLE].size, sessions);
  assert.equal(client.tables[ANSWER_TABLE].size, answers);
  if (sessions) {
    const row = client.tables[SESSION_TABLE].get(draft.session.id);
    assert.ok(row, 'The original stable session ID exists');
    assert.equal(row.user_id, OWNER);
    assert.equal(row.total_questions, draft.answers.length);
    assert.equal(row.correct_answers, 1);
  }
  for (const answer of draft.answers.slice(0, answers)) {
    const row = client.tables[ANSWER_TABLE].get(answer.id);
    assert.ok(row, 'Each original answer ID exists exactly once');
    assert.equal(row.session_id, draft.session.id);
    assert.equal(row.vocabulary_id, answer.vocabulary_id);
    assert.equal(row.sentence_id, answer.sentence_id);
    assert.equal(row.is_correct, answer.is_correct);
  }
}
const pending = fixture => fixture.reload().list(OWNER, 'my', fixture.kind);
const inserts = client => client.calls.filter(call => call.op === 'insert');

for (const kind of ['word', 'sentence']) {
  test(`${kind}: session failure retains durable answers and retry persists one session`, async () => {
    const f = setup(kind);
    f.client.failNext(SESSION_TABLE, 'insert', {error: lost});
    const failed = await f.save();
    assert.equal(failed.status, 'pending');
    assertRows(f.client, f.draft, {sessions: 0, answers: 0});
    assert.equal(inserts(f.client).filter(c => c.table === ANSWER_TABLE).length, 0);
    assert.equal(pending(f).length, 1);
    const restored = pending(f)[0];
    assert.equal(restored.session.id, f.draft.session.id);
    assert.deepEqual(copy(restored.answers), copy(f.draft.answers));
    const recovered = await f.save(restored, f.client, f.reload());
    assert.equal(recovered.status, 'saved');
    assertRows(f.client, f.draft);
    assert.equal(pending(f).length, 0);
  });

  test(`${kind}: answer failure never acknowledges the session and recovers after reopening`, async () => {
    const f = setup(kind);
    f.client.failNext(ANSWER_TABLE, 'insert', {error: lost});
    assert.equal((await f.save()).status, 'pending');
    assertRows(f.client, f.draft, {answers: 0});
    const restored = pending(f)[0];
    assert.ok(restored, 'The complete answer payload survives reopening');
    assert.equal((await f.save(restored, f.client, f.reload())).status, 'saved');
    assertRows(f.client, f.draft);
    assert.equal(pending(f).length, 0);
  });

  test(`${kind}: permission revocation during answers blocks replay and retains work until regrant`, async () => {
    const f = setup(kind);
    f.client.failNext(ANSWER_TABLE, 'insert', {before: client => { client.permitted = false; }});
    assert.equal((await f.save()).status, 'blocked');
    assertRows(f.client, f.draft, {answers: 0});
    const deniedRetry = await f.save(pending(f)[0]);
    assert.equal(deniedRetry.status, 'blocked');
    assertRows(f.client, f.draft, {answers: 0});
    assert.equal(f.client.calls.filter(c => c.op === 'read').length, 0, 'RLS denial is not a duplicate ACK');
    assert.equal(pending(f).length, 1);
    f.client.permitted = true;
    assert.equal((await f.save(pending(f)[0])).status, 'saved');
    assertRows(f.client, f.draft);
  });

  test(`${kind}: session denial does not trigger compatibility fallback`, async () => {
    const f = setup(kind);
    f.client.permitted = false;
    assert.equal((await f.save()).status, 'blocked');
    assert.equal(inserts(f.client).length, 1);
    assertRows(f.client, f.draft, {sessions: 0, answers: 0});
    assert.equal(pending(f).length, 1);
  });

  for (const table of [SESSION_TABLE, ANSWER_TABLE]) {
    for (const throws of [false, true]) {
      test(`${kind}: ${table} committed but ${throws ? 'thrown transport failure' : 'error acknowledgment'} retries without duplicates`, async () => {
        const f = setup(kind);
        f.client.failNext(table, 'insert', throws ? {commit: true, throwAfter: true} : {commit: true, error: lost});
        const uncertain = await f.save();
        assert.equal(uncertain.status, 'pending');
        assertRows(f.client, f.draft, {answers: table === ANSWER_TABLE ? 2 : 0});
        const recovered = await f.save(pending(f)[0], f.client, f.reload());
        assert.equal(recovered.status, 'saved');
        assertRows(f.client, f.draft);
        assert.equal(pending(f).length, 0);
        assert.ok(f.client.calls.some(c => c.op === 'read' && c.table === table));
      });
    }
  }

  test(`${kind}: repeated concurrent save calls share one operation and stable IDs`, async () => {
    const f = setup(kind);
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    f.client.failNext(SESSION_TABLE, 'insert', {before: () => barrier});
    const first = f.save();
    const second = f.save(copy(f.draft));
    release();
    const results = await Promise.all([first, second]);
    assert.ok(results.every(result => result.status === 'saved'));
    assertRows(f.client, f.draft);
    assert.equal(inserts(f.client).filter(call => call.table === SESSION_TABLE).length, 1);
    assert.equal(inserts(f.client).filter(call => call.table === ANSWER_TABLE).length, 1);
    assert.equal(pending(f).length, 0);
  });

  test(`${kind}: a subsequent save of the same retained payload is idempotent`, async () => {
    const f = setup(kind);
    assert.equal((await f.save()).status, 'saved');
    assert.equal((await f.save()).status, 'saved');
    assertRows(f.client, f.draft);
    assert.equal(pending(f).length, 0);
  });

  test(`${kind}: mismatched session duplicate is not acknowledged or overwritten`, async () => {
    const f = setup(kind);
    const existing = {...copy(f.draft.session), correct_answers: 999};
    f.client.tables[SESSION_TABLE].set(existing.id, existing);
    assert.equal((await f.save()).status, 'pending');
    assert.deepEqual(f.client.tables[SESSION_TABLE].get(existing.id), existing);
    assert.equal(f.client.tables[ANSWER_TABLE].size, 0);
    assert.equal(pending(f).length, 1);
  });

  test(`${kind}: mismatched answer duplicate preserves original history and pending answers`, async () => {
    const f = setup(kind);
    f.client.tables[SESSION_TABLE].set(f.draft.session.id, copy(f.draft.session));
    const existing = {...copy(f.draft.answers[0]), is_correct: !f.draft.answers[0].is_correct};
    f.client.tables[ANSWER_TABLE].set(existing.id, existing);
    assert.equal((await f.save()).status, 'pending');
    assert.deepEqual(f.client.tables[ANSWER_TABLE].get(existing.id), existing);
    assert.equal(f.client.tables[ANSWER_TABLE].size, 1, 'No missing answers are inserted beside a conflicting record');
    assert.equal(pending(f).length, 1);
  });

  test(`${kind}: duplicate readback missing or denied does not become success`, async () => {
    for (const fault of [{missing: true}, {error: deny}]) {
      const f = setup(kind);
      f.client.tables[SESSION_TABLE].set(f.draft.session.id, copy(f.draft.session));
      f.client.failNext(SESSION_TABLE, 'read', fault);
      const result = await f.save();
      assert.ok(['pending', 'blocked'].includes(result.status));
      assert.equal(f.client.tables[ANSWER_TABLE].size, 0);
      assert.equal(pending(f).length, 1);
    }
  });

  test(`${kind}: stale account cannot read or save another owner's recovery work`, async () => {
    const f = setup(kind);
    f.client.ownerId = OTHER;
    assert.equal(f.reload().list(OTHER, 'my', kind).length, 0);
    assert.equal((await f.save()).status, 'blocked');
    assert.equal(inserts(f.client).length, 0);
    assert.equal(pending(f).length, 1);
    f.client.ownerId = OWNER;
    assert.equal((await f.save(pending(f)[0])).status, 'saved');
    assertRows(f.client, f.draft);
  });

  test(`${kind}: account switch after a session acknowledgment prevents answer replay`, async () => {
    const f = setup(kind);
    f.client.failNext(SESSION_TABLE, 'insert', {after: client => { client.ownerId = OTHER; }});
    assert.equal((await f.save()).status, 'blocked');
    assertRows(f.client, f.draft, {answers: 0});
    assert.equal(pending(f).length, 1);
    f.client.ownerId = OWNER;
    assert.equal((await f.save(pending(f)[0])).status, 'saved');
    assertRows(f.client, f.draft);
  });

  test(`${kind}: account switch after answers commit retains acknowledgment uncertainty`, async () => {
    const f = setup(kind);
    f.client.failNext(ANSWER_TABLE, 'insert', {after: client => { client.ownerId = OTHER; }});
    assert.equal((await f.save()).status, 'blocked');
    assertRows(f.client, f.draft);
    assert.equal(pending(f).length, 1);
    f.client.ownerId = OWNER;
    assert.equal((await f.save(pending(f)[0])).status, 'saved');
    assertRows(f.client, f.draft);
    assert.equal(pending(f).length, 0);
  });

  test(`${kind}: recovery storage failure prevents all remote writes and remains recoverable in memory`, async () => {
    const f = setup(kind);
    f.storage.failSet = true;
    const result = await f.save();
    assert.equal(result.status, 'storage-error');
    assert.equal(inserts(f.client).length, 0);
    assert.equal(result.draft.session.id, f.draft.session.id);
    assert.deepEqual(copy(result.draft.answers), copy(f.draft.answers));
    f.storage.failSet = false;
    assert.equal((await f.save(result.draft)).status, 'saved');
    assertRows(f.client, f.draft);
  });

  test(`${kind}: device receipt is queued rather than falsely acknowledged as uploaded`, async () => {
    const f = setup(kind);
    const client = fakeClient({destination: 'device'});
    const result = await f.save(f.draft, client);
    assert.equal(result.status, 'queued');
    assertRows(client, f.draft);
  });
}

test('Draft append preserves IDs and timestamps, and storage reload retains payload and owner boundaries', () => {
  const f = setup('word');
  const restored = pending(f)[0];
  assert.deepEqual(copy(restored), copy(f.draft));
  assert.notEqual(f.draft.answers[0].id, f.draft.answers[1].id);
  assert.equal(f.draft.answers[0].answered_at, AT);
  assert.equal(f.draft.session.completed_at, AT);
  assert.equal(f.reload().list(OWNER, 'ja').length, 0);
  assert.equal(f.reload().list(OWNER, 'my', 'sentence').length, 0);
});

test('Session compatibility removes only a named optional missing column and keeps original stable IDs', async () => {
  for (const code of ['PGRST204', '42703']) {
    const f = setup('word');
    f.client.failNext(SESSION_TABLE, 'insert', {error: {code, message: code === 'PGRST204'
      ? "Could not find the 'difficulty' column of 'kg_chart_quiz_sessions' in the schema cache"
      : 'column "difficulty" of relation "kg_chart_quiz_sessions" does not exist'}});
    assert.equal((await f.save()).status, 'saved');
    assertRows(f.client, f.draft);
    const requests = inserts(f.client).filter(c => c.table === SESSION_TABLE);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].rows[0].id, requests[1].rows[0].id);
    assert.equal(Object.hasOwn(requests[1].rows[0], 'difficulty'), false);
  }
});

test('Answer compatibility removes only missing optional fields and keeps required sentence association', async () => {
  const f = setup('sentence');
  f.client.failNext(ANSWER_TABLE, 'insert', {error: {code: 'PGRST204', message:
    "Could not find the 'answer_text' column of 'kg_chart_quiz_answers' in the schema cache"}});
  assert.equal((await f.save()).status, 'saved');
  assertRows(f.client, f.draft);
  const requests = inserts(f.client).filter(c => c.table === ANSWER_TABLE);
  assert.equal(requests.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(requests[1].rows[i].id, f.draft.answers[i].id);
    assert.equal(requests[1].rows[i].sentence_id, f.draft.answers[i].sentence_id);
    assert.equal(Object.hasOwn(requests[1].rows[i], 'answer_text'), false);
    assert.equal(requests[1].rows[i].answered_at, AT);
  }
});

test('Missing sentence_id is a pending schema failure, never an unassociated answer fallback', async () => {
  const f = setup('sentence');
  f.client.failNext(ANSWER_TABLE, 'insert', {error: {code: 'PGRST204', message:
    "Could not find the 'sentence_id' column of 'kg_chart_quiz_answers' in the schema cache"}});
  assert.equal((await f.save()).status, 'pending');
  assertRows(f.client, f.draft, {answers: 0});
  assert.equal(inserts(f.client).filter(c => c.table === ANSWER_TABLE).length, 1);
  assert.equal(pending(f).length, 1);
});

test('Network, generic schema and wrong-table errors do not activate optional-column fallback', async () => {
  for (const error of [lost,
    {code: 'PGRST204', message: 'schema cache unavailable'},
    {code: 'PGRST204', message: "Could not find the 'difficulty' column of 'different_table' in the schema cache"},
    {code: 'PGRST202', message: 'function difficulty does not exist'},
  ]) {
    const f = setup('word');
    f.client.failNext(SESSION_TABLE, 'insert', {error});
    assert.equal((await f.save()).status, 'pending');
    assert.equal(inserts(f.client).length, 1);
    assertRows(f.client, f.draft, {sessions: 0, answers: 0});
  }
});

test('Failure of the compatibility retry retains optional-column decision across reopening', async () => {
  const f = setup('word');
  f.client.failNext(SESSION_TABLE, 'insert', {error: {code: 'PGRST204', message:
    "Could not find the 'difficulty' column of 'kg_chart_quiz_sessions' in the schema cache"}});
  f.client.failNext(SESSION_TABLE, 'insert', {error: lost});
  assert.equal((await f.save()).status, 'pending');
  const restored = pending(f)[0];
  assert.ok(restored.omittedColumns.session.includes('difficulty'));
  assert.equal((await f.save(restored, f.client, f.reload())).status, 'saved');
  assertRows(f.client, f.draft);
  assert.equal(Object.hasOwn(inserts(f.client).at(-2).rows[0], 'difficulty'), false);
});

test('Equivalent PostgreSQL timestamp representations acknowledge identical records without changing history', async () => {
  const f = setup('word');
  f.client.tables[SESSION_TABLE].set(f.draft.session.id, {...copy(f.draft.session), completed_at: '2026-11-26 10:00:00+00'});
  for (const answer of f.draft.answers) {
    f.client.tables[ANSWER_TABLE].set(answer.id, {...copy(answer), answered_at: '2026-11-26T19:00:00+09:00'});
  }
  const before = JSON.stringify(Object.fromEntries(Object.entries(f.client.tables).map(([key, rows]) => [key, [...rows.values()]])));
  assert.equal((await f.save()).status, 'saved');
  assertRows(f.client, f.draft);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(f.client.tables).map(([key, rows]) => [key, [...rows.values()]]))), before);
});

test('A removal failure after acknowledged writes reports success with a warning and permits safe cleanup retry', async () => {
  const f = setup('word');
  f.storage.failRemove = true;
  const result = await f.save();
  assert.equal(result.status, 'saved');
  assert.ok(result.warning);
  assertRows(f.client, f.draft);
  assert.equal(pending(f).length, 1);
  f.storage.failRemove = false;
  assert.equal((await f.save(pending(f)[0])).status, 'saved');
  assertRows(f.client, f.draft);
  assert.equal(pending(f).length, 0);
});

test('Malformed success acknowledgment leaves the draft pending even when a session may have committed', async () => {
  for (const data of [null, [], [{id: 'wrong-session'}]]) {
    const f = setup('word');
    f.client.failNext(SESSION_TABLE, 'insert', {commit: true, data});
    assert.equal((await f.save()).status, 'pending');
    assertRows(f.client, f.draft, {answers: 0});
    assert.equal(pending(f).length, 1);
    assert.equal((await f.save(pending(f)[0])).status, 'saved');
    assertRows(f.client, f.draft);
  }
});

test('An exact partial answer batch retries only the missing stable IDs in one atomic INSERT', async () => {
  const f = setup('word');
  f.client.tables[SESSION_TABLE].set(f.draft.session.id, copy(f.draft.session));
  f.client.tables[ANSWER_TABLE].set(f.draft.answers[0].id, copy(f.draft.answers[0]));
  assert.equal((await f.save()).status, 'saved');
  assertRows(f.client, f.draft);
  const writes = inserts(f.client).filter(call => call.table === ANSWER_TABLE);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].rows.map(row => row.id), copy(f.draft.answers.map(row => row.id)));
  assert.deepEqual(writes[1].rows.map(row => row.id), [f.draft.answers[1].id]);
  assert.equal(pending(f).length, 0);
});

test('A failed optional answer fallback remains pending and reopens with original answers intact', async () => {
  const f = setup('sentence');
  f.client.failNext(ANSWER_TABLE, 'insert', {error: {code: '42703', message:
    'column "answered_at" of relation "kg_chart_quiz_answers" does not exist'}});
  f.client.failNext(ANSWER_TABLE, 'insert', {error: lost});
  assert.equal((await f.save()).status, 'pending');
  assertRows(f.client, f.draft, {answers: 0});
  const restored = pending(f)[0];
  assert.deepEqual(copy(restored.answers), copy(f.draft.answers));
  assert.ok(restored.omittedColumns.answers.includes('answered_at'));
  assert.equal((await f.save(restored, f.client, f.reload())).status, 'saved');
  assertRows(f.client, f.draft);
  for (const row of f.client.tables[ANSWER_TABLE].values()) {
    assert.equal(Object.hasOwn(row, 'answered_at'), false);
    assert.ok(row.sentence_id);
  }
});

test('Compatibility checkpoint storage failure prevents an unrecorded alternate request', async () => {
  const f = setup('word');
  f.client.failNext(SESSION_TABLE, 'insert', {
    before: () => { f.storage.failSet = true; },
    error: {code: 'PGRST204', message:
      "Could not find the 'difficulty' column of 'kg_chart_quiz_sessions' in the schema cache"},
  });
  const result = await f.save();
  assert.equal(result.status, 'storage-error');
  assert.equal(inserts(f.client).length, 1);
  assertRows(f.client, f.draft, {sessions: 0, answers: 0});
  f.storage.failSet = false;
  assert.equal((await f.save(result.draft)).status, 'saved');
  assertRows(f.client, f.draft);
});

test('Permission rejection after an optional-column response is not retried without that permission', async () => {
  const f = setup('sentence');
  f.client.failNext(ANSWER_TABLE, 'insert', {error: {code: 'PGRST204', message:
    "Could not find the 'answer_text' column of 'kg_chart_quiz_answers' in the schema cache"}});
  f.client.failNext(ANSWER_TABLE, 'insert', {error: deny});
  assert.equal((await f.save()).status, 'blocked');
  assertRows(f.client, f.draft, {answers: 0});
  assert.equal(inserts(f.client).filter(call => call.table === ANSWER_TABLE).length, 2);
  assert.equal(pending(f).length, 1);
});

test('Recovery cleanup preserves unrelated local records and another owner\'s draft', async () => {
  const f = setup('word');
  f.storage.entries.set('existing-offline-outbox', 'untouched pending changes');
  f.storage.entries.set('existing-language-packs', 'untouched downloaded packs');
  let other = f.store.start({ownerId: OTHER, languageCode: 'my', kind: 'word',
    session: {topic_id: 'food', quiz_type: 'native_to_image'}});
  other = f.store.append(other, {vocabulary_id: 'another-invented-word', is_correct: true, answered_at: AT});
  f.store.write(other);
  const otherBefore = copy(f.reload().list(OTHER, 'my', 'word'));
  assert.equal((await f.save()).status, 'saved');
  assert.equal(pending(f).length, 0);
  assert.deepEqual(copy(f.reload().list(OTHER, 'my', 'word')), otherBefore);
  assert.equal(f.storage.getItem('existing-offline-outbox'), 'untouched pending changes');
  assert.equal(f.storage.getItem('existing-language-packs'), 'untouched downloaded packs');
});

test('Signed-out state blocks any retained quiz replay without discarding recovery data', async () => {
  const f = setup('word');
  f.client.ownerId = null;
  assert.equal((await f.save()).status, 'blocked');
  assert.equal(inserts(f.client).length, 0);
  assert.equal(pending(f).length, 1);
});

test('Concurrent saves with differing answer payloads never acknowledge the unsubmitted answers', async () => {
  const f = setup('word');
  const divergent = f.store.append(f.draft, {vocabulary_id: 'late-invented-word', is_correct: true, answered_at: AT});
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  f.client.failNext(SESSION_TABLE, 'insert', {before: () => barrier});
  const first = f.save();
  const conflict = f.save(divergent);
  release();
  const [saved, rejected] = await Promise.all([first, conflict]);
  assert.equal(saved.status, 'saved');
  assert.equal(rejected.status, 'storage-error');
  assert.equal(rejected.draft.answers.length, 3, 'Unsubmitted work remains available in memory for explicit recovery');
  assertRows(f.client, f.draft);
  assert.equal(f.client.tables[ANSWER_TABLE].has(divergent.answers[2].id), false);
});

test('Malformed answer acknowledgment retains a complete recovery draft until exact readback confirms all rows', async () => {
  const f = setup('sentence');
  f.client.failNext(ANSWER_TABLE, 'insert', {commit: true, data: []});
  assert.equal((await f.save()).status, 'pending');
  assertRows(f.client, f.draft);
  assert.equal(pending(f).length, 1);
  assert.equal((await f.save(pending(f)[0])).status, 'saved');
  assertRows(f.client, f.draft);
  assert.equal(pending(f).length, 0);
});

test('Revocation before replay of a missing answer subset rejects the new rows and retains complete work', async () => {
  const f = setup('word');
  f.client.tables[SESSION_TABLE].set(f.draft.session.id, copy(f.draft.session));
  f.client.tables[ANSWER_TABLE].set(f.draft.answers[0].id, copy(f.draft.answers[0]));
  f.client.failNext(ANSWER_TABLE, 'read', {after: client => { client.permitted = false; }});
  assert.equal((await f.save()).status, 'blocked');
  assertRows(f.client, f.draft, {answers: 1});
  assert.equal(pending(f).length, 1);
  f.client.permitted = true;
  assert.equal((await f.save(pending(f)[0])).status, 'saved');
  assertRows(f.client, f.draft);
});

test('Corrupted ownership in a supplied recovery draft never uploads or deletes the intact original', async () => {
  const f = setup('word');
  const forged = copy(f.draft);
  forged.session.user_id = OTHER;
  assert.equal((await f.save(forged)).status, 'blocked');
  assert.equal(inserts(f.client).length, 0);
  assert.deepEqual(copy(pending(f)[0]), copy(f.draft));
});

for (const level of ['copy', 'dev', 'memory']) {
  test(`Typed-word ${level} level persists its actual string value through failure and reopening`, async () => {
    const storage = memoryStorage();
    const options = {storage, uuid, now: () => AT};
    const store = API.createStore(options);
    let draft = store.start({ownerId: OWNER, languageCode: 'my', kind: 'word',
      session: {topic_id: 'food', quiz_type: 'type_word', quiz_level: level}});
    draft = store.append(draft, {vocabulary_id: 'typed-invented-word', is_correct: true,
      answer_text: 'invented', answered_at: AT});
    store.write(draft);
    const client = fakeClient();
    client.failNext(ANSWER_TABLE, 'insert', {error: lost});
    assert.equal((await API.save({client, draft, store})).status, 'pending');
    const reopened = API.createStore(options);
    const restored = reopened.list(OWNER, 'my', 'word')[0];
    assert.equal(restored.session.quiz_level, level);
    assert.equal((await API.save({client, draft: restored, store: reopened})).status, 'saved');
    assert.equal(client.tables[SESSION_TABLE].size, 1);
    assert.equal(client.tables[ANSWER_TABLE].size, 1);
    assert.equal(client.tables[SESSION_TABLE].get(draft.id).quiz_level, level);
    assert.equal(reopened.list(OWNER, 'my', 'word').length, 0);
  });
}

test('Missing quiz_level compatibility keeps the original typed level in recovery until a later retry succeeds', async () => {
  const storage = memoryStorage();
  const options = {storage, uuid, now: () => AT};
  const store = API.createStore(options);
  let draft = store.start({ownerId: OWNER, languageCode: 'my', kind: 'word',
    session: {topic_id: 'food', quiz_type: 'type_word', quiz_level: 'memory'}});
  draft = store.append(draft, {vocabulary_id: 'typed-invented-word', is_correct: true, answered_at: AT});
  store.write(draft);
  const client = fakeClient();
  client.failNext(SESSION_TABLE, 'insert', {error: {code: 'PGRST204', message:
    "Could not find the 'quiz_level' column of 'kg_chart_quiz_sessions' in the schema cache"}});
  client.failNext(ANSWER_TABLE, 'insert', {error: lost});
  assert.equal((await API.save({client, draft, store})).status, 'pending');
  const reopened = API.createStore(options);
  const restored = reopened.list(OWNER, 'my', 'word')[0];
  assert.equal(restored.session.quiz_level, 'memory');
  assert.ok(restored.omittedColumns.session.includes('quiz_level'));
  assert.equal((await API.save({client, draft: restored, store: reopened})).status, 'saved');
  assert.equal(client.tables[SESSION_TABLE].size, 1);
  assert.equal(client.tables[ANSWER_TABLE].size, 1);
  assert.equal(Object.hasOwn(client.tables[SESSION_TABLE].get(draft.id), 'quiz_level'), false);
});


// F2E1a: fictional atomic receipt contract; no network or real learner data.
function atomicFixture(kind = 'word') {
  const f = setup(kind);
  const policy = { state: 'restricted', revision: 17 };
  let draft = f.store.start({ ownerId: OWNER, languageCode: 'my', kind,
    session: {topic_id: kind === 'word' ? 'food' : null,
      quiz_type: kind === 'word' ? 'native_to_image' : 'sentence_to_meaning'},
    saveContext: API.captureContext(policy) });
  for (const answer of f.draft.answers) draft = f.store.append(draft, answer);
  // append generates fresh IDs but preserves the original answer content.
  f.store.write(draft);
  let current = policy, serverRevision = 17, fault = null;
  const requests = [], commits = new Map();
  const client = {
    auth: f.client.auth,
    from() { throw new Error('Restricted quiz must never use the direct INSERT route'); },
    async rpc(name, args) {
      assert.equal(name, 'kg_chart_f2_save_recovery_quiz');
      requests.push(copy(args));
      const wire = args.p_draft;
      assert.equal(wire.sealed, true);
      assert.equal(Object.hasOwn(wire, 'saveContext'), false);
      assert.equal(wire.ownerId, OWNER);
      const error = fault; fault = null;
      if (args.p_expected_revision !== serverRevision) return {error: {code: '40001'}};
      if (error === 'denied') return {error: {code: '42501'}};
      if (error === 'missing') return {error: {code: 'PGRST202'}};
      if (error === 'before') throw Error('Synthetic pre-commit transport failure');
      if (commits.has(wire.id)) assert.deepEqual(copy(commits.get(wire.id)), copy(wire));
      else commits.set(wire.id, copy(wire));
      if (error === 'lost') throw Error('Synthetic lost atomic response');
      const data = {session_id: wire.id, answer_count: wire.answers.length, expected_revision: args.p_expected_revision};
      if (error === 'malformed') data.answer_count--;
      if (error === 'device') return {data, saveDestination: 'device'};
      if (error === 'switch') f.client.ownerId = OTHER;
      if (error === 'revisionChanged') current = {state: 'restricted', revision: 18};
      return {data, error: null};
    },
  };
  return {...f, legacyDraft: f.draft, draft, requests, commits, client, get current() {return current;},
    set current(value) { current = value; }, set serverRevision(value) {serverRevision = value;},
    set fault(value) {fault = value;},
    set owner(value) {f.client.ownerId = value;},
    saveAtomic(value = draft, options = {}) {
      return API.save({client, draft: value, store: f.reload(), getAccess: () => current, ...options});
    },
    retained() {return f.reload().list(OWNER, 'my', kind).find(value => value.id === draft.id);},
  };
}
for (const kind of ['word', 'sentence']) {
  test('F2E1a ' + kind + ': sealed wire draft survives lost reply and reload without duplicates', async () => {
    const f = atomicFixture(kind);
    f.fault = 'lost';
    assert.equal((await f.saveAtomic()).status, 'pending');
    const original = copy(f.retained());
    assert.equal(original.sealed, true);
    assert.equal(original.saveContext.revision, 17);
    assert.equal((await f.saveAtomic(original)).status, 'saved');
    assert.equal(f.commits.size, 1);
    assert.deepEqual(f.requests[0], f.requests[1]);
    assert.equal(f.retained(), undefined);
  });
  test('F2E1a ' + kind + ': concurrent identical attempts use one atomic RPC', async () => {
    const f = atomicFixture(kind);
    const [a,b] = await Promise.all([f.saveAtomic(), f.saveAtomic(copy(f.draft))]);
    assert.equal(a.status, 'saved'); assert.equal(b.status, 'saved');
    assert.equal(f.requests.length, 1);
  });
  test('F2E1a ' + kind + ': denied and malformed acknowledgements retain the original payload', async () => {
    for (const [fault, status] of [['denied','blocked'], ['malformed','pending'], ['missing','pending'],
      ['before','pending'], ['device','pending'], ['switch','blocked'], ['revisionChanged','blocked']]) {
      const f = atomicFixture(kind);
      f.fault = fault;
      assert.equal((await f.saveAtomic()).status, status, fault);
      assert.equal(f.retained().saveContext.revision, 17);
      assert.deepEqual(copy(f.retained().answers), copy(f.draft.answers));
      assert.equal(f.requests.length, 1);
    }
  });
  test('F2E1a ' + kind + ': newer revision, missing provenance, mode change and offline facade never fall back', async () => {
    const f = atomicFixture(kind);
    f.current = {state: 'restricted', revision: 18};
    assert.equal((await f.saveAtomic()).error.code, 'KG_QUIZ_STALE_REVISION');
    f.current = {state: 'legacy'};
    assert.equal((await f.saveAtomic(f.retained())).error.code, 'KG_QUIZ_CONTEXT_REQUIRED');
    f.current = {state: 'restricted', revision: 17};
    assert.equal((await f.saveAtomic(f.retained(), {offlineClient: true})).error.code, 'KG_QUIZ_OFFLINE_DEFERRED');
    assert.equal((await f.saveAtomic(f.legacyDraft)).error.code, 'KG_QUIZ_CONTEXT_REQUIRED');
    assert.equal(f.requests.length, 0);
    f.serverRevision = 18;
    assert.equal((await f.saveAtomic(f.retained())).error.code, 'KG_QUIZ_STALE_REVISION');
    assert.equal(f.requests[0].p_expected_revision, 17);
    assert.equal(f.retained().saveContext.revision, 17);
    assert.equal(f.commits.size, 0);
  });
}
test('F2E1a: no RPC begins if owner or durable storage is unavailable', async () => {
  const f = atomicFixture();
  f.storage.failSet = true;
  assert.equal((await f.saveAtomic()).status, 'storage-error');
  f.storage.failSet = false;
  f.owner = OTHER;
  assert.equal((await f.saveAtomic()).status, 'blocked');
  assert.equal(f.requests.length, 0);
});
test('F2E1a: an existing draft cannot be rewritten with a new permission revision', () => {
  const f = atomicFixture();
  assert.throws(() => f.store.write({...f.draft, saveContext: {mode:'restricted', revision:18}}));
  assert.equal(f.retained().saveContext.revision, 17);
});
test('F2E1a: an oversized historical draft is retained without splitting', async () => {
  const f = atomicFixture();
  let d = f.draft;
  for (let i = d.answers.length; i <= API.atomicLimit; i++)
    d = f.store.append(d, d.answers[0]);
  f.store.write(d);
  assert.equal((await f.saveAtomic(d)).error.code, 'KG_QUIZ_ATOMIC_LIMIT');
  assert.equal(f.retained().answers.length, API.atomicLimit + 1);
  assert.equal(f.requests.length, 0);
});


// F2E1b timed recovery: preserve the actual completion tally and duration.
function timedFixture(kind, quizType, revision = 23) {
  const f = setup();
  const policy = {state:'restricted', revision};
  const store = f.reload();
  let d = store.start({ownerId:OWNER,languageCode:'my',kind,session:{
    topic_id:null,quiz_type:quizType,time_spent_seconds:0},saveContext:API.captureContext(policy)});
  const typed = kind === 'typing';
  const row = (id, correct, complete) => ({
    vocabulary_id: typed ? id : null, sentence_id: typed ? null : id,
    selected_vocabulary_id: typed && complete ? id : null, is_correct:correct,
    ...(typed ? {answer_text:correct ? 'correct' : 'wrong first attempt'} : {}),
  });
  d = store.append(d,row('first',quizType !== 'typing_copy',true),7);
  d = store.append(d,row('second',false,false),11);
  store.write(d);
  const requests=[], saved=new Map();
  let fault=null,current=policy;
  const client={auth:f.client.auth,from(){throw Error('Restricted timed draft must never use direct writes');},
    async rpc(name,args) {
      assert.equal(name,'kg_chart_f2_save_timed_quiz');
      requests.push(copy(args));
      const s=args.p_session, a=args.p_answers;
      assert.equal(args.p_expected_revision,revision);
      assert.equal(s.user_id,OWNER);
      assert.equal(s.total_questions,a.length);
      assert.ok(a.every(row=>row.session_id===s.id));
      if(fault==='deny') return {error:{code:'42501'}};
      if(fault==='stale') return {error:{code:'40001'}};
      if(fault==='unavailable') return {error:{code:'PGRST202'}};
      if(saved.has(s.id)) assert.deepEqual(saved.get(s.id),copy(args));
      else saved.set(s.id,copy(args));
      if(fault==='lost') return {error:{message:'response lost'}};
      return {data:{session_id:s.id,answer_count:a.length,expected_revision:revision,
        time_spent_seconds:fault==='duration' ? s.time_spent_seconds+1 : s.time_spent_seconds},
        ...(fault==='device'?{saveDestination:'device'}:{})};
    }};
  return {f,d,store,requests,saved,client,set fault(v){fault=v;},set policy(v){current=v;},
    recover(){return f.reload().list(OWNER,'my',kind)[0];},
    save(value=d,options={}) {return API.save({client,draft:value,store:f.reload(),getAccess:()=>current,...options});}};
}
for(const [kind,type] of [['typing','typing_copy'],['typing','typing_recall'],['speaking','speak_lines'],['speaking','speak_paragraph']]) {
  test('F2E1b '+type+': original timed contract, lost receipt and reload',async()=>{
    const f=timedFixture(kind,type);
    const d=f.store.finishTiming(f.d,19);
    assert.equal(d.session.correct_answers,1);
    assert.equal(d.answers.filter(a=>a.is_correct).length,type==='typing_copy'?0:1);
    assert.equal(d.session.time_spent_seconds,19);
    f.store.write(d);
    f.fault='lost';
    assert.equal((await f.save(d)).status,'pending');
    const retained=f.recover();
    assert.equal(retained.sealed,true);
    assert.equal(retained.session.time_spent_seconds,19);
    assert.equal(retained.saveContext.revision,23);
    f.fault=null;
    assert.equal((await f.save(retained)).status,'saved');
    assert.equal(f.saved.size,1);
    assert.deepEqual(f.requests[0],f.requests[1]);
    assert.equal(f.recover(),undefined);
  });
}
test('F2E1b: duration mismatch, stale revision, denial and unavailable RPC retain timed work',async()=>{
  for(const [fault,status] of [['duration','pending'],['deny','blocked'],['stale','blocked'],['unavailable','pending'],['device','pending']]){
    const f=timedFixture('typing','typing_copy');
    f.fault=fault;
    assert.equal((await f.save()).status,status);
    assert.equal(f.recover().session.time_spent_seconds,11);
    assert.equal(f.recover().saveContext.revision,23);
  }
});
test('F2E1b: owner, local storage, mode and offline facade failures never call the timed RPC',async()=>{
  const f=timedFixture('speaking','speak_lines');
  f.f.storage.failSet=true;
  assert.equal((await f.save()).status,'storage-error');
  f.f.storage.failSet=false;
  f.f.client.ownerId=OTHER;
  assert.equal((await f.save()).status,'blocked');
  f.f.client.ownerId=OWNER;
  f.policy={state:'restricted',revision:24};
  assert.equal((await f.save()).error.code,'KG_QUIZ_STALE_REVISION');
  f.policy={state:'legacy'};
  assert.equal((await f.save()).error.code,'KG_QUIZ_CONTEXT_REQUIRED');
  f.policy={state:'restricted',revision:23};
  assert.equal((await f.save(f.recover(),{offlineClient:true})).error.code,'KG_QUIZ_OFFLINE_DEFERRED');
  assert.equal(f.requests.length,0);
});
test('F2E1b: separate timed namespace, partial checkpoint, immutable sealed duration and copy tally',async()=>{
  const f=timedFixture('typing','typing_copy');
  assert.ok([...f.f.storage.entries.keys()].some(k=>k.startsWith(API.timedStoragePrefix)));
  assert.equal(f.store.list(OWNER,'my','word').length,1);
  assert.equal(f.store.list(OTHER,'my','typing').length,0);
  assert.equal(f.recover().session.correct_answers,1);
  f.fault='lost';await f.save();
  assert.throws(()=>f.store.finishTiming(f.recover(),99));
  assert.throws(()=>f.store.write({...f.recover(),session:{...f.recover().session,time_spent_seconds:99}}));
  assert.equal(f.recover().session.time_spent_seconds,11);
});
test('F2E1b: legacy timed recovery keeps sentence identity and uses stable direct rows',async()=>{
  const f=setup();
  let d=f.store.start({ownerId:OWNER,languageCode:'my',kind:'typing',session:{
    topic_id:null,quiz_type:'typing_copy',time_spent_seconds:0},saveContext:{mode:'legacy'}});
  d=f.store.append(d,{vocabulary_id:null,sentence_id:'sentence-1',selected_vocabulary_id:'sentence-1',
    is_correct:false,answer_text:'original first mistake'},5);
  f.store.write(d);
  f.client.failNext(ANSWER_TABLE,'insert',{error:lost,commit:true});
  assert.equal((await API.save({client:f.client,draft:d,store:f.store})).status,'pending');
  const retained=f.reload().list(OWNER,'my','typing')[0];
  assert.equal((await API.save({client:f.client,draft:retained,store:f.reload()})).status,'saved');
  assert.equal(f.client.tables[SESSION_TABLE].size,1);
  assert.equal(f.client.tables[ANSWER_TABLE].size,1);
  assert.equal(f.client.tables[SESSION_TABLE].get(d.id).correct_answers,1);
  assert.equal(f.client.tables[ANSWER_TABLE].get(d.answers[0].id).sentence_id,'sentence-1');
});


// F2E1c: the private evidence RPC accepts ordered phrase IDs, not answer rows.
function colourFixture(mode = 'phrase_to_picture', provenance = {state:'restricted',revision:31}) {
  const f=setup(), store=f.reload();
  const ids=Array.from({length:4},(_,i)=>'44000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
  let d=store.start({ownerId:OWNER,languageCode:'my',kind:'colour',colourMode:mode,
    session:{topic_id:null,quiz_type:'colour_phrase',time_spent_seconds:0},
    saveContext:API.captureContext(provenance)});
  d=store.append(d,{phrase_id:ids[0],selected_phrase_id:ids[0],option_ids:[ids[2],ids[0],ids[1],ids[3]],answered_at:AT},2);
  d=store.append(d,{phrase_id:ids[1],selected_phrase_id:ids[3],option_ids:[ids[3],ids[1],ids[0],ids[2]],answered_at:AT},7);
  store.write(d);
  let policy=provenance,fault=null;
  const requests=[],receipts=new Map();
  const client={auth:f.client.auth,from(){throw Error('Restricted colour may not write a summary or ordinary answers directly');},
    async rpc(name,args) {
      assert.equal(name,'kg_chart_f2_save_colour_quiz');
      requests.push(copy(args));
      const s=args.p_session,q=args.p_questions;
      assert.equal(args.p_expected_revision,31);
      assert.equal(args.p_mode,mode);
      assert.equal(s.user_id,OWNER);
      assert.equal(s.total_questions,q.length);
      assert.equal(s.correct_answers,q.filter(row=>row.phrase_id===row.selected_phrase_id).length);
      assert.ok(q.every(row=>Object.keys(row).sort().join(',')==='answered_at,option_ids,phrase_id,selected_phrase_id'));
      if(fault==='deny')return {error:{code:'42501'}};
      if(fault==='stale')return {error:{code:'40001'}};
      if(fault==='missing')return {error:{code:'PGRST202'}};
      if(fault==='summary-only')return {error:{code:'23505'}};
      if(receipts.has(s.id))assert.deepEqual(receipts.get(s.id),copy(args));
      else receipts.set(s.id,copy(args));
      if(fault==='lost')throw Error('Synthetic lost colour acknowledgement');
      if(fault==='switch')f.client.ownerId=OTHER;
      const data={session_id:s.id,question_count:q.length,correct_answers:s.correct_answers,
        expected_revision:31,time_spent_seconds:s.time_spent_seconds};
      if(fault==='count')data.question_count++;
      if(fault==='score')data.correct_answers++;
      if(fault==='revision')data.expected_revision++;
      if(fault==='duration')data.time_spent_seconds++;
      return {data,error:null,...(fault==='device'?{saveDestination:'device'}:{})};
    }};
  return {f,store,d,ids,requests,receipts,client,set policy(value){policy=value;},set fault(value){fault=value;},
    retained(){return f.reload().list(OWNER,'my','colour')[0];},
    save(value=d,options={}){return API.save({client,draft:value,store:f.reload(),getAccess:()=>policy,...options});}};
}
for(const mode of ['phrase_to_picture','listen_to_picture','picture_to_phrase']) {
  test('F2E1c '+mode+': exact ordered evidence and original duration survive lost receipt and reload',async()=>{
    const f=colourFixture(mode);
    const draft=f.store.finishTiming(f.d,12);
    assert.equal(draft.session.correct_answers,1);
    assert.equal(draft.session.total_questions,2);
    f.store.write(draft);
    f.fault='lost';
    assert.equal((await f.save(draft)).status,'pending');
    const retained=f.retained();
    assert.equal(retained.sealed,true);
    assert.equal(retained.colourMode,mode);
    assert.deepEqual(copy(retained.answers),copy(draft.answers));
    assert.equal(retained.session.time_spent_seconds,12);
    f.fault=null;
    const result=await f.save(retained);
    assert.equal(result.status,'saved');
    assert.equal(result.summaryOnly,undefined);
    assert.equal(f.receipts.size,1);
    assert.deepEqual(f.requests[0],f.requests[1]);
    assert.equal(f.retained(),undefined);
  });
}
test('F2E1c: deny, stale, missing, summary conflict and mismatched receipts retain evidence',async()=>{
  for(const [fault,status] of [['deny','blocked'],['stale','blocked'],['missing','pending'],
    ['summary-only','pending'],['count','pending'],['score','pending'],['revision','pending'],
    ['duration','pending'],['device','pending'],['switch','blocked']]){
    const f=colourFixture();
    f.fault=fault;
    assert.equal((await f.save()).status,status,fault);
    assert.deepEqual(copy(f.retained().answers),copy(f.d.answers),fault);
    assert.equal(f.retained().saveContext.revision,31);
  }
});
test('F2E1c: invalid evidence cannot be synthesized or silently dropped',async()=>{
  const f=colourFixture(),invalidDrafts=[];
  for(const edit of [
    d=>{d.colourMode='unknown';},
    d=>{d.answers=[];}, // historical summary without actual evidence
    d=>{d.answers[0].option_ids=[f.ids[0],f.ids[0]];},
    d=>{d.answers[0].option_ids=[f.ids[1],f.ids[2]];},
    d=>{d.answers[0].selected_phrase_id='44000000-0000-4000-8000-000000000099';},
    d=>{d.answers[1].phrase_id=d.answers[0].phrase_id;},
    d=>{d.answers[0].answered_at='2025-01-01T00:00:00Z';},
    d=>{d.session.correct_answers=2;},
    d=>{d.answers[0].vocabulary_id=f.ids[0];}
  ]){const d=copy(f.d);edit(d);invalidDrafts.push(d);}
  for(const d of invalidDrafts){
    assert.throws(()=>API.validateDraft(d));
    assert.equal((await f.save(d)).status,'blocked');
  }
  assert.equal(f.requests.length,0);
  assert.deepEqual(copy(f.retained().answers),copy(f.d.answers));
});
test('F2E1c: namespace, owner, immutable mode, order and permission revision are preserved',async()=>{
  const f=colourFixture();
  assert.ok([...f.f.storage.entries.keys()].some(k=>k.startsWith(API.colourStoragePrefix)));
  assert.equal(f.store.list(OWNER,'my','word').length,1);
  assert.equal(f.store.list(OWNER,'my','typing').length,0);
  assert.equal(f.store.list(OTHER,'my','colour').length,0);
  assert.throws(()=>f.store.write({...f.d,colourMode:'picture_to_phrase'}));
  const altered=copy(f.d);altered.answers[0].option_ids.reverse();
  assert.throws(()=>f.store.write(altered));
  f.policy={state:'restricted',revision:32};
  assert.equal((await f.save()).error.code,'KG_QUIZ_STALE_REVISION');
  f.policy={state:'legacy'};
  assert.equal((await f.save(f.retained())).error.code,'KG_QUIZ_CONTEXT_REQUIRED');
  f.policy={state:'restricted',revision:31};
  assert.equal((await f.save(f.retained(),{offlineClient:true})).error.code,'KG_QUIZ_OFFLINE_DEFERRED');
  assert.equal(f.requests.length,0);
});
test('F2E1c: storage and account failures precede the atomic call; concurrent retries share one request',async()=>{
  const f=colourFixture();
  f.f.storage.failSet=true;
  assert.equal((await f.save()).status,'storage-error');
  f.f.storage.failSet=false;
  f.f.client.ownerId=OTHER;
  assert.equal((await f.save()).status,'blocked');
  assert.equal(f.requests.length,0);
  f.f.client.ownerId=OWNER;
  const [a,b]=await Promise.all([f.save(f.retained()),f.save(f.retained())]);
  assert.equal(a.status,'saved');assert.equal(b.status,'saved');
  assert.equal(f.requests.length,1);
});
test('F2E1c: oversized recorded run is held intact, not split',async()=>{
  const f=colourFixture();
  let d=f.d;
  for(let i=2;i<=API.atomicLimit;i++){
    const id='55000000-0000-4000-8000-'+String(i).padStart(12,'0');
    d=f.store.append(d,{phrase_id:id,selected_phrase_id:id,option_ids:[id],answered_at:AT},8);
  }
  f.store.write(d);
  assert.equal((await f.save(d)).error.code,'KG_QUIZ_ATOMIC_LIMIT');
  assert.equal(f.retained().answers.length,API.atomicLimit+1);
  assert.equal(f.requests.length,0);
});
test('F2E1c: legacy and device routes acknowledge only stable summaries; never invent ordinary answers',async()=>{
  for(const destination of [undefined,'device']){
    const f=colourFixture('phrase_to_picture',{state:'legacy'}),client=fakeClient({destination});
    client.failNext(SESSION_TABLE,'insert',{error:lost,commit:true});
    assert.equal((await f.save(f.d,{client})).status,'pending');
    assert.deepEqual(copy(f.retained().answers),copy(f.d.answers));
    const result=await f.save(f.retained(),{client});
    assert.equal(result.status,destination?'queued':'saved');
    assert.equal(result.summaryOnly,true);
    assert.equal(client.tables[SESSION_TABLE].size,1);
    assert.equal(client.tables[ANSWER_TABLE].size,0);
    assert.equal(client.tables[SESSION_TABLE].get(f.d.id).correct_answers,1);
  }
});


// F2E2a: fictional versioned rating baseline/receipt and durable event tests.
const RatingAPI=context.window.KGRatingSave;
const RATING_WORD='44000000-0000-4000-8000-000000000001';
const RATING_WORD2='44000000-0000-4000-8000-000000000002';
function ratingFixture(initial=null){
  const storage=memoryStorage(),store=RatingAPI.createStore({storage,makeId:uuid,now:()=>AT});
  const target={ownerId:OWNER,languageCode:'my',vocabularyId:RATING_WORD,revision:17};
  let owner=OWNER,policy={state:'restricted',revision:17},languageCode='my',fault=null;
  const states=new Map([[RATING_WORD,{version:0,state:copy(initial)}]]),receipts=new Map(),calls=[];
  const current=id=>states.get(id)||{version:0,state:null};
  const client={auth:{async getSession(){return {data:{session:{user:{id:owner}}}};}},
    from(){throw Error('No restricted direct writes');},
    async rpc(name,args){
      calls.push({name,args:copy(args)});
      const id=args.p_vocabulary_id,v=current(id);
      if(fault==='deny')return {error:{code:'42501'}};
      if(args.p_expected_revision!==17||fault==='stale-revision')return {error:{code:'40001'}};
      if(name==='kg_chart_f2_my_progress_state'){
        if(fault==='readback'&&receipts.size)return {error:{message:'readback lost'}};
        return {data:{...copy(v),permission_revision:17}};
      }
      assert.equal(name,'kg_chart_f2_save_progress');
      assert.equal(args.p_topic_id,null);assert.equal(args.p_completed_at,null);
      const prior=receipts.get(args.p_event_id);
      if(prior){
        if(JSON.stringify(prior.args)!==JSON.stringify(args))return {error:{code:'23505'}};
        return {data:{event_id:args.p_event_id,event_version:prior.version,current_version:v.version,replayed:true}};
      }
      if(args.p_expected_version!==v.version)return {error:{code:'40001'}};
      if(fault==='missing')return {error:{code:'PGRST202'}};
      const next={version:v.version+1,state:args.p_operation==='rating_delete'?null:{
        rating:args.p_rating,last_reviewed_at:args.p_last_reviewed_at,updated_at:args.p_updated_at}};
      states.set(id,next);receipts.set(args.p_event_id,{args:copy(args),version:next.version});
      if(fault==='lost')throw Error('synthetic lost reply');
      if(fault==='switch')owner=OTHER;
      return {data:{event_id:args.p_event_id,event_version:next.version,
        current_version:fault==='malformed'?next.version+1:next.version,replayed:false}};
    }};
  const options={client,store,getScope:()=>({ownerId:owner,languageCode,policy})};
  return {storage,store,target,options,calls,receipts,current,
    set fault(v){fault=v;},set owner(v){owner=v;},set policy(v){policy=v;},set languageCode(v){languageCode=v;},
    advance(id,state){states.set(id,{version:current(id).version+1,state:copy(state)});},
    async make(value,id=RATING_WORD){
      const t={...target,vocabularyId:id};return store.make(t,await RatingAPI.read(options,t),value);
    },
    save:e=>RatingAPI.save(options,e),
    reopen:()=>RatingAPI.createStore({storage,makeId:uuid,now:()=>AT})};
}
test('F2E2a: version-zero historical rating, delete tombstone and fresh update',async()=>{
  const f=ratingFixture({rating:2,last_reviewed_at:null,updated_at:null});
  const e=await f.make(null);
  assert.equal(e.expectedVersion,0);assert.equal(e.originalState.rating,2);
  f.store.put(e);
  let r=await f.save(e);
  assert.equal(r.status,'saved');assert.equal(r.current.version,1);assert.equal(r.current.state,null);
  const fresh=await f.make(4);
  assert.equal(fresh.expectedVersion,1);assert.equal(fresh.originalState,null);
  f.store.put(fresh);r=await f.save(fresh);
  assert.equal(r.status,'saved');assert.equal(r.current.state.rating,4);assert.equal(r.current.version,2);
});
test('F2E2a: lost reply replay after a newer rating uses exact event and shows current state',async()=>{
  const f=ratingFixture(),e=await f.make(5);
  f.store.put(e);f.fault='lost';
  assert.equal((await f.save(e)).status,'pending');
  const original=f.reopen().list(OWNER,'my')[0];assert.deepEqual(copy(original),copy(e));
  f.advance(RATING_WORD,{rating:1,last_reviewed_at:AT,updated_at:AT});f.fault=null;
  const r=await RatingAPI.save({...f.options,store:f.reopen()},original);
  assert.equal(r.status,'superseded');assert.equal(r.receipt.event_version,1);
  assert.equal(r.current.version,2);assert.equal(r.current.state.rating,1);assert.equal(f.receipts.size,1);
  const writes=f.calls.filter(c=>c.name==='kg_chart_f2_save_progress');
  assert.deepEqual(writes[0],writes[1]);assert.equal(f.store.list(OWNER,'my').length,0);
});
test('F2E2a: stale baseline retained, explicit archive and separate new baseline',async()=>{
  const f=ratingFixture(),old=await f.make(4);
  f.advance(RATING_WORD,{rating:2,last_reviewed_at:AT,updated_at:AT});f.store.put(old);
  assert.equal((await f.save(old)).status,'conflict');
  assert.throws(()=>f.store.put(f.store.make(f.target,{version:1,state:f.current(RATING_WORD).state,permission_revision:17},5)));
  const current=await RatingAPI.read(f.options,f.target);f.store.archive(old,current);
  assert.equal(f.store.list(OWNER,'my').length,0);
  assert.ok([...f.storage.entries.keys()].some(k=>k.startsWith(RatingAPI.archivePrefix)));
  assert.throws(()=>f.store.put(old));
  const fresh=await f.make(5);assert.equal(fresh.expectedVersion,1);assert.notEqual(fresh.eventId,old.eventId);
  f.store.put(fresh);assert.equal((await f.save(fresh)).status,'saved');
});
test('F2E2a: delete/recreate/delete does not resurrect an obsolete absent baseline',async()=>{
  const f=ratingFixture(),old=await f.make(3);
  f.advance(RATING_WORD,{rating:2,last_reviewed_at:AT,updated_at:AT});f.advance(RATING_WORD,null);
  f.store.put(old);assert.equal((await f.save(old)).status,'conflict');
  assert.equal(f.current(RATING_WORD).version,2);assert.equal(f.current(RATING_WORD).state,null);
  assert.equal(f.store.list(OWNER,'my')[0].expectedVersion,0);
});
test('F2E2a: denied, stale revision, bad receipt, unavailable RPC, readback and account change retain event',async()=>{
  for(const [fault,status] of [['deny','blocked'],['stale-revision','conflict'],['malformed','pending'],
    ['missing','pending'],['readback','pending'],['switch','blocked']]){
    const f=ratingFixture(),e=await f.make(2);f.store.put(e);f.fault=fault;
    assert.equal((await f.save(e)).status,status,fault);
    assert.deepEqual(copy(f.store.list(OWNER,'my')[0]),copy(e),fault);
  }
});
test('F2E2a: changed scope and offline facade cannot send original restricted rating',async()=>{
  const f=ratingFixture(),e=await f.make(3);f.store.put(e);
  f.owner=OTHER;assert.equal((await f.save(e)).status,'blocked');f.owner=OWNER;
  f.policy={state:'restricted',revision:18};assert.equal((await f.save(e)).status,'blocked');
  f.policy={state:'legacy'};assert.equal((await f.save(e)).status,'blocked');
  f.policy={state:'restricted',revision:17};f.languageCode='ja';assert.equal((await f.save(e)).status,'blocked');f.languageCode='my';
  assert.equal((await RatingAPI.save({...f.options,offlineClient:true},e)).status,'blocked');
  assert.equal(f.calls.filter(c=>c.name==='kg_chart_f2_save_progress').length,0);
  assert.equal(f.store.list(OTHER,'my').length,0);assert.equal(f.store.list(OWNER,'ja').length,0);
});
test('F2E2a: storage before network, duplicate in flight and independent words',async()=>{
  const f=ratingFixture(),e=await f.make(3),other=await f.make(1,RATING_WORD2);
  f.storage.failSet=true;assert.throws(()=>f.store.put(e));f.storage.failSet=false;
  assert.equal((await f.save(e)).status,'storage-error');
  f.store.put(e);f.store.put(other);
  assert.throws(()=>f.store.archive(e,{version:0,state:null,permission_revision:17}));
  const [a,b,c]=await Promise.all([f.save(e),f.save(e),f.save(other)]);
  assert.equal(a.status,'saved');assert.equal(b.status,'saved');assert.equal(c.status,'saved');
  assert.equal(f.calls.filter(x=>x.name==='kg_chart_f2_save_progress').length,2);
  assert.equal(f.current(RATING_WORD).state.rating,3);assert.equal(f.current(RATING_WORD2).state.rating,1);
});


// F2E2b: exact evidence/record version and reset boundary, no invented
// completion timestamp after a lost or denied receipt.
const CompletionAPI=context.window.KGCompletionSave;
const PATH_AT='2026-11-27T12:00:00.123456+00:00';
const PATH_RESET='2026-11-27T13:00:00.123457+00:00';
function completionFixture(){
  const storage=memoryStorage(),store=CompletionAPI.createStore({storage,makeId:uuid});
  const target={ownerId:OWNER,languageCode:'my',revision:17};
  let owner=OWNER,policy={state:'restricted',revision:17},fault=null;
  let snap={owner_id:OWNER,language_code:'my',permission_revision:17,reset_at:null,bypass:false,unlocks:[],
    rules:{min_attempts:1,quiz_types:['native_to_image']},
    topics:[{topic_id:'food',version:0,complete:false,completed_at:null,eligible_at:PATH_AT}],
    counts:[{vocabulary_id:RATING_WORD,quiz_type:'native_to_image',count:1}]};
  const receipts=new Map(),calls=[];
  const client={auth:{async getSession(){return {data:{session:{user:{id:owner}}}};}},
    from(){throw Error('No direct completion mutation');},
    async rpc(name,args){
      calls.push({name,args:copy(args)});
      if(args.p_expected_revision!==snap.permission_revision)return {error:{code:'40001'}};
      if(fault==='deny')return {error:{code:'42501'}};
      if(name==='kg_chart_f2_my_completion_path'){
        if(fault==='readback'&&receipts.size)return {error:lost};
        return {data:copy(snap)};
      }
      assert.equal(name,'kg_chart_f2_complete_topic');
      if(fault==='missing')return {error:{code:'PGRST202'}};
      const row=snap.topics[0],prior=receipts.get(args.p_event_id);
      if(args.p_reset_at!==snap.reset_at)return {error:{code:'40001'}};
      if(prior){
        assert.deepEqual(prior.args,copy(args));
        return {data:{...prior.ack,current_version:row.version,replayed:true}};
      }
      if(args.p_expected_version!==row.version)return {error:{code:'40001'}};
      if(row.complete||args.p_evidence_at!==row.eligible_at)return {error:{code:'42501'}};
      row.complete=true;row.completed_at=args.p_evidence_at;row.version++;
      const ack={event_id:args.p_event_id,owner_id:OWNER,language_code:'my',topic_id:'food',
        permission_revision:17,reset_at:snap.reset_at,completed_at:row.completed_at,
        event_version:row.version,current_version:row.version,replayed:false};
      receipts.set(args.p_event_id,{args:copy(args),ack:copy(ack)});
      if(fault==='lost')return {error:lost};
      if(fault==='switch')owner=OTHER;
      if(fault==='malformed')ack.completed_at=PATH_RESET;
      return {data:ack};
    }};
  const options={client,store,getScope:()=>({ownerId:owner,languageCode:'my',policy})};
  return {storage,store,target,options,calls,receipts,get snapshot(){return copy(snap);},
    set fault(v){fault=v;},set owner(v){owner=v;},set policy(v){policy=v;},
    reset(){snap.reset_at=PATH_RESET;snap.permission_revision++;snap.topics[0].complete=false;
      snap.topics[0].eligible_at=null;snap.counts=[];policy={state:'restricted',revision:snap.permission_revision};},
    async make(){return store.make(target,await CompletionAPI.read(options,target),'food');},
    save:e=>CompletionAPI.save(options,e)};
}
test('F2E2b: exact receipt and readback before removing durable completion',async()=>{
  const f=completionFixture(),e=await f.make();
  assert.equal(e.evidenceAt,PATH_AT);assert.equal(e.expectedVersion,0);
  assert.equal((await f.save(e)).status,'storage-error');
  f.store.put(e);
  const [a,b]=await Promise.all([f.save(e),f.save(e)]);
  assert.equal(a.status,'saved');assert.equal(b.status,'saved');
  assert.equal(a.current.topics[0].complete,true);assert.equal(f.receipts.size,1);
  assert.equal(f.calls.filter(c=>c.name==='kg_chart_f2_complete_topic').length,1);
  assert.equal(f.store.list(OWNER,'my').length,0);
});
test('F2E2b: lost receipt retries the original event and microsecond timestamp after reload',async()=>{
  const f=completionFixture(),e=await f.make();f.store.put(e);f.fault='lost';
  assert.equal((await f.save(e)).status,'pending');
  const reopened=CompletionAPI.createStore({storage:f.storage,makeId:uuid});
  const retained=reopened.list(OWNER,'my')[0];
  f.fault=null;
  const result=await CompletionAPI.save({...f.options,store:reopened},retained);
  assert.equal(result.status,'saved');assert.equal(result.receipt.replayed,true);
  const writes=f.calls.filter(c=>c.name==='kg_chart_f2_complete_topic');
  assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].args.p_evidence_at,PATH_AT);
});
test('F2E2b: reset does not rebase old completion; explicit archive preserves request',async()=>{
  const f=completionFixture(),e=await f.make();f.store.put(e);
  assert.throws(()=>f.store.archive(e,f.snapshot,f.target));
  f.reset();assert.equal((await f.save(e)).status,'blocked');
  assert.equal(f.calls.filter(c=>c.name==='kg_chart_f2_complete_topic').length,0);
  const target={...f.target,revision:18};
  assert.throws(()=>f.store.make(target,f.snapshot,'food'));
  f.store.archive(e,f.snapshot,target);
  assert.equal(f.store.list(OWNER,'my').length,0);
  assert.ok([...f.storage.entries.keys()].some(k=>k.startsWith(CompletionAPI.archivePrefix)));
  assert.throws(()=>f.store.put(e));
});
test('F2E2b: denied, missing RPC, bad receipt, missing readback and owner change retain original',async()=>{
  for(const [fault,status] of [['deny','blocked'],['missing','pending'],['malformed','pending'],
    ['readback','pending'],['switch','blocked']]){
    const f=completionFixture(),e=await f.make();f.store.put(e);f.fault=fault;
    assert.equal((await f.save(e)).status,status,fault);
    assert.deepEqual(copy(f.store.list(OWNER,'my')[0]),copy(e));
  }
});
test('F2E2b: no offline facade, foreign snapshot, duplicate topic, or invented eligibility',async()=>{
  const f=completionFixture(),e=await f.make();f.store.put(e);
  assert.equal((await CompletionAPI.save({...f.options,offlineClient:true},e)).status,'blocked');
  assert.throws(()=>CompletionAPI.parseSnapshot({...f.snapshot,owner_id:OTHER},f.target));
  assert.throws(()=>CompletionAPI.parseSnapshot({...f.snapshot,topics:[...f.snapshot.topics,...f.snapshot.topics]},f.target));
  assert.throws(()=>f.store.make(f.target,f.snapshot,'unpermitted'));
  assert.equal(f.store.list(OTHER,'my').length,0);
  f.storage.failSet=true;
  assert.throws(()=>f.store.put({...e,eventId:uuid(),topicId:'other'}));
  assert.equal(f.calls.filter(c=>c.name==='kg_chart_f2_complete_topic').length,0);
});
