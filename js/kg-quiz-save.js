/* U4B2B-3D F1: recoverable, immutable word/sentence quiz saves.
 * Recovery drafts have a separate owner-scoped namespace. This module never
 * edits existing study storage, downloaded packs, or the offline outbox.
 * Legacy INSERT authorization remains the server's responsibility. F2E1a
 * uses the isolated F2D3A RPC contract for verified restricted online drafts.
 * This is not a production migration or an offline queue conversion.
 */
(function(root) {
  'use strict';
  const PREFIX = 'kg-chart-quiz-recovery-v1:';
  // Keep timed records separate so older builds can still open their F1 records.
  const TIMED_PREFIX = 'kg-chart-timed-quiz-recovery-v1:';
  const COLOUR_PREFIX = 'kg-chart-colour-quiz-recovery-v1:';
  const COLOUR_MODES = new Set(['phrase_to_picture', 'listen_to_picture', 'picture_to_phrase']);
  const COLOUR_KEYS = new Set(['phrase_id', 'selected_phrase_id', 'option_ids', 'answered_at']);
  const TABLES = { session: 'kg_chart_quiz_sessions', answers: 'kg_chart_quiz_answers' };
  const OPTIONAL = { session: ['quiz_level', 'difficulty'], answers: ['answer_text', 'answered_at'] };
  const SESSION_KEYS = new Set(['id', 'user_id', 'language_code', 'topic_id', 'quiz_type',
    'total_questions', 'correct_answers', 'completed_at', 'created_at', 'quiz_level', 'difficulty', 'time_spent_seconds']);
  const ANSWER_KEYS = new Set(['id', 'session_id', 'vocabulary_id', 'sentence_id',
    'selected_vocabulary_id', 'is_correct', 'answer_text', 'answered_at']);
  const QUIZ_TYPES = {
    word: ['native_to_image', 'image_to_native', 'devanagari_to_image', 'english_to_native',
      'listen_to_image', 'listen_to_native', 'word_builder', 'type_word'],
    sentence: ['sentence_to_meaning', 'meaning_to_sentence', 'build_sentence'],
    typing: ['typing_copy', 'typing_recall'],
    speaking: ['speak_lines', 'speak_paragraph'],
    colour: ['colour_phrase'],
  };
  const inFlight = new Map();
  const ATOMIC_LIMIT = 500;
  const ATOMIC_RPC = 'kg_chart_f2_save_recovery_quiz';
  const copy = value => JSON.parse(JSON.stringify(value));
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const text = (value, max = 200) => typeof value === 'string' && value.length > 0 &&
    value.length <= max && !/[\u0000-\u001f]/.test(value);
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const keysAllowed = (value, allowed) => Object.keys(value).every(key => allowed.has(key));
  const fail = (message, code, status = 'pending') => Object.assign(new Error(message), { code, status });
  const invalid = () => fail('This quiz recovery record is invalid. It has been retained without uploading.',
    'KG_QUIZ_INVALID_DRAFT', 'blocked');
  const colour = kind => kind === 'colour';
  const timed = kind => kind === 'typing' || kind === 'speaking' || colour(kind);
  const prefixFor = kind => colour(kind) ? COLOUR_PREFIX : timed(kind) ? TIMED_PREFIX : PREFIX;
  const ownerPrefix = (ownerId, prefix = PREFIX) => prefix + encodeURIComponent(ownerId) + ':';
  const draftKey = draft => ownerPrefix(draft.ownerId, prefixFor(draft.kind)) + encodeURIComponent(draft.id);
  const phraseId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const tally = (kind, answers) => answers.filter(answer => colour(kind)
    ? answer.phrase_id === answer.selected_phrase_id : kind === 'typing'
      ? answer.selected_vocabulary_id != null : answer.is_correct).length;
  const validSeconds = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;

  // Local-only authorization provenance. The F2D3A wire envelope stays v1.
  // Never assign a newer revision to already recorded work.
  function captureContext(policy) {
    if (policy?.state === 'legacy') return { mode: 'legacy' };
    if (policy?.state === 'restricted' && Number.isSafeInteger(policy.revision) && policy.revision > 0)
      return { mode: 'restricted', revision: policy.revision };
    return { mode: 'unverified' };
  }
  function validContext(value) {
    if (!record(value)) return false;
    if (value.mode === 'restricted') return Object.keys(value).length === 2 &&
      Number.isSafeInteger(value.revision) && value.revision > 0;
    return ['legacy', 'unverified'].includes(value.mode) && Object.keys(value).length === 1;
  }
  function sameContext(left, right) {
    return left?.mode === right?.mode && left?.revision === right?.revision &&
      (left === undefined) === (right === undefined);
  }

  function validateDraft(draft) {
    if (!record(draft) || draft.version !== 1 || !text(draft.id) || !text(draft.ownerId) ||
        !text(draft.languageCode, 32) || !owns(QUIZ_TYPES, draft.kind) || typeof draft.sealed !== 'boolean' ||
        !record(draft.session) || !keysAllowed(draft.session, SESSION_KEYS) ||
        !Array.isArray(draft.answers) || !record(draft.omittedColumns)) throw invalid();
    if (owns(draft, 'saveContext') && !validContext(draft.saveContext)) throw invalid();
    const session = draft.session;
    if (session.id !== draft.id || session.user_id !== draft.ownerId ||
        session.language_code !== draft.languageCode || !QUIZ_TYPES[draft.kind].includes(session.quiz_type) ||
        !(session.topic_id == null || text(session.topic_id, 200)) ||
        !Number.isSafeInteger(session.total_questions) || !Number.isSafeInteger(session.correct_answers) ||
        !timestamp(session.completed_at) || !timestamp(session.created_at) ||
        (session.quiz_level != null && !['copy', 'dev', 'memory'].includes(session.quiz_level)) ||
        (session.difficulty != null && !Number.isSafeInteger(session.difficulty))) throw invalid();
    if (timed(draft.kind) ? (!validSeconds(session.time_spent_seconds) || session.quiz_level != null ||
        session.difficulty != null || Date.parse(session.completed_at) < Date.parse(session.created_at)) :
        owns(session, 'time_spent_seconds')) throw invalid();
    if (colour(draft.kind)) {
      if (!COLOUR_MODES.has(draft.colourMode) || session.topic_id !== null ||
          owns(session, 'quiz_level') || owns(session, 'difficulty')) throw invalid();
    } else if (owns(draft, 'colourMode')) throw invalid();
    for (const type of ['session', 'answers']) {
      const omitted = draft.omittedColumns[type];
      if (!Array.isArray(omitted) || new Set(omitted).size !== omitted.length ||
          omitted.some(column => !OPTIONAL[type].includes(column)) ||
          (colour(draft.kind) && omitted.length)) throw invalid();
    }
    const ids = new Set();
    for (const answer of draft.answers) {
      if (colour(draft.kind)) {
        // These are the actual ordered phrase choices, not vocabulary answers.
        if (!record(answer) || !keysAllowed(answer, COLOUR_KEYS) ||
            !phraseId(answer.phrase_id) || !phraseId(answer.selected_phrase_id) ||
            ids.has(answer.phrase_id) || !Array.isArray(answer.option_ids) ||
            answer.option_ids.length < 1 || answer.option_ids.length > 4 ||
            !answer.option_ids.every(phraseId) ||
            new Set(answer.option_ids).size !== answer.option_ids.length ||
            !answer.option_ids.includes(answer.phrase_id) ||
            !answer.option_ids.includes(answer.selected_phrase_id) ||
            !timestamp(answer.answered_at) ||
            Date.parse(answer.answered_at) < Date.parse(session.created_at) ||
            Date.parse(answer.answered_at) > Date.parse(session.completed_at)) throw invalid();
        ids.add(answer.phrase_id);
        continue;
      }
      if (!record(answer) || !keysAllowed(answer, ANSWER_KEYS) || !text(answer.id) ||
          answer.id === draft.id || ids.has(answer.id) || answer.session_id !== draft.id ||
          typeof answer.is_correct !== 'boolean' || !timestamp(answer.answered_at) ||
          !(answer.selected_vocabulary_id == null || text(answer.selected_vocabulary_id)) ||
          !(answer.answer_text == null || typeof answer.answer_text === 'string')) throw invalid();
      // A sentence's identity is never an optional compatibility field.
      const word = text(answer.vocabulary_id), sentence = text(answer.sentence_id);
      if (word === sentence || (!word && answer.vocabulary_id != null) ||
          (!sentence && answer.sentence_id != null) ||
          (draft.kind === 'word' ? !word : draft.kind === 'sentence' || draft.kind === 'speaking' ? !sentence : false)) throw invalid();
      if (draft.kind === 'typing') {
        const target = word ? answer.vocabulary_id : answer.sentence_id;
        const finished = answer.selected_vocabulary_id != null;
        if ((finished && answer.selected_vocabulary_id !== target) || (answer.is_correct && !finished) ||
            (session.quiz_type === 'typing_recall' && answer.is_correct !== finished)) throw invalid();
      }
      if (draft.kind === 'speaking' && (answer.selected_vocabulary_id != null || answer.answer_text != null)) throw invalid();
      ids.add(answer.id);
    }
    if (session.total_questions !== draft.answers.length || session.correct_answers !==
        tally(draft.kind, draft.answers)) throw invalid();
    return draft;
  }

  function samePayload(left, right) {
    return record(left) && record(right) && left.id === right.id && left.ownerId === right.ownerId &&
      left.languageCode === right.languageCode && left.kind === right.kind &&
      left.colourMode === right.colourMode &&
      sameContext(left.saveContext, right.saveContext) &&
      JSON.stringify(left.session) === JSON.stringify(right.session) &&
      JSON.stringify(left.answers) === JSON.stringify(right.answers);
  }

  function createStore({ storage, uuid = () => root.crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
    const target = storage || root.localStorage;
    const storageError = error => fail('Quiz recovery could not be saved on this device. Keep this page open and retry. ' +
      (error?.message || ''), 'KG_QUIZ_STORAGE', 'storage-error');
    const read = key => {
      const raw = target.getItem(key);
      if (raw === null) return null;
      const draft = validateDraft(JSON.parse(raw));
      if (draftKey(draft) !== key) throw invalid();
      return draft;
    };
    return {
      start({ ownerId, languageCode, kind, session, saveContext, colourMode }) {
        const at = now(), id = uuid();
        const draft = {
          version: 1, id, ownerId, languageCode, kind,
          session: { ...session, id, user_id: ownerId, language_code: languageCode,
            total_questions: 0, correct_answers: 0, created_at: at, completed_at: at },
          answers: [], sealed: false, omittedColumns: { session: [], answers: [] },
          ...(saveContext === undefined ? {} : { saveContext: copy(saveContext) }),
          ...(colourMode === undefined ? {} : { colourMode }),
        };
        return validateDraft(copy(draft));
      },
      append(draft, answer, seconds) {
        validateDraft(draft);
        if (draft.sealed) throw fail('This quiz has already entered saving. Its recorded answers cannot be changed.',
          'KG_QUIZ_SEALED', 'blocked');
        const next = copy(draft);
        const row = colour(draft.kind)
          ? { ...copy(answer), answered_at: answer.answered_at || now() }
          : { ...answer, id: uuid(), session_id: draft.id, answered_at: answer.answered_at || now() };
        next.answers.push(row);
        next.session.total_questions = next.answers.length;
        next.session.correct_answers = tally(draft.kind, next.answers);
        next.session.completed_at = row.answered_at;
        if (timed(draft.kind)) {
          if (!validSeconds(seconds)) throw invalid();
          next.session.time_spent_seconds = Math.max(next.session.time_spent_seconds, seconds);
        }
        return validateDraft(copy(next));
      },
      finishTiming(draft, seconds) {
        validateDraft(draft);
        if (!timed(draft.kind) || draft.sealed || !validSeconds(seconds)) throw invalid();
        const next = copy(draft);
        next.session.time_spent_seconds = Math.max(next.session.time_spent_seconds, seconds);
        next.session.completed_at = new Date(Math.max(Date.parse(next.session.completed_at), Date.parse(now()))).toISOString();
        return validateDraft(next);
      },
      write(draft) {
        validateDraft(draft);
        try {
          const key = draftKey(draft), prior = read(key);
          // A stale component/tab must not replace a frozen request with a
          // different score or set of answers while that request is in flight.
          if (prior && (!sameContext(prior.saveContext, draft.saveContext) ||
              (colour(draft.kind) && (prior.colourMode !== draft.colourMode ||
                prior.session.created_at !== draft.session.created_at ||
                prior.session.time_spent_seconds > draft.session.time_spent_seconds ||
                prior.answers.length > draft.answers.length ||
                prior.answers.some((row, i) => JSON.stringify(row) !== JSON.stringify(draft.answers[i])))) ||
              (prior.sealed && (!draft.sealed || !samePayload(prior, draft)))))
            throw fail('Another save has already frozen this quiz. The existing recovery copy was preserved.',
              'KG_QUIZ_DRAFT_CONFLICT', 'storage-error');
          target.setItem(key, JSON.stringify(draft));
          return copy(draft);
        } catch (error) { throw storageError(error); }
      },
      list(ownerId, languageCode, kind) {
        if (!text(ownerId)) return [];
        try {
          const drafts = [], prefixes = kind == null ? [PREFIX, TIMED_PREFIX, COLOUR_PREFIX].map(prefix => ownerPrefix(ownerId, prefix))
            : [ownerPrefix(ownerId, prefixFor(kind))];
          for (let index = 0; index < target.length; index++) {
            const key = target.key(index);
            if (typeof key !== 'string' || !prefixes.some(prefix => key.startsWith(prefix))) continue;
            const draft = read(key);
            if (!draft || draft.ownerId !== ownerId) throw invalid();
            if ((languageCode == null || draft.languageCode === languageCode) &&
                (kind == null || draft.kind === kind)) drafts.push(draft);
          }
          return drafts.sort((a, b) => Date.parse(b.session.completed_at) - Date.parse(a.session.completed_at));
        } catch (error) { throw storageError(error); }
      },
      remove(draft) {
        validateDraft(draft);
        try {
          const key = draftKey(draft), prior = read(key);
          if (prior && !samePayload(prior, draft)) throw invalid();
          target.removeItem(key);
        } catch (error) { throw storageError(error); }
      },
    };
  }

  function sameField(type, key, saved, expected) {
    if ((type === 'session' && ['created_at', 'completed_at'].includes(key)) ||
        (type === 'answers' && key === 'answered_at')) {
      return timestamp(saved) && timestamp(expected) && Date.parse(saved) === Date.parse(expected);
    }
    return JSON.stringify(saved ?? null) === JSON.stringify(expected ?? null);
  }

  function assertRows(type, expected, actual) {
    const rows = actual == null ? [] : Array.isArray(actual) ? actual : [actual];
    if (rows.length !== expected.length || new Set(rows.map(row => row?.id)).size !== rows.length)
      throw fail('The server did not confirm every quiz record. Your recovery copy is retained.', 'KG_QUIZ_UNCONFIRMED');
    for (const row of expected) {
      const saved = rows.find(value => value?.id === row.id);
      if (!saved || Object.entries(row).some(([key, value]) => !sameField(type, key, saved[key], value)))
        throw fail('A saved quiz record does not match this attempt. Your recovery copy is retained.', 'KG_QUIZ_ACK_MISMATCH');
    }
    return rows;
  }

  function permissionDenied(error) {
    return error?.status === 'blocked' || [401, 403].includes(error?.status) ||
      ['42501', 'PGRST301', 'PGRST302', 'KG_OFFLINE_ACCESS_PENDING', 'KG_RESTRICTED_PACK_NOT_READY',
        'KG_QUIZ_ACCOUNT_CHANGED'].includes(error?.code);
  }

  function missingOptionalColumn(error, type, rows) {
    if (!['PGRST204', '42703'].includes(error?.code)) return null;
    const message = String(error.message || '');
    const table = message.match(/\b(?:column\s+of|of\s+relation)\s+['"]([^'"]+)['"]/i)?.[1];
    // A trigger or unrelated relation may mention the same field name. Its
    // error is not evidence that this requested table lacks that column.
    if ((table && table !== TABLES[type]) || (error.code === 'PGRST204' && !table)) return null;
    return OPTIONAL[type].find(column => rows.some(row => owns(row, column)) && (
      new RegExp("could not find (?:the )?['\"]" + column + "['\"] column\\b", 'i').test(message) ||
      new RegExp('\\bcolumn\\s+(?:[\\w]+\\.)?["\x27]?' + column +
        '["\x27]?(?:\\s+of\\s+relation\\s+["\x27][^"\x27]+["\x27])?\\s+does not exist\\b', 'i').test(message)
    )) || null;
  }

  async function performSave({ client, draft: supplied, store, getAccess, offlineClient = false }) {
    let draft = supplied;
    let destination = 'server';
    const denied = error => fail('Quiz saving is not currently permitted for this account. Your recovery copy is retained.',
      error?.code || 'KG_QUIZ_PERMISSION_DENIED', 'blocked');
    const assertOwner = async () => {
      const result = await client.auth.getSession();
      if (result?.error) {
        if (permissionDenied(result.error)) throw denied(result.error);
        throw result.error;
      }
      if (result?.data?.session?.user?.id !== draft.ownerId)
        throw fail('The signed-in account changed. This quiz remains with its original account.',
          'KG_QUIZ_ACCOUNT_CHANGED', 'blocked');
    };
    const asOwner = async operation => {
      await assertOwner();
      let result, thrown;
      try { result = await operation(); } catch (error) { thrown = error; }
      await assertOwner();
      if (thrown) throw thrown;
      if (result?.saveDestination === 'device') destination = 'device';
      return result;
    };
    const blocked = (message, code) => fail(message, code, 'blocked');
    const checkRoute = () => {
      // Older callers/tests without an access callback retain the legacy F1
      // contract. An actual restricted draft requires explicit verified scope.
      const current = captureContext(getAccess ? getAccess() : { state: 'legacy' });
      const original = draft.saveContext;
      if (current.mode === 'unverified' || original?.mode === 'unverified')
        throw blocked('Quiz permission provenance is unavailable. The original answers are retained.', 'KG_QUIZ_ACCESS_UNVERIFIED');
      if (current.mode === 'restricted' || original?.mode === 'restricted') {
        if (current.mode !== 'restricted' || original?.mode !== 'restricted')
          throw blocked('This quiz has no matching original restricted permission revision. It requires reconciliation.', 'KG_QUIZ_CONTEXT_REQUIRED');
        if (original.revision !== current.revision)
          throw blocked('Permissions changed since this quiz began. The original revision and answers are retained.', 'KG_QUIZ_STALE_REVISION');
        if (offlineClient)
          throw blocked('Restricted offline quiz reconciliation is not available yet. The original answers are retained.', 'KG_QUIZ_OFFLINE_DEFERRED');
        return 'atomic';
      }
      return 'legacy';
    };
    const saveAtomic = async () => {
      if (draft.answers.length > ATOMIC_LIMIT)
        throw blocked('This retained quiz exceeds the 500-answer atomic contract. It requires reconciliation, not splitting.', 'KG_QUIZ_ATOMIC_LIMIT');
      if (typeof client.rpc !== 'function')
        throw fail('Atomic quiz saving is unavailable. Your recovery copy is retained.', 'KG_QUIZ_RPC_UNAVAILABLE');
      const { saveContext, ...wireDraft } = copy(draft);
      const revision = saveContext.revision;
      const result = await asOwner(() => {
        if (checkRoute() !== 'atomic') throw blocked('Quiz save route changed.', 'KG_QUIZ_CONTEXT_REQUIRED');
        if (colour(draft.kind)) {
          return client.rpc('kg_chart_f2_save_colour_quiz', { p_expected_revision: revision,
            p_session: wireDraft.session, p_mode: wireDraft.colourMode, p_questions: wireDraft.answers });
        }
        if (timed(draft.kind)) {
          if (draft.kind === 'typing' && draft.answers.some(answer => !answer.vocabulary_id || answer.sentence_id != null))
            throw blocked('Restricted timed typing requires original word identities. This draft is retained.', 'KG_QUIZ_CONTEXT_REQUIRED');
          return client.rpc('kg_chart_f2_save_timed_quiz', { p_expected_revision: revision,
            p_session: wireDraft.session, p_answers: wireDraft.answers });
        }
        return client.rpc(ATOMIC_RPC, { p_expected_revision: revision, p_draft: wireDraft });
      });
      if (result?.error) {
        if (permissionDenied(result.error)) throw denied(result.error);
        if (result.error.code === '40001')
          throw blocked('The server rejected this original permission revision. The answers are retained.', 'KG_QUIZ_STALE_REVISION');
        throw result.error;
      }
      const receipt = result?.data;
      if (result?.saveDestination === 'device' || !record(receipt) ||
          receipt.session_id !== draft.id ||
          receipt[colour(draft.kind) ? 'question_count' : 'answer_count'] !== draft.answers.length ||
          (colour(draft.kind) && receipt.correct_answers !== draft.session.correct_answers) ||
          receipt.expected_revision !== revision || (timed(draft.kind) &&
            receipt.time_spent_seconds !== draft.session.time_spent_seconds))
        throw fail('The atomic server receipt did not confirm this quiz. Your recovery copy is retained.', 'KG_QUIZ_UNCONFIRMED');
      if (checkRoute() !== 'atomic') throw blocked('Quiz save route changed.', 'KG_QUIZ_CONTEXT_REQUIRED');
    };
    const payload = (type, rows) => rows.map(row => Object.fromEntries(Object.entries(row)
      .filter(([key]) => !draft.omittedColumns[type].includes(key))));
    const rememberOmission = (type, column) => {
      const next = copy(draft);
      if (!next.omittedColumns[type].includes(column)) next.omittedColumns[type].push(column);
      store.write(next); // Required before retry, including after a reopen.
      draft = next;
    };

    // A bulk INSERT is atomic. After a 23505, read every intended ID and
    // insert the missing subset together; never create new answers one by one.
    const insert = async (type, source, duplicatePass = 0) => {
      let rows = payload(type, source);
      for (let compatibilityPass = 0; compatibilityPass <= OPTIONAL[type].length; compatibilityPass++) {
        const result = await asOwner(() => client.from(TABLES[type])
          .insert(type === 'session' ? rows[0] : rows).select('*'));
        const error = result?.error;
        if (!error) { assertRows(type, rows, result?.data); return; }
        if (permissionDenied(error)) throw denied(error);
        const column = timed(draft.kind) ? null : missingOptionalColumn(error, type, rows);
        if (column) {
          rememberOmission(type, column);
          rows = payload(type, source);
          continue;
        }
        if (error.code !== '23505') throw error;
        let check;
        if (type === 'session') {
          check = await asOwner(() => client.from(TABLES.session).select('*')
            .eq('id', rows[0].id).eq('user_id', draft.ownerId).maybeSingle());
        } else {
          check = await asOwner(() => client.from(TABLES.answers).select('*')
            .in('id', rows.map(row => row.id)).eq('session_id', draft.id));
        }
        if (check?.error) throw permissionDenied(check.error) ? denied(check.error) : check.error;
        const found = check?.data == null ? [] : Array.isArray(check.data) ? check.data : [check.data];
        const existing = rows.filter(row => found.some(value => value?.id === row.id));
        assertRows(type, existing, found);
        const missing = rows.filter(row => !found.some(value => value?.id === row.id));
        if (!missing.length) return;
        if (type === 'session' || duplicatePass >= 1)
          throw fail('The existing quiz could not be confirmed. Your recovery copy is retained.', 'KG_QUIZ_UNCONFIRMED');
        await insert(type, source.filter(row => missing.some(value => value.id === row.id)), duplicatePass + 1);
        return;
      }
      throw fail('Quiz saving requires a compatible database schema. Your recovery copy is retained.', 'KG_QUIZ_SCHEMA_REQUIRED');
    };

    try {
      validateDraft(supplied);
      if (!supplied.answers.length) throw fail('There are no recorded quiz answers to save.', 'KG_QUIZ_EMPTY', 'blocked');
      draft = { ...copy(supplied), sealed: true };
      store.write(draft); // No request may begin until the complete immutable work is durable.
      const route = checkRoute();
      if (route === 'atomic') await saveAtomic();
      else {
        await insert('session', [draft.session]);
        // Legacy schemas and the old offline outbox support only colour summaries.
        // Never misrepresent phrase evidence as ordinary vocabulary answers.
        if (!colour(draft.kind)) await insert('answers', draft.answers);
      }
      await assertOwner();
      if (checkRoute() !== route) throw blocked('Quiz save route changed. The recovery copy is retained.', 'KG_QUIZ_CONTEXT_REQUIRED');
      const status = destination === 'device' ? 'queued' : 'saved';
      const summaryOnly = colour(draft.kind) && route === 'legacy';
      try { store.remove(draft); }
      catch (_) {
        return { status, draft, ...(summaryOnly ? {summaryOnly:true} : {}), warning: 'Results were saved, but the recovery copy could not be removed. A later retry will reuse the same record IDs.' };
      }
      return { status, draft, ...(summaryOnly ? {summaryOnly:true} : {}) };
    } catch (error) {
      return { status: permissionDenied(error) ? 'blocked' : error?.status === 'storage-error' ? 'storage-error' : 'pending',
        draft, error: { code: error?.code || 'KG_QUIZ_SAVE_FAILED',
          message: error?.message || 'Quiz saving was not confirmed. Your recovery copy is retained.' } };
    }
  }

  function save(options = {}) {
    if (!record(options)) return Promise.resolve({ status: 'blocked', draft: null,
      error: { code: 'KG_QUIZ_INVALID_DRAFT', message: invalid().message } });
    const key = JSON.stringify([options?.draft?.ownerId, options?.draft?.id]);
    const current = inFlight.get(key);
    if (current) {
      if (current.client === options.client && samePayload(current.draft, options.draft)) return current.task;
      return Promise.resolve({ status: 'storage-error', draft: options.draft,
        error: { code: 'KG_QUIZ_INFLIGHT_CONFLICT', message:
          'A different set of answers for this quiz is already being saved. These changes are still on this page; keep it open.' } });
    }
    // Take an immutable comparison snapshot too: a caller mutating its
    // original object cannot make different work share a successful receipt.
    let snapshot;
    try { snapshot = copy(options.draft); } catch (_) { snapshot = options.draft; }
    const task = performSave(options).finally(() => { if (inFlight.get(key)?.task === task) inFlight.delete(key); });
    inFlight.set(key, { task, draft: snapshot, client: options.client });
    return task;
  }

  root.KGQuizSave = { createStore, save, validateDraft, sameField, missingOptionalColumn,
    captureContext, atomicLimit: ATOMIC_LIMIT, storagePrefix: PREFIX, timedStoragePrefix: TIMED_PREFIX, colourStoragePrefix: COLOUR_PREFIX };
})(typeof window !== 'undefined' ? window : globalThis);
