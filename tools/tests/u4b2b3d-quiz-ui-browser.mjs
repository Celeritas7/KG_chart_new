// Render the actual learner quiz components against fictional persistent data.
// No hosted API, credentials, service worker, installed PWA or real account is used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {transform} from 'esbuild';
import {chromium} from 'playwright';

const source = await readFile('index.html', 'utf8');
const script = source.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'Canonical JSX must be found');
const clientSource = 'const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);';
const mountSource = "ReactDOM.createRoot(document.getElementById('root')).render(<App />);";
assert.equal(script.split(clientSource).length, 2, 'Replace only the real client boundary');
assert.equal(script.split(mountSource).length, 2, 'Replace only the final application mount');

// This code runs in the disposable browser profile. The test database is kept
// under a distinct key so it survives reload without sharing app recovery keys.
function installFakeClient() {
  const KEY = '__kg_u4b2b3d_fictional_database__';
  const owner = '11000000-0000-4000-8000-000000000001';
  const copy = value => JSON.parse(JSON.stringify(value));
  const words = ['🍎', '🥕', '🍌', '🍞'].map((emoji, i) => ({
    id: `22000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    topic_id: 'food', english_text: `Word ${i}`, display_text: `Word ${i}`,
    image_filename: `emoji:${emoji}`, translation: {native_text: `Native ${i}`, devanagari: ''},
  }));
  const sentences = words.map((_, i) => ({
    id: `33000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    language_code: 'my', group_name: 'Fictional group', native_text: `Sentence ${i}`,
    english_text: `Meaning ${i}`, sort_order: i, created_at: '2026-11-26T10:00:00.000Z',
  }));
  const phrases = ['Red','Blue','Green','Yellow'].map((colour,i)=>({
    id:'44000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),
    language_code:'my',native_text:'Colour fixture '+i,picture:'🍎',
    colour:{english_text:colour,extra_data:{}},noun:{english_text:'Apple'}
  }));
  let state = JSON.parse(localStorage.getItem(KEY) || 'null') || {
    owner, permitted: true, destination: null, faults: [], requests: [], callbacks: 0,
    levelCalls: 0, ratingCalls: 0, colourReceipts: {}, ratingVersions: {}, ratingReceipts: {}, ratingRequests: [],
    pathRevision:17,pathReset:null,pathVersion:0,pathComplete:false,pathEligible:'2026-11-27T12:00:00.123456+00:00',pathReceipts:{},pathRequests:[],
    tables: {
      kg_chart_quiz_sessions: [], kg_chart_quiz_answers: [],
      kg_chart_sentences: sentences,
      kg_chart_colour_phrases: phrases,
      kg_chart_user_ratings: [],
      kg_chart_user_levels: [{email: 'fixture@example.invalid', language_code: 'my', level: 1, unlocked: 1}],
    },
  };
  const assertFixture = (condition, message) => { if (!condition) throw Error(message); };
  const persist = () => localStorage.setItem(KEY, JSON.stringify(state));
  persist();
  const ratingState=id=>{
    const row=state.tables.kg_chart_user_ratings.find(r=>r.vocabulary_id===id);
    return {version:state.ratingVersions[id]||0,state:row?{
      rating:row.rating,last_reviewed_at:row.last_reviewed_at,updated_at:row.updated_at}:null};
  };
  const changeRating=(id,value,reviewed,updated)=>{
    state.ratingVersions[id]=(state.ratingVersions[id]||0)+1;
    state.tables.kg_chart_user_ratings=state.tables.kg_chart_user_ratings.filter(r=>r.vocabulary_id!==id);
    if(value!==null)state.tables.kg_chart_user_ratings.push({user_id:owner,language_code:'my',
      vocabulary_id:id,rating:value,last_reviewed_at:reviewed,updated_at:updated});
    persist();
    return state.ratingVersions[id];
  };
  let release;
  const api = {
    snapshot: () => copy(state),
    fault: (table, mode) => { state.faults.push({table, mode}); persist(); },
    permit: value => { state.permitted = value; persist(); },
    destination: value => { state.destination = value; persist(); },
    release: () => { release?.(); release = null; },
    callback: () => { state.callbacks++; persist(); },
    rate: () => { state.ratingCalls++; persist(); },
    externalRating: (id,value)=>changeRating(id,value,'2026-11-27T12:00:00Z','2026-11-27T12:00:00Z'),
    resetPath:()=>{state.pathRevision++;state.pathReset='2026-11-27T13:00:00.123457+00:00';state.pathComplete=false;state.pathEligible=null;persist();},
    words, user: {id: owner, email: 'fixture@example.invalid'},
  };
  window.__kgF1 = api;
  window.__fakeClient = {
    auth: {async getSession() { return {data: {session: {user: {id: state.owner}}}, error: null}; }},
    async rpc(name, args) {
      if(name==='kg_chart_my_answers')return {data:[],error:null};
      if(name==='kg_chart_f2_my_completion_path'||name==='kg_chart_f2_complete_topic'){
        state.pathRequests.push({name,args:copy(args)});persist();
        if(args.p_expected_revision!==state.pathRevision)return {error:{code:'40001'}};
        const topic={topic_id:'food',version:state.pathVersion,complete:state.pathComplete,
          completed_at:state.pathComplete?state.pathEligible:null,eligible_at:state.pathEligible};
        if(name==='kg_chart_f2_my_completion_path')return {data:{
          owner_id:owner,language_code:'my',permission_revision:state.pathRevision,reset_at:state.pathReset,
          bypass:false,unlocks:[],rules:{min_attempts:1,quiz_types:['native_to_image']},
          topics:[topic,{topic_id:'next',version:0,complete:false,completed_at:null,eligible_at:null}],
          counts:state.pathEligible?words.map(w=>({vocabulary_id:w.id,quiz_type:'native_to_image',count:1})):[]},error:null};
        if(args.p_reset_at!==state.pathReset)return {error:{code:'40001'}};
        const i=state.faults.findIndex(f=>f.table===name),fault=i<0?null:state.faults.splice(i,1)[0];persist();
        const prior=state.pathReceipts[args.p_event_id];
        if(prior){assertFixture(JSON.stringify(prior.args)===JSON.stringify(args),'Changed completion retry');
          return {data:{...prior.ack,current_version:state.pathVersion,replayed:true},error:null};}
        if(args.p_expected_version!==state.pathVersion)return {error:{code:'40001'}};
        if(state.pathComplete||args.p_evidence_at!==state.pathEligible||!state.pathEligible)return {error:{code:'42501'}};
        assertFixture(args.p_topic_id==='food'&&args.p_language_code==='my','Unexpected path scope');
        if(fault?.mode==='hold')await new Promise(resolve=>{release=resolve;});
        if(fault?.mode==='deny')return {error:{code:'42501'}};
        state.pathComplete=true;state.pathVersion++;
        const ack={event_id:args.p_event_id,owner_id:owner,language_code:'my',topic_id:'food',
          permission_revision:state.pathRevision,reset_at:state.pathReset,completed_at:state.pathEligible,
          event_version:state.pathVersion,current_version:state.pathVersion,replayed:false};
        state.pathReceipts[args.p_event_id]={args:copy(args),ack:copy(ack)};persist();
        return fault?.mode==='lost-ack'?{error:{message:'Synthetic lost completion receipt'}}:{data:ack,error:null};
      }
      if(name==='kg_chart_f2_my_progress_state'||name==='kg_chart_f2_save_progress'){
        const id=args.p_vocabulary_id;
        state.ratingRequests.push({name,args:copy(args)});persist();
        assertFixture(args.p_expected_revision===17&&args.p_language_code==='my'&&
          args.p_topic_id===null&&words.some(w=>w.id===id),'Unexpected rating scope');
        if(!state.permitted)return {error:{code:'42501'}};
        const before=ratingState(id);
        if(name==='kg_chart_f2_my_progress_state'){
          assertFixture(args.p_kind==='rating','Wrong baseline kind');
          return {data:{...before,permission_revision:17},error:null};
        }
        const i=state.faults.findIndex(f=>f.table===name),fault=i<0?null:state.faults.splice(i,1)[0];persist();
        if(fault?.mode==='deny')return {error:{code:'42501'}};
        const prior=state.ratingReceipts[args.p_event_id];
        if(prior){
          if(JSON.stringify(prior.args)!==JSON.stringify(args))return {error:{code:'23505'}};
          return {data:{event_id:args.p_event_id,event_version:prior.version,current_version:before.version,replayed:true},error:null};
        }
        if(args.p_expected_version!==before.version)return {error:{code:'40001'}};
        assertFixture(args.p_completed_at===null&&
          (args.p_operation==='rating_delete'?args.p_rating===null&&args.p_updated_at===null&&args.p_last_reviewed_at===null:
            args.p_operation==='rating_upsert'&&args.p_rating>=1&&args.p_rating<=5),'Unexpected rating operation');
        const version=changeRating(id,args.p_rating,args.p_last_reviewed_at,args.p_updated_at);
        state.ratingReceipts[args.p_event_id]={args:copy(args),version};persist();
        if(fault?.mode==='lost-ack')return {error:{message:'Synthetic lost rating receipt'}};
        return {data:{event_id:args.p_event_id,event_version:version,current_version:version,replayed:false},error:null};
      }
      if (name === 'kg_chart_f2_save_colour_quiz') {
        const s=args.p_session,q=args.p_questions;
        state.requests.push({table:name,args:copy(args)});persist();
        assertFixture(s.user_id===state.owner && args.p_expected_revision===17 &&
          s.total_questions===q.length && s.correct_answers===q.filter(row=>row.phrase_id===row.selected_phrase_id).length,
          'Unexpected colour envelope');
        const i=state.faults.findIndex(f=>f.table===name);
        const fault=i<0?null:state.faults.splice(i,1)[0];persist();
        if(fault?.mode==='deny')return {error:{code:'42501'}};
        if(fault?.mode==='fail')return {error:{message:'Synthetic colour failure'}};
        if(state.colourReceipts[s.id])assertFixture(JSON.stringify(state.colourReceipts[s.id])===JSON.stringify(args),'Changed evidence on retry');
        else {state.colourReceipts[s.id]=copy(args);state.tables.kg_chart_quiz_sessions.push(copy(s));persist();}
        if(fault?.mode==='lost-ack')return {error:{message:'Synthetic lost colour receipt'}};
        return {data:{session_id:s.id,question_count:q.length,correct_answers:s.correct_answers,
          expected_revision:17,time_spent_seconds:s.time_spent_seconds},error:null};
      }
      if (name === 'kg_chart_f2_save_timed_quiz') {
        const session = args.p_session, answers = args.p_answers;
        state.requests.push({table:name,args:copy(args)}); persist();
        assertFixture(session.user_id === state.owner && args.p_expected_revision === 17 &&
          session.total_questions === answers.length && answers.every(a=>a.session_id===session.id), 'Unexpected timed payload');
        const i=state.faults.findIndex(f=>f.table===name);
        const fault=i<0?null:state.faults.splice(i,1)[0];persist();
        if(fault?.mode==='deny') return {error:{code:'42501'}};
        if(fault?.mode==='fail') return {error:{message:'synthetic failure'}};
        if(!state.tables.kg_chart_quiz_sessions.some(row=>row.id===session.id)) {
          state.tables.kg_chart_quiz_sessions.push(copy(session));state.tables.kg_chart_quiz_answers.push(...copy(answers));persist();
        }
        if(fault?.mode==='lost-ack') return {error:{message:'synthetic timed reply lost'}};
        return {data:{session_id:session.id,answer_count:answers.length,expected_revision:17,time_spent_seconds:session.time_spent_seconds},error:null};
      }
      if (name === 'kg_chart_f2_save_recovery_quiz') {
        const d = args.p_draft;
        state.requests.push({table: name, args: copy(args)}); persist();
        assertFixture(d.sealed && args.p_expected_revision === 17 && d.ownerId === state.owner &&
          !Object.hasOwn(d, 'saveContext'), 'Unexpected restricted wire envelope');
        const faultIndex = state.faults.findIndex(fault => fault.table === name);
        const fault = faultIndex >= 0 ? state.faults.splice(faultIndex, 1)[0] : null;
        persist();
        if (fault?.mode === 'deny') return {data: null, error: {code:'42501'}};
        if (fault?.mode === 'fail') return {data: null, error: {message:'Synthetic connection failure'}};
        if (!state.tables.kg_chart_quiz_sessions.some(row => row.id === d.id)) {
          state.tables.kg_chart_quiz_sessions.push(copy(d.session));
          state.tables.kg_chart_quiz_answers.push(...copy(d.answers)); persist();
        }
        if (fault?.mode === 'lost-ack') return {data: null, error: {message:'Synthetic atomic reply lost'}};
        return {data:{session_id:d.id, answer_count:d.answers.length, expected_revision:17}, error:null};
      }
      if (name !== 'kg_chart_check_level_up') throw Error('Unexpected fixture RPC: ' + name);
      state.levelCalls++; persist();
      return {data: 1, error: null};
    },
    from(table) {
      if (!Object.hasOwn(state.tables, table)) throw Error('Unexpected fixture table: ' + table);
      const q = {op: 'read', filters: [], rows: [], limit: Infinity, one: false};
      let pending;
      const chain = {
        select() { return chain; },
        insert(rows) { q.op = 'insert'; q.rows = copy(Array.isArray(rows) ? rows : [rows]); return chain; },
        eq(key, value) { q.filters.push([key, value]); return chain; },
        in(key, value) { q.filters.push([key, value]); return chain; },
        order() { return chain; },
        limit(value) { q.limit = value; return chain; },
        maybeSingle() { q.one = true; return execute(); },
        single() { q.one = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      function execute() {
        return pending ||= (async () => {
          if (q.op === 'read') {
            const rows = state.tables[table].filter(row => q.filters.every(([key, value]) =>
              Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(0, q.limit);
            return {data: copy(q.one ? rows[0] ?? null : rows), error: null};
          }
          state.requests.push({table, rows: copy(q.rows)}); persist();
          const faultIndex = state.faults.findIndex(fault => fault.table === table);
          const fault = faultIndex >= 0 ? state.faults.splice(faultIndex, 1)[0] : null;
          persist();
          if (fault?.mode === 'hold') await new Promise(resolve => { release = resolve; });
          if (fault?.mode === 'deny') { state.permitted = false; persist(); }
          if (!state.permitted) return {data: null, error: {code: '42501', message: 'Synthetic RLS denial'}};
          if (fault?.mode === 'fail') return {data: null, error: {message: 'Synthetic connection failure'}};
          if (q.rows.some(row => table === 'kg_chart_quiz_sessions' ? row.user_id !== state.owner :
            !state.tables.kg_chart_quiz_sessions.some(session => session.id === row.session_id && session.user_id === state.owner))) {
            return {data: null, error: {code: '42501', message: 'Synthetic owner mismatch'}};
          }
          if (q.rows.some(row => state.tables[table].some(saved => saved.id === row.id))) {
            return {data: null, error: {code: '23505', message: 'Synthetic duplicate key'}};
          }
          state.tables[table].push(...copy(q.rows)); persist();
          if (fault?.mode === 'lost-ack') return {data: null, error: {message: 'Synthetic reply lost after commit'}};
          return {data: copy(q.one ? q.rows[0] : q.rows), error: null,
            ...(state.destination ? {saveDestination: state.destination} : {})};
        })();
      }
      return chain;
    },
  };
  window.KGAudio = {
    subscribe: () => () => {}, getVersion: () => 0, stop() {}, play() { return false; },
    autoPlay() {}, has: () => false, stateOf: () => '', toast() {},
    canUsePublicMedia: () => true, requireVerifiedMediaPolicy() {},
    prefs: {voice: 'm', muted: true},
  };
}

const harness = `
    const fixtureUser = window.__kgF1.user;
    const fixtureWords = window.__kgF1.words;
    const fixtureRules = { ...resolveRules(null), loaded: true };
    const fixturePrivate = { topics: new Set(), groups: new Set(), loaded: true };
    const fixtureSentenceAccess = window.KGSentenceAccess.parseGroupSnapshot(null, { state: 'legacy' }, 'my');
    function RatingFixture({policy,cards}){
      const rating=useUserRatings('my',policy), id=fixtureWords[0].id;
      const topics=[{id:'food',icon:'🍎',translation:{title_native:'Food'}}];
      return <>
        <RatingRecoveryPanel flow={rating.ratingFlow} vocabulary={fixtureWords}/>
        <div data-fixture-rating={rating.ratings[id]?.rating??'none'} data-ratings-loaded={rating.ratingsLoaded?'yes':'no'}/>
        {cards?<FlashcardView topics={topics} vocabulary={fixtureWords} ratings={rating.ratings}
          ratingsLoaded={rating.ratingsLoaded} onRate={rating.updateRating} onClearRating={rating.clearRating}
          languageCode="my" user={fixtureUser} restrictedRatings/>:
          <div>
            <button disabled={!rating.ratingsLoaded} onClick={()=>rating.updateRating(id,4)}>Rate fixture word</button>
            <button disabled={!rating.ratingsLoaded} onClick={()=>rating.clearRating(id)}>Clear fixture rating</button>
          </div>}
      </>;
    }
    function PathFixture({policy}){
      const topics=[{id:'food',icon:'🍎',translation:{title_native:'Food'}},{id:'next',icon:'🌱',translation:{title_native:'Next topic'}}];
      const vocab=[...fixtureWords,{...fixtureWords[0],id:'55000000-0000-4000-8000-000000000001',topic_id:'next'}];
      const path=useLearningPath({user:fixtureUser,languageCode:'my',topics,vocabulary:vocab,rules:fixtureRules,policy});
      return <>
        <CompletionRecoveryPanel flow={path.completionFlow} topics={topics}/>
        <div data-path-ready={path.loading?'no':'yes'} data-food-complete={path.status.food?.complete?'yes':'no'}
          data-next-unlocked={path.status.next?.unlocked?'yes':'no'} data-celebrated={path.celebration?'yes':'no'}/>
      </>;
    }
    function QuizFixture() {
      const [shown, setShown] = useState(true);
      const kind = new URLSearchParams(location.search).get('kind') || 'word';
      const restricted = new URLSearchParams(location.search).get('restricted') === 'yes';
      const scope = restricted ? {ownerId:fixtureUser.id, policy:{state:'restricted', revision:kind==='path'?window.__kgF1.snapshot().pathRevision:17}} : null;
      return <AuthContext.Provider value={{ user: fixtureUser }}>
        <KGMediaScopeContext.Provider value={scope}>
        <RulesContext.Provider value={fixtureRules}>
          <PrivateLessonsContext.Provider value={fixturePrivate}>
            <div aria-label="Fixture navigation">
              <button onClick={() => setShown(false)}>Leave quiz view</button>
              <button onClick={() => setShown(true)}>Reopen quiz view</button>
            </div>
            {shown ? kind === 'word'
              ? <WordQuizView topics={[{ id: 'food', icon: '🍎', translation: { title_native: 'Food' } }]}
                  vocabulary={fixtureWords} poolVocabulary={fixtureWords} ratings={{}}
                  onRate={window.__kgF1.rate} languageCode="my" user={fixtureUser}
                  onSessionSaved={window.__kgF1.callback} meaningName="English" />
              : kind === 'typing' ? <TypingView topics={[{id:'food',translation:{title_native:'Food'}}]}
                  vocabulary={fixtureWords} languageCode="my" user={fixtureUser} meaningName="English" accessPolicy={scope?.policy} />
              : kind === 'speaking' ? <SpeakView languageCode="my" user={fixtureUser} meaningName="English"
                  sentenceAccess={fixtureSentenceAccess} />
              : kind === 'colour' ? <ColourQuizView languageCode="my" user={fixtureUser} />
              : kind === 'ratings' || kind === 'rating-cards' ? <RatingFixture policy={scope?.policy} cards={kind==='rating-cards'}/>
              : kind === 'path' ? <PathFixture policy={scope?.policy}/>
              : <SentenceQuizView languageCode="my" user={fixtureUser} meaningName="English"
                  sentenceAccess={fixtureSentenceAccess} onSessionSaved={window.__kgF1.callback} />
              : <p>Outside quiz</p>}
          </PrivateLessonsContext.Provider>
        </RulesContext.Provider>
        </KGMediaScopeContext.Provider>
      </AuthContext.Provider>;
    }
    ReactDOM.createRoot(document.getElementById('root')).render(<QuizFixture />);
`;
const {code} = await transform(script.replace(clientSource, 'const supabase = window.__fakeClient;')
  .replace(mountSource, harness), {loader: 'jsx', target: 'es2022', format: 'iife'});
const assets = new Map([
  ['/react.js', await readFile('node_modules/react/umd/react.development.js')],
  ['/react-dom.js', await readFile('node_modules/react-dom/umd/react-dom.development.js')],
  ['/fixture.js', `(${installFakeClient.toString()})();`],
  ['/app.js', code],
]);
for (const filename of ['kg-shared.js', 'kg-learner-access.js', 'kg-sentence-access.js', 'kg-quiz-save.js']) {
  assets.set('/' + filename, await readFile('js/' + filename));
}
const html = '<!doctype html><html><head><meta charset="UTF-8"><title>Isolated F1 UI fixture</title>' +
  '<style>button{margin:4px;padding:8px}img{max-width:64px;max-height:64px}body{font-family:sans-serif}</style></head><body><div id="root"></div>' +
  [...assets.keys()].filter(path => path !== '/app.js').map(path => `<script src="${path}"></script>`).join('') +
  '<script src="/app.js"></script></body></html>';
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const content = path === '/' ? html : assets.get(path);
  if (content === undefined) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type': path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-store'});
  res.end(content);
});

