/* KG Chart Offline runtime. Kept outside index.html; both editions compile the same learner UI.
 * Local IDB writes and the outbox commit in ONE transaction. No service-role key is used.
 */
(() => {
  'use strict';
  const DB_NAME = 'kg-chart-offline-v1';
  const DB_VERSION = 1;
  const SCHEMA_VERSION = 1;
  const PREFIX = 'kg-offline-pack-';
  let sharedPicturesReady=false;
  const packCache = name => window.KGSharedPictures.open(name,owner,sharedPicturesReady);
  const MEDIA_PATH = '/storage/v1/object/public/vocabulary-assets/';
  const MISSING_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220" viewBox="0 0 300 220" role="img" aria-label="Image unavailable">
    <rect width="300" height="220" rx="16" fill="#f1f5f9"/>
    <rect x="78" y="28" width="144" height="114" rx="10" fill="none" stroke="#64748b" stroke-width="5"/>
    <circle cx="116" cy="62" r="12" fill="#94a3b8"/>
    <path d="m87 126 43-42 29 27 23-21 30 36" fill="none" stroke="#64748b" stroke-linecap="round" stroke-linejoin="round" stroke-width="6"/>
    <text x="150" y="178" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#334155">Image unavailable</text>
    <text x="150" y="201" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#475569">Published picture is missing</text>
  </svg>`;
  const TABLES = {
    languages: 'kg_chart_languages', topics: 'kg_chart_topics', topicTranslations: 'kg_chart_topic_translations',
    vocabulary: 'kg_chart_vocabulary', vocabularyTranslations: 'kg_chart_vocabulary_translations',
    sentences: 'kg_chart_sentences', colours: 'kg_chart_colour_phrases', settings: 'kg_chart_settings',
    ratings: 'kg_chart_user_ratings', sessions: 'kg_chart_quiz_sessions', answers: 'kg_chart_quiz_answers',
    levels: 'kg_chart_user_levels', completions: 'kg_chart_topic_completions', unlocks: 'kg_chart_topic_unlocks',
    resets: 'kg_chart_progress_resets', prefs: 'kg_chart_user_prefs', pron: 'kg_chart_pronunciation_attempts',
  };
  const CONTENT_TABLES = new Set([TABLES.languages, TABLES.topics, TABLES.topicTranslations,
    TABLES.vocabulary, TABLES.vocabularyTranslations, TABLES.sentences, TABLES.colours, TABLES.settings]);
  const PERSONAL_TABLES = new Set([TABLES.ratings, TABLES.sessions, TABLES.answers, TABLES.levels,
    TABLES.completions, TABLES.unlocks, TABLES.resets, TABLES.prefs, TABLES.pron]);
  const WRITABLE_TABLES = new Set([TABLES.ratings, TABLES.sessions, TABLES.answers,
    TABLES.levels, TABLES.completions, TABLES.prefs]);
  const PRIMARY = {
    [TABLES.ratings]: ['user_id', 'vocabulary_id', 'language_code'],
    [TABLES.sessions]: ['id'], [TABLES.answers]: ['id'],
    [TABLES.levels]: ['email', 'language_code'],
    [TABLES.completions]: ['user_id', 'language_code', 'topic_id'],
    [TABLES.prefs]: ['user_id'],
  };
  const listeners = new Set();
  let db, live, mediaRoot = '', owner = null, enrollment = null, busy = false, pauseRequested = false, updateCheckAt = 0;
  let packs = new Map(), activeCaches = [], progress = { phase: 'opening', done: 0, total: 0, bytes: 0, remaining: null, failures: 0, missingImages: 0 };
  let syncing = false, syncError = '', lastSync = null, pendingCount = 0;
  let options = { autoUpdate: true, wifiOnly: true }, knownLanguages = [], selectedLang = 'my', quizBusy = false, panelOpen = false, shellReady = false;
  let pendingShellUpdate = null, applyingShellUpdate = false, shellUpdateError = '';
  let readinessReport=null,checkingReadiness=false;
  // U4A: review evidence lives only in memory until manually exported.
  // No re-enrollment, IndexedDB writes, caches.delete or hidden syncs.
  let devicePanelOpen=false,devicePlatform='',deviceChecks=Object.create(null);
  let deviceOfflineEvidence=null,deviceEvidenceWasOffline=false,deviceCheckMessage='';
  let accountEpoch=0;
  // U3D1: OFF by default. Restricted offline packs are NOT authorized
  // until U3D2/U3D3, even when a valid online grant exists.
  const U3D1_OFFLINE_ACCESS_ENABLED = false;
  // U3D2A deliberately creates NO restricted pack. This read-only preview
  // contract is independently OFF until all backend/media gates are reviewed.
  const U3D2_SCOPED_PACK_PREVIEW_ENABLED = false;
  // U3D2B1: stages short-lived, source-authorized private bytes in a new
  // owner's isolated cache only. NEVER activates the stage or writes pack
  // pointers. The live switch stays OFF through B2/U3D3 device acceptance.
  const U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED = false;
  // U3D2B2: owner-only private media pointer + blob playback, NOT a
  // downloadable restricted lesson pack. Requires U3D3 and real devices.
  const U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED = false;
  // U3D3A is a restricted outbox REVIEW/HOLD gate, not upload permission.
  const U3D3A_OUTBOX_HOLD_ENABLED = false;
  // U3D3B: restricted text + protected media share ONE owner-scoped atomic
  // pointer. This is OFF until U3D3C server sync, U4 physical and release.
  const U3D3B_RESTRICTED_PACKS_ENABLED = false;
  // U3D3C: per-event server/RLS-verified restricted replay. OFF until
  // current backend grant enforcement and physical U4 acceptance.
  const U3D3C_RESTRICTED_SYNC_ENABLED = false;
  let heldOutboxReview=null;
  const privateMediaKey=(id,lang)=>'active-private-media:'+id+':'+lang;
  const previousPrivateMediaKey=(id,lang)=>'previous-private-media:'+id+':'+lang;
  let cachedAccessRecord=null;
  let accessView={state:'blocked',reason:'unverified',revision:null};
  const policyKey=id=>'offline-access-policy:'+id;
  function effectiveAccess(){
    if(!U3D1_OFFLINE_ACCESS_ENABLED)return {state:'legacy',reason:'stage_off',revision:0};
    if(accessView.state==='blocked')return accessView;
    return window.KGOfflineAccess?.fromCache(cachedAccessRecord,owner,Date.now()) ||
      {state:'blocked',reason:'policy_module_unavailable'};
  }
  function legacyAccessReady(){
    return !U3D1_OFFLINE_ACCESS_ENABLED ||
      window.KGOfflineAccess?.mayUseLegacyPack(effectiveAccess(),owner)===true;
  }
  const accessDenied=()=>problem(
    'Offline permissions require fresh verification; restricted packs are not activated. Your saved lessons and queued work have not been deleted.',
    'KG_OFFLINE_ACCESS_PENDING');
  function blockAccess(reason){
    if(!U3D1_OFFLINE_ACCESS_ENABLED)return;
    heldOutboxReview=null;
    accessView={state:'blocked',reason,revision:null};
    tellWorker();notify();
  }
  async function restoreOfflineAccess(){
    if(!U3D1_OFFLINE_ACCESS_ENABLED||!currentEnrollment())return;
    cachedAccessRecord=await get(policyKey(owner))||null;
    accessView=window.KGOfflineAccess?.fromCache(cachedAccessRecord,owner,Date.now()) ||
      {state:'blocked',reason:'policy_module_unavailable'};
    tellWorker();notify();
  }
  async function refreshVerifiedAccess(){
    if(!U3D1_OFFLINE_ACCESS_ENABLED)return effectiveAccess();
    if(!currentEnrollment()||!live||!navigator.onLine){
      blockAccess('network_verification_required');
      throw Error('Reconnect to verify this account before offline permissions can be used.');
    }
    const guard=accountGuard();
    try{
      // Never trust a caller-supplied email or owner ID for authorization.
      const user=await fetchOwner();guard();
      if(user.id!==owner)throw Error('Different verified account');
      const result=await live.rpc('kg_chart_u3_my_access_snapshot');guard();
      if(result.error)throw Error('Server access snapshot unavailable');
      const proposed=window.KGOfflineAccess?.fromServer(result.data,owner,Date.now(),cachedAccessRecord);
      if(!proposed?.record)throw Error(proposed?.view?.reason||'Server access snapshot not verified');
      await put(policyKey(owner),proposed.record);guard();
      cachedAccessRecord=proposed.record;
      accessView=proposed.view;
      heldOutboxReview=null;
      tellWorker();notify();
      return effectiveAccess();
    }catch(error){
      blockAccess('server_policy_unverified');
      throw error;
    }
  }
  const accountGuard=()=>{const id=owner,epoch=accountEpoch;return()=>{if(owner!==id || accountEpoch!==epoch || !currentEnrollment()) throw Error('Account changed during this operation. Unsent work is retained.');};};
  let appVersion = window.KG_APP_VERSION || 'unknown', activeWorkerVersion = null;
  const unified = window.KG_UNIFIED === true;
  let studyLanguage = 'my';
  const bounded = (promise, label, ms = 12000) => new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(Error(label+' timed out. Close other KG Chart tabs and retry; saved data has not been cleared.')),ms);
    Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});
  });
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kg-offline-account-events') : null;
  const notify = () => { listeners.forEach(fn => fn()); renderPanel(); };
  const problem = (message, code = 'KG_OFFLINE') => ({ message, code });
  const offlineError = (label = 'This action') => problem(label + ' requires internet. Downloaded lessons and quizzes still work.', 'KG_INTERNET_REQUIRED');
  const now = () => new Date().toISOString();
  const rowKey = (row, keys) => keys.map(k => String(row[k] ?? '')).join('\u001f');
  const matches = (row, filters) => filters.every(([op, key, value]) => op === 'eq' ? row[key] === value :
    op === 'in' ? value.includes(row[key]) : op === 'is' ? row[key] === value : false);
  const simplify = value => JSON.parse(JSON.stringify(value));
  const digest = async value => {
    // Blob/Response buffers can cross realms (e.g. iframe, test harness). Check
    // the intrinsic tag so real file bytes, not "[object ArrayBuffer]", get hashed.
    const bytes=Object.prototype.toString.call(value)==='[object ArrayBuffer]' || ArrayBuffer.isView(value)
      ? value : new TextEncoder().encode(value);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function mediaBase() {
    if (!mediaRoot) throw Error('Public image and audio source is not configured. Sign in again while online.');
    return mediaRoot;
  }

  function publicMediaRoot(client) {
    // Derive the public Storage URL from the configured SDK, never from a second
    // hard-coded project reference. The sentinel never causes a network request.
    const sentinel = '__kg_offline_media_root__';
    const publicUrl = client.storage.from('vocabulary-assets').getPublicUrl(sentinel)?.data?.publicUrl;
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') ||
        url.pathname !== MEDIA_PATH + sentinel || url.search || url.hash)
      throw Error('Unexpected public media source. Pack download is unavailable.');
    return publicUrl.slice(0, -sentinel.length);
  }

  const openDB = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
    };
    req.onblocked = () => reject(Error('Local storage is blocked by another KG Chart tab. Close that tab and retry.'));
    req.onsuccess = () => { req.result.onversionchange=()=>req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
  const request = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const get = key => request(db.transaction('kv').objectStore('kv').get(key));
  const put = (key, value) => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const transact = (stores, task) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    let outcome;
    try { outcome = task(tx); } catch (e) { tx.abort(); reject(e); return; }
    tx.oncomplete = () => resolve(outcome);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error('Local write was not saved'));
  });
  async function outbox() { return (await request(db.transaction('outbox').objectStore('outbox').getAll()))
    .filter(e => e.ownerId === owner)
    .sort((a,b) => (a.sequence||0)-(b.sequence||0) || a.at.localeCompare(b.at) ||
      ((a.table===TABLES.sessions?-1:a.table===TABLES.answers?1:0)-(b.table===TABLES.sessions?-1:b.table===TABLES.answers?1:0)) ); }
  async function updatePending() { pendingCount = owner ? (await outbox()).length : 0; notify(); }
  async function auditRestrictedQueue() {
    // Read-only count inventory; ALL restricted events remain locally held.
    if(!U3D3A_OUTBOX_HOLD_ENABLED || !U3D1_OFFLINE_ACCESS_ENABLED ||
       !currentEnrollment()) return null;
    if(effectiveAccess().state==='legacy') {
      heldOutboxReview=null;return null;
    }
    const guard=accountGuard(),events=await outbox();guard();
    const report=window.KGAccessOutbox?.analyzeOutbox({
      ownerId:owner,policyRecord:cachedAccessRecord,events,checkedAt:Date.now(),
    });
    if(!report || report.publishable!==false || report.held!==events.length)
      throw Error('Restricted outbox audit unavailable; queued work remains saved.');
    guard();heldOutboxReview=report;notify();
    return report;
  }
  const accountKey = (table) => `rows:${owner}:${table}`;
  const currentEnrollment = () => enrollment && owner === enrollment.id && enrollment.unlocked === true;
  const canUseLocal = table => currentEnrollment() && (PERSONAL_TABLES.has(table) || CONTENT_TABLES.has(table));

  async function setRows(table, values) { await put(accountKey(table), values); }
  async function selectRows(table) {
    if (PERSONAL_TABLES.has(table)) return (await get(accountKey(table))) || [];
    const all = [];
    const seen = new Set();
    for (const p of packs.values()) {
      for (const row of p.data[table] || []) {
        const key = rowKey(row, table === TABLES.languages ? ['code'] :
          table === TABLES.topics ? ['id'] : table === TABLES.vocabulary ? ['id'] :
          table === TABLES.topicTranslations ? ['topic_id', 'language_code'] :
          table === TABLES.vocabularyTranslations ? ['vocabulary_id', 'language_code'] :
          table === TABLES.settings ? ['key'] : ['id']);
        if (!seen.has(key)) { seen.add(key); all.push(row); }
      }
    }
    return all;
  }

  function enrich(table, rows, nested, all) {
    if (!nested) return rows;
    if (table === TABLES.topics || table === TABLES.vocabulary) {
      const translationTable = table === TABLES.topics ? TABLES.topicTranslations : TABLES.vocabularyTranslations;
      const join = table === TABLES.topics ? 'topic_id' : 'vocabulary_id';
      return rows.map(row => ({ ...row, translations: (all[translationTable] || []).filter(t => t[join] === row.id) }));
    }
    if (table === TABLES.colours) {
      const vocab = all[TABLES.vocabulary] || [];
      return rows.map(row => ({ ...row,
        colour: vocab.find(v => v.id === row.colour_id) || null,
        noun: vocab.find(v => v.id === row.noun_id) || null }));
    }
    return rows;
  }

  class Query {
    constructor(table, remote) { this.table = table; this.remote = remote; this.filters = []; this.orders = []; this.limitN = null; this.start = 0; this.end = null; this.columns = '*'; this.mutation = null; this.shape = null; this.conflict = null; }
    select(cols = '*') { this.columns = cols; this.remote = this.remote.select(cols); return this; }
    eq(k,v) { this.filters.push(['eq', k, v]); this.remote = this.remote.eq(k,v); return this; }
    in(k,v) { this.filters.push(['in', k, v]); this.remote = this.remote.in(k,v); return this; }
    is(k,v) { this.filters.push(['is', k, v]); this.remote = this.remote.is(k,v); return this; }
    order(k,opts = {}) { this.orders.push([k,opts.ascending !== false]); this.remote = this.remote.order(k,opts); return this; }
    limit(n) { this.limitN=n; this.remote=this.remote.limit(n); return this; }
    range(start,end) { this.start=start;this.end=end;this.remote=this.remote.range(start,end);return this; }
    maybeSingle() { this.shape='maybeSingle';this.remote=this.remote.maybeSingle();return this; }
    single() { this.shape='single';this.remote=this.remote.single();return this; }
    insert(value,opts) { this.mutation=['insert', value];this.remote=this.remote.insert(value,opts);return this; }
    upsert(value,opts) { this.mutation=['upsert', value];this.conflict=opts?.onConflict;this.remote=this.remote.upsert(value,opts);return this; }
    update(value) { this.mutation=['update',value];this.remote=this.remote.update(value);return this; }
    delete() { this.mutation=['delete',null];this.remote=this.remote.delete();return this; }
    then(yes,no) { return this.execute().then(yes,no); }
    async execute() {
      const requestedLanguage = this.filters.find(([op,key])=>op==='eq' && key==='language_code')?.[2] || studyLanguage;
      let restrictedContent=null;
      const needsRemoteContent = unified && CONTENT_TABLES.has(this.table) && !packs.has(requestedLanguage);
      const onlineOnlyWrite = unified && this.mutation && !WRITABLE_TABLES.has(this.table);
      // Never read an unscoped previously downloaded pack or create new
      // queued learner mutations for a restricted/unknown account in U3D1.
      if(U3D1_OFFLINE_ACCESS_ENABLED &&
         (CONTENT_TABLES.has(this.table)||PERSONAL_TABLES.has(this.table)) &&
         !legacyAccessReady()){
        // Until U3D3C, queueing new restricted progress is explicitly
        // disabled. Never upgrade a broad legacy pack or read personal tables.
        if(!U3D3B_RESTRICTED_PACKS_ENABLED || navigator.onLine ||
           effectiveAccess().state!=='restricted_pending' ||
           !CONTENT_TABLES.has(this.table) || this.mutation)
          return {data:null,error:accessDenied()};
        try{
          const verified=await readRestrictedBundle(requestedLanguage);
          restrictedContent=verified.content;
        }catch(e){
          return {data:null,error:problem('Restricted offline lesson unavailable: '+e.message,
            'KG_RESTRICTED_PACK_NOT_READY')};
        }
      }
      if (!restrictedContent && (!canUseLocal(this.table) || needsRemoteContent || onlineOnlyWrite)) {
        if(!navigator.onLine) return {data:null,error:offlineError('This feature')};
        return this.remote.then(x=>x);
      }
      if (this.mutation) {
        if (!WRITABLE_TABLES.has(this.table)) return { data: null, error: offlineError('Editing shared lesson content') };
        if (!currentEnrollment()) return { data: null, error: problem('Reauthenticate this account before saving offline progress') };
        try { return { data: await queueMutation(this.table,this.mutation,this.filters,this.conflict,this.shape), error:null, saveDestination:'device' }; }
        catch (e) { return { data:null,error:problem('Could not save on this device: '+e.message, 'KG_LOCAL_SAVE_FAILED') }; }
      }
      try {
        let rows = (restrictedContent ? restrictedContent[this.table] : await selectRows(this.table))
          .filter(r => matches(r,this.filters));
        if (this.columns.includes('translations:') || this.table === TABLES.colours && this.columns.includes('colour:')) {
          const all = {};
          if (this.table === TABLES.topics) all[TABLES.topicTranslations] = restrictedContent ?
            restrictedContent[TABLES.topicTranslations] : await selectRows(TABLES.topicTranslations);
          if (this.table === TABLES.vocabulary) all[TABLES.vocabularyTranslations] = restrictedContent ?
            restrictedContent[TABLES.vocabularyTranslations] : await selectRows(TABLES.vocabularyTranslations);
          if (this.table === TABLES.colours) all[TABLES.vocabulary] = restrictedContent ?
            restrictedContent[TABLES.vocabulary] : await selectRows(TABLES.vocabulary);
          rows = enrich(this.table, rows, true, all);
        }
        for (const [column,asc] of [...this.orders].reverse()) rows.sort((a,b) => {
          const v=(a[column]??''),w=(b[column]??'');return (v < w ? -1 : v > w ? 1 : 0) * (asc?1:-1);
        });
        if (this.end !== null) rows=rows.slice(this.start,this.end+1);
        if (this.limitN !== null) rows=rows.slice(0,this.limitN);
        if (!this.columns.includes('*') && !this.columns.includes(':')) {
          const keys=this.columns.split(',').map(s=>s.trim());rows=rows.map(r=>Object.fromEntries(keys.map(k=>[k,r[k]])));
        }
        return {data:this.shape ? (rows[0]??null) : rows,error:null};
      } catch(e) { return {data:null,error:problem('Offline read failed: '+e.message)}; }
    }
  }

  function makeRows(table,kind,value,filters,oldRows,conflict) {
    const incoming = value == null ? [] : (Array.isArray(value)?value:[value]);
    const keys = (conflict && conflict.split(',').map(x=>x.trim())) || PRIMARY[table] || ['id'];
    const rows = oldRows.map(r=>({...r})), created=[], acknowledged=[];
    if (kind === 'delete') {
      const removed=rows.filter(r=>matches(r,filters));
      return {next:rows.filter(r=>!matches(r,filters)),created:removed};
    }
    if (kind === 'update') {
      rows.forEach(r=>{if(matches(r,filters)){Object.assign(r,value);created.push({...r});}});
      return {next:rows,created};
    }
    for (const raw of incoming) {
      const row={...raw};
      if ([TABLES.sessions,TABLES.answers].includes(table)) row.id ||= crypto.randomUUID();
      const quizIndex=[TABLES.sessions,TABLES.answers].includes(table)
        ? rows.findIndex(r=>rowKey(r,keys)===rowKey(row,keys)) : -1;
      if(quizIndex!==-1 && kind==='insert') {
        // F1 retries use immutable UUIDs. An exact local row already has its
        // original outbox event (or was pulled from the server); acknowledge it
        // without adding a second event. Never overwrite a conflicting result.
        // Compare supplied fields before generating default timestamps.
        const mismatch=Object.entries(row).find(([key,value])=>
          !sameDuplicateInsertField(table,key,rows[quizIndex][key],value));
        if(mismatch) throw Error(`Existing saved quiz differs in ${table}.${mismatch[0]}. Your original work was retained.`);
        acknowledged.push({...rows[quizIndex]});
        continue;
      }
      if (table===TABLES.sessions) row.created_at ||= now();
      if (table===TABLES.answers) row.answered_at ||= now();
      if (table === TABLES.ratings) { row.user_id ||= owner;row.updated_at ||= now(); }
      if ([TABLES.completions,TABLES.prefs].includes(table)) row.user_id=owner;
      const i=rows.findIndex(r=>rowKey(r,keys)===rowKey(row,keys));
      if (i===-1) rows.push(row);
      else if (kind === 'upsert') rows[i]={...rows[i],...row};
      created.push({...row});
      acknowledged.push({...row});
    }
    return {next:rows,created,acknowledged};
  }

  // Only the F1 word/sentence saves require answer rows. In particular,
  // colour_phrase intentionally saves a session summary with no answers.
  const QUIZ_ANSWER_TYPES=new Set([
    'native_to_image','image_to_native','devanagari_to_image','english_to_native',
    'listen_to_image','listen_to_native','word_builder','type_word',
    'sentence_to_meaning','meaning_to_sentence','build_sentence',
  ]);
  const quizChecksKey=uid=>'quiz-answer-checks:'+uid;
  function quizAnswersComplete(check,rows) {
    return Number.isSafeInteger(check.total_questions) && check.total_questions>0 &&
      Number.isSafeInteger(check.correct_answers) && check.correct_answers>=0 &&
      check.correct_answers<=check.total_questions &&
      rows.length===check.total_questions && rows.every(row=>typeof row.is_correct==='boolean') &&
      rows.filter(row=>row.is_correct).length===check.correct_answers;
  }

  async function queueMutation(table,[kind,value],filters,conflict,shape) {
    // This read + outbox enqueue + updated view are committed atomically, in one IDB transaction.
    const uid=owner;
    const guard=accountGuard();
    const key=`rows:${uid}:${table}`;
    if((Array.isArray(value)?value:[value]).filter(Boolean).some(row=>
      (row.user_id && row.user_id!==uid) ||
      (table===TABLES.levels && row.email?.toLowerCase()!==enrollment.email)))
      throw Error('Account mismatch: refusing to queue another user’s data');
    // Stamp only future events created with a verified owner policy.
    // Legacy rows never receive a guessed historical revision.
    const policyRevision=U3D3A_OUTBOX_HOLD_ENABLED && U3D1_OFFLINE_ACCESS_ENABLED &&
      cachedAccessRecord?.ownerId===uid &&
      Number.isSafeInteger(cachedAccessRecord.snapshot?.revision)
      ? cachedAccessRecord.snapshot.revision : null;
    let created=[],acknowledged=[],localError=null;
    await transact(['kv','outbox'], tx => {
      const kv=tx.objectStore('kv'), out=tx.objectStore('outbox');
      const req=kv.get(key);
      req.onsuccess=()=>{
        const prior=req.result || [];
        let result;
        try { guard();result=makeRows(table,kind,value,filters,prior,conflict); }
        catch(error) { localError=error;tx.abort();return; }
        created=result.created;
        acknowledged=result.acknowledged||created;
        if (kind === 'delete' && !created.length) {
          // Preserve a delete against a remote record even when local data is missing.
          created=[Object.fromEntries(filters.filter(([op])=>op==='eq').map(([,k,v])=>[k,v]))];
          acknowledged=created;
        }
        const seqReq=kv.get('sequence:'+uid);
        seqReq.onsuccess=()=>{
          try { guard(); } catch(error) {localError=error;tx.abort();return;}
          let sequence=Number(seqReq.result)||0;
          for(const row of created){
            if (owner!==uid || (row.user_id && row.user_id!==uid)) {tx.abort();return;}
            const base=prior.find(p=>rowKey(p,PRIMARY[table]||['id'])===rowKey(row,PRIMARY[table]||['id']));
            const event={ id:crypto.randomUUID(), sequence:++sequence, ownerId:uid, table, kind, row:simplify(row),
              filters:simplify(filters), at:now(), baseUpdatedAt:base?.updated_at||base?.last_reviewed_at||null,
              state:'pending',
              ...(policyRevision===null?{}:{permissionRevision:policyRevision}) };
            out.put(event);
          }
          if(table===TABLES.sessions && created.length){
            const pendingKey='level-checks:'+uid,req=kv.get(pendingKey);
            req.onsuccess=()=>{
              const checks=req.result||{};
              for(const row of created) if(row.language_code) checks[row.language_code]=sequence;
              kv.put(checks,pendingKey);
            };
            const checkedSessions=kind==='insert'
              ?created.filter(row=>QUIZ_ANSWER_TYPES.has(row.quiz_type)):[];
            if(checkedSessions.length) {
              const req=kv.get(quizChecksKey(uid));
              req.onsuccess=()=>{
                const checks=req.result||{};
                for(const row of checkedSessions) checks[row.id]={language_code:row.language_code,
                  total_questions:row.total_questions,correct_answers:row.correct_answers};
                kv.put(checks,quizChecksKey(uid));
              };
            }
          }
          if(table===TABLES.answers && kind==='insert' && acknowledged.length) {
            const req=kv.get(quizChecksKey(uid));
            req.onsuccess=()=>{
              const checks=req.result||{};
              for(const id of new Set(acknowledged.map(row=>row.session_id))) {
                if(checks[id] && quizAnswersComplete(checks[id],result.next.filter(row=>row.session_id===id)))
                  delete checks[id];
              }
              kv.put(checks,quizChecksKey(uid));
            };
          }
          kv.put(sequence,'sequence:'+uid);
          kv.put(result.next,key);
        };
      };
    }).catch(error=>{throw localError||error;});
    channel?.postMessage({type:'changed',owner});
    await updatePending();
    if(U3D3A_OUTBOX_HOLD_ENABLED)await auditRestrictedQueue().catch(e=>{
      // The IDB write already succeeded. An audit failure must NOT turn
      // an acknowledged local write into a misleading "save failed" result.
      syncError='Queued work saved; permission review needs retry: '+e.message;notify();
    });
    return shape ? (acknowledged[0]||null) : (acknowledged.length?acknowledged:null);
  }

  // Read the published Supabase tables (not CSV demo data) with pagination.
  async function readPaged(table, configure = q=>q, chunk = 700) {
    if (!live || !navigator.onLine) throw Error('Connect to the internet to download published lessons.');
    let rows=[];
    const key = table === TABLES.languages ? 'code' : table === TABLES.settings ? 'key' :
      table === TABLES.topics ? 'id' : table === TABLES.topicTranslations ? 'topic_id' :
      table === TABLES.vocabularyTranslations ? 'vocabulary_id' : table === TABLES.levels ? 'email' :
      table === TABLES.unlocks ? 'topic_id' : table === TABLES.completions ? 'topic_id' :
      table === TABLES.prefs ? 'user_id' : 'id';
    for(let index=0;index<300;index++) {
      const query=configure(live.from(table).select('*')).order(key).range(index*chunk,(index+1)*chunk-1);
      const {data,error}=await Promise.race([query, new Promise((_,reject)=>setTimeout(()=>reject(Error(`Timed out reading ${table}. Retry when connected.`)),25000))]);
      if(error) throw Error(`${table}: ${error.message}`);
      rows.push(...(data||[]));
      if((data||[]).length<chunk) break;
      if(index===299) throw Error('Too many rows; pack pagination limit reached.');
    }
    return rows;
  }

  async function fetchContent(lang) {
    if (!/^[a-z]{2,3}$/.test(lang)) throw Error('Unknown language code');
    // Only include the selected language and its alternative meaning language.
    const meaning = lang === 'mr' ? ['mr','fil'] : [lang];
    const [languages,topics,tt,vocabulary,vt,sentences,colours,settings,privateVis] = await Promise.all([
      readPaged(TABLES.languages,q=>q.eq('is_active',true)),
      readPaged(TABLES.topics),
      readPaged(TABLES.topicTranslations,q=>q.in('language_code',meaning)),
      readPaged(TABLES.vocabulary),
      readPaged(TABLES.vocabularyTranslations,q=>q.in('language_code',meaning)),
      readPaged(TABLES.sentences,q=>q.eq('language_code',lang)),
      readPaged(TABLES.colours,q=>q.eq('language_code',lang)),
      // Never package the raw private_lessons email allowlist.
      readPaged(TABLES.settings,q=>q.in('key',['unlock_rules','admin_bypass_lock'])),
      live.rpc('kg_chart_my_private_lesson_visibility',{p_language:lang}),
    ]);
    if(privateVis.error || privateVis.data?.contract!==1
        || !Array.isArray(privateVis.data.topics) || !Array.isArray(privateVis.data.groups)
        || !privateVis.data.topics.every(t=>typeof t==='string')
        || !privateVis.data.groups.every(g=>typeof g==='string')) {
      throw Error('Private lesson visibility could not be verified for this pack. Reconnect and retry; existing packs are preserved.');
    }
    if(!languages.some(l=>l.code===lang)) throw Error('This language is not currently published/active.');
    if(!tt.some(t=>t.language_code===lang) || !vt.some(v=>v.language_code===lang)) throw Error('Published topics or vocabulary translations are missing.');
    // The sanitized cache key is unique per language. Existing account-scoped
    // pack and service-worker identity remain untouched.
    const safeSettings=[...settings.filter(s=>s.key!=='private_lessons'),
      {key:'kg_private_visibility:'+lang,value:privateVis.data}];
    return { [TABLES.languages]:languages,[TABLES.topics]:topics,[TABLES.topicTranslations]:tt,
      [TABLES.vocabulary]:vocabulary,[TABLES.vocabularyTranslations]:vt,
      [TABLES.sentences]:sentences,[TABLES.colours]:colours,[TABLES.settings]:safeSettings };
  }

  // U3D2A: inspect only account-granted source rows, never download all
  // languages/topics and then try to hide unwanted media. This preview is
  // kept entirely in memory and NEVER switches an active pack pointer.
  async function assembleRestrictedCandidate(lang) {
    if(!U3D1_OFFLINE_ACCESS_ENABLED ||
       (!U3D2_SCOPED_PACK_PREVIEW_ENABLED && !U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED))
      throw Error('Restricted offline content preparation is disabled pending release review.');
    if(!currentEnrollment() || !navigator.onLine || !live)
      throw Error('Connect and verify the enrolled account before restricted preview.');
    const guard=accountGuard();
    const access=await refreshVerifiedAccess();guard();
    if(access.state!=='restricted_pending')
      throw Error('Only a verified restricted account can request the scoped preview.');
    const original=cachedAccessRecord;
    const policy=window.KGLearnerAccess.parseSnapshot(original.snapshot);
    if(policy.state!=='restricted' || !policy.languages.includes(lang))
      throw Error('Requested language is not assigned to this learner.');
    const topicIds=policy.topics.filter(x=>x.startsWith(lang+'|'))
      .map(x=>x.slice(lang.length+1));
    if(!topicIds.length)throw Error('No assigned translated topics for this language.');

    const pagedIds=async(table,field,ids,extra=q=>q)=>{
      const rows=[];
      const values=[...new Set(ids)];
      for(let i=0;i<values.length;i+=25){
        const batch=values.slice(i,i+25);
        rows.push(...await readPaged(table,q=>extra(q.in(field,batch))));
        guard();
      }
      return rows;
    };

    const wantsSentences=policy.features.includes('quiz.sentences')||
      policy.features.includes('quiz.speak');
    const [vis,groups]=await Promise.all([
      live.rpc('kg_chart_my_private_lesson_visibility',{p_language:lang}),
      wantsSentences ? live.rpc('kg_chart_u3c2_my_sentence_groups',{p_language:lang}) :
        Promise.resolve({data:null,error:null}),
    ]);guard();
    if(vis.error || (wantsSentences && groups.error))
      throw Error('Restricted private lesson or sentence mapping unavailable.');
    const sentenceScope=wantsSentences
      ? window.KGSentenceAccess.parseGroupSnapshot(groups.data,policy,lang) : null;
    if(wantsSentences && sentenceScope.state!=='restricted')
      throw Error('Restricted sentence group mappings are not server enforced.');

    const [languages,topics,topicTranslations,vocabulary]=await Promise.all([
      readPaged(TABLES.languages,q=>q.eq('code',lang).eq('is_active',true)),
      pagedIds(TABLES.topics,'id',topicIds),
      pagedIds(TABLES.topicTranslations,'topic_id',topicIds,q=>q.eq('language_code',lang)),
      pagedIds(TABLES.vocabulary,'topic_id',topicIds),
    ]);guard();
    const wordIds=vocabulary.map(w=>w.id);
    const [wordTranslations,sentences,colours]=await Promise.all([
      pagedIds(TABLES.vocabularyTranslations,'vocabulary_id',wordIds,
        q=>q.eq('language_code',lang)),
      wantsSentences ? pagedIds(TABLES.sentences,'group_name',sentenceScope.groups,
        q=>q.eq('language_code',lang)) : Promise.resolve([]),
      policy.features.includes('quiz.colours')
        ? readPaged(TABLES.colours,q=>q.eq('language_code',lang)) : Promise.resolve([]),
    ]);guard();
    const source={
      [TABLES.languages]:languages,
      [TABLES.topics]:topics,[TABLES.topicTranslations]:topicTranslations,
      [TABLES.vocabulary]:vocabulary,[TABLES.vocabularyTranslations]:wordTranslations,
      [TABLES.sentences]:sentences,[TABLES.colours]:colours,
      [TABLES.settings]:[],
    };
    const candidate=window.KGScopedPack?.buildScopedPack({
      data:source,language:lang,ownerId:owner,policyRecord:original,
      sentenceResponse:groups.data,privateVisibility:vis.data,
      checkedAt:Date.now(),
    });
    if(!candidate)throw Error('Restricted content validator is unavailable.');

    // Do not promote a candidate if the grant changed while reading pages.
    // A same-revision mutation also fails in U3D1's snapshot contract.
    const refreshed=await refreshVerifiedAccess();guard();
    if(refreshed.state!=='restricted_pending' ||
       cachedAccessRecord.snapshot.revision!==candidate.manifest.policyRevision ||
       JSON.stringify(cachedAccessRecord.snapshot)!==JSON.stringify(original.snapshot))
      throw Error('Access changed during preview; no pack was installed.');
    return {candidate,policyRecord:original,sentenceScope};
  }

  async function previewRestrictedPack(lang) {
    if(!U3D1_OFFLINE_ACCESS_ENABLED || !U3D2_SCOPED_PACK_PREVIEW_ENABLED)
      throw Error('Restricted offline preview is disabled pending release review.');
    const {candidate}=await assembleRestrictedCandidate(lang);
    return {
      ...candidate.manifest,
      previewOnly:true,downloadable:false,
      description:'Content preview only. Private media and restricted pack activation await U3D2B2/U3D3.',
    };
  }

  async function stageRestrictedPrivateMedia(lang) {
    if(!U3D1_OFFLINE_ACCESS_ENABLED || !U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED)
      throw Error('Private offline media staging is disabled pending release review.');
    if(!currentEnrollment() || !navigator.onLine || busy || syncing || quizBusy)
      throw Error('Verify the account online and finish the current quiz, download or sync first.');
    // Only a verified restricted snapshot can reach this path. The candidate
    // uses scoped RLS queries; the signer reauthorizes EACH source again.
    const guard=accountGuard();
    const {candidate,policyRecord,sentenceScope}=await assembleRestrictedCandidate(lang);
    guard();
    if(!candidate.mediaPlan.length)
      throw Error('No private media sources to stage. Existing packs are untouched.');
    const ownerAtStart=owner;
    const snapshot=JSON.stringify(policyRecord.snapshot);
    const assertCurrent=()=>{
      guard();
      if(owner!==ownerAtStart || !currentEnrollment() ||
         !navigator.onLine || !cachedAccessRecord ||
         JSON.stringify(cachedAccessRecord.snapshot)!==snapshot ||
         effectiveAccess().state!=='restricted_pending')
        throw Error('Account or permissions changed during private media staging.');
    };
    assertCurrent();
    const appOrigin=location.origin;
    const projectUrl=new URL(mediaBase()).origin;
    const module=await import(new URL('./js/kg-private-offline-media.mjs',document.baseURI).href);
    assertCurrent();
    const args={
      ownerId:ownerAtStart,language:lang,policyRecord,
      appOrigin,offlineAccess:window.KGOfflineAccess,
      learnerAccess:window.KGLearnerAccess,cacheStorage:caches,
    };
    let descriptor,activated=false;
    try{
      descriptor=await module.stagePrivateMedia({
        ...args,mediaPlan:candidate.mediaPlan,sentenceScope,
        supabase:live,projectUrl,assertCurrent,
      });
      assertCurrent();
      // A policy change during an in-progress signed download must never
      // promote the staged bytes; check caller identity/revision again.
      const latest=await refreshVerifiedAccess();guard();
      if(latest.state!=='restricted_pending' ||
         JSON.stringify(cachedAccessRecord.snapshot)!==snapshot)
        throw Error('Permissions changed; the staged private media cannot be activated.');
      const verified=await module.inspectPrivateMediaStage({...args,descriptor});
      assertCurrent();
      if(!U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED)
        return {...verified,stagedOnly:true,
          readyToInstall:false,cacheName:descriptor.cacheName};
      // A "media-only" pointer is NOT an active restricted content pack.
      const playback=await import(new URL('./js/kg-private-offline-playback.mjs',document.baseURI).href);
      const pointer=await playback.preparePrivateMediaActivation({
        ...args,descriptor,authorizedPlan:candidate.mediaPlan,
        sentenceScope,assertCurrent,
      });
      assertCurrent();
      // Reverify against live Auth/RLS before writing a pointer. A changed
      // revision invalidates this stage and leaves old offline data intact.
      const fresh=await refreshVerifiedAccess();guard();
      if(fresh.state!=='restricted_pending' ||
         JSON.stringify(cachedAccessRecord.snapshot)!==snapshot)
        throw Error('Permissions changed before private media activation.');
      const key=privateMediaKey(ownerAtStart,lang);
      const previousKey=previousPrivateMediaKey(ownerAtStart,lang);
      await transact(['kv'],tx=>{
        const kv=tx.objectStore('kv');
        const req=kv.get(key);
        req.onsuccess=()=>{
          try{assertCurrent();}
          catch(_){tx.abort();return;}
          if(req.result)kv.put(req.result,previousKey);
          kv.put(pointer,key);
        };
      });
      activated=true;
      return {...verified,stagedOnly:false,mediaOnly:true,
        readyToInstall:false,cacheName:descriptor.cacheName};
    }catch(error){
      if(descriptor && !activated)
        await module.discardPrivateMediaStage({...args,descriptor}).catch(()=>{});
      throw error;
    }
  }

  async function readRestrictedBundle(language) {
    if(!U3D1_OFFLINE_ACCESS_ENABLED || !U3D3B_RESTRICTED_PACKS_ENABLED ||
       !currentEnrollment() || effectiveAccess().state!=='restricted_pending')
      throw Error('Restricted lessons require verified access and a complete installed bundle.');
    const guard=accountGuard();
    const id=owner,record=cachedAccessRecord;
    if(!record||record.ownerId!==id)throw Error('Account policy missing.');
    const k=window.KGRestrictedPacks?.keys(id,language);
    if(!k)throw Error('Restricted bundle validator unavailable.');
    const active=await get(k.active);guard();
    if(!active)throw Error('No account-specific lesson pack installed.');
    const body=await get(k.payloadPrefix+active.packageId);guard();
    if(!body)throw Error('Restricted lesson content was evicted.');
    const content=await window.KGRestrictedPacks.verify({
      ownerId:id,language,policyRecord:record,pointer:active,body,
      cryptoApi:crypto,checkedAt:Date.now(),
    });guard();
    return {content,pointer:active};
  }

  async function installRestrictedBundle(language) {
    if(!U3D1_OFFLINE_ACCESS_ENABLED || !U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED ||
       !U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED ||
       !U3D3B_RESTRICTED_PACKS_ENABLED)
      throw Error('Restricted pack installation is disabled pending release acceptance.');
    if(!currentEnrollment()||!navigator.onLine||busy||syncing||quizBusy)
      throw Error('Connect and finish the current quiz, download or sync first.');
    const guard=accountGuard(),id=owner;
    busy=true;
    progress={phase:'Verifying restricted lessons and private media…',
      done:0,total:0,bytes:0,remaining:null,failures:0,missingImages:0};notify();
    const appOrigin=location.origin;
    let descriptor=null,committed=false,mediaModule=null;
    try{
      const {candidate,policyRecord,sentenceScope}=await assembleRestrictedCandidate(language);
      guard();
      if(!candidate.mediaPlan.length)
        throw Error('This language has no verified protected media inventory.');
      const snapshot=JSON.stringify(policyRecord.snapshot);
      const assertCurrent=()=>{
        guard();
        if(owner!==id||!currentEnrollment()||!navigator.onLine||
           !cachedAccessRecord||JSON.stringify(cachedAccessRecord.snapshot)!==snapshot||
           effectiveAccess().state!=='restricted_pending')
          throw Error('Account or permissions changed during restricted pack install.');
      };
      const args={ownerId:id,language,policyRecord,appOrigin,
        offlineAccess:window.KGOfflineAccess,
        learnerAccess:window.KGLearnerAccess,cacheStorage:caches,cryptoApi:crypto};
      mediaModule=await import(new URL('./js/kg-private-offline-media.mjs',document.baseURI).href);
      assertCurrent();
      descriptor=await mediaModule.stagePrivateMedia({
        ...args,mediaPlan:candidate.mediaPlan,sentenceScope,
        supabase:live,projectUrl:new URL(mediaBase()).origin,assertCurrent,
      });
      assertCurrent();
      const playback=await import(new URL('./js/kg-private-offline-playback.mjs',document.baseURI).href);
      const mediaPointer=await playback.preparePrivateMediaActivation({
        ...args,descriptor,authorizedPlan:candidate.mediaPlan,
        sentenceScope,assertCurrent,
      });
      assertCurrent();
      const bundle=await window.KGRestrictedPacks.prepare({
        ownerId:id,language,policyRecord,content:candidate.content,
        mediaPlan:candidate.mediaPlan,mediaPointer,sentenceScope,
        checkedAt:Date.now(),cryptoApi:crypto,packageId:crypto.randomUUID(),
      });
      assertCurrent();
      await window.KGRestrictedPacks.verify({
        ownerId:id,language,policyRecord,pointer:bundle.pointer,
        body:bundle.body,cryptoApi:crypto,checkedAt:Date.now(),
      });
      // A different session/revision might become current while streaming
      // media. Revalidate Auth and server policy immediately before install.
      const current=await refreshVerifiedAccess();guard();
      if(current.state!=='restricted_pending' ||
         JSON.stringify(cachedAccessRecord.snapshot)!==snapshot)
        throw Error('Permissions changed before restricted pack activation.');
      const k=window.KGRestrictedPacks.keys(id,language);
      const activeRecord=cachedAccessRecord;
      await transact(['kv'],tx=>{
        const kv=tx.objectStore('kv');
        const policyReq=kv.get(policyKey(id));
        const activeReq=kv.get(k.active);
        activeReq.onsuccess=()=>{
          try{assertCurrent();}
          catch(_){tx.abort();return;}
          const disk=policyReq.result;
          // Multi-tab change detection is inside the SAME read/write IDB
          // transaction as both pointers and the new content body.
          if(!disk||disk.ownerId!==id ||
             JSON.stringify(disk.snapshot)!==snapshot ||
             disk.snapshot.revision!==activeRecord.snapshot.revision){
            tx.abort();return;
          }
          const old=activeReq.result;
          if(old)kv.put(old,k.previous);
          kv.put(bundle.body,k.payloadPrefix+bundle.pointer.packageId);
          kv.put(bundle.pointer,k.active);
        };
      });
      committed=true;
      progress.phase='Restricted content and private media verified together. Sync activation and device checks are still pending.';
      notify();
      return {contract:1,installedForReview:true,readyForRestrictedStudy:false,
        language,topics:bundle.pointer.counts.topics,
        words:bundle.pointer.counts.words,revision:bundle.pointer.revision,
        mediaSources:bundle.pointer.sourceKeys.length};
    }catch(error){
      if(descriptor&&!committed&&mediaModule)
        await mediaModule.discardPrivateMediaStage({
          descriptor,ownerId:id,language,policyRecord:{
            ownerId:id,snapshot:{revision:descriptor.revision}},
          appOrigin,cacheStorage:caches,
        }).catch(()=>{});
      progress.phase='Restricted pack not installed: '+error.message+
        '. Previously installed packs and queued progress remain saved.';
      notify();throw error;
    }finally{busy=false;notify();}
  }

  async function restorePreviousRestrictedBundle(language) {
    if(!U3D1_OFFLINE_ACCESS_ENABLED || !U3D3B_RESTRICTED_PACKS_ENABLED ||
       !currentEnrollment()||effectiveAccess().state!=='restricted_pending')
      throw Error('Restricted pack rollback is disabled or not authorized.');
    const guard=accountGuard(),id=owner,record=cachedAccessRecord;
    const k=window.KGRestrictedPacks?.keys(id,language);
    if(!k)throw Error('Restricted bundle validator unavailable.');
    const prior=await get(k.previous);guard();
    if(!prior)throw Error('No compatible earlier restricted bundle.');
    const body=await get(k.payloadPrefix+prior.packageId);guard();
    await window.KGRestrictedPacks.verify({
      ownerId:id,language,policyRecord:record,
      pointer:prior,body,cryptoApi:crypto,checkedAt:Date.now(),
    });guard();
    // A rollback is not permission to revive media from a revoked grant.
    const media=await import(new URL('./js/kg-private-offline-media.mjs',document.baseURI).href);guard();
    await media.inspectPrivateMediaStage({
      descriptor:prior.mediaPointer.descriptor,ownerId:id,language,
      policyRecord:{...record,checkedAt:prior.mediaPointer.checkedAt},
      appOrigin:location.origin,offlineAccess:window.KGOfflineAccess,
      learnerAccess:window.KGLearnerAccess,cacheStorage:caches,
    });guard();
    const snapshot=JSON.stringify(record.snapshot);
    await transact(['kv'],tx=>{
      const kv=tx.objectStore('kv');
      const policyReq=kv.get(policyKey(id)),activeReq=kv.get(k.active);
      activeReq.onsuccess=()=>{
        if(owner!==id||!currentEnrollment()||
           JSON.stringify(cachedAccessRecord?.snapshot)!==snapshot ||
           JSON.stringify(policyReq.result?.snapshot)!==snapshot) {
          tx.abort();return;
        }
        if(activeReq.result)kv.put(activeReq.result,k.previous);
        kv.put(prior,k.active);
      };
    });guard();
    return {restored:true,language,mediaAndText:true,
      queuedChangesPreserved:true};
  }

  async function readPrivateMedia(resource) {
    // A reader on a device without network must never attempt the public
    // Storage hash path or retry a signed token. Null means "not available".
    if(!U3D1_OFFLINE_ACCESS_ENABLED || !U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED ||
       !currentEnrollment() || effectiveAccess().state!=='restricted_pending' ||
       !resource || typeof resource.language!=='string')
      return null;
    const guard=accountGuard();
    const id=owner,lang=resource.language;
    const pointer=U3D3B_RESTRICTED_PACKS_ENABLED ?
      (await readRestrictedBundle(lang)).pointer.mediaPointer :
      await get(privateMediaKey(id,lang));
    guard();
    if(!pointer)return null;
    const record=cachedAccessRecord;
    const playback=await import(new URL('./js/kg-private-offline-playback.mjs',document.baseURI).href);guard();
    let lease=null;
    try{
      lease=await playback.readPrivateOfflineMedia({
        pointer,resource,ownerId:id,language:lang,policyRecord:record,
        appOrigin:location.origin,offlineAccess:window.KGOfflineAccess,
        learnerAccess:window.KGLearnerAccess,
        cacheStorage:caches,cryptoApi:crypto,assertCurrent:guard,
      });
      guard();
      return lease;
    }catch(error){
      lease?.release();
      // Denial never makes a request to the public media CDN.
      throw error;
    }
  }

  async function restorePreviousPrivateMedia(lang) {
    if(!U3D1_OFFLINE_ACCESS_ENABLED || !U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED ||
       !currentEnrollment() || effectiveAccess().state!=='restricted_pending')
      throw Error('Restricted offline media rollback is not approved.');
    const guard=accountGuard();
    const id=owner,record=cachedAccessRecord;
    const candidate=await get(previousPrivateMediaKey(id,lang));guard();
    if(!candidate||candidate.ownerId!==id||candidate.language!==lang||
       candidate.revision!==record?.snapshot?.revision||
       candidate.grants!==JSON.stringify(record.snapshot))
      throw Error('No compatible same-account, same-grant private stage to restore.');
    const module=await import(new URL('./js/kg-private-offline-media.mjs',document.baseURI).href);guard();
    await module.inspectPrivateMediaStage({
      descriptor:candidate.descriptor,ownerId:id,language:lang,
      policyRecord:{...record,checkedAt:candidate.checkedAt},
      appOrigin:location.origin,offlineAccess:window.KGOfflineAccess,
      learnerAccess:window.KGLearnerAccess,cacheStorage:caches,
    });
    guard();
    await put(privateMediaKey(id,lang),candidate);guard();
    // No previous or new stage is deleted; reversible until U3D3 policy
    // reconciliation and explicit owner approval for cleanup.
    return {restored:true,language:lang,mediaOnly:true};
  }

  function requiredMedia(data,lang) {
    const root = mediaBase();
    const urlSet=new Set();
    const vocabulary=data[TABLES.vocabulary]||[];
    const translated=new Set((data[TABLES.vocabularyTranslations]||[]).filter(x=>x.language_code===lang).map(x=>x.vocabulary_id));
    for(const v of vocabulary.filter(v=>translated.has(v.id))) {
      if(!v.image_filename || v.extra_data?.colorCode || v.image_filename.startsWith('emoji:')) continue;
      const url=v.image_filename.startsWith('http') ? v.image_filename : `${root}${v.topic_id}/${v.image_filename}`;
      if(!url.startsWith(root)) throw Error('External picture needs a verified offline source: '+url);
      urlSet.add(url);
    }
    for(const c of data[TABLES.colours]||[]) {
      if(!c.picture || c.picture.startsWith('emoji:') || c.picture.startsWith('linear-gradient') || c.picture.startsWith('#')) continue;
      // Colour phrases use CSS/emoji in this revision; reject an unexpected remote URL rather than mark pack ready.
      if(c.picture.startsWith('https://')) {
        if(!c.picture.startsWith(root)) throw Error('External colour picture requires internet: '+c.picture);
        urlSet.add(c.picture);
      }
    }
    return [...urlSet].sort();
  }

  async function audioFiles(lang) {
    const base=`${mediaBase()}audio/${lang}`;
    // The active worker serves the cached manifest by its canonical URL for
    // offline playback. Bust that cache during a connected update check.
    const res=await fetch(base+'/clips.json?kg_rev='+Date.now(),{cache:'no-store'}).catch(()=>null);
    if(!res || !res.ok) {
      if(res?.status === 404) return {urls:[],json:null};
      throw Error(`Audio list unavailable for ${lang}. Try again, or publish a clips.json manifest.`);
    }
    const json=await res.json();
    if(!Array.isArray(json.m)||!Array.isArray(json.f)) throw Error('Malformed audio manifest.');
    const codes=[...new Set([...json.m.map(x=>'m/'+x),...json.f.map(x=>'f/'+x)])];
    if(codes.some(x=>!/^([mf])\/[a-f0-9]{8}$/.test(x))) throw Error('Unsafe audio clip name');
    return {urls:codes.map(x=>`${base}/${x}.mp3`),json,manifestUrl:base+'/clips.json'};
  }

  async function fileInfo(url) {
    try {
      const r=await fetch(url,{method:'HEAD',cache:'no-store'});
      if(!r.ok) throw Error(`HTTP ${r.status}`);
      return {url,bytes:Number(r.headers.get('content-length'))||null,
        // ETag or Last-Modified changes on replacement at the exact same URL.
        revision:r.headers.get('etag') || r.headers.get('last-modified') || null};
    } catch(e) {
      // Some browsers/CDNs cannot HEAD CORS files; GET + SHA256 is required in that case.
      return {url,bytes:null,revision:null};
    }
  }

  async function stagedResponse(url,info,cache,priorCaches,forceRefresh) {
    const found=await cache.match(url);
    const matchesRevision=r=>info.revision && r?.headers.get('X-KG-Revision')===info.revision;
    // A staged response was already downloaded/hashed by this attempt. Resume it even
    // when HEAD cannot supply a revision. However, refresh placeholder images so
    // that a newly restored picture can replace the temporary fallback.
    if(found && found.headers.get('X-KG-SHA256') &&
       !(forceRefresh && found.headers.get('X-KG-Missing-Image')==='1')) { await cache.put(url,found.clone()); return found; }
    {
      // Reuse unchanged revisions even during refresh. Missing-image placeholders
      // must be fetched again so restored published pictures can replace them.
      for(const name of priorCaches){
        const previous=await (await packCache(name)).match(url);
        if(matchesRevision(previous) && previous.headers.get('X-KG-Missing-Image')!=='1') { await cache.put(url,previous.clone()); return previous; }
      }
    }
    return null;
  }

  async function isConfirmedMissingPicture(response,url) {
    if (![400,404].includes(response.status) || !url.startsWith(mediaBase()) ||
        !/\.(png|jpg|jpeg|webp|gif|avif|svg)$/i.test(new URL(url).pathname)) return false;
    // Storage can report a missing public object as HTTP 400 with a JSON
    // "not_found" error. Do NOT treat arbitrary 400s, auth errors, or timeouts
    // as missing pictures: those failures must stop a pack download.
    let body;
    try { body=(await response.clone().text()).slice(0,2048); }
    catch (_) { return false; }
    let error;
    try { error=JSON.parse(body); } catch (_) { error=null; }
    if (!error || typeof error !== 'object')
      return response.status===404 && (!body.trim() || /^(not found|object not found)$/i.test(body.trim()));
    const code=String(error.statusCode||error.status||'');
    const kind=String(error.error||error.code||'').toLowerCase();
    const message=String(error.message||'').toLowerCase();
    return kind==='not_found' || kind==='nosuchkey' ||
      ((code==='404' || response.status===404) &&
       /(?:resource|object|file|key) (?:was |is )?not found|no such (?:key|object|file)/.test(message));
  }

  async function cacheAsset(url,info,cache,blob,{missingImage=false}={}) {
    const isAudio=/\.mp3$/i.test(new URL(url).pathname);
    const hash=await digest(await blob.arrayBuffer());
    const headers=new Headers({'Content-Type':blob.type|| (isAudio?'audio/mpeg':'application/octet-stream'),
      'X-KG-SHA256':hash,'X-KG-Revision':info.revision||'', 'X-KG-Bytes':String(blob.size)});
    if (missingImage) headers.set('X-KG-Missing-Image','1');
    const response=new Response(blob,{status:200,headers});
    await cache.put(url,response.clone());
    return {response,hash,bytes:blob.size,missingImage};
  }

  async function saveAsset(url,info,cache) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    try {
      // A cache-buster bypasses stale intermediaries, but the CacheStorage key remains canonical.
      const originUrl=new URL(url);
      originUrl.searchParams.set('kg_rev',String(Date.now()));
      const r=await fetch(originUrl,{cache:'no-store',signal:controller.signal});
      if(!r.ok) {
        if(await isConfirmedMissingPicture(r,url)) {
          const placeholder=new Blob([MISSING_IMAGE_SVG],{type:'image/svg+xml'});
          return cacheAsset(url,info,cache,placeholder,{missingImage:true});
        }
        throw Error(`Asset HTTP ${r.status}: ${url}`);
      }
      const blob=await r.blob();
      if(!blob.size) throw Error(`Empty asset: ${url}`);
      const isImage=/\.(png|jpg|jpeg|webp|gif|avif|svg)$/i.test(new URL(url).pathname);
      const isAudio=/\.mp3$/i.test(new URL(url).pathname);
      if(isImage) {
        if(!blob.type.startsWith('image/')) throw Error(`Invalid picture type: ${url}`);
        // Check decode before claiming readiness; SVG requires a browser image load instead.
        if(blob.type !== 'image/svg+xml' && typeof createImageBitmap==='function') {
          const bitmap=await createImageBitmap(blob);bitmap.close();
        }
      } else if(isAudio && blob.size<64) throw Error(`Audio too short: ${url}`);
      return cacheAsset(url,info,cache,blob);
    } finally {clearTimeout(timer);}
  }

  async function downloadPack(lang,{refresh=false}={}) {
    if(busy) return;
    if(!currentEnrollment()) throw Error('Sign in with an approved account online before downloading.');
    if(!navigator.onLine) throw Error('An internet connection is required to download or update packs.');
    if(U3D1_OFFLINE_ACCESS_ENABLED){
      await refreshVerifiedAccess();
      if(!legacyAccessReady()){
        if(U3D2_SCOPED_PACK_PREVIEW_ENABLED &&
           effectiveAccess().state==='restricted_pending')
          await previewRestrictedPack(lang); // read-only: returns NO media/pack
        throw Error('Restricted packs await U3D2B protected media and U3D3 sync review. Previous packs are preserved.');
      }
    }
    const guard=accountGuard();
    busy=true;pauseRequested=false;
    progress={phase:'Reading published lesson data…',done:0,total:0,bytes:0,remaining:null,failures:0,missingImages:0};notify();
    try {
      const data=await fetchContent(lang);guard();
      const audio=await audioFiles(lang);guard();
      const fileUrls=[...new Set([...requiredMedia(data,lang),...audio.urls])];
      const infos=[];
      for(let i=0;i<fileUrls.length;i+=12) infos.push(...await Promise.all(fileUrls.slice(i,i+12).map(fileInfo)));
      guard();
      // Content and media revisions form a deterministic, versioned manifest; replacement at
      // an unchanged URL invalidates it if the storage provider exposes ETag/Last-Modified.
      const contentHash=await digest(JSON.stringify(data));
      const candidateRevision=await digest(JSON.stringify({contentHash,files:infos.map(f=>[f.url,f.revision,f.bytes]),audio:audio.json}));
      const stageId=`${owner}:${lang}:${candidateRevision}`;
      const interrupted=await get('staging:'+stageId);guard();
      const stageCache=interrupted?.stageCache || `${PREFIX}${owner}-${lang}-${crypto.randomUUID()}`;
      const cache=await packCache(stageCache);guard();
      const oldPack=packs.get(lang);
      if(audio.json) {
        // KGAudio.loadManifest() uses this exact public URL during offline playback.
        const body=JSON.stringify(audio.json);
        await cache.put(audio.manifestUrl,new Response(body,{headers:{'Content-Type':'application/json','X-KG-SHA256':await digest(body)}}));
      }
      guard();await put('staging:'+stageId,{lang,candidateRevision,contentHash,stageCache,startedAt:now(),schemaVersion:SCHEMA_VERSION});
      await navigator.storage?.persist?.().catch(()=>false);
      const previous=activeCaches.filter(n=>n.startsWith(PREFIX+owner+'-'));
      const estimated=infos.reduce((sum,i)=>sum+(i.bytes||0),0);
      progress={phase:'Downloading lesson media…',done:0,total:infos.length,bytes:0,
        remaining:infos.every(i=>i.bytes!==null)?estimated:null,failures:0,missingImages:0};notify();
      const completed=[];
      let cursor=0;
      await Promise.all(Array.from({length:Math.min(3,infos.length)},async()=>{
        while(cursor<infos.length && !pauseRequested){
          guard();
          const info=infos[cursor++];
          try {
            let found=await stagedResponse(info.url,info,cache,previous,refresh);
            let bytes=0,hash='',missingImage=false;
            if(found){
              bytes=Number(found.headers.get('X-KG-Bytes'))||((await found.blob()).size);
              hash=found.headers.get('X-KG-SHA256')||'';
              missingImage=found.headers.get('X-KG-Missing-Image')==='1';
            } else ({bytes,hash,missingImage}=await saveAsset(info.url,info,cache));
            guard();if(!hash) throw Error('Missing cached content hash');
            completed.push({url:info.url,revision:info.revision,bytes,sha256:hash,missingImage});
            progress.bytes+=bytes;
            if(missingImage) progress.missingImages++;
            if(progress.remaining!==null) progress.remaining=Math.max(0,progress.remaining-bytes);
          } catch(e) {
            progress.failures++;
            progress.phase=e.name==='QuotaExceededError' ? 'Device storage is full. Existing packs are safe.' : `Could not download ${info.url.split('/').pop()}: ${e.message}`;
            pauseRequested=true;
          } finally {progress.done++;notify();}
        }
      }));
      if(pauseRequested || progress.failures) throw Error(progress.failures ? progress.phase : 'Paused. Download again to resume; completed files were kept.');
      // Re-read every required file from staging, verify its hash, then atomically switch the pointer.
      progress.phase='Verifying complete pack…';notify();
      for(const file of completed){
        const response=await cache.match(file.url);
        if(!response || await digest(await bounded(response.arrayBuffer(),'Reading saved bytes',3000))!==file.sha256) throw Error('Verification failed: '+file.url);
      }
      guard();
      // Content-addressed FINAL revision incorporates real media SHA256, even when an
      // intermediate cache cannot supply an ETag for a replaced image at the same URL.
      const manifestRevision=await digest(JSON.stringify({contentHash,audio:audio.json,
        files:completed.slice().sort((a,b)=>a.url.localeCompare(b.url)).map(a=>[a.url,a.sha256])}));
      guard();
      // Verify again immediately before switching the active pack pointer;
      // an administrator may have changed the grant during the download.
      if(U3D1_OFFLINE_ACCESS_ENABLED){
        await refreshVerifiedAccess();guard();
        if(!legacyAccessReady())throw Error('Permissions changed. The previously installed pack is retained.');
      }
      const packageId=`${owner}:${lang}:${manifestRevision}`;
      if(oldPack && oldPack.manifestRevision===manifestRevision && oldPack.storageLayout===2) {
        await transact(['kv'],tx=>tx.objectStore('kv').delete('staging:'+stageId));
        await caches.delete(stageCache);
        progress={...progress,phase:'Checked: your existing pack is already current.',remaining:0};notify();
        return oldPack;
      }
      const pack={lang,storageLayout:cache.sharedWrites?2:1,ownerId:owner,createdAt:now(),schemaVersion:SCHEMA_VERSION,appVersion,
        candidateRevision,manifestRevision,contentHash,cacheName:stageCache,assets:completed,data};
      await transact(['kv'],tx=>{
        const kv=tx.objectStore('kv');
        kv.put(pack,'pack:'+packageId);
        const old=packs.get(lang);
        if(old) kv.put(old,'previous-pack:'+owner+':'+lang);
        kv.put(packageId,'active:'+owner+':'+lang);
        const names=[stageCache,...activeCaches.filter(n=>n!==old?.cacheName && n!==stageCache)];
        if(old?.cacheName) names.push(old.cacheName); // previous version remains recoverable
        kv.put(names,'active-caches:'+owner);
        kv.delete('staging:'+stageId);
      });
      guard();packs.set(lang,pack);
      activeCaches=[stageCache,...activeCaches.filter(n=>n!==stageCache)];
      tellWorker();
      if(typeof CustomEvent==='function') window.dispatchEvent?.(new CustomEvent('kg-pack-ready',{detail:{lang}}));
      progress={...progress,phase:shellReady?'Ready offline · '+lang:'Pack saved · waiting for app shell installation',done:infos.length,total:infos.length,remaining:0};
      await pullRemote().catch(e=>{syncError='Content ready, but progress download failed: '+e.message;});
      notify();
      return pack;
    } catch(e){
      progress.phase=e.message || 'Pack download failed. Retry; completed downloads remain saved.';
      notify();throw e;
    } finally {busy=false;notify();if(navigator.onLine)setTimeout(()=>sync().catch(()=>{}),0);}
  }

  const fetchOwner = async () => {
    if(!live) throw Error('Not connected to Supabase');
    const {data,error}=await live.auth.getUser();
    if(error || !data?.user || data.user.id!==owner) throw Error('Session expired or another account is signed in. Sign in to synchronize.');
    const allowed=await live.rpc('kg_chart_is_allowed');
    if(allowed.error || allowed.data!==true) throw Error('Server access not approved. Unsynced changes remain on this device.');
    return data.user;
  };

  async function pullRemote() {
    if(!currentEnrollment() || !navigator.onLine) throw Error('Reconnect to pull account progress');
    const guard=accountGuard();
    if(U3D1_OFFLINE_ACCESS_ENABLED){
      await refreshVerifiedAccess();guard();
      if(!legacyAccessReady())throw Error('Restricted progress needs U3D3 reconciliation; queued changes are preserved.');
    }else{await fetchOwner();guard();}
    const email=enrollment.email.toLowerCase();
    const tables=[
      [TABLES.ratings, q=>q.eq('user_id',owner)],
      [TABLES.sessions, q=>q.eq('user_id',owner)],
      [TABLES.completions,q=>q.eq('user_id',owner)],
      [TABLES.levels,q=>q.eq('email',email)],
      [TABLES.prefs,q=>q.eq('user_id',owner)],
      [TABLES.unlocks,q=>q.eq('email',email)],
      [TABLES.resets,q=>q.in('language_code',[...packs.keys(),'*'])],
      [TABLES.pron,q=>q.eq('user_id',owner)],
    ];
    const incoming={};
    for(const [table,filter] of tables) incoming[table]=await readPaged(table,filter);
    const sessionIds=incoming[TABLES.sessions].map(s=>s.id);
    incoming[TABLES.answers]=[];
    for(let i=0;i<sessionIds.length;i+=80) {
      const set=sessionIds.slice(i,i+80);
      incoming[TABLES.answers].push(...await readPaged(TABLES.answers,q=>q.in('session_id',set)));
    }
    const pending=await outbox();guard();
    // Pull server changes, then replay ONLY this account's unsent edits in memory before
    // atomically replacing local views. Remote account changes are never discarded silently.
    let pullError=null;
    await transact(['kv'],tx=>{
      const kv=tx.objectStore('kv');
      for(const [table,cloudRows] of Object.entries(incoming)) {
        const saveRows=rows=>{
          guard();let next=rows;
          for(const event of pending.filter(e=>e.table===table))
            next=makeRows(table,event.kind,event.row,event.filters,next).next;
          kv.put(next,accountKey(table));
        };
        if(table===TABLES.sessions) {
          const req=kv.get(accountKey(table));
          req.onsuccess=()=>{
            try {
              const previous=new Map((req.result||[]).map(row=>[row.id,row]));
              saveRows(cloudRows.map(row=>{
                const saved=previous.get(row.id);
                // Current offline upload intentionally omits quiz_level for
                // older servers. Retain the proven local typing metadata for
                // an otherwise identical owned session, so a pending answer
                // retry is not stranded after a successful session pull.
                if(!Object.prototype.hasOwnProperty.call(row,'quiz_level') &&
                  saved?.quiz_level!=null && saved.user_id===owner && row.user_id===owner &&
                  Object.entries(saved).every(([key,value])=>key==='quiz_level' ||
                    sameDuplicateInsertField(table,key,row[key],value)))
                  return {...row,quiz_level:saved.quiz_level};
                return row;
              }));
            } catch(error) {pullError=error;tx.abort();}
          };
        } else saveRows(cloudRows);
      }
    }).catch(error=>{throw pullError||error;});
    lastSync=now();await put('last-sync:'+owner,lastSync);
    channel?.postMessage({type:'changed',owner});notify();
  }

  // PostgreSQL can return the same timestamptz with an offset (+00:00)
  // while JavaScript Date.toISOString() uses Z. Verifying raw strings would
  // reject an already-saved row and strand every event behind it in the outbox.
  // Accept the *same instant* only; retain genuinely different saved values.
  function sameTimestamp(a,b) {
    if(a==null || b==null) return a==null && b==null;
    const left=Date.parse(a),right=Date.parse(b);
    return Number.isFinite(left) && Number.isFinite(right)
      ? left===right : String(a)===String(b);
  }
  function timestampAtLeast(a,b) {
    const left=Date.parse(a),right=Date.parse(b);
    return Number.isFinite(left) && Number.isFinite(right) && left>=right;
  }
  function sameAcknowledgedField(key,saved,queued) {
    return ['last_reviewed_at','completed_at'].includes(key)
      ? sameTimestamp(saved,queued) : String(saved)===String(queued);
  }
  function sameDuplicateInsertField(table,key,saved,queued) {
    // A retried quiz insert may already be saved. PostgreSQL serializes
    // timestamptz with +00:00 while the queued JavaScript value uses Z.
    // Only these known timestamp columns may compare as instants; IDs,
    // quiz results and all other fields keep their original strict check.
    const timestamp=table===TABLES.sessions && ['created_at','completed_at'].includes(key) ||
      table===TABLES.answers && ['created_at','answered_at'].includes(key);
    return timestamp ? sameTimestamp(saved,queued) :
      JSON.stringify(saved ?? null)===JSON.stringify(queued ?? null);
  }

  async function syncEvent(event) {
    if(event.ownerId!==owner) throw Error('Outbox account isolation error');
    const guard=accountGuard();
    const table=event.table;
    const row={...event.row};
    if(table===TABLES.sessions) delete row.quiz_level; // not present in current deployed schema
    if([TABLES.ratings,TABLES.levels,TABLES.completions,TABLES.prefs].includes(table)) {
      const keys=PRIMARY[table];
      let check=live.from(table).select('*');
      for(const key of keys) check=check.eq(key,row[key]);
      const {data:remote,error}=await check.maybeSingle();guard();
      if(error) throw Error(error.message);
      if(table===TABLES.levels) {
        // Earlier app builds queued a selected difficulty without the unlocked
        // field. PostgreSQL defaults the missing unlocked value to 1 on upsert,
        // violating level <= unlocked when the learner is studying level 2+.
        // Merge the server's existing unlock with the queued choice. This fixes
        // already-pending events without editing or discarding the local outbox.
        const selectedLevel=Number(row.level);
        const queuedUnlocked=row.unlocked==null?1:Number(row.unlocked);
        const serverUnlocked=remote?.unlocked==null?1:Number(remote.unlocked);
        if(![selectedLevel,queuedUnlocked,serverUnlocked].every(
          n=>Number.isInteger(n)&&n>=1&&n<=4))
          throw Error('Invalid saved difficulty level. Export recovery before troubleshooting.');
        row.unlocked=Math.max(selectedLevel,queuedUnlocked,serverUnlocked);
      }
      if(table===TABLES.ratings) {
        const remoteStamp=remote?.updated_at||remote?.last_reviewed_at||null;
        const baseStamp=event.baseUpdatedAt||null;
        if(remote && event.kind==='upsert' && remote.rating===row.rating && sameTimestamp(remote.last_reviewed_at,row.last_reviewed_at)) return;
        if(event.kind==='delete' && !remote) return;
        // Concurrent remote deletion/update must be resolved, never overwritten blindly.
        if(!sameTimestamp(remoteStamp,baseStamp) && !sameTimestamp(remoteStamp,row.updated_at)) {
          const conflict = Error(`Rating conflict on ${row.vocabulary_id}. Server and device changed the same word; export unsynced work before resolving.`);
          conflict.code = 'KG_RATING_CONFLICT';
          throw conflict;
        }
      }
      if(table===TABLES.prefs && remote) {
        // Preserve best typing scores from BOTH devices, choose larger CPM per key.
        const merged={...(remote.typing_best||{})};
        for(const [k,value] of Object.entries(row.typing_best||{})) {
          if(!merged[k] || (value.cpm||0)>(merged[k].cpm||0)) merged[k]=value;
        }
        row.typing_best=merged;
        // Audio choices are last-write-wins by the existing row timestamp;
        // a delayed retry cannot turn back a newer change from another device.
        if(remote.updated_at && row.updated_at && remote.updated_at>row.updated_at){
          row.audio_voice=remote.audio_voice;
          row.audio_muted=remote.audio_muted;
          row.updated_at=remote.updated_at;
        }
      }
      if(table===TABLES.completions && remote && timestampAtLeast(remote.completed_at,row.completed_at)) return;
    }
    guard();
    let result;
    if(event.kind==='delete') {
      let q=live.from(table).delete();
      for(const [op,k,v] of event.filters) if(op==='eq') q=q.eq(k,v);
      result=await q;
    } else if(event.kind==='insert') {
      result=await live.from(table).insert(row);
      if(result.error && result.error.code==='23505' && row.id) {
        // An upload may have reached the server before the connection died. Confirm the
        // exact immutable row, then acknowledge the retry without duplicating history.
        const check=await live.from(table).select('*').eq('id',row.id).maybeSingle();guard();
        if(!check.error && check.data) {
          const mismatch=Object.entries(row).find(([key,value]) =>
            !sameDuplicateInsertField(table,key,check.data[key],value));
          if(!mismatch) return; // Exact saved row: safe to acknowledge the retry.
          throw Error(`Existing server row differs from queued insert in ${table}.${mismatch[0]}. Nothing was silently discarded.`);
        }
      }
    } else if(event.kind==='upsert') {
      result=await live.from(table).upsert(row,{onConflict:(PRIMARY[table]||['id']).join(',')});
    } else {
      let q=live.from(table).update(row);
      for(const [op,k,v] of event.filters) if(op==='eq') q=q.eq(k,v);
      result=await q;
    }
    guard();
    if(result.error) throw Error(`${table}: ${result.error.message}`);
    // 204/empty responses alone do not prove a user row changed (RLS may affect 0 rows).
    if(PRIMARY[table]?.length) {
      let q=live.from(table).select('*');
      for(const key of PRIMARY[table]) q=q.eq(key,row[key]);
      const {data:ack,error}=await q.maybeSingle();guard();
      if(error) throw Error('Could not confirm server acknowledgment: '+error.message);
      if(event.kind==='delete') {
        if(ack) throw Error('Delete not acknowledged by server; local tombstone stays queued.');
      } else {
        if(!ack) throw Error('Server did not confirm the saved row.');
        const checkFields=table===TABLES.ratings?['rating','last_reviewed_at']:
          table===TABLES.prefs?['audio_voice','audio_muted']:
          table===TABLES.completions?['completed_at']:
          table===TABLES.levels?['level']:[];
        const mismatch=checkFields.find(k=>row[k]!==undefined && !sameAcknowledgedField(k,ack[k],row[k]));
        if(mismatch)
          throw Error(`Server row differs from queued update in ${table}.${mismatch}${row.vocabulary_id?' ('+row.vocabulary_id+')':''}. Nothing was silently discarded.`);
      }
    }
  }

  async function syncRestrictedQueue() {
    if(!U3D1_OFFLINE_ACCESS_ENABLED || !U3D3A_OUTBOX_HOLD_ENABLED ||
       !U3D3B_RESTRICTED_PACKS_ENABLED ||
       !U3D3C_RESTRICTED_SYNC_ENABLED ||
       !currentEnrollment()||!navigator.onLine||
       effectiveAccess().state!=='restricted_pending')
      throw Error('Restricted offline sync is not approved on this installation.');
    const guard=accountGuard(),id=owner,starting=cachedAccessRecord;
    if(!starting?.snapshot||starting.ownerId!==id)
      throw Error('Verified learner grant missing. Original queued work is retained.');
    const snapshot=JSON.stringify(starting.snapshot);
    const check=()=>{
      guard();
      if(owner!==id||!currentEnrollment()||!navigator.onLine||
         !cachedAccessRecord||effectiveAccess().state!=='restricted_pending'||
         JSON.stringify(cachedAccessRecord.snapshot)!==snapshot)
        throw Error('Permission changed during synchronization. Queue is retained.');
    };
    check();
    const queued=await outbox();check();
    const verifier=window.KGRestrictedSync;
    if(!verifier?.reconcile)
      throw Error('Permission-aware sync verification unavailable. Queued work was not deleted.');
    const refresh=async()=>{
      await refreshVerifiedAccess();check();
      return cachedAccessRecord;
    };
    const ack=async(event,checked)=>{
      check();
      // ACK is a conditional owner-bound compare/delete in ONE transaction.
      // Re-read both the persisted policy and outbox record to close races
      // with a second tab, sign-out, retry or a revised permission snapshot.
      await transact(['kv','outbox'],tx=>{
        const kv=tx.objectStore('kv'),queue=tx.objectStore('outbox');
        const policyReq=kv.get(policyKey(id));
        policyReq.onsuccess=()=>{
          const eventReq=queue.get(event.id);
          eventReq.onsuccess=()=>{
            try {
              check();
              const disk=policyReq.result,existing=eventReq.result;
              if(!disk||disk.ownerId!==id||
                 JSON.stringify(disk.snapshot)!==snapshot||
                 disk.checkedAt!==checked.checkedAt||
                 !existing||existing.ownerId!==id||
                 existing.id!==event.id||
                 JSON.stringify(existing)!==JSON.stringify(event))
                throw Error('Outbox or permissions changed before acknowledgment.');
              queue.delete(event.id);
            }catch(_){tx.abort();}
          };
        };
      });
      check();
    };
    const report=await verifier.reconcile({
      events:queued,ownerId:id,policyRecord:starting,
      client:live,refresh,apply:async event=>{
        check();await syncEvent(event);check();
      },ack,assertCurrent:check,
      offlineAccess:window.KGOfflineAccess,
      learnerAccess:window.KGLearnerAccess,
      sentenceAccess:window.KGSentenceAccess,
    });
    check();
    if(!report||report.publishable!==false||
       report.acknowledged<0||report.acknowledged>queued.length)
      throw Error('Restricted reconciliation result is invalid. Original queue retained.');
    // Aggregate-only UX: no private row, email, source ID or answer in status.
    heldOutboxReview={...report};
    const remaining=queued.length-report.acknowledged;
    syncError=remaining
      ? report.acknowledged+' authorized change(s) confirmed. '+
        remaining+' retained for permission review or retry. Export recovery before resolving.'
      : report.acknowledged+' authorized change(s) confirmed. All restricted queue entries reviewed.';
    notify();
    return report;
  }

  async function doSync() {
    if(syncing || busy || !currentEnrollment() || !navigator.onLine) return;
    const guard=accountGuard();
    const conflictedRatingKeys=new Map(); // Preserve one word's queued rating order.
    let deferredRatings=0;
    const conflictMessage=()=>deferredRatings
      ? `Rating conflict retained for ${conflictedRatingKeys.size} word(s) (${deferredRatings} pending rating change(s)). Export recovery before resolving.`
      : '';
    syncing=true;syncError='';notify();
    try {
      if(U3D1_OFFLINE_ACCESS_ENABLED){
        await refreshVerifiedAccess();guard();
        if(!legacyAccessReady()){
          if(U3D3C_RESTRICTED_SYNC_ENABLED){
            // Leave the old legacy loop and level-up/pull RPC completely
            // unreachable for restricted accounts. Every candidate is
            // independently reauthorized against live SQL and RLS.
            await syncRestrictedQueue();guard();return;
          }
          if(U3D3A_OUTBOX_HOLD_ENABLED){
            const review=await auditRestrictedQueue();guard();
            // No syncEvent, outbox delete, level-up RPC or remote pull after this return.
            syncError='Permission review: '+review.held+
              ' pending change(s) retained locally. No restricted changes uploaded.';
            return;
          }
          throw Error('Restricted queued changes await U3D3; nothing was discarded.');
        }
      }else{await fetchOwner();guard();}
      for(const event of await outbox()) {
        guard();
        const ratingKey=event.table===TABLES.ratings
          ? rowKey(event.row,PRIMARY[TABLES.ratings]) : null;
        // If an earlier rating for this word conflicted, later changes for the
        // same word must stay in order. Do not silently overwrite either version.
        if(ratingKey && conflictedRatingKeys.has(ratingKey)) {
          deferredRatings++;
          continue;
        }
        try { await syncEvent(event);guard(); }
        catch(e) {
          // A rating conflict must not block unrelated quiz sessions/answers.
          // Only the conflicting rating events remain in the local outbox.
          if(event.table!==TABLES.ratings || e?.code!=='KG_RATING_CONFLICT') throw e;
          conflictedRatingKeys.set(ratingKey,event.row.vocabulary_id);
          deferredRatings++;
          continue;
        }
        await transact(['outbox'],tx=>tx.objectStore('outbox').delete(event.id));
        pendingCount--;notify();
      }
      // Quiz history unlocks levels through a server RPC, not only a local
      // provisional check. Persistent markers survive a failed RPC AFTER the
      // history itself has been acknowledged, as well as interrupted restarts.
      const checkKey='level-checks:'+owner;
      const levelChecks=await get(checkKey)||{};
      for(const [lang,sequence] of Object.entries(levelChecks)){
        // New sessions are not eligible until their required answers are
        // durable locally AND uploaded. Historical sessions without a marker
        // retain their established behavior; no old row is rewritten here.
        const answerChecks=await get(quizChecksKey(owner))||{};guard();
        if(Object.values(answerChecks).some(check=>check.language_code===lang)) continue;
        const sessionIds=new Set((await selectRows(TABLES.sessions))
          .filter(row=>row.language_code===lang).map(row=>row.id));guard();
        if((await outbox()).some(e=>e.table===TABLES.sessions && e.row.language_code===lang ||
          e.table===TABLES.answers && sessionIds.has(e.row.session_id))) continue;
        guard();const result=await live.rpc('kg_chart_check_level_up',{p_lang:lang});guard();
        if(result.error) throw Error('Server level check for '+lang+': '+result.error.message);
        await transact(['kv'],tx=>{
          const kv=tx.objectStore('kv'),req=kv.get(checkKey);
          req.onsuccess=()=>{
            const fresh=req.result||{};
            if(fresh[lang]===sequence){delete fresh[lang];kv.put(fresh,checkKey);}
          };
        });
      }
      guard();await pullRemote();guard(); // Replays unresolved local ratings over fresh server data.
      if(deferredRatings) syncError=conflictMessage()+' Other study changes synchronized.';
    } catch(e) {
      syncError=(deferredRatings?conflictMessage()+' Other sync error: ':'')+(e.message||String(e));
    } finally {syncing=false;await updatePending();}
  }
  async function sync() {
    // Web Locks serialize multiple tabs; UUID PKs and unique rating keys also protect retries.
    if(navigator.locks?.request) return navigator.locks.request('kg-chart-offline-sync',doSync);
    return doSync();
  }

  function localRPC(name,args={}) {
    if(!currentEnrollment()) return null;
    if(name==='kg_chart_is_allowed') return {data:true,error:null};
    if(name==='kg_chart_is_admin') return {data:!!enrollment.admin,error:null};
    if(U3D1_OFFLINE_ACCESS_ENABLED && name==='kg_chart_u3_my_access_snapshot' && !navigator.onLine){
      const checked=effectiveAccess();
      return checked.state==='legacy'
        ? {data:cachedAccessRecord.snapshot,error:null}
        : {data:null,error:accessDenied()};
    }
    if(name==='kg_chart_my_private_lesson_visibility') {
      // The live endpoint is authoritative whenever a connection exists;
      // offline only, resolve the per-owner sanitized pack snapshot.
      if(navigator.onLine) return null;
      return (async()=>{
        const lang=String(args.p_language||'');
        if(!/^[a-z]{2,3}$/.test(lang)) return {
          data:null,error:Error('Invalid requested private-lesson language')
        };
        const settings=await selectRows(TABLES.settings);
        const safe=settings.find(x=>x.key==='kg_private_visibility:'+lang)?.value;
        const isSafe=x=>x?.contract===1&&Array.isArray(x.topics)
          &&Array.isArray(x.groups)&&x.topics.every(t=>typeof t==='string')
          &&x.groups.every(g=>typeof g==='string');
        if(isSafe(safe))return {data:safe,error:null};
        // Older installed packs already contain the legacy global setting.
        // Calculate only this enrolled account's own hidden IDs locally.
        // Never return/expose the original list of other learners' emails.
        const old=settings.find(x=>x.key==='private_lessons')?.value;
        if(!Array.isArray(old))return {
          data:null,error:Error('Private lesson visibility is not saved in this pack. Reconnect and update the language pack.')
        };
        const email=String(enrollment.email||'').toLowerCase();
        const denied=old.filter(rule=>(!rule?.language_code||rule.language_code===lang)
          &&!(rule.emails||[]).some(x=>String(x).toLowerCase()===email));
        if(denied.some(x=>!x||typeof x!=='object'
          ||(x.sentence_groups!=null&&!Array.isArray(x.sentence_groups))))return {
          data:null,error:Error('Saved private lesson metadata cannot be verified')
        };
        return {data:{contract:1,
          topics:[...new Set(denied.map(x=>x.topic_id).filter(x=>typeof x==='string'&&x))],
          groups:[...new Set(denied.flatMap(x=>x.sentence_groups||[]).filter(x=>typeof x==='string'&&x))]
        },error:null};
      })();
    }
    if(name==='kg_chart_my_answers') return (async()=>{
      const sessions=await selectRows(TABLES.sessions);
      const byId=new Map(sessions.filter(s=>s.user_id===owner && s.language_code===args.p_lang).map(s=>[s.id,s]));
      const answers=await selectRows(TABLES.answers);
      return {data:answers.filter(a=>a.vocabulary_id && byId.has(a.session_id)).map(a=>({
        vocabulary_id:String(a.vocabulary_id),quiz_type:byId.get(a.session_id).quiz_type,is_correct:a.is_correct,
        answered_at:a.answered_at||byId.get(a.session_id).completed_at||byId.get(a.session_id).created_at||now(),
      })),error:null};
    })();
    if(name==='kg_chart_check_level_up') return (async()=>{
      const guard=accountGuard();
      const s=(await selectRows(TABLES.sessions)).filter(s=>s.user_id===owner && s.language_code===args.p_lang &&
        ['native_to_image','image_to_native','devanagari_to_image','english_to_native','listen_to_image','listen_to_native'].includes(s.quiz_type));
      const answerChecks=await get(quizChecksKey(owner))||{};guard();
      if(Object.values(answerChecks).some(check=>check.language_code===args.p_lang))
        return {data:null,error:problem('Quiz answers are not fully saved yet. Retry the pending quiz before checking levels.','KG_QUIZ_ANSWERS_PENDING')};
      const levels=await selectRows(TABLES.levels),level=levels.find(l=>l.email===enrollment.email && l.language_code===args.p_lang)?.unlocked||1;
      const configured=(await selectRows(TABLES.settings)).find(s=>s.key==='unlock_rules')?.value||{};
      const limits=configured.languages?.[args.p_lang]?.level_up||configured.level_up||{answers:40,pct:85};
      let total=0,correct=0;
      for(const x of s.filter(x=>(x.difficulty||1)===level).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))){
        total+=x.total_questions||0;correct+=x.correct_answers||0;if(total>=(limits.answers||40))break;
      }
      const unlocked=Math.min(4,level<4 && total>=(limits.answers||40) && correct*100>=(limits.pct||85)*total ? level+1 : level);
      guard();
      if(unlocked>level){
        const i=levels.findIndex(l=>l.email===enrollment.email && l.language_code===args.p_lang);
        if(i>=0) levels[i]={...levels[i],unlocked};
        else levels.push({email:enrollment.email,language_code:args.p_lang,level,unlocked});
        await setRows(TABLES.levels,levels);
      }
      return {data:unlocked,error:null};
    })();
    return null;
  }

  function wrapClient(client) {
    if(live) return window.KGOffline.client;
    mediaRoot=publicMediaRoot(client);
    live=client;
    const proxyAuth=new Proxy(client.auth,{
      get(target,key){
        if(key==='getSession') return async()=>{
          const callback=new URL(location.href).searchParams.has('code')||location.hash.includes('access_token');
          if(!callback && currentEnrollment()) return {data:{session:{user:{id:owner,email:enrollment.email}}},error:null};
          return client.auth.getSession();
        };
        if(key==='signOut') return async (...args)=>{
          await lockAccount();
          return client.auth.signOut(...args);
        };
        if(key==='onAuthStateChange') return callback => client.auth.onAuthStateChange((event,session)=>{
          // During a disconnected cold start the SDK may emit INITIAL_SESSION(null)
          // or SIGNED_OUT(null) after getSession restored a verified local enrollment.
          // That missing remote session must not replace the saved learner with the
          // Welcome Back screen. Explicit sign-out calls lockAccount() first, so
          // it still passes through; a different signed-in user is handled below.
          if(!navigator.onLine && currentEnrollment() && !session?.user?.id) return;
          // A different Google/email account must NEVER see the previous owner's local view.
          if(session?.user?.id && currentEnrollment() && session.user.id!==owner) {
            lockAccount().then(()=>callback(event,session));
            return;
          }
          callback(event,session);
        });
        return typeof target[key]==='function' ? target[key].bind(target) : target[key];
      }
    });
    const facade={
      auth:proxyAuth,
      from:table=>new Query(table,client.from(table)),
      rpc:(name,args)=>localRPC(name,args)||client.rpc(name,args),
      functions:{invoke:(name,args)=>navigator.onLine?client.functions.invoke(name,args):Promise.resolve({data:null,error:offlineError('Speech assessment')})},
      storage:client.storage,
    };
    window.KGOffline.client=facade;
    tellWorker();
    if(currentEnrollment()) sync().catch(()=>{});
    return facade;
  }

  async function afterVerified(user, isCurrent = () => true) {
    // The generated AuthProvider owns the approval generation. Do not
    // activate an offline enrollment after a newer login or sign-out.
    const check = () => { if (!isCurrent()) throw Error('Account changed during verification. Saved work is retained.'); };
    check();
    if(currentEnrollment() && owner===user.id) return;
    if(!navigator.onLine || !live) throw Error('Initial offline setup requires an online verified sign-in.');
    const verified=await live.auth.getUser();
    check();
    if(verified.error || verified.data?.user?.id!==user.id) throw Error('Could not confirm this signed-in account online.');
    const allowed=await live.rpc('kg_chart_is_allowed');
    check();
    if(allowed.error || allowed.data!==true) throw Error('This account is not approved for KG Chart.');
    const adm=await live.rpc('kg_chart_is_admin');
    check();
    accountEpoch++;
    devicePlatform='';deviceChecks=Object.create(null);
    deviceOfflineEvidence=null;deviceEvidenceWasOffline=false;deviceCheckMessage='';
    enrollment={id:user.id,email:user.email.toLowerCase(),admin:adm.data===true,unlocked:true,verifiedAt:now()};
    owner=user.id;
    await transact(['kv'],tx=>{
      tx.objectStore('kv').put(enrollment,'enroll:'+owner);
      tx.objectStore('kv').put(owner,'active-owner');
    });
    await loadPacks();
    check();
    if(U3D1_OFFLINE_ACCESS_ENABLED){
      await restoreOfflineAccess();
      // Failure blocks local study; it never uninstalls a pack or signs out.
      await refreshVerifiedAccess().catch(()=>{});
    }
    tellWorker();
    await updatePending();
    listLanguages().catch(()=>{});
    notify();
  }

  async function lockAccount() {
    // Sign-out never deletes outbox or existing content. It just revokes local presentation.
    accountEpoch++;readinessReport=null;heldOutboxReview=null;
    devicePlatform='';deviceChecks=Object.create(null);
    deviceOfflineEvidence=null;deviceEvidenceWasOffline=false;deviceCheckMessage='';
    cachedAccessRecord=null;accessView={state:'blocked',reason:'signed_out',revision:null};
    const prev=owner;
    if(typeof Event==='function') window.dispatchEvent?.(new Event('kg-account-locked'));
    if(enrollment){enrollment={...enrollment,unlocked:false};await put('enroll:'+owner,enrollment);}
    owner=null;packs=new Map();activeCaches=[];pendingCount=0;lastSync=null;
    await put('active-owner',null);
    navigator.serviceWorker?.controller?.postMessage({type:'KG_OFFLINE_LOCK'});
    channel?.postMessage({type:'lock',owner:prev});
    notify();
  }

  async function loadPacks() {
    packs=new Map();activeCaches=[];
    if(!currentEnrollment()) return;
    const id=owner, epoch=accountEpoch, loaded=new Map();
    for(const lang of ['my','zh','si','te','ta','ko','th','ms','mr','kn','ja','fil']) {
      const key=await get('active:'+id+':'+lang);
      const pack=key && await get('pack:'+key);
      if(pack && pack.ownerId===id && pack.schemaVersion<=SCHEMA_VERSION) loaded.set(lang,pack);
    }
    const caches=(await get('active-caches:'+id))||[];
    const synced=(await get('last-sync:'+id))||null;
    if(owner!==id || accountEpoch!==epoch || !currentEnrollment()) return;
    packs=loaded;activeCaches=caches;lastSync=synced;
  }

  async function readMedia(url) {
    // Same account boundaries as the worker; never inspect staging/other owners.
    if(!currentEnrollment() || !legacyAccessReady() || !mediaRoot || !url.startsWith(mediaRoot)) return null;
    const expectedOwner=owner;
    try {
      for(const name of activeCaches.filter(n=>n.startsWith(PREFIX+expectedOwner+'-'))) {
        const response=await bounded(packCache(name).then(cache=>cache.match(url)), 'Reading saved audio', 1500);
        if(owner!==expectedOwner || !currentEnrollment()) return null;
        if(response) return response;
      }
    } catch (_) { /* The player may retry the published URL online. */ }
    return null;
  }

  async function verifyOffline() {
    if(checkingReadiness || busy || syncing || quizBusy) throw Error('Finish the quiz, download or sync before checking saved files.');
    if(!currentEnrollment()) throw Error('Sign in before checking this account’s saved packs.');
    const guard=accountGuard();checkingReadiness=true;readinessReport=null;notify();
    const report={format:'kg-offline-readiness',version:1,checkedAt:now(),origin:new URL(location.href).origin,
      edition:unified?'unified':'separate-offline',appVersion,shell:{ok:false},packs:[],pendingChanges:0,ready:false};
    try {
      try {
        const worker=navigator.serviceWorker?.controller;
        if(!worker) throw Error('No controlling service worker. Reopen after installation.');
        report.shell=await new Promise((resolve,reject)=>{
          const channel=new MessageChannel();
          const timer=setTimeout(()=>{channel.port1.close();reject(Error('App-file verification timed out.'));},30000);
          channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};
          worker.postMessage({type:'KG_OFFLINE_AUDIT_SHELL'},[channel.port2]);
        });
      } catch(e) {report.shell={ok:false,error:e.message};}
      guard();
      for(const [lang,pack] of [...packs]) {
        const row={language:lang,files:pack.assets?.length||0,audioFiles:0,missingPictures:0,failures:[],ok:false};
        try {
          const cache=await packCache(pack.cacheName);
          if(!pack.assets?.length)row.failures.push('Pack has no saved files');
          for(const file of pack.assets||[]) {
            guard();const response=await bounded(cache.match(file.url),'Reading saved file',3000);
            if(!response || await digest(await bounded(response.arrayBuffer(),'Reading saved bytes',3000))!==file.sha256)row.failures.push(new URL(file.url).pathname.split('/').pop());
            if(/\.mp3$/i.test(new URL(file.url).pathname)) row.audioFiles++;
            if(file.missingImage) row.missingPictures++;
          }
          if(row.audioFiles) {
            const catalog=await bounded(cache.match(mediaBase()+'audio/'+lang+'/clips.json'),'Reading saved catalog',3000);
            if(!catalog) row.failures.push('clips.json');
            else {
              const bytes=await catalog.clone().arrayBuffer();
              if(await digest(bytes)!==catalog.headers.get('X-KG-SHA256'))row.failures.push('clips.json integrity');
              const json=await catalog.json();if(!Array.isArray(json.m)||!Array.isArray(json.f))row.failures.push('clips.json format');
            }
          }
          if(packs.get(lang)!==pack)row.failures.push('Pack changed during check; retry');
          row.ok=row.failures.length===0;
        } catch(e){row.failures.push(e.message);}
        report.packs.push(row);
      }
      guard();report.pendingChanges=(await outbox()).length;guard();
      report.ready=legacyAccessReady() && report.shell?.ok===true && report.packs.length>0 && report.packs.every(p=>p.ok);
      readinessReport=report;return report;
    } finally {checkingReadiness=false;notify();}
  }
  function exportReadiness() {
    if(!readinessReport)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(readinessReport,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='kg-offline-readiness.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }

  function deviceAcceptanceReport() {
    const contract=window.KGDeviceAcceptance;
    if(!contract?.createReport)throw Error('U4 device acceptance report is unavailable.');
    return contract.createReport({
      platform:devicePlatform,observations:deviceChecks,
      readiness:deviceOfflineEvidence,wasOffline:deviceEvidenceWasOffline,
      currentPending:currentEnrollment()?pendingCount:null,
      edition:unified?'unified':'separate-offline',
    });
  }
  async function verifyDeviceOffline() {
    // Require actual disconnected state. The existing full file-hash
    // readiness audit is reused, never a special-case fake PASS.
    if(navigator.onLine) {
      deviceOfflineEvidence=null;deviceEvidenceWasOffline=false;
      deviceCheckMessage='Disconnect Wi-Fi/mobile data and reopen the installed app before verifying saved files.';
      notify();return null;
    }
    const guard=accountGuard();
    deviceOfflineEvidence=null;deviceEvidenceWasOffline=false;
    deviceCheckMessage='Reading saved app and language files without internet…';
    notify();
    try{
      const result=await verifyOffline();
      guard();
      if(navigator.onLine)throw Error('Connection changed during the offline audit. Repeat while disconnected.');
      deviceOfflineEvidence=result;
      deviceEvidenceWasOffline=true;
      deviceCheckMessage=result.ready
        ? 'Offline files verified. Physical steps still require manual observations.'
        : 'Some saved files need attention. Reconnect and repair before relying on the device.';
      notify();return result;
    }catch(e) {
      deviceOfflineEvidence=null;deviceEvidenceWasOffline=false;
      deviceCheckMessage='Offline file verification incomplete: '+humanError(e);
      notify();throw e;
    }
  }
  function exportDeviceAcceptance() {
    if(!currentEnrollment())throw Error('Sign in as this device account before exporting acceptance.');
    // Only sanitized counts and human observations; not the older detailed
    // readiness report or recovery JSON (which contain private filenames).
    const report=deviceAcceptanceReport();
    const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download='kg-u4a-device-acceptance-'+report.platform+'.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    return report;
  }

  function tellWorker() {
    const worker=navigator.serviceWorker?.controller;
    if(currentEnrollment() && mediaRoot && legacyAccessReady())
      worker?.postMessage({type:'KG_OFFLINE_OWNER',id:owner,mediaRoot});
    else if(U3D1_OFFLINE_ACCESS_ENABLED) {
      // A restricted/unknown session must not use the legacy worker's
      // public-media fallback or another owner's saved public packs.
      worker?.postMessage({type:'KG_OFFLINE_RESTRICTED_MEDIA'});
    }
    worker?.postMessage({type:'KG_OFFLINE_CHECK_SHELL'});
  }

  async function exportRecovery() {
    if(!currentEnrollment()) throw Error('Sign in to export this account’s unsynchronized work.');
    const tables={};
    for(const table of PERSONAL_TABLES) tables[table]=await get(accountKey(table))||[];
    const payload={format:'kg-chart-unsynced-recovery',version:1,exportedAt:now(),ownerId:owner,
      email:enrollment.email,lastSync,outbox:await outbox(),tables,
      quizAnswerChecks:await get(quizChecksKey(owner))||{}};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`kg-chart-unsynced-${owner}-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }

  async function importRecovery(file) {
    if(!currentEnrollment()) throw Error('Sign in as the original account before importing a recovery file.');
    if(!file || file.size>25*1048576) throw Error('Select a KG Chart recovery JSON file smaller than 25 MB.');
    const saved=JSON.parse(await file.text());
    if(saved.format!=='kg-chart-unsynced-recovery' || saved.version!==1 || saved.ownerId!==owner ||
      saved.email?.toLowerCase()!==enrollment.email || !Array.isArray(saved.outbox))
      throw Error('Recovery account or format does not match this authorized login. Nothing was imported.');
    for(const event of saved.outbox) {
      if(event.ownerId!==owner || !WRITABLE_TABLES.has(event.table) || !/^[a-f0-9-]{36}$/i.test(event.id) ||
        !['insert','upsert','update','delete'].includes(event.kind) || !event.row || typeof event.row!=='object' ||
        event.row.user_id && event.row.user_id!==owner) throw Error('Recovery contains an invalid account-bound change.');
    }
    const tables=Object.entries(saved.tables||{}).filter(([t])=>PERSONAL_TABLES.has(t));
    for(const [table,rows] of tables){
      if(!Array.isArray(rows) || rows.length>100000 || rows.some(row=>row.user_id && row.user_id!==owner ||
        table===TABLES.levels && row.email!==enrollment.email)) throw Error('Recovery contains rows for a different account.');
    }
    const savedChecks=saved.quizAnswerChecks||{};
    if(typeof savedChecks!=='object' || Array.isArray(savedChecks) || Object.keys(savedChecks).length>100000)
      throw Error('Recovery quiz checks are invalid. Nothing was imported.');
    const savedSessions=saved.tables?.[TABLES.sessions]||[];
    for(const [id,check] of Object.entries(savedChecks)) {
      const session=savedSessions.find(row=>row.id===id && row.user_id===owner);
      if(!check || typeof check!=='object' || Array.isArray(check) ||
        !session || !QUIZ_ANSWER_TYPES.has(session.quiz_type) ||
        !session.language_code || check.language_code!==session.language_code ||
        !Number.isSafeInteger(check.total_questions) || check.total_questions<1 ||
        !Number.isSafeInteger(check.correct_answers) || check.correct_answers<0 ||
        check.correct_answers>check.total_questions ||
        check.total_questions!==session.total_questions || check.correct_answers!==session.correct_answers)
        throw Error('Recovery quiz check does not match its owned session. Nothing was imported.');
    }
    let recoveryError=null;
    await transact(['kv','outbox'],tx=>{
      const kv=tx.objectStore('kv'),queue=tx.objectStore('outbox');
      for(const event of saved.outbox) {
        const req=queue.get(event.id);
        req.onsuccess=()=>{if(!req.result)queue.put(event);};
      }
      for(const [table,rows] of tables){
        const key=accountKey(table),req=kv.get(key);
        req.onsuccess=()=>{
          const old=req.result||[],unique=PRIMARY[table]||['id'];
          const existing=new Set(old.map(r=>rowKey(r,unique)));
          kv.put([...old,...rows.filter(r=>{const k=rowKey(r,unique);if(existing.has(k))return false;existing.add(k);return true;})],key);
        };
      }
      if(Object.keys(savedChecks).length) {
        const checksReq=kv.get(quizChecksKey(owner));
        checksReq.onsuccess=()=>{
          // These reads follow the table merge writes already queued above.
          const sessionsReq=kv.get(accountKey(TABLES.sessions));
          sessionsReq.onsuccess=()=>{
            const answersReq=kv.get(accountKey(TABLES.answers));
            answersReq.onsuccess=()=>{
              const checks=checksReq.result||{};
              for(const [id,check] of Object.entries(savedChecks)) {
                const row=(sessionsReq.result||[]).find(row=>row.id===id && row.user_id===owner);
                if(!row || Object.entries(check).some(([key,value])=>row[key]!==value)) {
                  recoveryError=Error('Recovery conflicts with a saved quiz session. Nothing was imported.');
                  tx.abort();return;
                }
                if(!checks[id]) checks[id]={...check};
                if(quizAnswersComplete(checks[id],(answersReq.result||[]).filter(row=>row.session_id===id)))
                  delete checks[id];
              }
              kv.put(checks,quizChecksKey(owner));
            };
          };
        };
      }
    }).catch(error=>{throw recoveryError||error;});
    progress.phase=`Recovered ${saved.outbox.length} queued changes for ${enrollment.email}. Verify and synchronize when online.`;
    await updatePending();
  }

  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sizeOf = n => Number.isFinite(n) ? (n/1048576).toFixed(1)+' MB' : 'unknown';
  const shortDate = d => d ? new Date(d).toLocaleString() : 'Never';
  const humanError = e => e?.message || String(e);

  async function listLanguages() {
    if(!live || !currentEnrollment() || !navigator.onLine || !legacyAccessReady()) return;
    const {data,error}=await live.from(TABLES.languages).select('*').eq('is_active',true).order('sort_order');
    if(error) throw Error(error.message);
    knownLanguages=data||[];
    await put('languages:'+owner,knownLanguages);
    notify();
  }

  function openSettings() {
    const dialog=document.getElementById('kg-settings-dialog');
    if(!dialog || dialog.open) return;
    panelOpen=true;
    renderPanel();
    dialog.showModal();
  }

  function renderPanel() {
    const node=document.getElementById('kg-offline-panel');
    if(!node) return;
    const ready=[...packs.keys()];
    const assets=Array.from(packs.values()).flatMap(p=>p.assets||[]);
    const bytes=assets.reduce((s,a)=>s+a.bytes,0);
    const pictureBytes=[...new Map(assets.filter(a=>/\.(png|jpg|jpeg|webp|gif|avif|svg)$/i.test(new URL(a.url).pathname)).map(a=>[a.sha256,a])).values()].reduce((s,a)=>s+a.bytes,0);
    const langs=knownLanguages.length ? knownLanguages : [...new Map([...packs.values()].flatMap(p=>p.data[TABLES.languages]||[]).map(l=>[l.code,l])).values()];
    const languageOptions=langs.length ? langs : [{code:'my',name_english:'Burmese'},{code:'ja',name_english:'Japanese'},{code:'ta',name_english:'Tamil'}];
    if(!languageOptions.some(x=>x.code===selectedLang)) selectedLang=languageOptions[0].code;
    const missingImages=(packs.get(selectedLang)?.assets||[]).filter(a=>a.missingImage).length;
    const offline= !navigator.onLine;
    const status=currentEnrollment() ? `Account: ${esc(enrollment.email)} · ${ready.length} packs · ${sizeOf(bytes)} · App shell ${shellReady?'verified':'not yet verified'}` : 'First-time setup: sign in to KG Chart while online.';
    const accessNotice=U3D1_OFFLINE_ACCESS_ENABLED && !legacyAccessReady()
      ? 'Restricted or unverified offline learning is pending full U3D3 authorization. Existing packs and queued work remain saved.'
      : '';
    const heldNotice=U3D3A_OUTBOX_HOLD_ENABLED && heldOutboxReview?.held
      ? heldOutboxReview.held+' queued change(s) held for permission review. Export recovery before resolving; nothing was discarded.'
      : '';
    const waiting=progress.remaining===null ? 'Remaining size not supplied by server' : sizeOf(progress.remaining)+' remaining';
    const complete=ready.length && shellReady ? 'App files and lessons are saved. Verify offline reopening on this device before relying on them.' :
      ready.length ? 'Language pack saved. Finish installing the app shell and reopen once while online before going offline.' :
      'No complete pack yet. Sign in and download before taking this edition offline.';
    const deviceContract=window.KGDeviceAcceptance;
    const deviceSummary=deviceContract?.createReport?.({
      platform:devicePlatform,observations:deviceChecks,
      readiness:deviceOfflineEvidence,wasOffline:deviceEvidenceWasOffline,
      currentPending:currentEnrollment()?pendingCount:null,
      edition:unified?'unified':'separate-offline',
    });
    const deviceCases=deviceContract?.CASES||[];
    const deviceCaseControls=deviceCases.map(item=>
      '<label>'+esc(item.label)+
      '<select id="kg-u4-'+esc(item.id)+'" aria-label="'+esc(item.label)+'">'+
      [['not_tested','Not tested'],['pass','Pass (I checked)'],['fail','Fail']].map(([value,label])=>
        '<option value="'+value+'"'+(deviceChecks[item.id]===value?' selected':'')+'>'+label+'</option>').join('')+
      '</select><small>'+esc(item.instruction)+'</small></label>'
    ).join('');
    const updateBlocked=quizBusy || busy || syncing;
    const updateReason=quizBusy ? 'Open the Chart tab to enable the update.' :
      busy ? 'Finish or pause the language-pack download first.' :
      syncing ? 'Wait for synchronization to finish.' : '';
    node.innerHTML=`<section class="kg-offline-toolbar" role="region" aria-label="KG Chart Offline controls">
      ${pendingShellUpdate ? `<div class="kg-offline-update" role="status" aria-live="polite">
        <span><strong>New app version downloaded.</strong> Your saved packs and unsent study progress will be kept.
          ${updateReason ? esc(updateReason) : 'Apply it when you are ready.'}
          ${shellUpdateError ? `<span class="kg-offline-update-error">${esc(shellUpdateError)}</span>` : ''}</span>
        <button id="kg-shell-update" ${updateBlocked || applyingShellUpdate?'disabled':''}>${applyingShellUpdate?'Updating…':quizBusy?'Switch to Chart to update':busy?'Pause the pack download to update':syncing?'Waiting for sync…':'Update app now'}</button>
      </div>` : ''}
      <details ${panelOpen ? 'open' : ''}>
        <summary><strong>Study offline</strong> <span class="kg-offline-pill">${offline?'Offline':'Connected'}</span>
        <span class="kg-offline-pill">${pendingCount?pendingCount+' pending':ready.length+' packs saved'}</span><span class="kg-offline-pill">${shellReady?'App files saved':'App files not verified'}</span></summary>
        <div class="kg-offline-body">
          <div class="kg-offline-description">${status}. ${complete} Shared picture content: ${sizeOf(pictureBytes)}. Older pack copies are retained for recovery.
          ${accessNotice ? '<strong role="status">'+esc(accessNotice)+'</strong>' : ''}
          ${heldNotice ? '<strong role="status">'+esc(heldNotice)+'</strong>' : ''}</div>
          <div class="kg-offline-grid">
            <label>Language pack<select id="kg-pack-lang" ${!currentEnrollment()?'disabled':''}>${languageOptions.map(l=>`<option value="${esc(l.code)}" ${l.code===selectedLang?'selected':''}>${esc(l.flag_emoji||'')} ${esc(l.name_english||l.code)} ${ready.includes(l.code)?shellReady?'✓ ready offline':'✓ pack saved':''}</option>`).join('')}</select></label>
            <div class="kg-offline-actions">
              <button id="kg-download" ${!currentEnrollment()||busy||!legacyAccessReady()?'disabled':''}>${packs.has(selectedLang)?'Check / update pack':'Download pack'}</button>
              <button id="kg-pause" ${busy?'':'disabled'}>Pause</button>
              <button id="kg-sync" ${!currentEnrollment()||syncing||offline?'disabled':''}>${syncing?'Syncing…':'Sync now'}</button>
              <button id="kg-verify" ${checkingReadiness||busy||syncing||quizBusy?'disabled':''}>${checkingReadiness?'Checking saved files…':'Check offline readiness'}</button>
              <button id="kg-report" ${readinessReport?'':'disabled'}>Export check report</button>
              <button id="kg-check-app-update">Check for app update</button>
              <button id="kg-repair">Repair app files</button>
              <button id="kg-export" ${!currentEnrollment()?'disabled':''}>Export recovery</button>
            </div>
          </div>
          <label class="kg-offline-import">Restore unsent work from a backup: <input type="file" accept="application/json,.json" id="kg-import" ${!currentEnrollment()?'disabled':''}></label>
          <div class="kg-offline-meter"><progress max="${Math.max(progress.total,1)}" value="${progress.done}" aria-label="Pack download progress"></progress>
            <span>${progress.done}/${progress.total} files · ${sizeOf(progress.bytes)} checked · ${waiting} · ${progress.failures} failures · ${progress.missingImages||0} image placeholders</span>
          </div>
          <p class="kg-offline-message">${esc(progress.phase)}${syncError?' · Sync error: '+esc(syncError):''}</p>
          ${missingImages ? `<p class="kg-offline-message" role="status">⚠ ${missingImages} published image${missingImages===1?' is':'s are'} unavailable in the selected pack. Local placeholders keep downloads and offline lessons working; image-based questions may be less useful until those pictures are restored.</p>` : ''}
          <div class="kg-offline-grid kg-offline-options">
            <label><input type="checkbox" id="kg-auto" ${options.autoUpdate?'checked':''}> Check/update packs automatically while open</label>
            <label><input type="checkbox" id="kg-wifi" ${options.wifiOnly?'checked':''}> Wi-Fi only when the browser identifies it</label>
          </div>
          ${readinessReport ? `<p class="kg-offline-message">File check: ${readinessReport.ready?'Passed':'Needs attention'} · ${readinessReport.edition} · ${esc(readinessReport.appVersion)} · ${readinessReport.pendingChanges} unsent changes · ${readinessReport.packs.reduce((sum,p)=>sum+p.missingPictures,0)} picture placeholders. Physical Airplane-mode testing is still required.</p>` : ''}
          <details id="kg-u4-device" ${devicePanelOpen?'open':''}>
            <summary><strong>U4 device acceptance</strong> · Android/iPad · ${esc(deviceSummary?.baselineVerdict||'incomplete')}</summary>
            <div class="kg-offline-body">
              <p>Record real device results. No test automatically marks a physical check as passed.
              Restricted-user access is NOT authorized. This checklist never uploads a report or alters study storage.</p>
              <label>Device
                <select id="kg-u4-platform" aria-label="Device platform">
                  <option value="" ${!devicePlatform?'selected':''}>Select device</option>
                  <option value="android" ${devicePlatform==='android'?'selected':''}>Android</option>
                  <option value="ipad" ${devicePlatform==='ipad'?'selected':''}>iPad Home Screen app</option>
                </select>
              </label>
              <div class="kg-offline-actions">
                <button id="kg-u4-check" ${!currentEnrollment()||checkingReadiness||busy||syncing||quizBusy?'disabled':''}>Verify saved files offline</button>
                <button id="kg-u4-export" ${!currentEnrollment()?'disabled':''}>Export U4 evidence (counts only)</button>
              </div>
              <p role="status">${esc(deviceCheckMessage||
                'First reopen the installed app with Airplane mode enabled. Then verify saved files while still offline.')}</p>
              <p>Offline file check: ${deviceOfflineEvidence?
                (deviceSummary?.readiness?.ready?'Files verified':'Needs attention'):
                'Not checked on this app session'} · User observations: ${deviceSummary?.totals?.passed||0} passed,
                ${deviceSummary?.totals?.failed||0} failed, ${deviceSummary?.totals?.notTested||deviceCases.length} untested</p>
              <div class="kg-offline-grid kg-offline-options">${deviceCaseControls}</div>
              <p><strong>Baseline verdict:</strong> ${esc(deviceSummary?.baselineVerdict||'incomplete')}.
              <strong>Restricted sharing:</strong> NOT TESTED / NO-GO.
              Do not clear browser storage, uninstall the PWA or sign out for this test.
              Recovery backup exports contain personal data; keep them privately.</p>
            </div>
          </details>
          <p class="kg-offline-foot">App version: ${esc(appVersion)} · Active worker: ${esc(activeWorkerVersion||'Checking…')}</p>
          <p class="kg-offline-foot">Last server-acknowledged sync: ${shortDate(lastSync)}. ${pendingCount} unsent changes.
            Account verification and audio assessment need internet. Expired sessions need reauthentication before sync.
            Browser background downloads are not guaranteed; checks resume when the app opens or reconnects.</p>
        </div>
      </details>
    </section>`;
    node.querySelector('details')?.addEventListener('toggle',e=>{panelOpen=e.target.open;});
    node.querySelector('#kg-u4-device')?.addEventListener('toggle',e=>{devicePanelOpen=e.target.open;});
    node.querySelector('#kg-u4-platform')?.addEventListener('change',e=>{
      devicePlatform=e.target.value;renderPanel();
    });
    for(const item of deviceCases){
      node.querySelector('#kg-u4-'+item.id)?.addEventListener('change',e=>{
        deviceChecks[item.id]=e.target.value;renderPanel();
      });
    }
    node.querySelector('#kg-u4-check')?.addEventListener('click',()=>
      verifyDeviceOffline().catch(e=>{deviceCheckMessage=humanError(e);notify();}));
    node.querySelector('#kg-u4-export')?.addEventListener('click',()=>
      {try{exportDeviceAcceptance();}
       catch(e){deviceCheckMessage=humanError(e);notify();}});
    node.querySelector('#kg-check-app-update')?.addEventListener('click',()=>{
      if(window.KGCheckAppUpdate) window.KGCheckAppUpdate();
      else {progress.phase='App updater is not ready. Reopen while connected and try again.';notify();}
    });
    node.querySelector('#kg-pack-lang')?.addEventListener('change',e=>{selectedLang=e.target.value;renderPanel();});
    node.querySelector('#kg-shell-update')?.addEventListener('click',async()=>{
      if(!pendingShellUpdate || quizBusy || busy || syncing || applyingShellUpdate) return;
      applyingShellUpdate=true;shellUpdateError='';notify();
      try { await pendingShellUpdate(); }
      catch(e) { applyingShellUpdate=false;shellUpdateError=humanError(e);notify(); }
    });
    node.querySelector('#kg-download')?.addEventListener('click',()=>downloadPack(selectedLang,{refresh:packs.has(selectedLang)})
      .catch(e=>{progress.phase=humanError(e);notify();}));
    node.querySelector('#kg-pause')?.addEventListener('click',()=>{pauseRequested=true;progress.phase='Pausing after current files…';notify();});
    node.querySelector('#kg-sync')?.addEventListener('click',()=>sync());
    node.querySelector('#kg-verify')?.addEventListener('click',()=>verifyOffline().catch(e=>{progress.phase=e.message;notify();}));
    node.querySelector('#kg-report')?.addEventListener('click',exportReadiness);
    node.querySelector('#kg-repair')?.addEventListener('click',()=>window.KGRepairShell?.().catch(e=>{progress.phase=e.message;notify();}));
    node.querySelector('#kg-export')?.addEventListener('click',()=>exportRecovery().catch(e=>{syncError=humanError(e);notify();}));
    node.querySelector('#kg-import')?.addEventListener('change',e=>importRecovery(e.target.files?.[0]).catch(err=>{syncError=humanError(err);notify();}));
    node.querySelector('#kg-auto')?.addEventListener('change',e=>{options.autoUpdate=e.target.checked;saveOptions();});
    node.querySelector('#kg-wifi')?.addEventListener('change',e=>{options.wifiOnly=e.target.checked;saveOptions();});
  }
  const saveOptions=()=>put('options:'+owner,options).then(notify);

  async function automaticChecks() {
    if(!currentEnrollment() || busy || syncing || quizBusy || !navigator.onLine || document.hidden || !options.autoUpdate) return;
    if(navigator.connection?.saveData) return;
    if(options.wifiOnly && !['wifi','ethernet'].includes(navigator.connection?.type)) {
      progress.phase='Waiting for detectable Wi-Fi; this browser may not report Wi-Fi. Manual download works on any connection.';
      notify();return;
    }
    const current=Date.now();
    if(current-updateCheckAt<6*60*60*1000) return; // no continuous network churn
    updateCheckAt=current;
    await sync().catch(()=>{});
    if(U3D1_OFFLINE_ACCESS_ENABLED && !legacyAccessReady())return;
    for(const lang of packs.keys()) {
      if(quizBusy || busy || !navigator.onLine) break;
      try{await downloadPack(lang,{refresh:true});}catch(e){syncError='Update paused: '+humanError(e);notify();break;}
    }
  }

  async function init() {
    db=await bounded(openDB(), 'Opening local storage');
    const previous=await get('active-owner');
    if(previous){
      const record=await get('enroll:'+previous);
      if(record?.id===previous && record.unlocked===true) {owner=previous;enrollment=record;}
    }
    if(currentEnrollment()) {
      await loadPacks();
      if(U3D1_OFFLINE_ACCESS_ENABLED)await restoreOfflineAccess();
      options={...options,...((await get('options:'+owner))||{})};
      knownLanguages=(await get('languages:'+owner))||[];
      pendingCount=(await outbox()).length;
      if(U3D3A_OUTBOX_HOLD_ENABLED)await auditRestrictedQueue();
    }
    const build=await bounded(fetch('./offline-build.json',{cache:'only-if-cached',mode:'same-origin'}).then(r=>r.ok?r.json():null), 'Reading app version', 1500).catch(()=>null);
    appVersion=window.KG_APP_VERSION||build?.appVersion||'unknown';
    progress.phase=currentEnrollment() ? 'Saved packs are ready.' : 'Sign in online to authorize this device and download lessons.';
    notify();
    navigator.serviceWorker?.addEventListener('controllerchange',()=>{
      shellReady=false;sharedPicturesReady=false;pendingShellUpdate=null;applyingShellUpdate=false;
      deviceOfflineEvidence=null;deviceEvidenceWasOffline=false;
      deviceCheckMessage='App worker changed. Repeat the offline file check before exporting evidence.';
      tellWorker();notify();
    });
    navigator.serviceWorker?.addEventListener('message',event=>{
      if(event.data?.type==='KG_OFFLINE_VERSION' && event.source===navigator.serviceWorker.controller) {
        activeWorkerVersion=event.data.revision;notify();
      }
      if(event.data?.type==='KG_OFFLINE_REQUEST_OWNER') {
        event.ports?.[0]?.postMessage(
          U3D1_OFFLINE_ACCESS_ENABLED && !legacyAccessReady() ?
          {restrictedMedia:true} :
          currentEnrollment() && mediaRoot && legacyAccessReady()
          ? {id:owner,mediaRoot} : null);
      }
      if(event.data?.type==='KG_OFFLINE_SHELL_INCOMPLETE') {
        shellReady=false;progress.phase='App files need repair. Reconnect and use Repair app files. Packs and progress are kept.';notify();
      }
      if(event.data?.type==='KG_OFFLINE_SHELL_READY') {
        activeWorkerVersion=event.data.revision;
        sharedPicturesReady=event.data.sharedPictures===1;
        shellReady=true;
        if(packs.size && progress.phase.startsWith('Pack saved'))
          progress.phase='Ready offline · '+[...packs.keys()].join(', ');
        notify();
      }
    });
    addEventListener('online',()=>{notify();sync().catch(()=>{});setTimeout(automaticChecks,0);});
    addEventListener('offline',notify);
    addEventListener('focus',()=>{notify();setTimeout(automaticChecks,0);});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)automaticChecks();});
    navigator.connection?.addEventListener?.('change',automaticChecks);
    channel?.addEventListener('message',event=>{
      if(event.data?.type==='lock' && event.data.owner===owner) location.reload();
      if(event.data?.type==='changed' && event.data.owner===owner) updatePending();
    });
    tellWorker();
    // Resume only after the app is interactive; no network call delays cold startup.
    setTimeout(automaticChecks,12000);
  }

  function fatal(e) {
    const root=document.getElementById('root');
    if(root) root.innerHTML=`<div class="kg-offline-fatal"><h1>KG Chart Offline could not open</h1>
      <p>${esc(e?.message||'Local storage is unavailable or full.')}</p>
      <p>Reconnect and reopen to repair. Your existing offline data has not been cleared.</p>
      <button onclick="location.reload()">Try opening again</button></div>`;
  }

  window.KGOffline={
    openSettings,
    ready:bounded(init(), 'Opening saved lessons', 20000).catch(e=>{fatal(e);throw e;}), wrapClient,afterVerified,downloadPack,
    previewRestrictedPack,stageRestrictedPrivateMedia,
    readPrivateMedia,restorePreviousPrivateMedia,
    installRestrictedBundle,readRestrictedBundle,restorePreviousRestrictedBundle,
    auditRestrictedQueue,syncRestrictedQueue,
    setLanguage:value=>{studyLanguage=value;},
    pause:()=>{pauseRequested=true;},sync,exportRecovery,importRecovery,
    setQuizBusy:value=>{if(quizBusy!==!!value){quizBusy=!!value;notify();}},
    canApplyShellUpdate:()=>!quizBusy && !busy && !syncing,
    offerShellUpdate:apply=>{pendingShellUpdate=typeof apply==='function'?apply:null;applyingShellUpdate=false;shellUpdateError='';notify();},
    verifyOffline,verifyDeviceOffline,deviceAcceptanceReport,exportDeviceAcceptance,
    readMedia,tellWorker,notice:message=>{progress.phase=message;notify();},fatal,
    status:()=>({appVersion,activeWorkerVersion,ownerId:owner,shellReady,
      readyLanguages:legacyAccessReady()?[...packs.keys()]:[],
      offlineAccess:U3D1_OFFLINE_ACCESS_ENABLED?{...effectiveAccess()}:{state:'legacy',reason:'stage_off'},
      restrictedBundlesEnabled:U3D3B_RESTRICTED_PACKS_ENABLED,
      heldOutbox:U3D3A_OUTBOX_HOLD_ENABLED&&heldOutboxReview ?
        {...heldOutboxReview}:null,
      pending:pendingCount,lastSync,progress:{...progress},syncError,quizBusy,updateAvailable:!!pendingShellUpdate}),
    subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  };
})();
