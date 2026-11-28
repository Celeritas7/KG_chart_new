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
test('F2E2b-R1: exact reset boundaries archive only obsolete events and preserve their payloads',async()=>{
  for(const [resetAt,obsolete] of [
    ['2026-11-27T12:00:00.123099+00:00',false],
    ['2026-11-27T12:00:00.123100+00:00',true],
    ['2026-11-27T12:00:00.123101+00:00',true],
    ['2026-11-27T21:00:00.123100+09:00',true],
    ['2026-11-27T06:30:00.123099-05:30',false],
    [null,false],
  ]){
    const f=completionFixture(),e={...await f.make(),evidenceAt:'2026-11-27T12:00:00.123100Z'};
    f.store.put(e);
    const current={...f.snapshot,permission_revision:18,reset_at:resetAt,
      topics:[{...f.snapshot.topics[0],eligible_at:null}],counts:[]};
    const target={...f.target,revision:18};
    assert.equal(CompletionAPI.canArchive(e,current),obsolete,String(resetAt));
    if(!obsolete){
      assert.throws(()=>f.store.archive(e,current,target),error=>error.code==='KG_PATH_ARCHIVE_UNCERTAIN');
      assert.deepEqual(copy(f.store.list(OWNER,'my')[0]),copy(e));
      continue;
    }
    f.store.archive(e,current,target);
    assert.equal(f.store.list(OWNER,'my').length,0);
    const archived=JSON.parse([...f.storage.entries].find(([k])=>k.startsWith(CompletionAPI.archivePrefix))[1]);
    assert.deepEqual(archived.event,copy(e));
    assert.equal(archived.observed.reset_at,resetAt);
    assert.equal(archived.observed.permission_revision,18);
    const fresh={...current,topics:[{...current.topics[0],eligible_at:'2026-11-27T12:00:00.123901Z'}]};
    const next=f.store.put(f.store.make(target,fresh,'food'));
    assert.notEqual(next.eventId,e.eventId);
    assert.equal(next.resetAt,resetAt);assert.equal(next.revision,18);
    assert.equal(next.evidenceAt,'2026-11-27T12:00:00.123901Z');
    assert.deepEqual(archived.event,copy(e));
  }
});
test('F2E2b-R1: uncertain timestamps and unchanged reset never justify archival',async()=>{
  const f=completionFixture(),e=await f.make();f.store.put(e);
  for(const resetAt of ['2026-11-27T12:00:00.1234567Z','2026-02-30T12:00:00.123457Z',
    'November 27, 2026 13:00:00 UTC','2026-11-27T12:00:00.123457+25:00']){
    const snap={...f.snapshot,reset_at:resetAt};
    assert.equal(CompletionAPI.canArchive(e,snap),false,resetAt);
    assert.throws(()=>f.store.archive(e,snap,f.target));
    assert.deepEqual(copy(f.store.list(OWNER,'my')[0]),copy(e));
  }
  const sameCutoff={...e,resetAt:e.evidenceAt};
  assert.equal(CompletionAPI.canArchive(sameCutoff,{...f.snapshot,reset_at:e.evidenceAt}),false);
  assert.equal(CompletionAPI.canArchive(e,{...f.snapshot,owner_id:OTHER,reset_at:PATH_RESET}),false);
  assert.equal(CompletionAPI.canArchive(e,{...f.snapshot,language_code:'ja',reset_at:PATH_RESET}),false);
  assert.equal(CompletionAPI.canArchive(e,{...f.snapshot,topics:[{...f.snapshot.topics[0],version:1}]}),true);
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


// F2E2c uses state versions, not rating-style event receipts. This fake
// models the final state/select/check envelopes; native PostgreSQL CI owns
// the receipt eligibility, rule precedence and administrative cutoff logic.
const LevelAPI=context.window.KGLevelState;
const LEVEL_STATE='kg_chart_f2_level_state',LEVEL_SELECT='kg_chart_f2_select_difficulty',LEVEL_CHECK='kg_chart_f2_check_level_up';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function levelFixture(initial={level:1,unlocked:2,version:5}){
  let state=copy(initial),owner=OWNER,revision=17;
  let live={ownerId:OWNER,languageCode:'my',policy:{state:'restricted',revision:17}};
  const calls=[],faults=[];
  const evidence={total:0,correct:0,requiredAnswers:40,requiredPct:85};
  const client={auth:{async getSession(){return {data:{session:{user:{id:owner}}}};}},
    from(){throw Error('Restricted difficulty must not access raw tables');},
    async rpc(name,args){
      calls.push({name,args:copy(args)});
      const i=faults.findIndex(f=>f.name===name),fault=i<0?null:faults.splice(i,1)[0];
      if(fault?.before)await fault.before();
      if(fault?.throwBefore)throw Error('Synthetic transport failure');
      if(fault?.error&&!fault.commit)return {error:copy(fault.error)};
      if(args.p_expected_revision!==revision)return {error:{code:'40001'}};
      assert.equal(args.p_lang,'my');
      let data;
      if(name===LEVEL_STATE)data=copy(state);
      else{
        assert.ok([LEVEL_SELECT,LEVEL_CHECK].includes(name));
        if(args.p_expected_version!==state.version)return {error:{code:'40001'}};
        if(name===LEVEL_SELECT){
          if(args.p_level<1||args.p_level>state.unlocked)return {error:deny};
          if(args.p_level!==state.level){state.level=args.p_level;state.version++;}
          data=copy(state);
        }else{
          const total=state.unlocked===4?0:evidence.total,correct=state.unlocked===4?0:evidence.correct;
          if(state.unlocked<4&&total>=evidence.requiredAnswers&&correct*100>=total*evidence.requiredPct){
            state.unlocked++;state.version++;
          }
          data={...copy(state),evaluated_total:total,evaluated_correct:correct,
            required_answers:evidence.requiredAnswers,required_pct:evidence.requiredPct};
        }
      }
      if(fault?.after)await fault.after();
      if(fault?.throwAfter)throw Error('Synthetic lost reply');
      if(fault?.error)return {error:copy(fault.error)};
      if(fault&&Object.hasOwn(fault,'data'))data=typeof fault.data==='function'?fault.data(data):copy(fault.data);
      return {data,...(fault?.destination?{saveDestination:fault.destination}:{})};
    }};
  const options={client,getScope:()=>live};
  const target={ownerId:OWNER,languageCode:'my',revision:17};
  return {client,options,target,calls,evidence,faults,
    get state(){return copy(state);},set state(value){state=copy(value);},
    set owner(value){owner=value;},get live(){return live;},set live(value){live=value;},
    set revision(value){revision=value;},
    read:()=>LevelAPI.read(options,target),
    select:(before,desired)=>LevelAPI.select(options,target,before,desired),
    check:before=>LevelAPI.check(options,target,before)};
}
const levelWrites=f=>f.calls.filter(c=>c.name!==LEVEL_STATE);
test('F2E2c: only scoped server state is accepted; malformed and unsafe levels fail closed',async()=>{
  const f=levelFixture();assert.deepEqual(copy(await f.read()),f.state);
  assert.deepEqual(f.calls,[{name:LEVEL_STATE,args:{p_expected_revision:17,p_lang:'my'}}]);
  for(const bad of [null,[],{}, {level:'1',unlocked:2,version:0},{level:0,unlocked:2,version:0},
    {level:3,unlocked:2,version:0},{level:1,unlocked:5,version:0},{level:1,unlocked:2,version:-1},
    {level:1,unlocked:2,version:Number.MAX_SAFE_INTEGER+1}]){
    f.faults.push({name:LEVEL_STATE,data:bad});
    await assert.rejects(f.read(),error=>error.code==='KG_LEVEL_STATE');
  }
  assert.equal(levelWrites(f).length,0);
});
test('F2E2c: selection waits for acknowledgement and current readback; original version stays frozen',async()=>{
  const f=levelFixture(),before=await f.read(),entered=deferred(),release=deferred();
  f.faults.push({name:LEVEL_STATE,before:async()=>{entered.resolve();await release.promise;}});
  let settled=false;const task=f.select(before,2).then(result=>{settled=true;return result;});
  await entered.promise;
  assert.equal(settled,false);assert.equal(f.state.level,2);
  assert.deepEqual(copy(before),{level:1,unlocked:2,version:5});
  before.version=999;before.level=4;release.resolve();
  const result=await task;
  assert.equal(result.status,'confirmed');assert.deepEqual(copy(result.current),f.state);
  assert.equal(result.advanced,null);
  assert.deepEqual(levelWrites(f),[{name:LEVEL_SELECT,args:{p_expected_revision:17,p_lang:'my',p_expected_version:5,p_level:2}}]);
});
test('F2E2c: no-op selection keeps version and locked or exhausted versions send nothing',async()=>{
  const f=levelFixture(),before=await f.read();
  assert.equal((await f.select(before,1)).status,'confirmed');assert.equal(f.state.version,5);
  assert.equal((await f.select(before,3)).status,'blocked');
  assert.equal((await f.select({...before,version:Number.MAX_SAFE_INTEGER},2)).status,'blocked');
  assert.equal(levelWrites(f).length,1);
});
test('F2E2c: exact concurrent selection joins once and a competing check stays blocked',async()=>{
  const f=levelFixture(),before=await f.read(),entered=deferred(),release=deferred();
  f.faults.push({name:LEVEL_SELECT,before:async()=>{entered.resolve();await release.promise;}});
  const a=f.select(before,2),b=f.select(copy(before),2);
  assert.equal(a,b);await entered.promise;
  assert.equal((await f.check(before)).status,'busy');
  release.resolve();assert.equal((await a).status,'confirmed');assert.equal(levelWrites(f).length,1);
});
test('F2E2c: whole-session evaluation is server-owned and advancement discards old-level progress',async()=>{
  const f=levelFixture({level:1,unlocked:1,version:0});
  Object.assign(f.evidence,{total:11,correct:9,requiredAnswers:10,requiredPct:90});
  const first=await f.check(await f.read());
  assert.equal(first.status,'confirmed');assert.equal(first.advanced,null);
  assert.deepEqual(copy(first.evaluation),{level:1,total:11,correct:9,requiredAnswers:10,requiredPct:90,pct:81});
  assert.equal(f.state.unlocked,1);
  Object.assign(f.evidence,{total:12,correct:11});
  const second=await f.check(first.current);
  assert.equal(second.status,'confirmed');assert.equal(second.advanced,2);assert.equal(second.evaluation,null);
  assert.deepEqual(copy(second.current),{level:1,unlocked:2,version:1});
  const max=levelFixture({level:3,unlocked:4,version:10});
  Object.assign(max.evidence,{total:500,correct:500});
  const capped=await max.check(await max.read());
  assert.equal(capped.status,'confirmed');assert.equal(capped.advanced,null);assert.equal(capped.evaluation,null);
  assert.equal(max.state.version,10);
});
test('F2E2c: missing or failed selection reconciles current state without another mutation',async()=>{
  for(const fault of [{error:deny},{error:{code:'PGRST202'}},{throwBefore:true}]){
    const f=levelFixture(),before=await f.read();f.faults.push({name:LEVEL_SELECT,...fault});
    const result=await f.select(before,2);
    assert.equal(result.status,'reconciled');assert.equal(result.current.level,1);
    assert.equal(result.advanced,null);assert.equal(levelWrites(f).length,1);
    assert.equal(f.calls.filter(c=>c.name===LEVEL_STATE).length,2);
  }
});
test('F2E2c: lost committed selection or unlock is observed but never attributed or replayed',async()=>{
  for(const operation of ['select','check']){
    const f=levelFixture(),before=await f.read();
    Object.assign(f.evidence,{total:40,correct:40});
    f.faults.push({name:operation==='select'?LEVEL_SELECT:LEVEL_CHECK,throwAfter:true});
    const result=await (operation==='select'?f.select(before,2):f.check(before));
    assert.equal(result.status,'reconciled');assert.deepEqual(copy(result.current),f.state);
    assert.equal(result.advanced,null);assert.equal(result.evaluation,null);assert.equal(levelWrites(f).length,1);
    // A reopened consumer may read the state; it does not rerun the intent.
    await f.read();await f.read();assert.equal(levelWrites(f).length,1);
  }
});
test('F2E2c: lost no-op check never reruns even when fresh evidence can now unlock',async()=>{
  const f=levelFixture({level:1,unlocked:1,version:0}),before=await f.read();
  f.faults.push({name:LEVEL_CHECK,error:lost,commit:true,after:()=>{Object.assign(f.evidence,{total:40,correct:40});}});
  const result=await f.check(before);
  assert.equal(result.status,'reconciled');assert.equal(result.current.version,0);assert.equal(result.current.unlocked,1);
  await f.read();assert.equal(levelWrites(f).length,1);assert.equal(f.state.unlocked,1);
  // A deliberate subsequent check is a new action, not original-event replay.
  const explicit=await f.check(result.current);assert.equal(explicit.advanced,2);assert.equal(levelWrites(f).length,2);
});
test('F2E2c: stale versions reconcile without rebasing and newer readback never celebrates',async()=>{
  const f=levelFixture(),before=await f.read();f.state={level:2,unlocked:3,version:8};
  const stale=await f.select(before,2);
  assert.equal(stale.status,'reconciled');assert.equal(stale.error.code,'KG_LEVEL_CONFLICT');
  assert.equal(stale.current.version,8);assert.equal(levelWrites(f).length,1);
  const g=levelFixture({level:1,unlocked:1,version:0});Object.assign(g.evidence,{total:40,correct:40});
  g.faults.push({name:LEVEL_CHECK,after:()=>{g.state={level:2,unlocked:2,version:2};}});
  const newer=await g.check(await g.read());
  assert.equal(newer.status,'superseded');assert.deepEqual(copy(newer.current),g.state);
  assert.equal(newer.advanced,null);assert.equal(newer.evaluation,null);assert.equal(levelWrites(g).length,1);
});
test('F2E2c: malformed acknowledgements cannot confirm a selection or advancement',async()=>{
  for(const data of [s=>({...s,version:s.version+1}),s=>({...s,level:1}),s=>({...s,unlocked:3}),null]){
    const f=levelFixture(),before=await f.read();f.faults.push({name:LEVEL_SELECT,data});
    const result=await f.select(before,2);assert.equal(result.status,'reconciled');assert.equal(result.advanced,null);
  }
  for(const data of [s=>({...s,unlocked:3,version:2}),s=>({...s,evaluated_correct:41}),
    s=>({...s,required_answers:9}),s=>({...s,required_pct:101}),s=>({...s,level:2}),
    s=>({...s,evaluated_total:0,evaluated_correct:0}),s=>({...s,unlocked:1,version:0})]){
    const f=levelFixture({level:1,unlocked:1,version:0});Object.assign(f.evidence,{total:40,correct:40});
    f.faults.push({name:LEVEL_CHECK,data});const result=await f.check(await f.read());
    assert.equal(result.status,'reconciled');assert.equal(result.advanced,null);assert.equal(result.evaluation,null);
  }
});
test('F2E2c: absent or inconsistent readback holds state after an acknowledged mutation',async()=>{
  for(const fault of [{error:lost},{data:{level:1,unlocked:2,version:5}},
    {data:{level:1,unlocked:2,version:6}},{data:null},{destination:'device'}]){
    const f=levelFixture(),before=await f.read();f.faults.push({name:LEVEL_STATE,...fault});
    const result=await f.select(before,2);
    assert.equal(result.status,'unavailable');assert.equal(result.current,undefined);assert.equal(result.advanced,undefined);
    assert.equal(levelWrites(f).length,1);
  }
});
test('F2E2c: uncertain mutation cannot adopt a regressed or same-version changed baseline',async()=>{
  for(const data of [{level:1,unlocked:2,version:4},{level:2,unlocked:2,version:5},
    {level:1,unlocked:3,version:5}]){
    const f=levelFixture(),before=await f.read();
    f.faults.push({name:LEVEL_SELECT,error:lost},{name:LEVEL_STATE,data});
    const result=await f.select(before,2);
    assert.equal(result.status,'unavailable');assert.equal(result.error.code,'KG_LEVEL_READBACK');
    assert.equal(result.current,undefined);assert.equal(levelWrites(f).length,1);
  }
});
test('F2E2c: offline, unverified, foreign-owner and changed scope never authorize a mutation',async()=>{
  for(const change of [f=>{f.options.offlineClient=true;},f=>{f.live.policy={state:'legacy'};},
    f=>{f.live.policy={state:'restricted',revision:18};},f=>{f.live.languageCode='ja';},
    f=>{f.live.ownerId=OTHER;},f=>{f.owner=OTHER;}]){
    const f=levelFixture(),before=await f.read();change(f);
    assert.equal((await f.select(before,2)).status,'blocked');assert.equal(levelWrites(f).length,0);
  }
});
test('F2E2c: owner, language and revision changes during a mutation discard its reply',async()=>{
  for(const change of [f=>{f.owner=OTHER;},f=>{f.live.ownerId=OTHER;},f=>{f.live.languageCode='ja';},
    f=>{f.live.policy={state:'restricted',revision:18};}]){
    const f=levelFixture(),before=await f.read();f.faults.push({name:LEVEL_SELECT,after:()=>change(f)});
    const result=await f.select(before,2);
    assert.equal(result.status,'blocked');assert.equal(result.current,undefined);assert.equal(result.advanced,undefined);
    assert.equal(f.calls.filter(c=>c.name===LEVEL_STATE).length,1,'No read into a changed scope');
  }
});
test('F2E2c: device mutation acknowledgement is not a confirmed server action',async()=>{
  const f=levelFixture(),before=await f.read();f.faults.push({name:LEVEL_SELECT,destination:'device'});
  const result=await f.select(before,2);
  assert.equal(result.status,'reconciled');assert.equal(result.error.code,'KG_LEVEL_DEVICE');
  assert.equal(result.advanced,null);assert.equal(levelWrites(f).length,1);
});

// F2E2d: invented account preference state and immutable receipts. Native
// PostgreSQL CI separately exercises the actual authorization/merge SQL.
const PreferenceAPI=context.window.KGPreferenceSave;
const PREF_READ='kg_chart_f2_my_preferences',PREF_PATCH='kg_chart_f2_patch_preferences';
const BEST_KEY='my|copy|words|animals';
const bestRun=(cpm,at=AT)=>({cpm,last:cpm,at});
function preferenceFixture(initial={}){
  let state={owner_id:OWNER,permission_revision:17,version:0,audio_voice:'f',audio_muted:false,typing_best:{},...copy(initial)};
  let owner=state.owner_id,live={ownerId:state.owner_id,policy:{state:'restricted',revision:17}},revision=17;
  const storage=memoryStorage(),store=PreferenceAPI.createStore({storage,makeId:uuid,now:()=>AT});
  const calls=[],faults=[],receipts=new Map();
  const client={auth:{async getSession(){return {data:{session:{user:{id:owner}}}};}},
    from(){throw Error('Restricted preferences must not use raw account tables');},
    async rpc(name,args){
      calls.push({name,args:copy(args)});
      const i=faults.findIndex(f=>f.name===name),fault=i<0?null:faults.splice(i,1)[0];
      if(fault?.before)await fault.before();
      if(fault?.throwBefore)throw Error('Synthetic connection loss');
      if(fault?.error&&!fault.commit)return {error:copy(fault.error)};
      if(args.p_owner_id!==owner)return {error:deny};
      if(args.p_expected_revision!==revision)return {error:{code:'40001'}};
      let data;
      if(name===PREF_READ)data=copy(state);
      else{
        assert.equal(name,PREF_PATCH);
        const prior=receipts.get(args.p_event_id),payload=JSON.stringify(args);
        if(prior){
          if(prior.payload!==payload)return {error:{code:'23505'}};
          data={...copy(prior.receipt),current_version:state.version,replayed:true};
        }else{
          if(args.p_expected_version!==state.version)return {error:{code:'40001'}};
          const next=copy(state),patch=args.p_patch;
          if(Object.hasOwn(patch,'audio_voice'))next.audio_voice=patch.audio_voice;
          if(Object.hasOwn(patch,'audio_muted'))next.audio_muted=patch.audio_muted;
          for(const [key,value] of Object.entries(patch.typing_best||{})){
            const old=next.typing_best[key];
            if(!old)next.typing_best[key]=copy(value);
            else{
              const a=PreferenceAPI.instant(old.at),b=PreferenceAPI.instant(value.at);
              if(a===b&&old.last!==value.last)return {error:{code:'23505'}};
              next.typing_best[key]={...(b>a?value:old),cpm:Math.max(old.cpm,value.cpm)};
            }
          }
          next.version++;state=next;
          data={owner_id:owner,event_id:args.p_event_id,event_version:state.version,current_version:state.version,permission_revision:revision,replayed:false};
          receipts.set(args.p_event_id,{payload,receipt:copy(data)});
        }
      }
      if(fault?.after)await fault.after();
      if(fault?.throwAfter)throw Error('Synthetic lost reply after commit');
      if(fault?.error)return {error:copy(fault.error)};
      if(fault&&Object.hasOwn(fault,'data'))data=typeof fault.data==='function'?fault.data(data):copy(fault.data);
      return {data,...(fault?.destination?{saveDestination:fault.destination}:{})};
    }};
  const options={client,store,getScope:()=>live},target={ownerId:state.owner_id,revision:17};
  return {client,options,target,storage,store,calls,faults,receipts,
    get state(){return copy(state);},set state(v){state=copy(v);},
    get live(){return live;},set live(v){live=v;},set owner(v){owner=v;},set revision(v){revision=v;},
    read:()=>PreferenceAPI.read(options,target),
    make:async patch=>{const e=store.make(target,await PreferenceAPI.read(options,target),patch);store.put(e);return e;},
    save:e=>PreferenceAPI.save(options,e)};
}
const preferenceWrites=f=>f.calls.filter(c=>c.name===PREF_PATCH);
test('F2E2d: missing-row baseline is verified, owner-bound and independent of device mirrors',async()=>{
  const f=preferenceFixture();f.storage.setItem('kg_chart_audio_prefs',JSON.stringify({voice:'m',muted:true}));
  f.storage.setItem('kg_chart_typing_best',JSON.stringify({[BEST_KEY]:bestRun(999)}));
  const before=[...f.storage.entries];
  assert.deepEqual(copy(await f.read()),f.state);
  assert.deepEqual(f.calls,[{name:PREF_READ,args:{p_expected_revision:17,p_owner_id:OWNER}}]);
  assert.deepEqual([...f.storage.entries],before);assert.equal(preferenceWrites(f).length,0);
});
test('F2E2d: malformed, foreign or unsafe preference projections fail closed',async()=>{
  const f=preferenceFixture();
  for(const bad of [null,[],{}, {...f.state,owner_id:OTHER},{...f.state,permission_revision:18},
    {...f.state,version:'0'},{...f.state,version:-1},{...f.state,version:Number.MAX_SAFE_INTEGER+1},
    {...f.state,audio_voice:'x'},{...f.state,audio_muted:0},{...f.state,typing_best:[]},
    {...f.state,typing_best:{'my|copy|sentences':bestRun(1)}},{...f.state,typing_best:{[BEST_KEY]:{...bestRun(1),last:2}}}]){
    f.faults.push({name:PREF_READ,data:bad});await assert.rejects(f.read(),e=>e.code==='KG_PREF_STATE');
  }
  assert.equal(preferenceWrites(f).length,0);
});
test('F2E2d: drafts contain only supplied fields and copies of touched baseline keys',async()=>{
  const f=preferenceFixture({typing_best:{[BEST_KEY]:bestRun(100),'ja|recall|words':bestRun(200)}});
  const patch={audio_voice:'m',typing_best:{[BEST_KEY]:bestRun(20,'2026-11-26T11:00:00Z')}};
  const event=await f.make(patch);patch.typing_best[BEST_KEY].cpm=999;
  assert.deepEqual(copy(event.originalState),{audio_voice:'f',audio_muted:false,typing_best:{[BEST_KEY]:bestRun(100)}});
  assert.equal(event.patch.typing_best[BEST_KEY].cpm,20);
  const result=await f.save(event);assert.equal(result.status,'saved');
  assert.deepEqual(preferenceWrites(f)[0].args,{p_expected_revision:17,p_owner_id:OWNER,p_event_id:event.eventId,p_expected_version:0,
    p_patch:{audio_voice:'m',typing_best:{[BEST_KEY]:bestRun(20,'2026-11-26T11:00:00Z')}}});
  assert.equal(f.state.audio_muted,false);assert.equal(f.state.typing_best['ja|recall|words'].cpm,200);
});
test('F2E2d: invalid fields, replacement maps, typing keys, bounds and timestamps cannot form events',async()=>{
  const f=preferenceFixture(),before=await f.read();
  const badPatches=[{},[],{user_id:OWNER},{updated_at:AT},{audio_voice:'female'},{audio_muted:1},{typing_best:{}},
    ...['my|copy|sentences','my|copy|words|all','my|copy|words| bad','my|copy|words|','my|copy|words|a|b','MY|copy|words','my|write|words'].map(k=>({typing_best:{[k]:bestRun(10)}})),
    ...[{cpm:-1,last:0,at:AT},{cpm:100001,last:10,at:AT},{cpm:1.5,last:1,at:AT},{cpm:10,last:11,at:AT},
      {cpm:10,last:1,at:'2026-02-30T10:00:00Z'},{cpm:10,last:1,at:'2026-01-01'},
      {cpm:10,last:1,at:'2026-11-26T10:00:00.1234567Z'},{cpm:10,last:1,at:'9999-01-01T00:00:00Z'},
      {...bestRun(10),owner:OWNER}].map(v=>({typing_best:{[BEST_KEY]:v}})),
    {typing_best:Object.fromEntries(Array.from({length:51},(_,i)=>['my|copy|words|t'+i,bestRun(i)]))}];
  for(const patch of badPatches)assert.throws(()=>f.store.make(f.target,before,patch),e=>e.code==='KG_PREF_INVALID');
  assert.equal(f.storage.length,0);assert.equal(preferenceWrites(f).length,0);
});
test('F2E2d: microsecond and timezone comparisons preserve exact timestamp order',()=>{
  assert.equal(PreferenceAPI.instant('2026-11-26T10:00:00.123456Z'),PreferenceAPI.instant('2026-11-26T19:00:00.123456+09:00'));
  assert.equal(PreferenceAPI.instant('2026-11-26T10:00:00.123457Z')-PreferenceAPI.instant('2026-11-26T10:00:00.123456Z'),1n);
  for(const value of ['2026-02-29T00:00:00Z','2026-11-26T24:00:00Z','2026-11-26T10:60:00Z','2026-11-26T10:00:00+16:00','0000-01-01T00:00:00Z'])
    assert.throws(()=>PreferenceAPI.instant(value));
});
test('F2E2d: audio change waits for readback and never sends the untouched audio field',async()=>{
  const f=preferenceFixture(),event=await f.make({audio_voice:'m'}),entered=deferred(),release=deferred();
  f.faults.push({name:PREF_READ,before:async()=>{entered.resolve();await release.promise;}});
  let settled=false;const task=f.save(event).then(r=>{settled=true;return r;});await entered.promise;
  assert.equal(settled,false);assert.equal(f.store.list(OWNER).length,1);assert.equal(f.state.audio_voice,'m');
  release.resolve();const result=await task;assert.equal(result.status,'saved');assert.equal(f.store.list(OWNER).length,0);
  assert.deepEqual(preferenceWrites(f)[0].args.p_patch,{audio_voice:'m'});assert.equal(result.current.audio_muted,false);
});
test('F2E2d: a no-op accepted preference event still increments the account version',async()=>{
  const f=preferenceFixture(),event=await f.make({audio_muted:false});
  const result=await f.save(event);assert.equal(result.status,'saved');assert.equal(result.receipt.event_version,1);assert.equal(f.state.version,1);
});
test('F2E2d: duplicate saves join, account-wide competing changes remain separately recoverable',async()=>{
  const f=preferenceFixture(),voice=await f.make({audio_voice:'m'}),typing=await f.make({typing_best:{[BEST_KEY]:bestRun(90)}});
  const entered=deferred(),release=deferred();f.faults.push({name:PREF_PATCH,before:async()=>{entered.resolve();await release.promise;}});
  const task=f.save(voice);assert.equal(task,f.save(copy(voice)));await entered.promise;
  const held=await f.save(typing);assert.equal(held.status,'blocked');assert.equal(held.error.code,'KG_PREF_BUSY');
  assert.equal(f.store.list(OWNER).length,2);release.resolve();assert.equal((await task).status,'saved');
  const stale=await f.save(typing);assert.equal(stale.status,'conflict');assert.equal(f.store.list(OWNER).length,1);
  assert.equal(preferenceWrites(f).length,2);assert.equal(preferenceWrites(f)[1].args.p_expected_version,0);
});
test('F2E2d: different learners do not share an in-flight preference lock',async()=>{
  const f=preferenceFixture(),g=preferenceFixture({owner_id:OTHER});
  const a=await f.make({audio_voice:'m'}),b=await g.make({audio_muted:true}),entered=deferred(),release=deferred();
  f.faults.push({name:PREF_PATCH,before:async()=>{entered.resolve();await release.promise;}});
  const task=f.save(a);await entered.promise;assert.equal((await g.save(b)).status,'saved');release.resolve();await task;
});
test('F2E2d: faster older runs and slower newer runs merge maximum and last independently',async()=>{
  const f=preferenceFixture({typing_best:{[BEST_KEY]:bestRun(150,'2026-11-26T12:00:00Z')}});
  const older=await f.make({typing_best:{[BEST_KEY]:bestRun(200,'2026-11-26T11:00:00Z')}});
  assert.equal((await f.save(older)).status,'saved');
  assert.deepEqual(f.state.typing_best[BEST_KEY],{cpm:200,last:150,at:'2026-11-26T12:00:00Z'});
  const newer=await f.make({typing_best:{[BEST_KEY]:bestRun(80,'2026-11-26T13:00:00Z')}});
  assert.equal((await f.save(newer)).status,'saved');
  assert.deepEqual(f.state.typing_best[BEST_KEY],{cpm:200,last:80,at:'2026-11-26T13:00:00Z'});
});
test('F2E2d: equivalent timestamp conflicts hold while distinct microseconds retain the later run',async()=>{
  const f=preferenceFixture({typing_best:{[BEST_KEY]:bestRun(90,'2026-11-26T10:00:00.123456Z')}});
  const event=await f.make({typing_best:{[BEST_KEY]:bestRun(100,'2026-11-26T19:00:00.123456+09:00')}});
  assert.equal((await f.save(event)).status,'conflict');assert.equal(f.state.version,0);assert.equal(f.store.list(OWNER).length,1);
  const g=preferenceFixture({typing_best:{[BEST_KEY]:bestRun(90,'2026-11-26T10:00:00.123456Z')}});
  const next=await g.make({typing_best:{[BEST_KEY]:bestRun(80,'2026-11-26T10:00:00.123457Z')}});
  assert.equal((await g.save(next)).status,'saved');
  assert.deepEqual(g.state.typing_best[BEST_KEY],{cpm:90,last:80,at:'2026-11-26T10:00:00.123457Z'});
});
test('F2E2d: failed and lost replies retain exact events across reopening without automatic replay',async()=>{
  for(const fault of [{throwBefore:true},{throwAfter:true},{error:lost,commit:true}]){
    const f=preferenceFixture(),event=await f.make({audio_muted:true});f.faults.push({name:PREF_PATCH,...fault});
    const result=await f.save(event);assert.equal(result.status,'pending');assert.equal(result.current,undefined);
    const reopened=PreferenceAPI.createStore({storage:f.storage,makeId:uuid,now:()=>AT}),saved=reopened.list(OWNER)[0];
    assert.deepEqual(copy(saved),copy(event));await f.read();assert.equal(preferenceWrites(f).length,1);
    f.options.store=reopened;const retried=await f.save(saved);assert.equal(retried.status,'saved');
    assert.deepEqual(preferenceWrites(f)[0].args,preferenceWrites(f)[1].args);assert.equal(f.receipts.size,1);assert.equal(f.state.version,1);
  }
});
test('F2E2d: replay of an older accepted event shows current state without restoring the old fields',async()=>{
  const f=preferenceFixture(),event=await f.make({audio_voice:'m'});f.faults.push({name:PREF_PATCH,throwAfter:true});
  await f.save(event);f.state={...f.state,version:2,audio_voice:'f',audio_muted:true};
  const result=await f.save(event);assert.equal(result.status,'superseded');assert.equal(result.receipt.event_version,1);assert.equal(result.receipt.current_version,2);
  assert.equal(result.current.audio_voice,'f');assert.equal(result.current.audio_muted,true);assert.equal(f.state.version,2);
  assert.deepEqual(preferenceWrites(f)[0].args,preferenceWrites(f)[1].args);
});
test('F2E2d: stale baseline and changed revision stay held without rebasing or archive proof',async()=>{
  const f=preferenceFixture(),event=await f.make({audio_voice:'m'});f.state={...f.state,version:1,audio_muted:true};
  assert.equal((await f.save(event)).status,'conflict');assert.equal(event.expectedVersion,0);
  f.live={ownerId:OWNER,policy:{state:'restricted',revision:18}};f.revision=18;
  assert.equal((await f.save(event)).status,'blocked');assert.equal(preferenceWrites(f).length,1);
  assert.throws(()=>f.store.archive(event,{...f.state,permission_revision:18}));assert.equal(f.store.list(OWNER).length,1);
});
test('F2E2d: malformed receipts cannot clear or confirm original events',async()=>{
  for(const mutate of [d=>({...d,owner_id:OTHER}),d=>({...d,permission_revision:18}),d=>({...d,event_id:uuid()}),
    d=>({...d,event_version:2}),d=>({...d,current_version:0}),d=>({...d,current_version:2}),d=>({...d,replayed:'true'}),()=>null]){
    const f=preferenceFixture(),event=await f.make({audio_voice:'m'});f.faults.push({name:PREF_PATCH,data:mutate});
    const result=await f.save(event);assert.equal(result.status,'pending');assert.equal(result.error.code,'KG_PREF_RECEIPT');
    assert.equal(f.store.list(OWNER).length,1);assert.equal(f.calls.filter(c=>c.name===PREF_READ).length,1);
  }
});
test('F2E2d: missing, regressed or mismatched readback retains the receipt event for exact retry',async()=>{
  for(const fault of [{error:lost},{data:d=>({...d,version:0})},{data:d=>({...d,audio_voice:'f'})},
    {data:d=>({...d,audio_muted:true})},{data:null},{destination:'device'}]){
    const f=preferenceFixture(),event=await f.make({audio_voice:'m'});f.faults.push({name:PREF_READ,...fault});
    const result=await f.save(event);assert.equal(result.status,'pending');assert.equal(result.current,undefined);assert.equal(f.store.list(OWNER).length,1);
    assert.equal((await f.save(event)).status,'saved');assert.equal(f.state.version,1);
  }
});
test('F2E2d: touched typing merge must match but newly visible unrelated projection keys are accepted',async()=>{
  const f=preferenceFixture({typing_best:{[BEST_KEY]:bestRun(100)}});
  const event=await f.make({typing_best:{[BEST_KEY]:bestRun(50,'2026-11-26T11:00:00Z')}});
  f.faults.push({name:PREF_READ,data:d=>({...d,typing_best:{...d.typing_best,[BEST_KEY]:bestRun(50,'2026-11-26T11:00:00Z')}})});
  assert.equal((await f.save(event)).error.code,'KG_PREF_READBACK');assert.equal(f.store.list(OWNER).length,1);
  f.faults.push({name:PREF_READ,data:d=>({...d,typing_best:{...d.typing_best,'ja|copy|words':bestRun(70)}})});
  assert.equal((await f.save(event)).status,'saved');assert.equal(f.state.version,1);
  const g=preferenceFixture();const first=await g.read();g.state={...g.state,typing_best:{[BEST_KEY]:bestRun(10)}};
  const second=await g.read();assert.equal(first.version,second.version);assert.equal(second.typing_best[BEST_KEY].cpm,10);
});
test('F2E2d: current readback newer than the acknowledgement is not event-specific success',async()=>{
  const f=preferenceFixture(),event=await f.make({audio_muted:true});
  f.faults.push({name:PREF_PATCH,after:()=>{f.state={...f.state,version:2,audio_muted:false};}});
  const result=await f.save(event);assert.equal(result.status,'superseded');assert.equal(result.current.audio_muted,false);
  assert.equal(result.receipt.event_version,1);assert.equal(f.store.list(OWNER).length,0);
});
test('F2E2d: blocked policy, offline facade and mismatched auth never send a preference mutation',async()=>{
  for(const change of [f=>{f.options.offlineClient=true;},f=>{f.live.policy={state:'legacy'};},
    f=>{f.live.policy={state:'unavailable'};},f=>{f.live.policy.revision=18;},f=>{f.live.ownerId=OTHER;},f=>{f.owner=OTHER;}]){
    const f=preferenceFixture(),event=await f.make({audio_voice:'m'});change(f);
    assert.equal((await f.save(event)).status,'blocked');assert.equal(preferenceWrites(f).length,0);assert.equal(f.store.list(OWNER).length,1);
  }
});
test('F2E2d: scope changes while read, mutation or readback is pending discard stale replies',async()=>{
  for(const stage of ['read','patch','readback'])for(const change of [f=>{f.owner=OTHER;},f=>{f.live.ownerId=OTHER;},f=>{f.live.policy.revision=18;},f=>{f.live=null;}]){
    const f=preferenceFixture();
    if(stage==='read'){
      f.faults.push({name:PREF_READ,after:()=>change(f)});await assert.rejects(f.read());
    }else{
      const event=await f.make({audio_voice:'m'});f.faults.push({name:stage==='patch'?PREF_PATCH:PREF_READ,after:()=>change(f)});
      const result=await f.save(event);assert.equal(result.status,'blocked');assert.equal(result.current,undefined);assert.equal(f.store.list(OWNER).length,1);
    }
  }
});
test('F2E2d: a device acknowledgement cannot masquerade as an account preference receipt',async()=>{
  const f=preferenceFixture(),event=await f.make({audio_muted:true});f.faults.push({name:PREF_PATCH,destination:'device'});
  const result=await f.save(event);assert.equal(result.status,'pending');assert.equal(result.error.code,'KG_PREF_DEVICE');assert.equal(f.store.list(OWNER).length,1);
});
test('F2E2d: durable identity is required, payload changes are rejected and failed clearing is retryable',async()=>{
  const f=preferenceFixture(),before=await f.read(),event=f.store.make(f.target,before,{audio_voice:'m'});
  assert.equal((await f.save(event)).status,'storage-error');assert.equal(preferenceWrites(f).length,0);
  f.store.put(event);const changed=copy(event);changed.patch.audio_voice='f';assert.throws(()=>f.store.put(changed));
  assert.equal((await f.save(changed)).status,'storage-error');assert.equal(preferenceWrites(f).length,0);
  f.storage.failRemove=true;assert.equal((await f.save(event)).status,'storage-error');assert.equal(f.state.version,1);
  f.storage.failRemove=false;assert.equal((await f.save(event)).status,'saved');assert.equal(f.state.version,1);
});
test('F2E2d: explicit archive requires newer same-scope proof and preserves original event before removal',async()=>{
  const f=preferenceFixture(),event=await f.make({audio_voice:'m'}),before=await f.read();
  assert.throws(()=>f.store.archive(event,before),e=>e.code==='KG_PREF_ARCHIVE_UNCERTAIN');
  f.state={...f.state,version:1,audio_muted:true};const current=await f.read();
  f.storage.failSet=true;assert.throws(()=>f.store.archive(event,current));assert.equal(f.store.list(OWNER).length,1);
  f.storage.failSet=false;f.store.archive(event,current);assert.equal(f.store.list(OWNER).length,0);
  const archive=JSON.parse(f.storage.getItem(PreferenceAPI.archivePrefix+OWNER+':'+event.eventId));
  assert.deepEqual(archive.event,copy(event));assert.deepEqual(archive.observed,copy(current));assert.throws(()=>f.store.put(event));
  assert.equal(preferenceWrites(f).length,0);
});
test('F2E2d: foreign recovery namespaces and old unversioned outbox records are preserved',async()=>{
  const f=preferenceFixture(),event=await f.make({audio_voice:'m'});
  const other={...copy(event),ownerId:OTHER,eventId:uuid()};f.store.put(other);
  f.storage.setItem('kg_chart_audio_prefs','legacy audio bytes');f.storage.setItem('kg_chart_typing_best','legacy typing bytes');
  f.storage.setItem('kg-offline-outbox','unversioned preferences');const retained=[...f.storage.entries].filter(([k])=>!k.startsWith(PreferenceAPI.storagePrefix+OWNER+':'));
  assert.equal((await f.save(event)).status,'saved');assert.deepEqual([...f.storage.entries],retained);
  assert.equal(f.store.list(OTHER).length,1);assert.equal(f.store.list(OWNER).length,0);
});
test('F2E2d: a device clock correction cannot hide or rewrite a durable preference event',async()=>{
  const f=preferenceFixture({typing_best:{[BEST_KEY]:bestRun(120)}}),event=await f.make({typing_best:{[BEST_KEY]:bestRun(80,'2026-11-26T11:00:00Z')}});
  // The VM clock belongs only to the isolated helper, not the test process.
  vm.runInContext('globalThis.preferenceTestNow=Date.now;Date.now=()=>0;',context);
  try{
    const reopened=PreferenceAPI.createStore({storage:f.storage,makeId:uuid,now:()=>AT});
    assert.deepEqual(copy(reopened.list(OWNER)),[copy(event)]);assert.deepEqual(copy(reopened.sameStored(event)),copy(event));
    assert.equal(JSON.stringify(reopened.list(OWNER)[0]),JSON.stringify(event),'Export retains exact authored timestamps');
    assert.throws(()=>reopened.make(f.target,f.state,{typing_best:{[BEST_KEY]:bestRun(80)}}),'A new intent still requires a valid current-time baseline');
    f.options.store=reopened;f.faults.push({name:PREF_PATCH,error:{code:'22023'}});
    const result=await f.save(event);assert.equal(result.status,'pending');assert.equal(preferenceWrites(f).length,1);
    assert.deepEqual(preferenceWrites(f)[0].args.p_patch,copy(event.patch));assert.equal(reopened.list(OWNER).length,1);
  }finally{vm.runInContext('Date.now=globalThis.preferenceTestNow;delete globalThis.preferenceTestNow;',context);}
});
test('F2E2d: malformed or mismatched archive proof cannot remove pending recovery',async()=>{
  for(const corrupt of [a=>({event:a.event}),a=>({...a,observed:null}),a=>({...a,observed:{...a.observed,owner_id:OTHER}}),
    a=>({...a,observed:{...a.observed,permission_revision:18}}),a=>({...a,observed:{...a.observed,version:0}}),
    a=>({...a,archivedAt:'not a timestamp'}),a=>({...a,unexpected:true})]){
    const f=preferenceFixture(),event=await f.make({audio_voice:'m'});f.state={...f.state,version:1};
    const current=await f.read(),archive={event:copy(event),observed:copy(current),archivedAt:AT};
    f.storage.setItem(PreferenceAPI.archivePrefix+OWNER+':'+event.eventId,JSON.stringify(corrupt(archive)));
    assert.throws(()=>f.store.archive(event,current));assert.equal(f.store.list(OWNER).length,1);
    assert.deepEqual(copy(f.store.sameStored(event)),copy(event));
  }
});