if (process.env.CI) {
  assert.deepEqual((await readdir('/sys/class/net')).sort(), ['lo'], 'CI browser fixture requires Docker --network none');
}
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let passed = 0;
const sessions = 'kg_chart_quiz_sessions', answers = 'kg_chart_quiz_answers';
async function scenario(name, kind, run, restricted = false) {
  const context = await browser.newContext({serviceWorkers: 'block'});
  // Route applies to the whole disposable context. Only this local server may
  // receive requests; canonical converter startup requests are aborted.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${origin}/?kind=${kind}${restricted ? '&restricted=yes' : ''}`, {waitUntil: 'load'});
    if (kind==='typing') await page.getByRole('button', {name:'Start',exact:true}).waitFor();
    else if (kind==='speaking') await page.getByRole('button', {name:/Whole paragraph/}).waitFor();
    else if(kind==='ratings'||kind==='rating-cards')await page.locator('[data-ratings-loaded="yes"]').waitFor({state:'attached'});
    else if(kind==='path')await page.locator('[data-path-ready="yes"]').waitFor({state:'attached'});
    else await page.getByRole('button', {name: /^Start Quiz/}).waitFor();
    await run(page);
    assert.deepEqual(errors, [], 'No uncaught errors in rendered canonical quiz');
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    console.error((await page.locator('body').innerText()).slice(0, 2200));
    throw error;
  } finally { await context.close(); }
}
const snapshot = page => page.evaluate(() => window.__kgF1.snapshot());
async function complete(page, kind, afterAnswer) {
  await page.getByRole('button', {name: /^Start Quiz/}).click();
  for (let index = 0; index < 4; index++) {
    const choice = kind === 'word' ? page.locator('button').filter({has: page.locator('img')}).first()
      : page.getByRole('button', {name: /Meaning [0-3]/}).first();
    await choice.click();
    await afterAnswer?.(page, index);
    await page.getByRole('button', {name: index === 3 ? /^See Results/ : kind === 'word' ? /^Next Question/ : /^Next →/}).click();
  }
  await page.getByText(kind === 'word' ? 'Quiz Completed!' : 'Sentence Quiz Completed!', {exact: true}).waitFor();
}
async function unsaved(page, blocked = false) {
  await page.getByRole('alert').filter({hasText: blocked ? 'Saving is blocked' : 'Not saved yet'}).waitFor();
  assert.equal(await page.getByText('✓ Results saved', {exact: true}).count(), 0);
  const db = await snapshot(page);
  assert.equal(db.callbacks, 0, 'No saved-session progress callback before required writes');
  assert.equal(db.levelCalls, 0, 'No level RPC before required writes');
  assert.equal(db.ratingCalls, 0, 'No automatic rating before required writes');
  return db;
}
async function saved(page, kind, queued = false) {
  await page.getByText(queued ? '✓ Saved on this device. Check Settings for sync status.' : '✓ Results saved', {exact: true}).waitFor();
  await page.waitForFunction(() => window.__kgF1.snapshot().callbacks === 1);
  if (kind === 'word') await page.waitForFunction(() => window.__kgF1.snapshot().levelCalls === 1);
  const db = await snapshot(page);
  assert.equal(db.tables[sessions].length, 1);
  assert.equal(db.tables[answers].length, 4);
  assert.equal(new Set(db.tables[answers].map(row => row.id)).size, 4);
  assert.ok(db.tables[answers].every(row => row.session_id === db.tables[sessions][0].id));
  assert.equal(db.callbacks, 1);
  assert.equal(db.levelCalls, kind === 'word' ? 1 : 0);
  const recovery = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('kg-chart-quiz-recovery-v1:')));
  assert.equal(recovery.length, 0);
  if (queued) assert.equal(await page.getByText('✓ Results saved', {exact: true}).count(), 0);
  return db;
}

