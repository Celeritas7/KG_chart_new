// Render the actual learner quiz components against fictional persistent data.
// No hosted API, credentials, service worker, installed PWA or real account is used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {transform} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

// Optional read-only baseline source supports proving a regression against
// a reviewed Git version without modifying the shared working index.html.
const source = await readFile(process.env.KG_UI_SOURCE || 'index.html', 'utf8');
const script = source.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'Canonical JSX must be found');
const clientSource = 'const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);';
const mountSource = "ReactDOM.createRoot(document.getElementById('root')).render(<App />);";
assert.equal(script.split(clientSource).length, 2, 'Replace only the real client boundary');
assert.equal(script.split(mountSource).length, 2, 'Replace only the final application mount');
const tailwindConfig = source.match(/<script>\s*(tailwind\.config\s*=[\s\S]*?)<\/script>/)?.[1];
assert.ok(tailwindConfig, 'Canonical Tailwind configuration must be found');
const tailwind = {};
runInNewContext(tailwindConfig, {tailwind});
const compiledStyles = await postcss([tailwindcss({...tailwind.config,
  content: [{raw: source, extension: 'html'}],
})]).process('@tailwind base; @tailwind components; @tailwind utilities;', {from: undefined});
// Include the real layout and animation rules as well as real generated
// utilities. Unstyled dialogs do not reproduce their pointer obstruction.
const canonicalStyles = compiledStyles.css + [...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)]
  .map(match => match[1]).join('\n');

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
    reads: [], levelRequests: [], levelScopes: {}, levelRevisions: {[owner]:17}, mcqReceipts: {},
    pathRevision:17,pathReset:null,pathVersion:0,pathComplete:false,pathCompletedAt:null,
    pathEligible:'2026-11-27T12:00:00.123456+00:00',pathReceipts:{},pathRequests:[],
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
  const mcqTypes = ['native_to_image','image_to_native','devanagari_to_image',
    'english_to_native','listen_to_image','listen_to_native'];
  const levelKey = (ownerId,languageCode) => ownerId+'|'+languageCode;
  const currentLevel = (ownerId,languageCode) => state.levelScopes[levelKey(ownerId,languageCode)] ||
    {level:1,unlocked:1,version:0,adminCutoff:null};
  const levelJson = value => ({level:value.level,unlocked:value.unlocked,version:value.version});
  const writeLevel = (patch,{ownerId=state.owner,languageCode='my',revision}={}) => {
    const key=levelKey(ownerId,languageCode);
    state.levelScopes[key]={...currentLevel(ownerId,languageCode),...copy(patch)};
    if(revision!==undefined)state.levelRevisions[ownerId]=revision;
    persist();return copy(state.levelScopes[key]);
  };
  const mcqReceipt = (session,answers,confirmedAt=new Date().toISOString()) => ({
    ownerId:session.user_id,languageCode:session.language_code,difficulty:session.difficulty,
    answerIds:answers.map(answer=>answer.id).sort(),confirmedAt,
  });
  const evaluateLevel = (ownerId,languageCode,level) => {
    let total=0,correct=0;
    if(level.unlocked<4)for(const session of [...state.tables.kg_chart_quiz_sessions]
      .sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))){
      const receipt=state.mcqReceipts[session.id];
      const answers=state.tables.kg_chart_quiz_answers.filter(answer=>answer.session_id===session.id);
      if(!receipt||session.user_id!==ownerId||session.language_code!==languageCode||
        receipt.ownerId!==ownerId||receipt.languageCode!==languageCode||
        receipt.difficulty!==session.difficulty||session.difficulty!==level.unlocked||
        !mcqTypes.includes(session.quiz_type)||!session.completed_at||
        session.total_questions<1||session.total_questions>500||
        session.total_questions!==answers.length||
        session.correct_answers!==answers.filter(answer=>answer.is_correct).length||
        JSON.stringify(receipt.answerIds)!==JSON.stringify(answers.map(answer=>answer.id).sort())||
        answers.some(answer=>typeof answer.is_correct!=='boolean'||!answer.answered_at||
          !words.some(word=>word.id===answer.vocabulary_id)||answer.sentence_id)||
        (level.adminCutoff&&(!receipt.confirmedAt||receipt.confirmedAt<=level.adminCutoff||
          session.created_at<=level.adminCutoff||session.completed_at<=level.adminCutoff)))continue;
      total+=session.total_questions;correct+=session.correct_answers;
      if(total>=10)break;
    }
    return {evaluated_total:total,evaluated_correct:correct,required_answers:10,required_pct:90};
  };
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
    setOwner: value => { state.owner=value; persist(); },
    setLevel: writeLevel,
    levelRevision: value => {state.levelRevisions[state.owner]=value;persist();},
    levelEvidence: ({difficulty=1,count=6,correct=count,confirmed=true,
      ownerId=state.owner,languageCode='my',at='2026-11-26T10:00:00.000Z'}={}) => {
      const id=crypto.randomUUID();
      const session={id,user_id:ownerId,language_code:languageCode,topic_id:'food',
        quiz_type:'native_to_image',difficulty,total_questions:count,correct_answers:correct,
        created_at:at,completed_at:at};
      const answers=Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),session_id:id,
        vocabulary_id:words[i%words.length].id,selected_vocabulary_id:words[i%words.length].id,
        is_correct:i<correct,answered_at:at}));
      state.tables.kg_chart_quiz_sessions.push(session);state.tables.kg_chart_quiz_answers.push(...answers);
      if(confirmed)state.mcqReceipts[id]=mcqReceipt(session,answers,at);
      persist();return id;
    },
    resetPath:(at='2026-11-27T13:00:00.123457+00:00')=>{state.pathRevision++;state.pathReset=at;state.pathComplete=false;state.pathEligible=null;persist();},
    eligiblePath:at=>{state.pathEligible=at;persist();},
    words, user: {id: owner, email: 'fixture@example.invalid'},
  };
  window.__kgF1 = api;
  const initial=window.__kgF1Initial;
  if(initial&&!state.initializedByScenario){
    if(initial.level)api.setLevel(initial.level);
    for(const fault of initial.faults||[])api.fault(fault.table,fault.mode);
    if(initial.legacyLevel){
      state.tables.kg_chart_user_levels[0]={...state.tables.kg_chart_user_levels[0],...initial.legacyLevel};
      localStorage.setItem('kg_chart_level_my',JSON.stringify(initial.legacyLevel));
    }
    if(initial.history)api.levelEvidence(initial.history);
    state.initializedByScenario=true;persist();
  }
  window.__fakeClient = {
    auth: {async getSession() { return {data: {session: {user: {id: state.owner}}}, error: null}; }},
    async rpc(name, args) {
      if(name==='kg_chart_my_answers')return {data:[],error:null};
      if(['kg_chart_f2_level_state','kg_chart_f2_select_difficulty','kg_chart_f2_check_level_up'].includes(name)){
        const ownerId=state.owner,languageCode=args.p_lang;
        state.levelRequests.push({name,args:copy(args),ownerId});persist();
        const i=state.faults.findIndex(f=>f.table===name),fault=i<0?null:state.faults.splice(i,1)[0];persist();
        if(args.p_expected_revision!==(state.levelRevisions[ownerId]||17))return {error:{code:'40001'}};
        if(!state.permitted||!['my','ja'].includes(languageCode))return {error:{code:'42501'}};
        if(fault?.mode==='fail')return {error:{message:'Synthetic difficulty connection failure'}};
        if(fault?.mode==='deny')return {error:{code:'42501'}};
        const before=currentLevel(ownerId,languageCode);
        let result=levelJson(before);
        if(name!=='kg_chart_f2_level_state'){
          if(fault?.mode==='stale'){
            // A competing current-version selection or successful check won
            // before this call acquired the owned level row.
            writeLevel({...(before.unlocked>1?{level:before.level===1?2:1}:{unlocked:2}),
              version:before.version+1},{ownerId,languageCode});
            return {error:{code:'40001'}};
          }
          if(args.p_expected_version!==before.version)return {error:{code:'40001'}};
          if(name==='kg_chart_f2_select_difficulty'){
            if(!Number.isInteger(args.p_level)||args.p_level<1||args.p_level>before.unlocked)return {error:{code:'42501'}};
            result=levelJson(writeLevel({level:args.p_level,version:before.version+(args.p_level!==before.level?1:0)},
              {ownerId,languageCode}));
          }else{
            const progress=evaluateLevel(ownerId,languageCode,before);
            const advances=before.unlocked<4&&progress.evaluated_total>=progress.required_answers&&
              progress.evaluated_correct*100>=progress.required_pct*progress.evaluated_total;
            result={...levelJson(writeLevel({unlocked:before.unlocked+(advances?1:0),version:before.version+(advances?1:0)},
              {ownerId,languageCode})),...progress};
          }
        }
        // Hold the response after the operation's transaction, as a delayed
        // network reply; a later server state must not masquerade as its ACK.
        if(fault?.mode==='hold')await new Promise(resolve=>{release=resolve;});
        if(fault?.mode==='newer-before-readback')writeLevel({level:result.unlocked,version:result.version+1},
          {ownerId,languageCode});
        if(fault?.mode==='lost-ack-next-evidence'){
          // Another device can finish work at the newly available level
          // before the first reply arrives. An automatic rebased check would
          // wrongly perform a second advancement from this single intent.
          api.levelEvidence({difficulty:result.unlocked,count:10,ownerId,languageCode,
            at:new Date().toISOString()});
        }
        if(['lost-ack','lost-ack-next-evidence'].includes(fault?.mode))return {error:{message:'Synthetic difficulty reply lost'}};
        return {data:result,error:null};
      }
      if(name==='kg_chart_f2_my_completion_path'||name==='kg_chart_f2_complete_topic'){
        state.pathRequests.push({name,args:copy(args)});persist();
        if(args.p_expected_revision!==state.pathRevision)return {error:{code:'40001'}};
        const topic={topic_id:'food',version:state.pathVersion,complete:state.pathComplete,
          completed_at:state.pathCompletedAt,eligible_at:state.pathEligible};
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
        if(fault?.mode==='fail')return {error:{message:'Synthetic uncertain completion reply'}};
        state.pathComplete=true;state.pathCompletedAt=state.pathEligible;state.pathVersion++;
        const ack={event_id:args.p_event_id,owner_id:owner,language_code:'my',topic_id:'food',
          permission_revision:state.pathRevision,reset_at:state.pathReset,completed_at:state.pathEligible,
          event_version:state.pathVersion,current_version:state.pathVersion,replayed:false};
        state.pathReceipts[args.p_event_id]={args:copy(args),ack:copy(ack)};persist();
        if(fault?.mode==='reset-before-reply')api.resetPath('2026-11-27T12:00:00.123900+00:00');
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
        if(fault?.mode==='hold')await new Promise(resolve=>{release=resolve;});
        if(fault?.mode==='fail')return {error:{message:'Synthetic rating failure'}};
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
        if(mcqTypes.includes(d.session.quiz_type)){
          assertFixture(Number.isInteger(d.session.difficulty)&&d.session.difficulty>=1&&d.session.difficulty<=4,
            'Restricted MCQ requires an explicit original difficulty');
          if(d.session.difficulty>currentLevel(state.owner,d.session.language_code).unlocked)return {error:{code:'42501'}};
        }else assertFixture(d.session.difficulty==null,'Non-MCQ draft must not acquire a difficulty');
        if (!state.tables.kg_chart_quiz_sessions.some(row => row.id === d.id)) {
          state.tables.kg_chart_quiz_sessions.push(copy(d.session));
          state.tables.kg_chart_quiz_answers.push(...copy(d.answers)); persist();
        }
        if(mcqTypes.includes(d.session.quiz_type)&&!state.mcqReceipts[d.id]){
          state.mcqReceipts[d.id]=mcqReceipt(d.session,d.answers);persist();
        }
        if(fault?.mode==='hold')await new Promise(resolve=>{release=resolve;});
        if (fault?.mode === 'lost-ack') return {data: null, error: {message:'Synthetic atomic reply lost'}};
        return {data:{session_id:d.id, answer_count:d.answers.length, expected_revision:17}, error:null};
      }
      if (name !== 'kg_chart_check_level_up') throw Error('Unexpected fixture RPC: ' + name);
      state.levelCalls++; persist();
      const legacyFaultIndex=state.faults.findIndex(fault=>fault.table===name);
      const legacyFault=legacyFaultIndex<0?null:state.faults.splice(legacyFaultIndex,1)[0];persist();
      if(legacyFault?.mode==='hold'){
        await new Promise(resolve=>{release=resolve;});
        return {data:2,error:null};
      }
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
            state.reads.push({table,filters:copy(q.filters)});persist();
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
    function RatingFixture({policy,cards,chart,languageCode,user}){
      const rating=useUserRatings(languageCode,policy), id=fixtureWords[0].id;
      const topics=[{id:'food',icon:'🍎',translation:{title_native:'Food'}}];
      return <>
        <RatingRecoveryPanel flow={rating.ratingFlow} vocabulary={fixtureWords}/>
        <div data-fixture-rating={rating.ratings[id]?.rating??'none'} data-ratings-loaded={rating.ratingsLoaded?'yes':'no'}
          data-fixture-owner={user.id} data-fixture-language={languageCode} data-fixture-revision={policy?.revision}/>
        {cards?<FlashcardView topics={topics} vocabulary={fixtureWords} ratings={rating.ratings}
          ratingsLoaded={rating.ratingsLoaded} onRate={rating.updateRating} onClearRating={rating.clearRating}
          languageCode={languageCode} user={user} restrictedRatings/>:chart?
          <ChartView topic={topics[0]} vocabulary={fixtureWords} ratings={rating.ratings}
            onRate={rating.updateRating} languageCode={languageCode} showEnglish
            onToggleEnglish={()=>{}} meaningName="English"/>:
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
      const [identity,setIdentity]=useState({user:fixtureUser,languageCode:'my',revision:17,
        policyState:window.__kgF1Initial?.policyState||'restricted'});
      useEffect(()=>{
        window.__kgF1.changeScope=patch=>{
          if(patch.ownerId)window.__kgF1.setOwner(patch.ownerId);
          if(patch.revision!==undefined)window.__kgF1.levelRevision(patch.revision);
          setIdentity(old=>({user:patch.ownerId?{...old.user,id:patch.ownerId}:old.user,
            languageCode:patch.languageCode||old.languageCode,revision:patch.revision??old.revision,
            policyState:patch.policyState||old.policyState}));
        };
        return()=>{delete window.__kgF1.changeScope;};
      },[]);
      const kind = new URLSearchParams(location.search).get('kind') || 'word';
      const restricted = new URLSearchParams(location.search).get('restricted') === 'yes';
      const scope = restricted ? {ownerId:identity.user.id, policy:{state:identity.policyState, revision:kind==='path'?window.__kgF1.snapshot().pathRevision:identity.revision}} : null;
      return <AuthContext.Provider value={{ user: identity.user }}>
        <KGMediaScopeContext.Provider value={scope}>
        <RulesContext.Provider value={fixtureRules}>
          <PrivateLessonsContext.Provider value={fixturePrivate}>
            <div aria-label="Fixture navigation" data-fixture-owner={identity.user.id}
              data-fixture-language={identity.languageCode} data-fixture-revision={identity.revision}>
              <button onClick={() => setShown(false)}>Leave quiz view</button>
              <button onClick={() => setShown(true)}>Reopen quiz view</button>
            </div>
            {shown ? kind === 'word'
              ? <WordQuizView key={identity.user.id+':'+identity.languageCode} topics={[{ id: 'food', icon: '🍎', translation: { title_native: 'Food' } }]}
                  vocabulary={fixtureWords} poolVocabulary={fixtureWords} ratings={{}}
                  onRate={window.__kgF1.rate} languageCode={identity.languageCode} user={identity.user}
                  onSessionSaved={window.__kgF1.callback} meaningName="English" />
              : kind === 'typing' ? <TypingView topics={[{id:'food',translation:{title_native:'Food'}}]}
                  vocabulary={fixtureWords} languageCode="my" user={fixtureUser} meaningName="English" accessPolicy={scope?.policy} />
              : kind === 'speaking' ? <SpeakView languageCode="my" user={fixtureUser} meaningName="English"
                  sentenceAccess={fixtureSentenceAccess} />
              : kind === 'colour' ? <ColourQuizView languageCode="my" user={fixtureUser} />
              : ['ratings','rating-cards','rating-chart'].includes(kind) ? <RatingFixture policy={scope?.policy}
                  cards={kind==='rating-cards'} chart={kind==='rating-chart'} languageCode={identity.languageCode} user={identity.user}/>
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
  ['/app.css', canonicalStyles],
]);
for (const filename of ['kg-shared.js', 'kg-learner-access.js', 'kg-sentence-access.js', 'kg-quiz-save.js']) {
  assets.set('/' + filename, await readFile('js/' + filename));
}
const html = '<!doctype html><html><head><meta charset="UTF-8"><title>Isolated F1 UI fixture</title>' +
  '<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div>' +
  [...assets.keys()].filter(path => path.endsWith('.js') && path !== '/app.js').map(path => `<script src="${path}"></script>`).join('') +
  '<script src="/app.js"></script></body></html>';
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const content = path === '/' ? html : assets.get(path);
  if (content === undefined) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type': path === '/' ? 'text/html; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-store'});
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
async function scenario(name, kind, run, restricted = false, initial = null) {
  if(process.env.KG_UI_SCENARIO&&!name.includes(process.env.KG_UI_SCENARIO))return;
  const context = await browser.newContext({serviceWorkers: 'block'});
  if(initial)await context.addInitScript(value=>{window.__kgF1Initial=value;},initial);
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
    else if(['ratings','rating-cards','rating-chart'].includes(kind))await page.locator('[data-ratings-loaded="yes"]').waitFor({state:'attached'});
    else if(kind==='path')await page.locator('[data-path-ready="yes"]').waitFor({state:'attached'});
    else if(kind==='word'&&restricted&&initial?.policyState!=='legacy')await page.getByRole('region',{name:'Difficulty status'}).waitFor();
    else await page.getByRole('button', {name: /^Start Quiz/}).waitFor();
    await run(page);
    if(restricted&&['sentence','typing','speaking','colour'].includes(kind))
      assert.equal((await snapshot(page)).levelRequests.length,0,'Non-MCQ consumers must not read or mutate word difficulty');
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
const levelStateRpc='kg_chart_f2_level_state';
const levelSelectRpc='kg_chart_f2_select_difficulty';
const levelCheckRpc='kg_chart_f2_check_level_up';
const levelRegion=page=>page.getByRole('region',{name:'Difficulty status'});
const levelChoice=(page,name)=>page.getByRole('button',{name:new RegExp(name+'$')});
const wordStart=page=>page.getByRole('button',{name:/^(Start Quiz|Verifying your level|Loading your level|Difficulty unavailable)/});
const levelCalls=(db,name)=>db.levelRequests.filter(request=>request.name===name);
async function verifiedLevel(page,selected='Easy',unlocked=selected){
  await levelRegion(page).getByText(`Current difficulty: ${selected} · available through ${unlocked}.`,{exact:true}).waitFor();
  await levelRegion(page).getByRole('button',{name:'Refresh difficulty',exact:true}).click({trial:true});
}
async function completeCorrectWord(page,afterStart,started=false){
  if(!started)await page.getByRole('button',{name:/^Start Quiz/}).click();
  await afterStart?.();
  for(let index=0;index<4;index++){
    await page.locator('button').filter({has:page.locator('img')}).first().click({trial:true});
    const native=(await page.getByText(/^Native [0-3]$/).first().textContent()).trim();
    await page.getByRole('button',{name:new RegExp('Word '+native.slice(-1)+'$')}).click();
    await page.getByText('✅ Correct!',{exact:true}).waitFor();
    await page.getByRole('button',{name:index===3?/^See Results/:/^Next Question/}).click();
  }
  await page.getByText('Quiz Completed!',{exact:true}).waitFor();
}
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
      if(kind==='word')await page.waitForFunction(name=>window.__kgF1.snapshot().levelRequests.some(request=>request.name===name),levelCheckRpc);
      const db = await snapshot(page);
      assert.equal(db.requests.length, 2);
      assert.deepEqual(db.requests[0], db.requests[1]);
      assert.equal(db.tables[sessions].length, 1);
      assert.equal(db.tables[answers].length, 4);
      assert.equal(db.callbacks, 0, 'Restricted confirmation must not enter legacy saved-session callbacks');
      assert.equal(db.ratingCalls, 0);
      assert.equal(db.levelCalls, 0);
      assert.equal(levelCalls(db,levelCheckRpc).length,kind==='word'?1:0,
        'Only a confirmed MCQ recovery may trigger the new restricted advancement contract');
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
    assert.equal(await page.getByRole('button',{name:/To sort \(4\)/,includeHidden:true}).count(),1);
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
  const chartCard=page=>page.locator('#chart-card-22000000-0000-4000-8000-000000000001');
  const wordDetail=page=>page.locator('.fixed.inset-0').filter({has:page.locator('h2').filter({hasText:/^Native 0$/})});
  const detailRating=page=>wordDetail(page).getByRole('button',{name:/Understand but can't use/,includeHidden:true});
  const pendingRatings=page=>page.evaluate(()=>Object.keys(localStorage)
    .filter(key=>key.startsWith('kg-chart-rating-recovery-v1:')).map(key=>JSON.parse(localStorage.getItem(key))));
  const expectFocus=async locator=>{
    const element=await locator.elementHandle();
    await locator.page().waitForFunction(el=>document.activeElement===el,element);
  };
  async function openWordDetail(page){
    await chartCard(page).getByText('Native 0',{exact:true}).click();
    await wordDetail(page).getByRole('button',{name:'Close',exact:true}).waitFor();
    assert.deepEqual(await wordDetail(page).evaluate(el=>({position:getComputedStyle(el).position,z:getComputedStyle(el).zIndex})),
      {position:'fixed',z:'50'},'Use the actual positioned word-detail layer');
  }
  for(const mobile of [false,true])await scenario(`F2E2a-R1 styled Chart detail: pointer Cancel and Confirm ${mobile?'mobile':'desktop'}`, 'rating-chart', async page=>{
    if(mobile)await page.setViewportSize({width:390,height:844});
    await openWordDetail(page);
    const trigger=detailRating(page);
    await trigger.click();
    await dialog(page).getByText(/version 0/).waitFor();
    if(mobile&&process.env.KG_UI_SCREENSHOT)await page.screenshot({path:process.env.KG_UI_SCREENSHOT});
    assert.equal(ratingWrites(await snapshot(page)).length,0);
    // Ordinary pointer clicks, with no force or close-detail workaround:
    // the old z-50 confirmation is physically covered at this exact point.
    await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
    await dialog(page).waitFor({state:'hidden'});
    assert.equal(await wordDetail(page).isVisible(),true);
    await expectFocus(trigger);
    assert.equal(ratingWrites(await snapshot(page)).length,0);
    assert.deepEqual(await pendingRatings(page),[]);
    await trigger.click();
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await dialog(page).waitFor({state:'hidden'});
    await page.locator('[data-fixture-rating="4"]').waitFor({state:'attached'});
    await expectFocus(trigger);
    assert.equal(await trigger.evaluate(el=>el.classList.contains('bg-orange-500')),true);
    assert.equal(ratingWrites(await snapshot(page)).length,1);
    assert.deepEqual(await pendingRatings(page),[]);
    await wordDetail(page).getByRole('button',{name:'Close',exact:true}).click();
    // The original Chart hover rating controls still enter the same flow.
    await chartCard(page).hover();
    const inline=chartCard(page).getByTitle("Don't know",{exact:true});
    await inline.click();
    await dialog(page).waitFor();
    await page.mouse.move(1,1);
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({state:'hidden'});
    await expectFocus(inline);
    await page.waitForFunction(el=>getComputedStyle(el.parentElement.parentElement).opacity==='1',await inline.elementHandle());
    await inline.press('Enter');
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await page.locator('[data-fixture-rating="5"]').waitFor({state:'attached'});
    assert.equal(ratingWrites(await snapshot(page)).length,2);
  },true);
  await scenario('F2E2a-R1 styled Chart detail: keyboard focus trap Escape and pointer focus return', 'rating-chart', async page=>{
    await openWordDetail(page);
    const trigger=detailRating(page);
    await wordDetail(page).getByRole('button',{name:'Close',exact:true}).focus();
    // Model a tap that does not natively focus its button (Safari behavior).
    // The canonical rating call receives the actual initiating control.
    await trigger.evaluate(el=>el.addEventListener('pointerdown',event=>event.preventDefault(),{once:true}));
    await trigger.click();
    const cancel=dialog(page).getByRole('button',{name:'Cancel',exact:true});
    const confirm=dialog(page).getByRole('button',{name:'Confirm rating',exact:true});
    await cancel.waitFor();await expectFocus(cancel);
    await page.keyboard.press('Shift+Tab');await expectFocus(confirm);
    await page.keyboard.press('Tab');await expectFocus(cancel);
    await page.keyboard.press('Tab');await expectFocus(confirm);
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({state:'hidden'});
    await expectFocus(trigger);
    assert.equal(await wordDetail(page).isVisible(),true);
    assert.equal(ratingWrites(await snapshot(page)).length,0);
    await trigger.press('Enter');
    await cancel.waitFor();await expectFocus(cancel);
    await page.keyboard.press('Tab');await page.keyboard.press('Enter');
    await dialog(page).waitFor({state:'hidden'});
    await page.locator('[data-fixture-rating="4"]').waitFor({state:'attached'});
    await expectFocus(trigger);
  },true);
  await scenario('F2E2a-R1 styled Chart detail: double click and busy keyboard keep one original mutation', 'rating-chart', async page=>{
    await openWordDetail(page);
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_save_progress','hold'));
    await detailRating(page).click();
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).dblclick();
    await page.waitForFunction(()=>window.__kgF1.snapshot().ratingRequests.filter(r=>r.name==='kg_chart_f2_save_progress').length===1);
    assert.equal(await dialog(page).getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true);
    assert.equal(await dialog(page).getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);
    for(const key of ['Tab','Shift+Tab','Escape']){
      await page.keyboard.press(key);
      assert.equal(await dialog(page).evaluate(el=>el.contains(document.activeElement)),true,'Saving focus remains in the active dialog');
    }
    assert.equal(await page.locator('[data-fixture-rating]').getAttribute('data-fixture-rating'),'none');
    assert.equal(Object.keys((await snapshot(page)).ratingReceipts).length,0);
    const original=(await pendingRatings(page))[0];assert.ok(original?.eventId);
    await page.evaluate(()=>window.__kgF1.release());
    await dialog(page).waitFor({state:'hidden'});
    await page.locator('[data-fixture-rating="4"]').waitFor({state:'attached'});
    const db=await snapshot(page);
    assert.equal(ratingWrites(db).length,1);assert.equal(Object.keys(db.ratingReceipts).length,1);
    assert.equal(ratingWrites(db)[0].args.p_event_id,original.eventId);
    await expectFocus(detailRating(page));
  },true);
  for(const fault of ['fail','lost-ack'])await scenario(`F2E2a-R1 styled Chart detail: ${fault} retains exact event and retries current state`, 'rating-chart', async page=>{
    await openWordDetail(page);
    await page.evaluate(mode=>window.__kgF1.fault('kg_chart_f2_save_progress',mode),fault);
    await detailRating(page).click();
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await dialog(page).waitFor({state:'hidden'});
    await ratingRegion(page).getByText(/rating server did not confirm/i).waitFor();
    assert.equal(await wordDetail(page).isVisible(),true);
    const original=(await pendingRatings(page))[0];assert.ok(original?.eventId);
    const first=ratingWrites(await snapshot(page))[0];
    assert.equal(first.args.p_event_id,original.eventId);
    assert.equal(await page.locator('[data-fixture-rating]').getAttribute('data-fixture-rating'),'none');
    if(fault==='lost-ack')await page.evaluate(()=>window.__kgF1.externalRating(window.__kgF1.words[0].id,1));
    await wordDetail(page).getByRole('button',{name:'Close',exact:true}).click();
    await ratingRegion(page).getByRole('button',{name:'Retry original rating',exact:true}).click();
    await ratingRegion(page).getByText(fault==='lost-ack'?/newer server rating is shown/:/^Rating confirmed\.$/).waitFor();
    const db=await snapshot(page),writes=ratingWrites(db);
    assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
    assert.equal(Object.keys(db.ratingReceipts).length,1);
    assert.equal(await page.locator('[data-fixture-rating]').getAttribute('data-fixture-rating'),fault==='lost-ack'?'1':'4');
    assert.deepEqual(await pendingRatings(page),[]);
  },true);
  for(const [kind,patch,attribute,wanted] of [
    ['owner',{ownerId:'11000000-0000-4000-8000-000000000002'},'data-fixture-owner','11000000-0000-4000-8000-000000000002'],
    ['language',{languageCode:'ja'},'data-fixture-language','ja'],
    ['revision',{revision:18},'data-fixture-revision','18'],
  ])await scenario(`F2E2a-R1 styled Chart detail: ${kind} change invalidates saving dialog without stale focus or result`, 'rating-chart', async page=>{
    await openWordDetail(page);
    const trigger=detailRating(page);
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_save_progress','hold'));
    await trigger.click();
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await page.waitForFunction(()=>window.__kgF1.snapshot().ratingRequests.some(r=>r.name==='kg_chart_f2_save_progress'));
    const original=(await pendingRatings(page))[0];assert.ok(original?.eventId);
    // A real provider transition, not a forced click through the modal.
    await page.evaluate(value=>window.__kgF1.changeScope(value),patch);
    await page.locator(`[${attribute}="${wanted}"][data-ratings-loaded="yes"]`).waitFor({state:'attached'});
    await dialog(page).waitFor({state:'hidden'});
    assert.equal(await trigger.evaluate(el=>document.activeElement===el),false,'Do not return focus to an old-scope initiator');
    assert.equal(await page.locator('#root').evaluate(el=>el.inert),false,'Restore the application surface after scope change');
    await page.evaluate(()=>window.__kgF1.release());
    await page.waitForFunction(()=>Object.keys(window.__kgF1.snapshot().ratingReceipts).length===1);
    assert.equal(await page.locator('[data-fixture-rating]').getAttribute('data-fixture-rating'),'none');
    assert.equal(await page.getByText('Rating confirmed.',{exact:true}).count(),0);
    assert.deepEqual(await pendingRatings(page),[original]);
    assert.equal(ratingWrites(await snapshot(page)).length,1);
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
  for(const [label,resetAt,obsolete] of [
    ['earlier','2026-11-27T12:00:00.123455+00:00',false],
    ['equal','2026-11-27T21:00:00.123456+09:00',true],
    ['later','2026-11-27T12:00:00.123457+00:00',true],
  ])await scenario(`F2E2b-R1 actual recovery: ${label} microsecond reset boundary`, 'path', async page=>{
    const region=page.getByRole('region',{name:'Topic completion recovery'});
    const localEvents=prefix=>page.evaluate(p=>Object.keys(localStorage).filter(k=>k.startsWith(p))
      .map(k=>JSON.parse(localStorage.getItem(k))),prefix);
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_complete_topic','fail'));
    await region.getByRole('button',{name:'Confirm completion',exact:true}).click();
    await region.getByText(/server did not confirm completion/i).waitFor();
    const [original]=await localEvents('kg-chart-completion-recovery-v1:');
    assert.equal((await snapshot(page)).pathVersion,0,'No newer version may mask a timestamp comparison failure');
    await page.evaluate(at=>window.__kgF1.resetPath(at),resetAt);
    await page.reload({waitUntil:'load'});
    await page.locator('[data-path-ready="yes"][data-food-complete="no"][data-next-unlocked="no"][data-celebrated="no"]').waitFor({state:'attached'});
    await region.getByRole('button',{name:'Review current progress'}).click();
    await region.getByText(/Current state: not confirmed/).waitFor();
    const archive=region.getByRole('button',{name:'Archive obsolete completion'});
    assert.equal(await archive.count(),obsolete?1:0);
    assert.deepEqual(await localEvents('kg-chart-completion-recovery-v1:'),[original]);
    if(!obsolete){
      assert.equal((await localEvents('kg-chart-completion-archive-v1:')).length,0);
      assert.equal((await snapshot(page)).pathRequests.filter(r=>r.name==='kg_chart_f2_complete_topic').length,1);
      return;
    }
    await archive.click();
    await region.getByText(/Obsolete request archived/).waitFor();
    const [archived]=await localEvents('kg-chart-completion-archive-v1:');
    assert.deepEqual(archived.event,original);
    assert.equal(archived.observed.reset_at,resetAt);
    assert.equal((await localEvents('kg-chart-completion-recovery-v1:')).length,0);
    await page.evaluate(()=>window.__kgF1.eligiblePath('2026-11-27T12:00:00.123901+00:00'));
    await region.getByRole('button',{name:'Refresh confirmed progress'}).click();
    await region.getByRole('button',{name:'Confirm completion',exact:true}).click();
    await region.getByText('Topic completion confirmed by the server.',{exact:true}).waitFor();
    await page.locator('[data-food-complete="yes"][data-next-unlocked="yes"][data-celebrated="yes"]').waitFor({state:'attached'});
    const writes=(await snapshot(page)).pathRequests.filter(r=>r.name==='kg_chart_f2_complete_topic');
    assert.equal(writes.length,2);assert.notEqual(writes[1].args.p_event_id,original.eventId);
    assert.equal(writes[1].args.p_reset_at,resetAt);assert.equal(writes[1].args.p_expected_revision,18);
    assert.equal(writes[1].args.p_expected_version,0);
    assert.equal(writes[1].args.p_evidence_at,'2026-11-27T12:00:00.123901+00:00');
    assert.deepEqual((await localEvents('kg-chart-completion-archive-v1:'))[0].event,original);
  },true);
  await scenario('F2E2b-R1 actual recovery: no-reset lost reply remains pending and retries unchanged', 'path', async page=>{
    const region=page.getByRole('region',{name:'Topic completion recovery'});
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_complete_topic','fail'));
    await region.getByRole('button',{name:'Confirm completion',exact:true}).click();
    await region.getByText(/server did not confirm completion/i).waitFor();
    await page.reload({waitUntil:'load'});
    await page.locator('[data-path-ready="yes"]').waitFor({state:'attached'});
    await region.getByRole('button',{name:'Review current progress'}).click();
    await region.getByText(/Current state: not confirmed/).waitFor();
    assert.equal(await region.getByRole('button',{name:'Archive obsolete completion'}).count(),0);
    assert.equal(await region.getByRole('button',{name:'Confirm completion',exact:true}).count(),0);
    await region.getByRole('button',{name:'Retry original completion'}).click();
    await region.getByText('Topic completion confirmed by the server.',{exact:true}).waitFor();
    const writes=(await snapshot(page)).pathRequests.filter(r=>r.name==='kg_chart_f2_complete_topic');
    assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
  },true);
  await scenario('F2E2b-R1 actual path: a receipt overtaken by reset cannot unlock or celebrate', 'path', async page=>{
    const region=page.getByRole('region',{name:'Topic completion recovery'});
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_complete_topic','reset-before-reply'));
    await region.getByRole('button',{name:'Confirm completion',exact:true}).click();
    await region.getByText(/original completion pending/).waitFor();
    await region.getByText(/Learning path unavailable:/).waitFor();
    await page.locator('[data-food-complete="no"][data-next-unlocked="no"][data-celebrated="no"]').waitFor({state:'attached'});
    assert.equal(await region.getByText('Topic completion confirmed by the server.',{exact:true}).count(),0);
    await page.reload({waitUntil:'load'});
    await page.locator('[data-path-ready="yes"][data-food-complete="no"][data-next-unlocked="no"][data-celebrated="no"]').waitFor({state:'attached'});
    const db=await snapshot(page);
    assert.equal(db.pathVersion,1);assert.equal(db.pathCompletedAt,'2026-11-27T12:00:00.123456+00:00');
    assert.equal(db.pathReset,'2026-11-27T12:00:00.123900+00:00');
    assert.equal(db.pathRequests.filter(r=>r.name==='kg_chart_f2_complete_topic').length,1);
    assert.equal(await region.getByRole('button',{name:'Confirm completion',exact:true}).count(),0);
  },true);

  await scenario('F2E2c actual difficulty: failed initial read never trusts local levels or historical summaries; retry and reload read current state', 'word', async page=>{
    const region=levelRegion(page);
    await region.getByRole('alert').filter({hasText:'Difficulty could not be verified.'}).waitFor();
    assert.equal(await wordStart(page).isDisabled(),true);
    assert.equal(await levelChoice(page,'Expert').isDisabled(),true);
    assert.equal(await region.getByText(/^Confirmed .* answers:/).count(),0);
    let db=await snapshot(page);
    assert.equal(db.reads.some(read=>read.table==='kg_chart_user_levels'),false,'Restricted state must not query the legacy level table');
    assert.equal(levelCalls(db,levelStateRpc).length,1);
    assert.equal(levelCalls(db,levelCheckRpc).length,0);
    await region.getByRole('button',{name:'Refresh difficulty',exact:true}).click();
    await verifiedLevel(page);
    assert.equal(await levelChoice(page,'Easy').getAttribute('aria-pressed'),'true');
    assert.equal(await levelChoice(page,'Normal').isDisabled(),true);
    await wordStart(page).click({trial:true});
    await region.getByRole('button',{name:'Check advancement',exact:true}).click();
    await region.getByText('Confirmed Easy answers: 0/10 · 0% correct (need 90%).',{exact:true}).waitFor();
    db=await snapshot(page);
    assert.equal(levelCalls(db,levelCheckRpc).length,1);
    assert.equal(Object.keys(db.mcqReceipts).length,0,'Historical complete-looking rows have no confirmed MCQ receipt');
    await page.reload({waitUntil:'load'});
    await verifiedLevel(page);
    assert.equal(await region.getByText(/^Confirmed .* answers:/).count(),0,'A fresh state read cannot fabricate an evaluation');
    db=await snapshot(page);
    assert.equal(levelCalls(db,levelCheckRpc).length,1,'Reload must not automatically perform an advancement check');
    assert.equal(levelCalls(db,levelSelectRpc).length,0);
    assert.equal(db.levelCalls,0);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('kg_chart_level_my'))),{level:4,unlocked:4},
      'Restricted reads must not rewrite the unrelated legacy local mirror');
  },true,{legacyLevel:{level:4,unlocked:4},history:{count:100,correct:100,confirmed:false},
    faults:[{table:levelStateRpc,mode:'fail'}]});

  await scenario('F2E2c actual difficulty: pending selection blocks optimistic start and freezes the confirmed quiz difficulty', 'word', async page=>{
    await verifiedLevel(page,'Easy','Normal');
    await page.setViewportSize({width:390,height:844});
    if(process.env.KG_LEVEL_SCREENSHOT){
      await levelRegion(page).scrollIntoViewIfNeeded();
      await page.screenshot({path:process.env.KG_LEVEL_SCREENSHOT});
    }
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),levelSelectRpc);
    await levelChoice(page,'Normal').click();
    await levelRegion(page).getByText('Confirming difficulty…',{exact:true}).waitFor();
    assert.equal(await levelChoice(page,'Easy').getAttribute('aria-pressed'),'true');
    assert.equal(await levelChoice(page,'Normal').getAttribute('aria-pressed'),'false');
    assert.equal(await levelChoice(page,'Normal').isDisabled(),true);
    assert.equal(await wordStart(page).isDisabled(),true);
    let db=await snapshot(page);
    assert.equal(levelCalls(db,levelSelectRpc).length,1);
    assert.deepEqual(levelCalls(db,levelSelectRpc)[0].args,
      {p_expected_revision:17,p_lang:'my',p_expected_version:4,p_level:2});
    await page.evaluate(()=>window.__kgF1.release());
    await levelRegion(page).getByText('Difficulty confirmed.',{exact:true}).waitFor();
    await verifiedLevel(page,'Normal','Normal');
    assert.equal(await levelChoice(page,'Normal').getAttribute('aria-pressed'),'true');
    await completeCorrectWord(page,()=>page.evaluate(()=>window.__kgF1.setLevel({level:1,version:6})));
    await page.getByText('✓ Results saved',{exact:true}).waitFor();
    await verifiedLevel(page,'Easy','Normal');
    db=await snapshot(page);
    const draft=db.requests.find(request=>request.table==='kg_chart_f2_save_recovery_quiz').args.p_draft;
    assert.equal(draft.session.difficulty,2,'An in-progress quiz retains its original confirmed level');
    assert.equal(db.tables[sessions].find(session=>session.id===draft.id).difficulty,2,
      'A still-unlocked difficulty is valid even when another device selected a lower level');
    assert.equal(levelCalls(db,levelSelectRpc).length,1);
    assert.equal(levelCalls(db,levelCheckRpc).length,1,'A stale check is reconciled once, never rebased');
    assert.equal(db.levelCalls,0);assert.equal(db.ratingCalls,0);
    await page.getByRole('button',{name:'Try Again',exact:true}).click();
    await completeCorrectWord(page,undefined,true);
    await page.getByText('✓ Results saved',{exact:true}).waitFor();
    await levelRegion(page).getByRole('status').filter({hasText:'Automatic advancement checks are paused.'}).waitFor();
    db=await snapshot(page);
    const second=db.requests.filter(request=>request.table==='kg_chart_f2_save_recovery_quiz')[1].args.p_draft;
    assert.notEqual(second.id,draft.id);
    assert.equal(second.session.difficulty,1,'Try Again uses the latest verified Easy selection, not the prior frozen Normal');
    assert.equal(levelCalls(db,levelCheckRpc).length,1,'Try Again must not silently retry the previous stale check');
  },true,{level:{level:1,unlocked:2,version:4}});

  for(const fault of ['fail','lost-ack'])await scenario(`F2E2c actual difficulty: ${fault} selection reconciles by read without repeating the mutation`, 'word', async page=>{
    await verifiedLevel(page,'Easy','Normal');
    await page.evaluate(({name,mode})=>window.__kgF1.fault(name,mode),{name:levelSelectRpc,mode:fault});
    await levelChoice(page,'Normal').click();
    await levelRegion(page).getByText(/The difficulty request was not confirmed/).waitFor();
    await verifiedLevel(page,fault==='fail'?'Easy':'Normal','Normal');
    assert.equal(await levelRegion(page).getByText('Difficulty confirmed.',{exact:true}).count(),0);
    let db=await snapshot(page);
    assert.equal(levelCalls(db,levelSelectRpc).length,1);
    assert.equal(levelCalls(db,levelStateRpc).length,2);
    await levelRegion(page).getByRole('button',{name:'Refresh difficulty',exact:true}).click();
    await verifiedLevel(page,fault==='fail'?'Easy':'Normal','Normal');
    await page.reload({waitUntil:'load'});
    await verifiedLevel(page,fault==='fail'?'Easy':'Normal','Normal');
    db=await snapshot(page);
    assert.equal(levelCalls(db,levelSelectRpc).length,1,'Explicit read and reload cannot repeat an uncertain selection');
    assert.equal(levelCalls(db,levelCheckRpc).length,0);
  },true,{level:{level:1,unlocked:2,version:0}});

  await scenario('F2E2c actual difficulty: confirmed MCQ save checks once and waits for exact current readback before unlock or Switch', 'word', async page=>{
    await verifiedLevel(page);
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_save_recovery_quiz','hold'));
    await completeCorrectWord(page);
    await page.getByRole('status').filter({hasText:'Saving…'}).waitFor();
    assert.equal(levelCalls(await snapshot(page),levelCheckRpc).length,0,'A committed quiz with no ACK must not advance the UI');
    assert.equal(await page.getByText(/Normal unlocked!/).count(),0);
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),levelStateRpc);
    await page.evaluate(()=>window.__kgF1.release());
    await page.waitForFunction(name=>window.__kgF1.snapshot().levelRequests.filter(request=>request.name===name).length===2,levelStateRpc);
    await levelRegion(page).getByText('Checking advancement…',{exact:true}).waitFor();
    assert.equal(await page.getByText(/Normal unlocked!/).count(),0,'Mutation ACK alone cannot celebrate an unlock');
    assert.equal(await page.getByRole('button',{name:'Try Again',exact:true}).isDisabled(),true);
    assert.equal(levelCalls(await snapshot(page),levelCheckRpc).length,1);
    await page.evaluate(()=>window.__kgF1.release());
    await page.getByText(/Normal unlocked!/).waitFor();
    await verifiedLevel(page,'Easy','Normal');
    assert.equal(await levelRegion(page).getByText(/^Confirmed .* answers:/).count(),0,
      'The successful check counted Easy evidence, not progress toward Hard');
    let db=await snapshot(page);
    assert.equal(levelCalls(db,levelCheckRpc).length,1);
    assert.equal(db.levelScopes[db.owner+'|my'].level,1,'Unlocking does not implicitly select the next difficulty');
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),levelSelectRpc);
    await page.getByRole('button',{name:'Switch to Normal',exact:true}).click();
    await levelRegion(page).getByText('Confirming difficulty…',{exact:true}).waitFor();
    await page.getByText('Quiz Completed!',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Try Again',exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.__kgF1.release());
    await verifiedLevel(page,'Normal','Normal');
    await wordStart(page).click({trial:true});
    assert.equal(await page.getByText('Quiz Completed!',{exact:true}).count(),0);
    db=await snapshot(page);
    assert.equal(levelCalls(db,levelSelectRpc).length,1);
    assert.equal(levelCalls(db,levelCheckRpc).length,1);
  },true,{history:{count:6,correct:6,confirmed:true}});

  await scenario('F2E2c actual difficulty: failed and lost quiz replies retain the original draft and do not check until exact confirmation', 'word', async page=>{
    await verifiedLevel(page);
    await page.evaluate(()=>{
      window.__kgF1.fault('kg_chart_f2_save_recovery_quiz','fail');
      window.__kgF1.fault('kg_chart_f2_save_recovery_quiz','lost-ack');
    });
    await completeCorrectWord(page);
    await unsaved(page);
    assert.equal(levelCalls(await snapshot(page),levelCheckRpc).length,0);
    await page.getByRole('button',{name:'Retry save',exact:true}).click();
    await page.waitForFunction(()=>window.__kgF1.snapshot().requests.length===2);
    await unsaved(page);
    assert.equal(levelCalls(await snapshot(page),levelCheckRpc).length,0);
    assert.equal(await levelRegion(page).getByRole('button',{name:'Check advancement',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Retry save',exact:true}).click();
    await page.getByText('✓ Results saved',{exact:true}).waitFor();
    await levelRegion(page).getByText('Advancement checked.',{exact:true}).waitFor();
    const db=await snapshot(page),writes=db.requests.filter(request=>request.table==='kg_chart_f2_save_recovery_quiz');
    assert.equal(writes.length,3);
    assert.deepEqual(writes[0],writes[1]);assert.deepEqual(writes[1],writes[2]);
    assert.equal(levelCalls(db,levelCheckRpc).length,1);
    assert.equal(db.callbacks,0);assert.equal(db.ratingCalls,0);assert.equal(db.levelCalls,0);
    assert.equal(Object.keys(db.mcqReceipts).length,2,'Only the seeded evidence and one confirmed original session exist');
  },true,{history:{count:6,correct:6,confirmed:true}});

  for(const fault of ['lost-ack-next-evidence','stale','newer-before-readback'])await scenario(`F2E2c actual difficulty: ${fault} check shows current server state without stale celebration or automatic rebase`, 'word', async page=>{
    await verifiedLevel(page);
    await page.evaluate(({name,mode})=>window.__kgF1.fault(name,mode),{name:levelCheckRpc,mode:fault});
    await completeCorrectWord(page);
    await page.getByText('✓ Results saved',{exact:true}).waitFor();
    await verifiedLevel(page,fault==='newer-before-readback'?'Normal':'Easy','Normal');
    await levelRegion(page).getByText('Automatic advancement checks are paused. Refresh difficulty or check advancement to continue.',{exact:true}).waitFor();
    assert.equal(await page.getByText(/Normal unlocked!/).count(),0);
    assert.equal(await levelRegion(page).getByText(/^Confirmed .* answers:/).count(),0);
    let db=await snapshot(page);
    assert.equal(levelCalls(db,levelCheckRpc).length,1);
    assert.equal(db.levelScopes[db.owner+'|my'].unlocked,2);
    if(fault==='lost-ack-next-evidence'){
      const reads=levelCalls(db,levelStateRpc).length;
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(({name,count})=>window.__kgF1.snapshot().levelRequests.filter(request=>request.name===name).length===count,
        {name:levelStateRpc,count:reads+1});
      await verifiedLevel(page,'Easy','Normal');
      await levelRegion(page).getByText('Automatic advancement checks are paused. Refresh difficulty or check advancement to continue.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'← Back to Setup',exact:true}).click();
      await completeCorrectWord(page);
      await page.getByText('✓ Results saved',{exact:true}).waitFor();
      await levelRegion(page).getByRole('status').filter({hasText:'Automatic advancement checks are paused.'}).waitFor();
      assert.equal(levelCalls(await snapshot(page),levelCheckRpc).length,1,
        'A newer confirmed quiz must not silently repeat an earlier uncertain check');
      await levelRegion(page).getByRole('button',{name:'Check advancement',exact:true}).click();
      await verifiedLevel(page,'Easy','Hard');
      assert.equal(levelCalls(await snapshot(page),levelCheckRpc).length,2,'Only the explicit new check may evaluate the next level');
    }
    const beforeReload=levelCalls(await snapshot(page),levelCheckRpc).length;
    await page.reload({waitUntil:'load'});
    await verifiedLevel(page,fault==='newer-before-readback'?'Normal':'Easy',fault==='lost-ack-next-evidence'?'Hard':'Normal');
    db=await snapshot(page);
    assert.equal(levelCalls(db,levelCheckRpc).length,beforeReload);
    assert.equal(await page.getByText(/unlocked!/).count(),0);
  },true,{history:{count:6,correct:6,confirmed:true}});

  for(const [kind,patch] of [
    ['owner',{ownerId:'11000000-0000-4000-8000-000000000099'}],
    ['language',{languageCode:'ja'}],
    ['revision',{revision:18}],
  ])await scenario(`F2E2c actual difficulty: ${kind} transition invalidates an in-flight check and its celebration`, 'word', async page=>{
    await verifiedLevel(page);
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),levelCheckRpc);
    await completeCorrectWord(page);
    await page.waitForFunction(name=>window.__kgF1.snapshot().levelRequests.some(request=>request.name===name),levelCheckRpc);
    await page.evaluate(({kind,patch})=>{
      if(kind==='revision')window.__kgF1.setLevel({level:1,unlocked:1,version:2,adminCutoff:new Date().toISOString()},{revision:18});
      window.__kgF1.changeScope(patch);
    },{kind,patch});
    await verifiedLevel(page);
    await page.evaluate(()=>window.__kgF1.release());
    await verifiedLevel(page);
    assert.equal(await page.getByText(/unlocked!/).count(),0);
    assert.equal(await levelRegion(page).getByText('Advancement checked.',{exact:true}).count(),0);
    assert.equal(await levelRegion(page).getByText(/^Confirmed .* answers:/).count(),0);
    const db=await snapshot(page);
    assert.equal(levelCalls(db,levelCheckRpc).length,1);
    const reads=levelCalls(db,levelStateRpc);
    assert.equal(reads.length,2,'Obsolete completion cannot issue another read in its former scope');
    assert.equal(reads[1].ownerId,patch.ownerId||db.owner);
    assert.equal(reads[1].args.p_lang,patch.languageCode||'my');
    assert.equal(reads[1].args.p_expected_revision,patch.revision||17);
  },true,{history:{count:6,correct:6,confirmed:true}});

  await scenario('F2E2c actual difficulty: offline facade and unknown policy remain unavailable without a legacy fallback', 'word', async page=>{
    await verifiedLevel(page,'Normal','Normal');
    const before=await snapshot(page);
    await page.evaluate(()=>{window.KGOffline={client:window.__fakeClient};});
    await levelRegion(page).getByRole('button',{name:'Refresh difficulty',exact:true}).click();
    await levelRegion(page).getByRole('alert').filter({hasText:'online server connection'}).waitFor();
    assert.equal(await wordStart(page).isDisabled(),true);
    assert.equal((await snapshot(page)).levelRequests.length,before.levelRequests.length);
    await page.evaluate(()=>{delete window.KGOffline;window.__kgF1.changeScope({policyState:'unknown'});});
    await levelRegion(page).getByRole('alert').filter({hasText:'learning access must be verified'}).waitFor();
    assert.equal(await wordStart(page).isDisabled(),true);
    assert.equal(await levelChoice(page,'Normal').isDisabled(),true);
    const db=await snapshot(page);
    assert.equal(db.levelRequests.length,before.levelRequests.length);
    assert.equal(db.reads.some(read=>read.table==='kg_chart_user_levels'),false);
    assert.equal(db.levelCalls,0);
  },true,{level:{level:2,unlocked:2,version:1},legacyLevel:{level:4,unlocked:4}});

  await scenario('F2E2c actual difficulty: typed word save is excluded even when confirmed MCQ evidence could advance', 'word', async page=>{
    await verifiedLevel(page);
    await page.getByRole('button',{name:/Type the Word/}).click();
    await page.getByRole('button',{name:/^Start Quiz/}).click();
    for(let index=0;index<4;index++){
      await page.getByRole('button',{name:'Show word',exact:true}).click();
      await page.getByRole('button',{name:index===3?/^See Results/:/^Next Word/}).click();
    }
    await page.getByText('✓ Results saved',{exact:true}).waitFor();
    await page.getByRole('button',{name:'← Back to Setup',exact:true}).click();
    const db=await snapshot(page),draft=db.requests.find(request=>request.table==='kg_chart_f2_save_recovery_quiz').args.p_draft;
    assert.equal(draft.session.quiz_type,'type_word');assert.equal(draft.session.difficulty??null,null);
    assert.equal(db.mcqReceipts[draft.id],undefined);
    assert.equal(levelCalls(db,levelCheckRpc).length,0);
    assert.equal(db.ratingCalls,0);assert.equal(db.levelCalls,0);
  },true,{history:{count:10,correct:10,confirmed:true}});

  await scenario('F2E2c actual difficulty: unavailable refresh retains its verified version floor until a consistent state arrives', 'word', async page=>{
    await verifiedLevel(page,'Normal','Normal');
    for(const response of [{level:1,unlocked:1,version:2},{level:1,unlocked:2,version:3}]){
      await page.evaluate(value=>window.__kgF1.setLevel(value),response);
      await levelRegion(page).getByRole('button',{name:'Refresh difficulty',exact:true}).click();
      await levelRegion(page).getByRole('alert').filter({hasText:'Difficulty could not be verified.'}).waitFor();
      assert.equal(await wordStart(page).isDisabled(),true);
      assert.equal(await levelChoice(page,'Normal').getAttribute('aria-pressed'),'false');
    }
    await page.evaluate(()=>window.__kgF1.setLevel({level:1,unlocked:2,version:4}));
    await levelRegion(page).getByRole('button',{name:'Refresh difficulty',exact:true}).click();
    await verifiedLevel(page,'Easy','Normal');
    await wordStart(page).click({trial:true});
    const db=await snapshot(page);
    assert.equal(levelCalls(db,levelSelectRpc).length,0);assert.equal(levelCalls(db,levelCheckRpc).length,0);
  },true,{level:{level:2,unlocked:2,version:3}});

  await scenario('F2E2c actual difficulty: original quiz-save reply cannot trigger a check after permission revision changes', 'word', async page=>{
    await verifiedLevel(page);
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_save_recovery_quiz','hold'));
    await completeCorrectWord(page);
    await page.getByRole('status').filter({hasText:'Saving…'}).waitFor();
    await page.evaluate(()=>window.__kgF1.changeScope({revision:18}));
    await verifiedLevel(page);
    await page.evaluate(()=>window.__kgF1.release());
    await page.getByRole('status').filter({hasText:'Saving…'}).waitFor({state:'detached'});
    const db=await snapshot(page);
    assert.equal(levelCalls(db,levelCheckRpc).length,0);
    assert.equal(db.requests.length,1);assert.equal(db.tables[sessions].length,2,'The completed original history remains retained');
    assert.equal(await page.getByText(/unlocked!/).count(),0);
  },true,{history:{count:6,correct:6,confirmed:true}});

  await scenario('F2E2c actual difficulty: an old legacy level-up reply cannot overwrite newly restricted state or local history', 'word', async page=>{
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_check_level_up','hold'));
    await completeCorrectWord(page);
    await page.waitForFunction(()=>window.__kgF1.snapshot().levelCalls===1);
    await page.evaluate(()=>window.__kgF1.changeScope({policyState:'restricted'}));
    await verifiedLevel(page);
    await page.evaluate(()=>window.__kgF1.release());
    await verifiedLevel(page);
    assert.equal(await page.getByText(/Normal unlocked!/).count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('kg_chart_level_my')),null,
      'The obsolete legacy continuation must not write an unlock into local storage');
    const db=await snapshot(page);
    assert.equal(db.levelCalls,1);assert.equal(levelCalls(db,levelCheckRpc).length,0);
  },true,{policyState:'legacy'});

  assert.ok(passed>0,'The scenario filter must select at least one real scenario');
  console.log(`U4B2B3D_RENDERED_QUIZ_UI_PASS: ${passed} scenarios; isolated fictional clients; physical devices not tested`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
