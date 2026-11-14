/* KG Chart Offline runtime. Kept outside index.html; both editions compile the same learner UI.
 * Local IDB writes and the outbox commit in ONE transaction. No service-role key is used.
 */
(() => {
  'use strict';
  const DB_NAME = 'kg-chart-offline-v1';
  const DB_VERSION = 1;
  const SCHEMA_VERSION = 1;
  const PREFIX = 'kg-offline-pack-';
  const MEDIA_ROOT = 'https://ulgrfumbwjovbjzjiems.supabase.co/storage/v1/object/public/vocabulary-assets/';
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
  let db, live, owner = null, enrollment = null, busy = false, pauseRequested = false, updateCheckAt = 0;
  let packs = new Map(), activeCaches = [], progress = { phase: 'opening', done: 0, total: 0, bytes: 0, remaining: null, failures: 0 };
  let syncing = false, syncError = '', lastSync = null, pendingCount = 0;
  let options = { autoUpdate: true, wifiOnly: true }, knownLanguages = [], selectedLang = 'my', quizBusy = false, panelOpen = false, shellReady = false;
  let appVersion = 'unknown';
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kg-offline-account-events') : null;
  const notify = () => { listeners.forEach(fn => fn()); renderPanel(); };
  const problem = (message, code = 'KG_OFFLINE') => ({ message, code });
  const offlineError = (label = 'This action') => problem(label + ' requires internet. Downloaded lessons and quizzes still work.', 'KG_INTERNET_REQUIRED');
  const now = () => new Date().toISOString();
  const rowKey = (row, keys) => keys.map(k => String(row[k] ?? '')).join('\u001f');
  const matches = (row, filters) => filters.every(([op, key, value]) => op === 'eq' ? row[key] === value :
    op === 'in' ? value.includes(row[key]) : op === 'is' ? row[key] === value : false);
  const simplify = value => JSON.parse(JSON.stringify(value));
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value instanceof ArrayBuffer ? value : new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const openDB = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
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
      if (!canUseLocal(this.table)) {
        if(!navigator.onLine) return {data:null,error:offlineError('This feature')};
        return this.remote.then(x=>x);
      }
      if (this.mutation) {
        if (!WRITABLE_TABLES.has(this.table)) return { data: null, error: offlineError('Editing shared lesson content') };
        if (!currentEnrollment()) return { data: null, error: problem('Reauthenticate this account before saving offline progress') };
        try { return { data: await queueMutation(this.table,this.mutation,this.filters,this.conflict,this.shape), error:null }; }
        catch (e) { return { data:null,error:problem('Could not save on this device: '+e.message, 'KG_LOCAL_SAVE_FAILED') }; }
      }
      try {
        let rows = (await selectRows(this.table)).filter(r => matches(r,this.filters));
        if (this.columns.includes('translations:') || this.table === TABLES.colours && this.columns.includes('colour:')) {
          const all = {};
          if (this.table === TABLES.topics) all[TABLES.topicTranslations] = await selectRows(TABLES.topicTranslations);
          if (this.table === TABLES.vocabulary) all[TABLES.vocabularyTranslations] = await selectRows(TABLES.vocabularyTranslations);
          if (this.table === TABLES.colours) all[TABLES.vocabulary] = await selectRows(TABLES.vocabulary);
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
    const rows = oldRows.map(r=>({...r})), created=[];
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
      if (table===TABLES.sessions) row.created_at ||= now();
      if (table===TABLES.answers) row.answered_at ||= now();
      if (table === TABLES.ratings) { row.user_id ||= owner;row.updated_at ||= now(); }
      if ([TABLES.completions,TABLES.prefs].includes(table)) row.user_id=owner;
      const i=rows.findIndex(r=>rowKey(r,keys)===rowKey(row,keys));
      if (i===-1) rows.push(row);
      else if (kind === 'upsert') rows[i]={...rows[i],...row};
      created.push({...row});
    }
    return {next:rows,created};
  }

  async function queueMutation(table,[kind,value],filters,conflict,shape) {
    // This read + outbox enqueue + updated view are committed atomically, in one IDB transaction.
    const uid=owner;
    const key=`rows:${uid}:${table}`;
    if((Array.isArray(value)?value:[value]).filter(Boolean).some(row=>
      (row.user_id && row.user_id!==uid) ||
      (table===TABLES.levels && row.email?.toLowerCase()!==enrollment.email)))
      throw Error('Account mismatch: refusing to queue another user’s data');
    let created=[];
    await transact(['kv','outbox'], tx => {
      const kv=tx.objectStore('kv'), out=tx.objectStore('outbox');
      const req=kv.get(key);
      req.onsuccess=()=>{
        const prior=req.result || [];
        const result=makeRows(table,kind,value,filters,prior,conflict);
        created=result.created;
        if (kind === 'delete' && !created.length) {
          // Preserve a delete against a remote record even when local data is missing.
          created=[Object.fromEntries(filters.filter(([op])=>op==='eq').map(([,k,v])=>[k,v]))];
        }
        const seqReq=kv.get('sequence:'+uid);
        seqReq.onsuccess=()=>{
          let sequence=Number(seqReq.result)||0;
          for(const row of created){
            if (owner!==uid || (row.user_id && row.user_id!==uid)) {tx.abort();return;}
            const base=prior.find(p=>rowKey(p,PRIMARY[table]||['id'])===rowKey(row,PRIMARY[table]||['id']));
            const event={ id:crypto.randomUUID(), sequence:++sequence, ownerId:uid, table, kind, row:simplify(row),
              filters:simplify(filters), at:now(), baseUpdatedAt:base?.updated_at||base?.last_reviewed_at||null,
              state:'pending' };
            out.put(event);
          }
          if(table===TABLES.sessions && created.length){
            const pendingKey='level-checks:'+uid,req=kv.get(pendingKey);
            req.onsuccess=()=>{
              const checks=req.result||{};
              for(const row of created) if(row.language_code) checks[row.language_code]=sequence;
              kv.put(checks,pendingKey);
            };
          }
          kv.put(sequence,'sequence:'+uid);
          kv.put(result.next,key);
        };
      };
    });
    channel?.postMessage({type:'changed',owner});
    await updatePending();
    return shape ? (created[0]||null) : (created.length?created:null);
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
    const [languages,topics,tt,vocabulary,vt,sentences,colours,settings] = await Promise.all([
      readPaged(TABLES.languages,q=>q.eq('is_active',true)),
      readPaged(TABLES.topics),
      readPaged(TABLES.topicTranslations,q=>q.in('language_code',meaning)),
      readPaged(TABLES.vocabulary),
      readPaged(TABLES.vocabularyTranslations,q=>q.in('language_code',meaning)),
      readPaged(TABLES.sentences,q=>q.eq('language_code',lang)),
      readPaged(TABLES.colours,q=>q.eq('language_code',lang)),
      readPaged(TABLES.settings,q=>q.in('key',['unlock_rules','private_lessons','admin_bypass_lock'])),
    ]);
    if(!languages.some(l=>l.code===lang)) throw Error('This language is not currently published/active.');
    if(!tt.some(t=>t.language_code===lang) || !vt.some(v=>v.language_code===lang)) throw Error('Published topics or vocabulary translations are missing.');
    return { [TABLES.languages]:languages,[TABLES.topics]:topics,[TABLES.topicTranslations]:tt,
      [TABLES.vocabulary]:vocabulary,[TABLES.vocabularyTranslations]:vt,
      [TABLES.sentences]:sentences,[TABLES.colours]:colours,[TABLES.settings]:settings };
  }

  function requiredMedia(data,lang) {
    const urlSet=new Set();
    const vocabulary=data[TABLES.vocabulary]||[];
    const translated=new Set((data[TABLES.vocabularyTranslations]||[]).filter(x=>x.language_code===lang).map(x=>x.vocabulary_id));
    for(const v of vocabulary.filter(v=>translated.has(v.id))) {
      if(!v.image_filename || v.extra_data?.colorCode || v.image_filename.startsWith('emoji:')) continue;
      const url=v.image_filename.startsWith('http') ? v.image_filename : `${MEDIA_ROOT}${v.topic_id}/${v.image_filename}`;
      if(!url.startsWith(MEDIA_ROOT)) throw Error('External picture needs a verified offline source: '+url);
      urlSet.add(url);
    }
    for(const c of data[TABLES.colours]||[]) {
      if(!c.picture || c.picture.startsWith('emoji:') || c.picture.startsWith('linear-gradient') || c.picture.startsWith('#')) continue;
      // Colour phrases use CSS/emoji in this revision; reject an unexpected remote URL rather than mark pack ready.
      if(c.picture.startsWith('https://')) {
        if(!c.picture.startsWith(MEDIA_ROOT)) throw Error('External colour picture requires internet: '+c.picture);
        urlSet.add(c.picture);
      }
    }
    return [...urlSet].sort();
  }

  async function audioFiles(lang) {
    const base=`${MEDIA_ROOT}audio/${lang}`;
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
    // when HEAD cannot supply a revision; never redownload a completed staged file.
    if(found && found.headers.get('X-KG-SHA256')) return found;
    if(!forceRefresh) {
      // Reuse older, activated copies ONLY if the publisher has a reliable revision.
      for(const name of priorCaches){
        const previous=await (await caches.open(name)).match(url);
        if(matchesRevision(previous)) { await cache.put(url,previous.clone()); return previous; }
      }
    }
    return null;
  }

  async function saveAsset(url,info,cache) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    try {
      // A cache-buster bypasses stale intermediaries, but the CacheStorage key remains canonical.
      const originUrl=new URL(url);
      originUrl.searchParams.set('kg_rev',String(Date.now()));
      const r=await fetch(originUrl,{cache:'no-store',signal:controller.signal});
      if(!r.ok) throw Error(`Asset HTTP ${r.status}: ${url}`);
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
      const hash=await digest(await blob.arrayBuffer());
      const headers=new Headers({'Content-Type':blob.type|| (isAudio?'audio/mpeg':'application/octet-stream'),
        'X-KG-SHA256':hash,'X-KG-Revision':info.revision||'', 'X-KG-Bytes':String(blob.size)});
      const response=new Response(blob,{status:200,headers});
      await cache.put(url,response.clone());
      return {response,hash,bytes:blob.size};
    } finally {clearTimeout(timer);}
  }

  async function downloadPack(lang,{refresh=false}={}) {
    if(busy) return;
    if(!currentEnrollment()) throw Error('Sign in with an approved account online before downloading.');
    if(!navigator.onLine) throw Error('An internet connection is required to download or update packs.');
    busy=true;pauseRequested=false;
    progress={phase:'Reading published lesson data…',done:0,total:0,bytes:0,remaining:null,failures:0};notify();
    try {
      const data=await fetchContent(lang);
      const audio=await audioFiles(lang);
      const fileUrls=[...new Set([...requiredMedia(data,lang),...audio.urls])];
      const infos=[];
      for(let i=0;i<fileUrls.length;i+=12) infos.push(...await Promise.all(fileUrls.slice(i,i+12).map(fileInfo)));
      // Content and media revisions form a deterministic, versioned manifest; replacement at
      // an unchanged URL invalidates it if the storage provider exposes ETag/Last-Modified.
      const contentHash=await digest(JSON.stringify(data));
      const candidateRevision=await digest(JSON.stringify({contentHash,files:infos.map(f=>[f.url,f.revision,f.bytes]),audio:audio.json}));
      const stageId=`${owner}:${lang}:${candidateRevision}`;
      const interrupted=await get('staging:'+stageId);
      const stageCache=interrupted?.stageCache || `${PREFIX}${owner}-${lang}-${crypto.randomUUID()}`;
      const cache=await caches.open(stageCache);
      const oldPack=packs.get(lang);
      if(oldPack && oldPack.candidateRevision===candidateRevision && !refresh && !interrupted) {
        progress={...progress,phase:'This pack is already ready offline.',done:fileUrls.length,total:fileUrls.length};notify();
        return oldPack;
      }
      if(audio.json) {
        // KGAudio.loadManifest() uses this exact public URL during offline playback.
        const body=JSON.stringify(audio.json);
        await cache.put(audio.manifestUrl,new Response(body,{headers:{'Content-Type':'application/json','X-KG-SHA256':await digest(body)}}));
      }
      await put('staging:'+stageId,{lang,candidateRevision,contentHash,stageCache,startedAt:now(),schemaVersion:SCHEMA_VERSION});
      await navigator.storage?.persist?.().catch(()=>false);
      const previous=activeCaches.filter(n=>n.startsWith(PREFIX+owner+'-'));
      const estimated=infos.reduce((sum,i)=>sum+(i.bytes||0),0);
      progress={phase:'Downloading lesson media…',done:0,total:infos.length,bytes:0,
        remaining:estimated||null,failures:0};notify();
      const completed=[];
      let cursor=0;
      await Promise.all(Array.from({length:Math.min(3,infos.length)},async()=>{
        while(cursor<infos.length && !pauseRequested){
          const info=infos[cursor++];
          try {
            let found=await stagedResponse(info.url,info,cache,previous,refresh);
            let bytes=0,hash='';
            if(found){bytes=Number(found.headers.get('X-KG-Bytes'))||((await found.blob()).size);hash=found.headers.get('X-KG-SHA256')||'';}
            else ({bytes,hash}=await saveAsset(info.url,info,cache));
            if(!hash) throw Error('Missing cached content hash');
            completed.push({url:info.url,revision:info.revision,bytes,sha256:hash});
            progress.bytes+=bytes;
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
        if(!response || await digest(await response.arrayBuffer())!==file.sha256) throw Error('Verification failed: '+file.url);
      }
      // Content-addressed FINAL revision incorporates real media SHA256, even when an
      // intermediate cache cannot supply an ETag for a replaced image at the same URL.
      const manifestRevision=await digest(JSON.stringify({contentHash,audio:audio.json,
        files:completed.slice().sort((a,b)=>a.url.localeCompare(b.url)).map(a=>[a.url,a.sha256])}));
      const packageId=`${owner}:${lang}:${manifestRevision}`;
      if(oldPack && oldPack.manifestRevision===manifestRevision) {
        await transact(['kv'],tx=>tx.objectStore('kv').delete('staging:'+stageId));
        await caches.delete(stageCache);
        progress={...progress,phase:'Checked: your existing pack is already current.',remaining:0};notify();
        return oldPack;
      }
      const pack={lang,ownerId:owner,createdAt:now(),schemaVersion:SCHEMA_VERSION,appVersion,
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
      packs.set(lang,pack);
      activeCaches=[stageCache,...activeCaches.filter(n=>n!==stageCache)];
      tellWorker();
      progress={...progress,phase:shellReady?'Ready offline · '+lang:'Pack saved · waiting for app shell installation',done:infos.length,total:infos.length,remaining:0};
      await pullRemote().catch(e=>{syncError='Content ready, but progress download failed: '+e.message;});
      notify();
      return pack;
    } catch(e){
      progress.phase=e.message || 'Pack download failed. Retry; completed downloads remain saved.';
      notify();throw e;
    } finally {busy=false;notify();}
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
    await fetchOwner();
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
    const pending=await outbox();
    // Pull server changes, then replay ONLY this account's unsent edits in memory before
    // atomically replacing local views. Remote account changes are never discarded silently.
    await transact(['kv'],tx=>{
      const kv=tx.objectStore('kv');
      for(const [table,cloudRows] of Object.entries(incoming)) {
        let next=cloudRows;
        for(const event of pending.filter(e=>e.table===table)) {
          const kind=event.kind;
          next=makeRows(table,kind,event.row,event.filters,next).next;
        }
        kv.put(next,accountKey(table));
      }
    });
    lastSync=now();await put('last-sync:'+owner,lastSync);
    channel?.postMessage({type:'changed',owner});notify();
  }

  async function syncEvent(event) {
    if(event.ownerId!==owner) throw Error('Outbox account isolation error');
    const table=event.table;
    const row={...event.row};
    if(table===TABLES.sessions) delete row.quiz_level; // not present in current deployed schema
    if([TABLES.ratings,TABLES.levels,TABLES.completions,TABLES.prefs].includes(table)) {
      const keys=PRIMARY[table];
      let check=live.from(table).select('*');
      for(const key of keys) check=check.eq(key,row[key]);
      const {data:remote,error}=await check.maybeSingle();
      if(error) throw Error(error.message);
      if(table===TABLES.ratings) {
        const remoteStamp=remote?.updated_at||remote?.last_reviewed_at||null;
        const baseStamp=event.baseUpdatedAt||null;
        if(remote && event.kind==='upsert' && remote.rating===row.rating && remote.last_reviewed_at===row.last_reviewed_at) return;
        if(event.kind==='delete' && !remote) return;
        // Concurrent remote deletion/update must be resolved, never overwritten blindly.
        if(remoteStamp!==baseStamp && remoteStamp!==row.updated_at) {
          throw Error(`Rating conflict on ${row.vocabulary_id}. Server and device changed the same word; export unsynced work before resolving.`);
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
      if(table===TABLES.completions && remote && remote.completed_at>=row.completed_at) return;
    }
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
        const check=await live.from(table).select('*').eq('id',row.id).maybeSingle();
        if(!check.error && check.data && Object.entries(row).every(([k,v]) =>
          JSON.stringify(check.data[k] ?? null)===JSON.stringify(v ?? null))) return;
      }
    } else if(event.kind==='upsert') {
      result=await live.from(table).upsert(row,{onConflict:(PRIMARY[table]||['id']).join(',')});
    } else {
      let q=live.from(table).update(row);
      for(const [op,k,v] of event.filters) if(op==='eq') q=q.eq(k,v);
      result=await q;
    }
    if(result.error) throw Error(`${table}: ${result.error.message}`);
    // 204/empty responses alone do not prove a user row changed (RLS may affect 0 rows).
    if(PRIMARY[table]?.length) {
      let q=live.from(table).select('*');
      for(const key of PRIMARY[table]) q=q.eq(key,row[key]);
      const {data:ack,error}=await q.maybeSingle();
      if(error) throw Error('Could not confirm server acknowledgment: '+error.message);
      if(event.kind==='delete') {
        if(ack) throw Error('Delete not acknowledged by server; local tombstone stays queued.');
      } else {
        if(!ack) throw Error('Server did not confirm the saved row.');
        const checkFields=table===TABLES.ratings?['rating','last_reviewed_at']:
          table===TABLES.prefs?['audio_voice','audio_muted']:
          table===TABLES.completions?['completed_at']:
          table===TABLES.levels?['level']:[];
        if(checkFields.some(k=>row[k]!==undefined && String(ack[k])!==String(row[k])))
          throw Error('Server row differs from the queued update. Nothing was silently discarded.');
      }
    }
  }

  async function doSync() {
    if(syncing || busy || !currentEnrollment() || !navigator.onLine) return;
    syncing=true;syncError='';notify();
    try {
      await fetchOwner();
      for(const event of await outbox()) {
        await syncEvent(event);
        await transact(['outbox'],tx=>tx.objectStore('outbox').delete(event.id));
        pendingCount--;notify();
      }
      // Quiz history unlocks levels through a server RPC, not only a local
      // provisional check. Persistent markers survive a failed RPC AFTER the
      // history itself has been acknowledged, as well as interrupted restarts.
      const checkKey='level-checks:'+owner;
      const levelChecks=await get(checkKey)||{};
      for(const [lang,sequence] of Object.entries(levelChecks)){
        if((await outbox()).some(e=>e.table===TABLES.sessions && e.row.language_code===lang)) continue;
        const result=await live.rpc('kg_chart_check_level_up',{p_lang:lang});
        if(result.error) throw Error('Server level check for '+lang+': '+result.error.message);
        await transact(['kv'],tx=>{
          const kv=tx.objectStore('kv'),req=kv.get(checkKey);
          req.onsuccess=()=>{
            const fresh=req.result||{};
            if(fresh[lang]===sequence){delete fresh[lang];kv.put(fresh,checkKey);}
          };
        });
      }
      await pullRemote(); // pulls remote edits even if nothing was queued
    } catch(e) {syncError=e.message||String(e);}
    finally {syncing=false;await updatePending();}
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
      const s=(await selectRows(TABLES.sessions)).filter(s=>s.user_id===owner && s.language_code===args.p_lang &&
        ['native_to_image','image_to_native','devanagari_to_image','english_to_native','listen_to_image','listen_to_native'].includes(s.quiz_type));
      const levels=await selectRows(TABLES.levels),level=levels.find(l=>l.email===enrollment.email && l.language_code===args.p_lang)?.unlocked||1;
      const configured=(await selectRows(TABLES.settings)).find(s=>s.key==='unlock_rules')?.value||{};
      const limits=configured.languages?.[args.p_lang]?.level_up||configured.level_up||{answers:40,pct:85};
      let total=0,correct=0;
      for(const x of s.filter(x=>(x.difficulty||1)===level).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))){
        total+=x.total_questions||0;correct+=x.correct_answers||0;if(total>=(limits.answers||40))break;
      }
      const unlocked=Math.min(4,level<4 && total>=(limits.answers||40) && correct*100>=(limits.pct||85)*total ? level+1 : level);
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
    if(currentEnrollment()) sync().catch(()=>{});
    return facade;
  }

  async function afterVerified(user) {
    if(currentEnrollment() && owner===user.id) return;
    if(!navigator.onLine || !live) throw Error('Initial offline setup requires an online verified sign-in.');
    const verified=await live.auth.getUser();
    if(verified.error || verified.data?.user?.id!==user.id) throw Error('Could not confirm this signed-in account online.');
    const allowed=await live.rpc('kg_chart_is_allowed');
    if(allowed.error || allowed.data!==true) throw Error('This account is not approved for KG Chart.');
    const adm=await live.rpc('kg_chart_is_admin');
    enrollment={id:user.id,email:user.email.toLowerCase(),admin:adm.data===true,unlocked:true,verifiedAt:now()};
    owner=user.id;
    await transact(['kv'],tx=>{
      tx.objectStore('kv').put(enrollment,'enroll:'+owner);
      tx.objectStore('kv').put(owner,'active-owner');
    });
    await loadPacks();
    tellWorker();
    await updatePending();
    listLanguages().catch(()=>{});
    notify();
  }

  async function lockAccount() {
    // Sign-out never deletes outbox or existing content. It just revokes local presentation.
    const prev=owner;
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
    for(const lang of ['my','zh','si','te','ta','ko','th','ms','mr','kn','ja','fil']) {
      const key=await get('active:'+owner+':'+lang);
      const pack=key && await get('pack:'+key);
      if(pack && pack.ownerId===owner && pack.schemaVersion<=SCHEMA_VERSION) packs.set(lang,pack);
    }
    activeCaches=(await get('active-caches:'+owner))||[];
    lastSync=(await get('last-sync:'+owner))||null;
  }

  function tellWorker() {
    const worker=navigator.serviceWorker?.controller;
    if(currentEnrollment()) worker?.postMessage({type:'KG_OFFLINE_OWNER',id:owner});
    worker?.postMessage({type:'KG_OFFLINE_CHECK_SHELL'});
  }

  async function exportRecovery() {
    if(!currentEnrollment()) throw Error('Sign in to export this account’s unsynchronized work.');
    const tables={};
    for(const table of PERSONAL_TABLES) tables[table]=await get(accountKey(table))||[];
    const payload={format:'kg-chart-unsynced-recovery',version:1,exportedAt:now(),ownerId:owner,
      email:enrollment.email,lastSync,outbox:await outbox(),tables};
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
    });
    progress.phase=`Recovered ${saved.outbox.length} queued changes for ${enrollment.email}. Verify and synchronize when online.`;
    await updatePending();
  }

  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sizeOf = n => Number.isFinite(n) ? (n/1048576).toFixed(1)+' MB' : 'unknown';
  const shortDate = d => d ? new Date(d).toLocaleString() : 'Never';
  const humanError = e => e?.message || String(e);

  async function listLanguages() {
    if(!live || !currentEnrollment() || !navigator.onLine) return;
    const {data,error}=await live.from(TABLES.languages).select('*').eq('is_active',true).order('sort_order');
    if(error) throw Error(error.message);
    knownLanguages=data||[];
    await put('languages:'+owner,knownLanguages);
    notify();
  }

  function renderPanel() {
    const node=document.getElementById('kg-offline-panel');
    if(!node) return;
    const ready=[...packs.keys()];
    const bytes=(Array.from(packs.values()).flatMap(p=>p.assets||[]).reduce((s,a)=>s+a.bytes,0));
    const langs=knownLanguages.length ? knownLanguages : [...new Map([...packs.values()].flatMap(p=>p.data[TABLES.languages]||[]).map(l=>[l.code,l])).values()];
    const languageOptions=langs.length ? langs : [{code:'my',name_english:'Burmese'},{code:'ja',name_english:'Japanese'},{code:'ta',name_english:'Tamil'}];
    if(!languageOptions.some(x=>x.code===selectedLang)) selectedLang=languageOptions[0].code;
    const offline= !navigator.onLine;
    const status=currentEnrollment() ? `Account: ${esc(enrollment.email)} · ${ready.length} packs · ${sizeOf(bytes)} · App shell ${shellReady?'verified':'not yet verified'}` : 'First-time setup: sign in to KG Chart while online.';
    const waiting=progress.remaining===null ? 'Remaining size not supplied by server' : sizeOf(progress.remaining)+' remaining';
    const complete=ready.length && shellReady ? 'All required app files and saved lessons can open without a network request.' :
      ready.length ? 'Language pack saved. Finish installing the app shell and reopen once while online before going offline.' :
      'No complete pack yet. Sign in and download before taking this edition offline.';
    node.innerHTML=`<section class="kg-offline-toolbar" role="region" aria-label="KG Chart Offline controls">
      <details ${panelOpen || (!ready.length && currentEnrollment()) ? 'open' : ''}>
        <summary><strong>⬇ KG Chart Offline</strong> <span class="kg-offline-pill">${offline?'Offline':'Connected'}</span>
        <span class="kg-offline-pill">${pendingCount?pendingCount+' pending':'Saved on this device'}</span></summary>
        <div class="kg-offline-body">
          <div class="kg-offline-description">${status}. ${complete}</div>
          <div class="kg-offline-grid">
            <label>Language pack<select id="kg-pack-lang" ${!currentEnrollment()?'disabled':''}>${languageOptions.map(l=>`<option value="${esc(l.code)}" ${l.code===selectedLang?'selected':''}>${esc(l.flag_emoji||'')} ${esc(l.name_english||l.code)} ${ready.includes(l.code)?shellReady?'✓ ready offline':'✓ pack saved':''}</option>`).join('')}</select></label>
            <div class="kg-offline-actions">
              <button id="kg-download" ${!currentEnrollment()||busy?'disabled':''}>${packs.has(selectedLang)?'Check / update pack':'Download pack'}</button>
              <button id="kg-pause" ${busy?'':'disabled'}>Pause</button>
              <button id="kg-sync" ${!currentEnrollment()||syncing||offline?'disabled':''}>${syncing?'Syncing…':'Sync now'}</button>
              <button id="kg-export" ${!currentEnrollment()?'disabled':''}>Export recovery</button>
            </div>
          </div>
          <label class="kg-offline-import">Restore unsent work from a backup: <input type="file" accept="application/json,.json" id="kg-import" ${!currentEnrollment()?'disabled':''}></label>
          <div class="kg-offline-meter"><progress max="${Math.max(progress.total,1)}" value="${progress.done}" aria-label="Pack download progress"></progress>
            <span>${progress.done}/${progress.total} files · ${sizeOf(progress.bytes)} checked · ${waiting} · ${progress.failures} failures</span>
          </div>
          <p class="kg-offline-message">${esc(progress.phase)}${syncError?' · Sync error: '+esc(syncError):''}</p>
          <div class="kg-offline-grid kg-offline-options">
            <label><input type="checkbox" id="kg-auto" ${options.autoUpdate?'checked':''}> Check/update packs automatically while open</label>
            <label><input type="checkbox" id="kg-wifi" ${options.wifiOnly?'checked':''}> Wi-Fi only when the browser identifies it</label>
          </div>
          <p class="kg-offline-foot">Last server-acknowledged sync: ${shortDate(lastSync)}. ${pendingCount} unsent changes.
            Account verification and audio assessment need internet. Expired sessions need reauthentication before sync.
            Browser background downloads are not guaranteed; checks resume when the app opens or reconnects.</p>
        </div>
      </details>
    </section>`;
    node.querySelector('details')?.addEventListener('toggle',e=>{panelOpen=e.target.open;});
    node.querySelector('#kg-pack-lang')?.addEventListener('change',e=>{selectedLang=e.target.value;renderPanel();});
    node.querySelector('#kg-download')?.addEventListener('click',()=>downloadPack(selectedLang,{refresh:packs.has(selectedLang)})
      .catch(e=>{progress.phase=humanError(e);notify();}));
    node.querySelector('#kg-pause')?.addEventListener('click',()=>{pauseRequested=true;progress.phase='Pausing after current files…';notify();});
    node.querySelector('#kg-sync')?.addEventListener('click',()=>sync());
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
    for(const lang of packs.keys()) {
      if(quizBusy || busy || !navigator.onLine) break;
      try{await downloadPack(lang,{refresh:true});}catch(e){syncError='Update paused: '+humanError(e);notify();break;}
    }
  }

  async function init() {
    db=await openDB();
    const previous=await get('active-owner');
    if(previous){
      const record=await get('enroll:'+previous);
      if(record?.id===previous && record.unlocked===true) {owner=previous;enrollment=record;}
    }
    if(currentEnrollment()) {
      await loadPacks();
      options={...options,...((await get('options:'+owner))||{})};
      knownLanguages=(await get('languages:'+owner))||[];
      pendingCount=(await outbox()).length;
    }
    const build=await fetch('./offline-build.json',{cache:'only-if-cached',mode:'same-origin'}).then(r=>r.ok?r.json():null).catch(()=>null);
    appVersion=build?.appVersion||'unknown';
    progress.phase=currentEnrollment() ? 'Saved packs are ready.' : 'Sign in online to authorize this device and download lessons.';
    notify();
    navigator.serviceWorker?.addEventListener('controllerchange',()=>{shellReady=false;tellWorker();notify();});
    navigator.serviceWorker?.addEventListener('message',event=>{
      if(event.data?.type==='KG_OFFLINE_SHELL_READY') {
        shellReady=true;
        if(packs.size && progress.phase.startsWith('Pack saved'))
          progress.phase='Ready offline · '+[...packs.keys()].join(', ');
        notify();
      }
    });
    addEventListener('online',()=>{notify();setTimeout(automaticChecks,0);});
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
    ready:init().catch(e=>{fatal(e);throw e;}), wrapClient,afterVerified,downloadPack,
    pause:()=>{pauseRequested=true;},sync,exportRecovery,importRecovery,
    setQuizBusy:value=>{quizBusy=!!value;},
    tellWorker,notice:message=>{progress.phase=message;notify();},fatal,
    status:()=>({ownerId:owner,shellReady,readyLanguages:[...packs.keys()],pending:pendingCount,lastSync,progress:{...progress},syncError}),
    subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  };
})();