try {
  browser = await chromium.launch({headless: true,
    ...(process.env.KG_CHROMIUM_EXECUTABLE ? {executablePath: process.env.KG_CHROMIUM_EXECUTABLE} : {}),
    args: ['--no-sandbox']});
  for (const kind of ['word', 'sentence']) {
    await scenario(`${kind}: failed session, visible unsaved state, repeated retry clicks`, kind, async page => {
      await page.evaluate(table => window.__kgF1.fault(table, 'fail'), sessions);
      await complete(page, kind);
      const db = await unsaved(page);
      assert.equal(db.tables[sessions].length, 0);
      assert.equal(db.tables[answers].length, 0);
      await page.getByRole('button', {name: 'Retry save', exact: true}).evaluate(button => { button.click(); button.click(); });
      await saved(page, kind);
    });
    await scenario(`${kind}: failed answers survive full page reload and explicit retry`, kind, async page => {
      await page.evaluate(table => window.__kgF1.fault(table, 'fail'), answers);
      await complete(page, kind);
      const db = await unsaved(page);
      assert.equal(db.tables[sessions].length, 1);
      assert.equal(db.tables[answers].length, 0);
      const id = db.tables[sessions][0].id;
      await page.reload({waitUntil: 'load'});
      await page.getByRole('region', {name: 'Quiz save recovery'}).waitFor();
      await unsaved(page);
      await page.getByRole('button', {name: 'Retry save', exact: true}).click();
      assert.equal((await saved(page, kind)).tables[sessions][0].id, id);
    });
    await scenario(`${kind}: committed answers with lost response recover without duplicate rows`, kind, async page => {
      await page.evaluate(table => window.__kgF1.fault(table, 'lost-ack'), answers);
      await complete(page, kind);
      const db = await unsaved(page);
      assert.equal(db.tables[sessions].length, 1);
      assert.equal(db.tables[answers].length, 4);
      const ids = db.tables[answers].map(row => row.id).sort();
      await page.getByRole('button', {name: 'Retry save', exact: true}).click();
      assert.deepEqual((await saved(page, kind)).tables[answers].map(row => row.id).sort(), ids);
    });
    await scenario(`${kind}: permission denial is retained and replay requires regrant`, kind, async page => {
      await page.evaluate(table => window.__kgF1.fault(table, 'deny'), answers);
      await complete(page, kind);
      const first = await unsaved(page, true);
      assert.equal(first.tables[sessions].length, 1);
      assert.equal(first.tables[answers].length, 0);
      await page.getByRole('button', {name: 'Retry save', exact: true}).click();
      await unsaved(page, true);
      assert.equal((await snapshot(page)).tables[answers].length, 0);
      await page.evaluate(() => window.__kgF1.permit(true));
      await page.getByRole('button', {name: 'Retry save', exact: true}).click();
      await saved(page, kind);
    });
    await scenario(`${kind}: durable device receipt uses honest queued wording`, kind, async page => {
      await page.evaluate(() => window.__kgF1.destination('device'));
      await complete(page, kind);
      await saved(page, kind, true);
    });
  }
  await scenario('word: committed session with lost acknowledgment reuses the same session', 'word', async page => {
    await page.evaluate(table => window.__kgF1.fault(table, 'lost-ack'), sessions);
    await complete(page, 'word');
    const first = await unsaved(page);
    assert.equal(first.tables[sessions].length, 1);
    assert.equal(first.tables[answers].length, 0);
    assert.equal(first.requests.filter(request => request.table === sessions).length, 1, 'A network failure is not a schema fallback');
    await page.getByRole('button', {name: 'Retry save', exact: true}).click();
    assert.equal((await saved(page, 'word')).tables[sessions][0].id, first.tables[sessions][0].id);
  });
  await scenario('word: leaving and reopening during saving receives completion without stale recovery UI', 'word', async page => {
    await page.evaluate(table => window.__kgF1.fault(table, 'hold'), answers);
    await complete(page, 'word');
    await page.getByRole('status').filter({hasText: 'Saving…'}).waitFor();
    await page.getByRole('button', {name: 'Leave quiz view', exact: true}).click();
    await page.getByText('Outside quiz', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Reopen quiz view', exact: true}).click();
    await page.getByRole('region', {name: 'Quiz save recovery'}).waitFor();
    await page.evaluate(() => window.__kgF1.release());
    await page.getByRole('region', {name: 'Quiz save recovery'}).waitFor({state: 'detached'});
    assert.equal(await page.getByText('Saving…', {exact: true}).count(), 0);
    const db = await snapshot(page);
    assert.equal(db.tables[sessions].length, 1);
    assert.equal(db.tables[answers].length, 4);
  });
  await scenario('word: recovery-storage failure is visible during the quiz and saves after storage recovers', 'word', async page => {
    await page.evaluate(() => {
      window.__kgOriginalStorageSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (String(key).startsWith('kg-chart-quiz-recovery-v1:')) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
        return window.__kgOriginalStorageSet.call(this, key, value);
      };
    });
    await complete(page, 'word', async (current, index) => {
      if (index !== 0) return;
      await current.getByRole('alert').filter({hasText: 'A recovery copy could not be saved'}).waitFor();
      assert.equal(await current.getByRole('button', {name: 'Download answers', exact: true}).count(), 1);
      const db = await snapshot(current);
      assert.equal(db.tables[sessions].length, 0);
      assert.equal(db.tables[answers].length, 0);
      assert.equal(db.callbacks, 0);
    });
    await page.getByRole('alert').filter({hasText: 'A recovery copy could not be saved'}).waitFor();
    const db = await snapshot(page);
    assert.equal(db.requests.length, 0, 'No remote INSERT before the entire draft is durable');
    assert.equal(db.callbacks, 0);
    assert.equal(db.levelCalls, 0);
    await page.evaluate(() => { Storage.prototype.setItem = window.__kgOriginalStorageSet; });
    await page.getByRole('button', {name: 'Retry save', exact: true}).click();
    await saved(page, 'word');
  });
  for (const kind of ['word', 'sentence']) {
    await scenario('F2E1a ' + kind + ': actual quiz uses atomic RPC and recovers a lost reply after reload', kind, async page => {
      const rpc = 'kg_chart_f2_save_recovery_quiz';
      await page.evaluate(name => window.__kgF1.fault(name, 'lost-ack'), rpc);
      await complete(page, kind);
      const pending = await unsaved(page);
      assert.equal(pending.requests.length, 1);
      assert.equal(pending.requests[0].table, rpc);
      assert.equal(pending.tables[sessions].length, 1);
      assert.equal(pending.tables[answers].length, 4);
      await page.reload({waitUntil:'load'});
      await page.getByRole('button', {name: /Retry save/}).first().click();
      await page.getByText('✓ Results saved', {exact:true}).waitFor();
      const db = await snapshot(page);
      assert.equal(db.requests.length, 2);
      assert.deepEqual(db.requests[0], db.requests[1]);
      assert.equal(db.tables[sessions].length, 1);
      assert.equal(db.tables[answers].length, 4);
      assert.equal(db.callbacks, 0, 'Restricted progress consumers remain deferred to F2E2');
      assert.equal(db.ratingCalls, 0);
      assert.equal(db.levelCalls, 0);
      assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('kg-chart-quiz-recovery-v1:')).length), 0);
    }, true);
  }
  await scenario('F2E1b actual typing copy: corrected mistake is completed, original timed draft retries after reload', 'typing', async page => {
    const rpc='kg_chart_f2_save_timed_quiz';
    await page.evaluate(name=>window.__kgF1.fault(name,'lost-ack'),rpc);
    await page.getByRole('button',{name:'Start',exact:true}).click();
    const target=await page.locator('[aria-label^="Native "]').getAttribute('aria-label');
    await page.getByRole('textbox',{name:'Type here'}).fill('wrong');
    await page.getByRole('textbox',{name:'Type here'}).fill(target);
    await page.getByRole('button',{name:'← Back',exact:true}).click();
    await unsaved(page);
    let db=await snapshot(page);
    assert.equal(db.requests.length,1);
    const first=db.requests[0];
    assert.equal(first.table,rpc);
    assert.equal(first.args.p_session.correct_answers,1);
    assert.equal(first.args.p_answers[0].is_correct,false);
    assert.equal(first.args.p_answers[0].answer_text,'wrong');
    await page.reload({waitUntil:'load'});
    await page.getByRole('region',{name:'Quiz save recovery'}).getByRole('button',{name:'Retry save',exact:true}).click();
    await page.getByText('✓ Results saved',{exact:true}).waitFor();
    db=await snapshot(page);
    assert.deepEqual(db.requests[0],db.requests[1]);
    assert.equal(db.tables[sessions].length,1);
    assert.equal(db.tables[answers].length,1);
  },true);
  await scenario('F2E1b actual speaking paragraph: denied receipt retained; retry preserves duration and evidence', 'speaking', async page => {
    const rpc='kg_chart_f2_save_timed_quiz';
    await page.evaluate(name=>window.__kgF1.fault(name,'deny'),rpc);
    await page.getByRole('button',{name:/Whole paragraph/}).click();
    await page.getByTitle('Peek at this line').first().click();
    await page.getByRole('button',{name:/Reveal all and check/}).click();
    await page.getByRole('button',{name:/I said it all/}).click();
    await unsaved(page,true);
    let db=await snapshot(page);
    assert.equal(db.requests.length,1);
    assert.equal(db.requests[0].args.p_session.correct_answers,3);
    assert.equal(db.requests[0].args.p_session.total_questions,4);
    assert.equal(db.tables[sessions].length,0);
    await page.getByRole('button',{name:'Retry save',exact:true}).click();
    await page.getByText('✓ Results saved',{exact:true}).waitFor();
    db=await snapshot(page);
    assert.deepEqual(db.requests[0],db.requests[1]);
    assert.equal(db.tables[answers].length,4);
  },true);
  for(const [mode,label] of [['phrase_to_picture','Phrase → Picture'],['listen_to_picture','Listen → Picture'],['picture_to_phrase','Picture → Phrase']]) {
    await scenario('F2E1c actual '+mode+': ordered visible options survive lost acknowledgement and reload', 'colour', async page => {
      const rpc='kg_chart_f2_save_colour_quiz';
      await page.evaluate(name=>window.__kgF1.fault(name,'lost-ack'),rpc);
      await page.getByRole('button',{name:new RegExp(label)}).click();
      await page.getByRole('button',{name:/^Start Quiz/}).click();
      const evidence=[];
      for(let i=0;i<4;i++){
        const target=await page.locator('[data-colour-target]').getAttribute('data-colour-target');
        const opts=await page.locator('[data-colour-option]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-colour-option')));
        const selected=opts[i%opts.length];
        evidence.push({phrase_id:target,selected_phrase_id:selected,option_ids:opts});
        await page.locator('[data-colour-option]').nth(i%opts.length).click();
        await page.getByRole('button',{name:i===3?/See Results/:/Next →/}).click();
      }
      await unsaved(page);
      let db=await snapshot(page);
      assert.equal(db.requests.length,1);
      const original=db.requests[0];
      assert.equal(original.table,rpc);
      assert.equal(original.args.p_mode,mode);
      assert.deepEqual(original.args.p_questions.map(({answered_at,...q})=>q),evidence);
      assert.equal(original.args.p_session.correct_answers,evidence.filter(q=>q.phrase_id===q.selected_phrase_id).length);
      assert.equal(db.tables[answers].length,0);
      await page.reload({waitUntil:'load'});
      await page.getByRole('region',{name:'Quiz save recovery'}).getByRole('button',{name:'Retry save',exact:true}).click();
      await page.getByText('✓ Results saved',{exact:true}).waitFor();
      db=await snapshot(page);
      assert.deepEqual(db.requests[0],db.requests[1]);
      assert.equal(db.tables[sessions].length,1);
      assert.equal(db.tables[answers].length,0);
      assert.equal(Object.keys(db.colourReceipts).length,1);
    },true);
  }
  await scenario('F2E1c actual colour: partial evidence is recoverable after leaving, without invented questions', 'colour', async page => {
    await page.getByRole('button',{name:/^Start Quiz/}).click();
    const target=await page.locator('[data-colour-target]').getAttribute('data-colour-target');
    await page.locator('[data-colour-option]').first().click();
    await page.getByRole('button',{name:'← Back',exact:true}).click();
    await page.getByRole('region',{name:'Quiz save recovery'}).waitFor();
    await page.reload({waitUntil:'load'});
    await page.getByRole('region',{name:'Quiz save recovery'}).getByRole('button',{name:'Retry save',exact:true}).click();
    await page.getByText('✓ Results saved',{exact:true}).waitFor();
    const db=await snapshot(page);
    assert.equal(db.requests.length,1);
    assert.equal(db.requests[0].args.p_questions.length,1);
    assert.equal(db.requests[0].args.p_questions[0].phrase_id,target);
    assert.equal(db.tables[answers].length,0);
  },true);
  const ratingWrites=db=>db.ratingRequests.filter(r=>r.name==='kg_chart_f2_save_progress');
  const ratingRegion=page=>page.getByRole('region',{name:'Rating recovery'});
  const dialog=page=>page.getByRole('dialog',{name:'Confirm rating change'});
  await scenario('F2E2a actual rating hook: baseline conflict is retained, reviewed and archived explicitly', 'ratings', async page=>{
    await page.getByRole('button',{name:'Rate fixture word'}).click();
    await dialog(page).getByText(/Current server rating: Not rated · version 0/).waitFor();
    assert.equal(ratingWrites(await snapshot(page)).length,0,'No mutation before confirmation');
    await page.evaluate(()=>window.__kgF1.externalRating(window.__kgF1.words[0].id,2));
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await ratingRegion(page).getByText(/original rating or permission version conflicts/i).waitFor();
    assert.equal(ratingWrites(await snapshot(page))[0].args.p_expected_version,0);
    await ratingRegion(page).getByRole('button',{name:'Review current rating'}).click();
    await ratingRegion(page).getByText(/Current server rating: Can't use in conversation · version 1/).waitFor();
    await ratingRegion(page).getByRole('button',{name:'Keep server rating and archive change'}).click();
    await ratingRegion(page).getByText(/Original change archived/).waitFor();
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('kg-chart-rating-archive-v1:')).length),1);
    await page.getByRole('button',{name:'Rate fixture word'}).click();
    await dialog(page).getByText(/version 1/).waitFor();
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await ratingRegion(page).getByText('Rating confirmed.',{exact:true}).waitFor();
    const db=await snapshot(page),writes=ratingWrites(db);
    assert.equal(writes.length,2);
    assert.equal(writes[1].args.p_expected_version,1);
    assert.notEqual(writes[0].args.p_event_id,writes[1].args.p_event_id);
    assert.equal(db.tables.kg_chart_user_ratings[0].rating,4);
    assert.equal(db.requests.length,0,'No raw rating mutation');
  },true);
  await scenario('F2E2a actual rating hook: lost response, reload and historical acknowledgement never restore old state', 'ratings', async page=>{
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_save_progress','lost-ack'));
    await page.getByRole('button',{name:'Rate fixture word'}).click();
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await ratingRegion(page).getByText(/rating server did not confirm/i).waitFor();
    await page.evaluate(()=>window.__kgF1.externalRating(window.__kgF1.words[0].id,1));
    await page.reload({waitUntil:'load'});
    await ratingRegion(page).getByRole('button',{name:'Retry original rating'}).click();
    await ratingRegion(page).getByText(/newer server rating is shown/).waitFor();
    const db=await snapshot(page),writes=ratingWrites(db);
    assert.deepEqual(writes[0],writes[1]);
    assert.equal(db.tables.kg_chart_user_ratings[0].rating,1);
    assert.equal(await page.locator('[data-fixture-rating]').getAttribute('data-fixture-rating'),'1');
    assert.equal(Object.keys(db.ratingReceipts).length,1);
  },true);
  await scenario('F2E2a actual Cards: no optimistic sort, confirmed rating and versioned Undo deletion', 'rating-cards', async page=>{
    await page.locator('.flip-card').first().waitFor();
    await page.keyboard.press('Space');await page.keyboard.press('5');
    await dialog(page).getByText(/version 0/).waitFor();
    assert.equal(await page.getByRole('button',{name:/To sort \(4\)/}).count(),1);
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await page.getByRole('button',{name:/To sort \(3\)/}).waitFor();
    await page.getByRole('button',{name:/Undo/}).click();
    await dialog(page).getByText(/version 1/).waitFor();
    await dialog(page).getByText('New rating: Not rated',{exact:true}).waitFor();
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await page.getByRole('button',{name:/To sort \(4\)/}).waitFor();
    const db=await snapshot(page),writes=ratingWrites(db);
    assert.equal(writes.length,2);assert.equal(writes[1].args.p_operation,'rating_delete');
    assert.equal(writes[1].args.p_expected_version,1);
    assert.equal(db.tables.kg_chart_user_ratings.length,0);
    assert.equal(db.ratingVersions[writes[1].args.p_vocabulary_id],2);
  },true);
  await scenario('F2E2b actual path: no local completion, unlock or celebration until server readback', 'path', async page=>{
    const region=page.getByRole('region',{name:'Topic completion recovery'});
    const state=page.locator('[data-path-ready]');
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_complete_topic','hold'));
    await region.getByRole('button',{name:'Confirm completion',exact:true}).click();
    await page.waitForFunction(()=>window.__kgF1.snapshot().pathRequests.some(r=>r.name==='kg_chart_f2_complete_topic'));
    assert.equal(await state.getAttribute('data-food-complete'),'no');
    assert.equal(await state.getAttribute('data-next-unlocked'),'no');
    assert.equal(await state.getAttribute('data-celebrated'),'no');
    await page.evaluate(()=>window.__kgF1.release());
    await region.getByText('Topic completion confirmed by the server.',{exact:true}).waitFor();
    await page.locator('[data-food-complete="yes"][data-next-unlocked="yes"][data-celebrated="yes"]').waitFor({state:'attached'});
    assert.equal((await snapshot(page)).pathVersion,1);
  },true);
  await scenario('F2E2b actual path: lost response then reset keeps pending original without automatic rebasing', 'path', async page=>{
    const region=page.getByRole('region',{name:'Topic completion recovery'});
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_complete_topic','lost-ack'));
    await region.getByRole('button',{name:'Confirm completion',exact:true}).click();
    await region.getByText(/original completion pending/).waitFor();
    await region.getByText(/server did not confirm completion/i).waitFor();
    await page.evaluate(()=>window.__kgF1.resetPath());
    await page.reload({waitUntil:'load'});
    await page.locator('[data-path-ready="yes"][data-food-complete="no"][data-next-unlocked="no"]').waitFor({state:'attached'});
    await region.getByRole('button',{name:'Retry original completion'}).click();
    await region.getByText(/permission revision changed/i).waitFor();
    const db=await snapshot(page);
    assert.equal(db.pathRequests.filter(r=>r.name==='kg_chart_f2_complete_topic').length,1);
    await region.getByRole('button',{name:'Review current progress'}).click();
    await region.getByRole('button',{name:'Archive obsolete completion'}).click();
    await region.getByText(/Obsolete request archived/).waitFor();
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('kg-chart-completion-archive-v1:')).length),1);
    assert.equal(await region.getByRole('button',{name:'Confirm completion',exact:true}).count(),0);
  },true);
  console.log(`U4B2B3D_RENDERED_QUIZ_UI_PASS: ${passed} scenarios; isolated fictional clients; physical devices not tested`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
