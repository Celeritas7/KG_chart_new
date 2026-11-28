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
  // Only the flag route uses a selection larger than one server batch. The
  // original four-word quiz fixtures and all their evidence stay unchanged.
  const flagWords = Array.from({length:12},(_,i)=>({
    ...words[i%words.length],id:`22000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
    english_text:`Word ${i}`,display_text:`Word ${i}`,
    translation:{native_text:`Native ${i}`,devanagari:`शब्द ${i}`},
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
    preferenceRequests: [], preferenceVersions: {}, preferenceReceipts: {}, typingPermissions: {},
    flagRequests: [], flagReceipts: {}, flagDeniedTargets: [], accessModes: {[owner]:'restricted'},
    pathRevision:17,pathReset:null,pathVersion:0,pathComplete:false,pathCompletedAt:null,
    pathEligible:'2026-11-27T12:00:00.123456+00:00',pathReceipts:{},pathRequests:[],
    tables: {
      kg_chart_quiz_sessions: [], kg_chart_quiz_answers: [],
      kg_chart_sentences: sentences,
      kg_chart_colour_phrases: phrases,
      kg_chart_user_ratings: [],
      kg_chart_user_prefs: [{user_id:owner,audio_voice:'f',audio_muted:false,typing_best:{}}],
      kg_chart_user_levels: [{email: 'fixture@example.invalid', language_code: 'my', level: 1, unlocked: 1}],
      kg_chart_flags: [],
    },
  };
  const assertFixture = (condition, message) => { if (!condition) throw Error(message); };
  const persist = () => localStorage.setItem(KEY, JSON.stringify(state));
  persist();
  const canonicalFlag=flag=>Object.fromEntries(['id','language_code','vocabulary_id','sentence_id',
    'colour_phrase_id','reason','notes','shown_devanagari','suggestion'].map(key=>[key,flag[key]??null]));
  const jsonbText=value=>Array.isArray(value)?'['+value.map(jsonbText).join(', ')+']':
    value&&typeof value==='object'?'{'+Object.entries(value).map(([key,item])=>JSON.stringify(key)+': '+jsonbText(item)).join(', ')+'}':JSON.stringify(value);
  const flagTargetAllowed=flag=>!state.flagDeniedTargets.includes(flag.vocabulary_id||flag.sentence_id||flag.colour_phrase_id)&&
    ['my','ja'].includes(flag.language_code)&&(flag.vocabulary_id?flagWords.some(word=>word.id===flag.vocabulary_id):
      flag.sentence_id?sentences.some(sentence=>sentence.id===flag.sentence_id&&sentence.language_code===flag.language_code):
      phrases.some(phrase=>phrase.id===flag.colour_phrase_id&&phrase.language_code===flag.language_code));
  const validFlag=flag=>{
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const bytes=value=>new TextEncoder().encode(value||'').length;
    return flag&&typeof flag==='object'&&!Array.isArray(flag)&&uuid.test(flag.id)&&
      Object.keys(flag).every(key=>['id','language_code','vocabulary_id','sentence_id','colour_phrase_id',
        'reason','notes','status','shown_devanagari','suggestion'].includes(key))&&
      Object.values(flag).every(value=>value===null||typeof value==='string')&&
      typeof flag.language_code==='string'&&flag.language_code.trim().length>0&&flag.language_code.length<=32&&
      [flag.vocabulary_id,flag.sentence_id,flag.colour_phrase_id].filter(value=>value!==null&&value!==undefined).length===1&&
      [flag.vocabulary_id,flag.sentence_id,flag.colour_phrase_id].every(value=>value==null||uuid.test(value))&&
      flag.status==='open'&&['pronunciation','wrong_word','missing_image','missing_translation','needs_review'].includes(flag.reason)&&
      !(flag.sentence_id&&flag.reason==='missing_image')&&!(flag.colour_phrase_id&&flag.reason==='missing_translation')&&
      (flag.suggestion==null||flag.reason==='pronunciation')&&bytes(flag.notes)<=16384&&
      bytes(flag.shown_devanagari)<=8192&&bytes(flag.suggestion)<=8192;
  };
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
  const preferenceRow=ownerId=>state.tables.kg_chart_user_prefs.find(row=>row.user_id===ownerId)||
    {user_id:ownerId,audio_voice:'f',audio_muted:false,typing_best:{}};
  const preferenceInstant=value=>{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
    const millis=Date.parse(value);if(!Number.isFinite(millis))return null;
    const fraction=(value.match(/\.(\d+)/)?.[1]||'').padEnd(6,'0');
    return BigInt(millis)*1000n+BigInt(fraction.slice(3,6));
  };
  const validPreferenceBest=value=>value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join(',')==='at,cpm,last'&&Number.isInteger(value.cpm)&&value.cpm>=0&&value.cpm<=100000&&
    Number.isInteger(value.last)&&value.last>=0&&value.last<=value.cpm&&preferenceInstant(value.at)!==null&&
    preferenceInstant(value.at)<=BigInt(Date.now()+300000)*1000n;
  const preferenceKeyAllowed=(key,ownerId)=>state.typingPermissions[ownerId]!==false&&
    /^(my|ja)\|(copy|recall)\|words(?:\|food)?$/.test(key);
  const preferenceSnapshot=(ownerId,revision)=>{
    const row=preferenceRow(ownerId);
    if(!row.typing_best||typeof row.typing_best!=='object'||Array.isArray(row.typing_best))return null;
    return {owner_id:ownerId,permission_revision:revision,version:state.preferenceVersions[ownerId]||0,
      audio_voice:row.audio_voice,audio_muted:row.audio_muted,typing_best:Object.fromEntries(Object.entries(row.typing_best)
        .filter(([key,value])=>preferenceKeyAllowed(key,ownerId)&&validPreferenceBest(value)))};
  };
  const patchPreferenceRow=(ownerId,patch)=>{
    const old=preferenceRow(ownerId),next=copy(old);
    for(const key of ['audio_voice','audio_muted'])if(Object.hasOwn(patch,key))next[key]=patch[key];
    if(patch.typing_best){
      assertFixture(next.typing_best&&typeof next.typing_best==='object'&&!Array.isArray(next.typing_best),'Invalid historical typing map');
      for(const [key,value] of Object.entries(patch.typing_best)){
        const prior=next.typing_best[key];
        if(!prior)next.typing_best[key]=copy(value);
        else{
          assertFixture(validPreferenceBest(prior),'Touched invalid historical typing value');
          const oldAt=preferenceInstant(prior.at),newAt=preferenceInstant(value.at);
          if(oldAt===newAt&&prior.last!==value.last)return {error:{code:'23505'}};
          next.typing_best[key]={...copy(newAt>oldAt?value:prior),cpm:Math.max(prior.cpm,value.cpm)};
        }
      }
    }
    state.tables.kg_chart_user_prefs=state.tables.kg_chart_user_prefs.filter(row=>row.user_id!==ownerId);
    state.tables.kg_chart_user_prefs.push(next);
    state.preferenceVersions[ownerId]=(state.preferenceVersions[ownerId]||0)+1;persist();
    return {version:state.preferenceVersions[ownerId]};
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
    setAccessMode: value => {state.accessModes[state.owner]=value;persist();},
    denyFlagTarget: id => {state.flagDeniedTargets.push(id);persist();},
    moderateFlag: (id,status='resolved')=>{
      const flag=state.tables.kg_chart_flags.find(row=>row.id===id);
      assertFixture(flag,'Only an existing fictional flag can be moderated');
      flag.status=status;flag.resolved_at='2026-11-28T12:00:00Z';persist();
    },
    seedPreferences: (value,{ownerId=state.owner,version=0,revision=17}={})=>{
      const next={...preferenceRow(ownerId),...copy(value),user_id:ownerId};
      state.tables.kg_chart_user_prefs=state.tables.kg_chart_user_prefs.filter(row=>row.user_id!==ownerId);
      state.tables.kg_chart_user_prefs.push(next);state.preferenceVersions[ownerId]=version;
      state.levelRevisions[ownerId]=revision;persist();
    },
    externalPreferences: (patch,ownerId=state.owner)=>patchPreferenceRow(ownerId,patch),
    permitTyping: (value,ownerId=state.owner)=>{state.typingPermissions[ownerId]=value;persist();},
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
    words, flagWords, user: {id: owner, email: 'fixture@example.invalid'},
  };
  window.__kgF1 = api;
  const initial=window.__kgF1Initial;
  if(initial&&!state.initializedByScenario){
    if(initial.policyState)api.setAccessMode(initial.policyState);
    if(initial.level)api.setLevel(initial.level);
    for(const fault of initial.faults||[])api.fault(fault.table,fault.mode);
    if(initial.legacyLevel){
      state.tables.kg_chart_user_levels[0]={...state.tables.kg_chart_user_levels[0],...initial.legacyLevel};
      localStorage.setItem('kg_chart_level_my',JSON.stringify(initial.legacyLevel));
    }
    if(initial.history)api.levelEvidence(initial.history);
    if(initial.preferences)api.seedPreferences(initial.preferences,initial.preferenceScope);
    if(initial.otherPreferences)api.seedPreferences(initial.otherPreferences,{ownerId:'11000000-0000-4000-8000-000000000099'});
    for(const [key,value] of Object.entries(initial.local||{}))localStorage.setItem(key,JSON.stringify(value));
    if(initial.typingAllowed===false)api.permitTyping(false);
    state.initializedByScenario=true;persist();
  }
  window.__fakeClient = {
    auth: {async getSession() { return {data: {session: state.owner?{user: {id: state.owner}}:null}, error: null}; }},
    async rpc(name, args) {
      if(name==='kg_chart_my_answers')return {data:[],error:null};
      if(name==='kg_chart_f2_submit_flags'){
        const ownerId=state.owner,revision=state.levelRevisions[ownerId]||17;
        state.flagRequests.push({name,args:copy(args),ownerId});persist();
        const i=state.faults.findIndex(fault=>fault.table===name),fault=i<0?null:state.faults.splice(i,1)[0];persist();
        if(!ownerId||args.p_owner_id!==ownerId||!state.permitted||(state.accessModes[ownerId]||'restricted')!=='restricted')
          return {error:{code:'42501',message:'Synthetic reporter or permission denied'}};
        if(args.p_expected_revision!==revision)return {error:{code:'40001',message:'Synthetic permission revision changed'}};
        const flags=args.p_flags;
        if(!Array.isArray(flags)||flags.length<1||flags.length>10||new TextEncoder().encode(jsonbText(flags)).length>262144||flags.some(flag=>!validFlag(flag))||
          new Set(flags.map(flag=>flag.id)).size!==flags.length)return {error:{code:'22023',message:'Synthetic malformed report batch'}};
        // Current target authorization is checked before even an exact replay.
        if(flags.some(flag=>!flagTargetAllowed(flag))||fault?.mode==='deny')
          return {error:{code:'42501',message:'Synthetic flag target denied'}};
        if(fault?.mode==='fail')return {error:{message:'Synthetic flag connection failure'}};
        for(const flag of flags){
          const receipt=state.flagReceipts[flag.id],saved=state.tables.kg_chart_flags.find(row=>row.id===flag.id);
          if(receipt?(receipt.ownerId!==ownerId||JSON.stringify(receipt.payload)!==JSON.stringify(canonicalFlag(flag))||
              !saved||saved.reporter_id!==ownerId||JSON.stringify(canonicalFlag(saved))!==JSON.stringify(receipt.payload)):!!saved)
            return {error:{code:'23505',message:'Synthetic report identity conflict'}};
        }
        // Validate the entire group before changing any row or receipt, just
        // as the native PostgreSQL transaction rolls all rows back together.
        for(const flag of flags)if(!state.flagReceipts[flag.id]){
          state.flagReceipts[flag.id]={ownerId,payload:canonicalFlag(flag)};
          state.tables.kg_chart_flags.push({...copy(flag),reporter_id:ownerId,status:'open'});
        }
        persist();
        const result={flag_ids:flags.map(flag=>flag.id).sort(),count:flags.length,expected_revision:revision};
        if(fault?.mode==='hold')await new Promise(resolve=>{release=resolve;});
        if(fault?.mode==='lost-ack')return {error:{message:'Synthetic flag reply lost after commit'}};
        if(fault?.mode==='wrong-id')result.flag_ids[0]='99000000-0000-4000-8000-000000000001';
        if(fault?.mode==='duplicate-id')result.flag_ids[1]=result.flag_ids[0];
        if(fault?.mode==='extra-id')result.flag_ids.push('99000000-0000-4000-8000-000000000001');
        if(fault?.mode==='wrong-count')result.count++;
        if(fault?.mode==='wrong-revision')result.expected_revision++;
        if(fault?.mode==='reversed')result.flag_ids.reverse();
        return {data:result,error:null};
      }
      if(['kg_chart_f2_my_preferences','kg_chart_f2_patch_preferences'].includes(name)){
        const ownerId=state.owner,revision=state.levelRevisions[ownerId]||17;
        state.preferenceRequests.push({name,args:copy(args),ownerId});persist();
        const i=state.faults.findIndex(fault=>fault.table===name),fault=i<0?null:state.faults.splice(i,1)[0];persist();
        if(!ownerId||ownerId!==args.p_owner_id||!state.permitted)return {error:{code:'42501'}};
        if(args.p_expected_revision!==revision)return {error:{code:'40001'}};
        if(fault?.mode==='fail')return {error:{message:'Synthetic preference reply failure'}};
        if(fault?.mode==='deny')return {error:{code:'42501'}};
        let result;
        if(name==='kg_chart_f2_my_preferences'){
          result=preferenceSnapshot(ownerId,revision);
          if(!result)return {error:{code:'22023'}};
        }else{
          const patch=args.p_patch,keys=patch&&typeof patch==='object'&&!Array.isArray(patch)?Object.keys(patch):[];
          if(!keys.length||keys.some(key=>!['audio_voice','audio_muted','typing_best'].includes(key))||
            (Object.hasOwn(patch,'audio_voice')&&!['m','f'].includes(patch.audio_voice))||
            (Object.hasOwn(patch,'audio_muted')&&typeof patch.audio_muted!=='boolean')||
            (Object.hasOwn(patch,'typing_best')&&(!patch.typing_best||typeof patch.typing_best!=='object'||Array.isArray(patch.typing_best))))
            return {error:{code:'22023'}};
          if(patch.typing_best){
            const entries=Object.entries(patch.typing_best);
            if(entries.length<1||entries.length>50)return {error:{code:'22023'}};
            if(entries.some(([key])=>!preferenceKeyAllowed(key,ownerId)))return {error:{code:'42501'}};
            if(entries.some(([,value])=>!validPreferenceBest(value)))return {error:{code:'22023'}};
          }
          const prior=state.preferenceReceipts[args.p_event_id],version=state.preferenceVersions[ownerId]||0;
          if(prior){
            if(prior.ownerId!==ownerId||JSON.stringify(prior.patch)!==JSON.stringify(patch)||prior.expectedVersion!==args.p_expected_version)
              return {error:{code:'23505'}};
            if(prior.revision!==revision)return {error:{code:'40001'}};
            result={owner_id:ownerId,event_id:args.p_event_id,event_version:prior.eventVersion,
              current_version:version,permission_revision:revision,replayed:true};
          }else{
            if(args.p_expected_version!==version)return {error:{code:'40001'}};
            const next=patchPreferenceRow(ownerId,patch);if(next.error)return next;
            state.preferenceReceipts[args.p_event_id]={ownerId,revision,patch:copy(patch),
              expectedVersion:args.p_expected_version,eventVersion:next.version};persist();
            result={owner_id:ownerId,event_id:args.p_event_id,event_version:next.version,
              current_version:next.version,permission_revision:revision,replayed:false};
          }
        }
        if(fault?.mode==='hold')await new Promise(resolve=>{release=resolve;});
        if(fault?.mode==='lost-ack')return {error:{message:'Synthetic preference receipt lost'}};
        return {data:copy(result),error:null};
      }
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
          const i=state.faults.findIndex(f=>f.table===name&&f.mode==='hold');
          if(i>=0){state.faults.splice(i,1);persist();await new Promise(resolve=>{release=resolve;});}
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
        select(columns) { q.columns=columns;return chain; },
        insert(rows) { q.op = 'insert'; q.rows = copy(Array.isArray(rows) ? rows : [rows]); return chain; },
        upsert(rows) { q.op='upsert';q.rows=copy(Array.isArray(rows)?rows:[rows]);return chain; },
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
            state.reads.push({table,filters:copy(q.filters),columns:q.columns});persist();
            const rows = state.tables[table].filter(row => q.filters.every(([key, value]) =>
              Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(0, q.limit);
            const result=copy(q.one?rows[0]??null:rows);
            const i=state.faults.findIndex(fault=>fault.table===table&&(fault.mode==='hold-read'||
              fault.mode==='hold-typing-read'&&q.columns==='typing_best'));
            if(i>=0){state.faults.splice(i,1);persist();await new Promise(resolve=>{release=resolve;});}
            return {data:result,error:null};
          }
          state.requests.push({table, rows: copy(q.rows)}); persist();
          const faultIndex = state.faults.findIndex(fault => fault.table === table);
          const fault = faultIndex >= 0 ? state.faults.splice(faultIndex, 1)[0] : null;
          persist();
          if (fault?.mode === 'hold') await new Promise(resolve => { release = resolve; });
          if (fault?.mode === 'hold-missing-column') {
            await new Promise(resolve=>{release=resolve;});
            return {data:null,error:{code:'PGRST204',message:'Synthetic missing compatibility column'}};
          }
          if (fault?.mode === 'deny') { state.permitted = false; persist(); }
          if (!state.permitted) return {data: null, error: {code: '42501', message: 'Synthetic RLS denial'}};
          if (fault?.mode === 'fail') return {data: null, error: {message: 'Synthetic connection failure'}};
          if(table==='kg_chart_flags'){
            if((state.accessModes[state.owner]||'restricted')!=='legacy')return {error:{code:'42501',message:'Synthetic restricted direct flag write denied'}};
            if(fault?.mode==='missing-column')return {error:{code:'PGRST204',message:'Synthetic missing compatibility column'}};
            const rows=q.rows.map(row=>({...row,id:row.id||crypto.randomUUID(),reporter_id:state.owner}));
            state.tables[table].push(...rows);persist();
            return {data:copy(rows),error:null};
          }
          if(table==='kg_chart_user_prefs'&&q.op==='upsert'){
            if(q.rows.some(row=>row.user_id!==state.owner))return {error:{code:'42501'}};
            for(const row of q.rows){
              const old=preferenceRow(row.user_id);
              state.tables[table]=state.tables[table].filter(saved=>saved.user_id!==row.user_id);
              state.tables[table].push({...old,...copy(row)});
            }
            persist();return {data:copy(q.one?q.rows[0]:q.rows),error:null};
          }
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
  // Only the whole-App R1 route uses these controlled auth/session boundaries.
  // Earlier component fixtures retain their original injected test contexts.
  if (new URLSearchParams(location.search).get('kind') === 'auth') {
    const other = '11000000-0000-4000-8000-000000000002';
    const holds = [...(initial?.authHolds || [])], requests = [], waiting = new Map();
    const callbacks = new Set();
    let serial = 0, signouts = 0;
    const session = id => id ? {user:{id,email:id === owner ? 'a@example.invalid' : 'b@example.invalid'}} : null;
    const event = (id, type = id ? 'SIGNED_IN' : 'SIGNED_OUT') => {
      state.owner = id;
      persist();
      for (const cb of [...callbacks]) cb(type, session(id));
    };
    const request = async (kind, result) => {
      const id = ++serial, hold = holds.indexOf(kind);
      const row = {id,kind,owner:state.owner,held:hold >= 0,released:false};
      requests.push(row);
      if (hold < 0) return result;
      holds.splice(hold,1);
      return new Promise(resolve => waiting.set(id, override => {
        row.released = true;
        resolve(override === undefined ? result : override);
      }));
    };
    window.__kgAuth = {
      a:owner,b:other, emit:event, silent:id=>{state.owner=id;persist();},
      hold:kind=>holds.push(kind),
      requests:()=>copy(requests), signouts:()=>signouts,
      subscribers:()=>callbacks.size,
      release:(id,override)=>{const fn=waiting.get(id);assertFixture(fn,'Expected held auth request '+id);waiting.delete(id);fn(override);},
      seed:()=>{
        const rating = window.KGRatingSave.createStore().make(
          {ownerId:owner,languageCode:'my',vocabularyId:words[0].id,revision:17},
          {version:0,state:null,permission_revision:17},4);
        window.KGRatingSave.createStore().put(rating);
        const completion={contract:1,ownerId:owner,languageCode:'my',revision:17,
          eventId:crypto.randomUUID(),topicId:'food',expectedVersion:0,resetAt:null,evidenceAt:state.pathEligible};
        window.KGCompletionSave.createStore().put(completion);
        return {rating,completion};
      },
      pending:()=>({
        rating:window.KGRatingSave.createStore().list(owner,'my'),
        completion:window.KGCompletionSave.createStore().list(owner,'my')
      }),
    };
    const original = window.__fakeClient;
    state.tables.kg_chart_languages = [{code:'my',name_english:'Burmese',is_active:true,sort_order:1}];
    state.tables.kg_chart_topics = [{id:'food',sort_order:1,title_english:'Food',
      translations:[{language_code:'my',title_native:'Food',question_native:'Which?',question_english:'Which?'}]}];
    state.tables.kg_chart_vocabulary = words.map(w=>({...w,translations:[{language_code:'my',...w.translation}]}));
    for (const table of ['kg_chart_settings','kg_chart_topic_unlocks','kg_chart_progress_resets','kg_chart_topic_completions']) state.tables[table]=[];
    window.__fakeClient = {...original,
      auth:{
        getSession:()=>request('session',{data:{session:session(state.owner)},error:null}),
        onAuthStateChange:cb=>{callbacks.add(cb);return {data:{subscription:{unsubscribe:()=>callbacks.delete(cb)}}};},
        signOut:async()=>{++signouts;event(null);return {error:null};},
      },
      async rpc(name,args) {
        if(name==='kg_chart_is_allowed') return request('approval',{data:true,error:null});
        if(name==='kg_chart_u3_my_access_snapshot') return request('access',{data:{
          contract:1,mode:'restricted',revision:17,server_enforced:true,languages:['my'],
          topics:[{language_code:'my',topic_id:'food'}],
          features:state.owner===owner?['chart','quiz.words']:['chart'],
        },error:null});
        if(name==='kg_chart_my_private_lesson_visibility')return {data:{contract:1,topics:[],groups:[]},error:null};
        if(name==='kg_chart_u3c2_my_sentence_groups')return {data:null,error:{message:'No sentence scope'}};
        if(name==='kg_chart_is_admin')return {data:false,error:null};
        if(name==='kg_chart_f2_my_completion_path')return {data:{
          owner_id:state.owner,language_code:'my',permission_revision:17,reset_at:null,
          bypass:false,unlocks:[],rules:{min_attempts:1,quiz_types:['native_to_image']},
          topics:[{topic_id:'food',version:0,complete:false,completed_at:null,eligible_at:state.pathEligible}],counts:[]
        },error:null};
        if(name==='kg_chart_f2_my_preferences')return {data:{
          owner_id:state.owner,permission_revision:17,version:0,audio_voice:'f',audio_muted:false,typing_best:{}
        },error:null};
        return original.rpc(name,args);
      }
    };
  }
  window.KGAudio = {
    subscribe: () => () => {}, getVersion: () => 0, stop() {}, play() { return false; },
    autoPlay() {}, has: () => false, stateOf: () => '', toast() {},
    canUsePublicMedia: () => true, requireVerifiedMediaPolicy() {},
    setVerifiedMediaPolicy() {}, loadManifest() {}, initPrefs() {},
    setPreferenceScope() {}, applyPreferenceState() {},
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
    function PreferenceFixture({policy,user,languageCode,audioOnly}){
      const preferences=usePersonalPreferences(user,policy,true);
      return <KGPreferenceContext.Provider value={preferences}>
        <div className="bg-jade-700 text-white p-4 flex items-center justify-between">
          <span>Fictional learner preferences</span>{user&&<AudioControls/>}
        </div>
        <PreferenceRecoveryPanel flow={preferences}/>
        {!audioOnly&&user&&<TypingView key={user.id+':'+languageCode}
          topics={[{id:'food',translation:{title_native:'Food'}}]} vocabulary={fixtureWords}
          languageCode={languageCode} user={user} meaningName="English" accessPolicy={policy}/>}
      </KGPreferenceContext.Provider>;
    }
    function QuizFixture() {
      const [shown, setShown] = useState(true);
      const [identity,setIdentity]=useState({user:fixtureUser,languageCode:'my',revision:17,
        policyState:window.__kgF1Initial?.policyState||'restricted'});
      useEffect(()=>{
        window.__kgF1.changeScope=patch=>{
          if(patch.logout)window.__kgF1.setOwner(null);
          else if(patch.ownerId)window.__kgF1.setOwner(patch.ownerId);
          if(patch.revision!==undefined)window.__kgF1.levelRevision(patch.revision);
          if(patch.policyState)window.__kgF1.setAccessMode(patch.policyState);
          setIdentity(old=>({user:patch.logout?null:patch.ownerId?{...fixtureUser,...old.user,id:patch.ownerId}:old.user,
            languageCode:patch.languageCode||old.languageCode,revision:patch.revision??old.revision,
            policyState:patch.policyState||old.policyState}));
        };
        return()=>{delete window.__kgF1.changeScope;};
      },[]);
      const kind = new URLSearchParams(location.search).get('kind') || 'word';
      const restricted = new URLSearchParams(location.search).get('restricted') === 'yes';
      const scope = restricted ? {ownerId:identity.user?.id, policy:{state:identity.policyState, revision:kind==='path'?window.__kgF1.snapshot().pathRevision:identity.revision}} : null;
      return <AuthContext.Provider value={{ user: identity.user }}>
        <KGMediaScopeContext.Provider value={scope}>
        <RulesContext.Provider value={fixtureRules}>
          <PrivateLessonsContext.Provider value={fixturePrivate}>
            <div aria-label="Fixture navigation" data-fixture-owner={identity.user?.id}
              data-fixture-language={identity.languageCode} data-fixture-revision={identity.revision}>
              <button onClick={() => setShown(false)}>Leave quiz view</button>
              <button onClick={() => setShown(true)}>Reopen quiz view</button>
            </div>
            {(kind.startsWith('flags')||kind==='rating-flags')&&<FlagRecoveryPanel user={identity.user}
              languageCode={identity.languageCode} policy={scope?.policy}/>}
            {shown ? kind === 'word'
              ? <WordQuizView key={identity.user?.id+':'+identity.languageCode} topics={[{ id: 'food', icon: '🍎', translation: { title_native: 'Food' } }]}
                  vocabulary={fixtureWords} poolVocabulary={fixtureWords} ratings={{}}
                  onRate={window.__kgF1.rate} languageCode={identity.languageCode} user={identity.user}
                  onSessionSaved={window.__kgF1.callback} meaningName="English" />
              : kind === 'typing' ? <TypingView topics={[{id:'food',translation:{title_native:'Food'}}]}
                  vocabulary={fixtureWords} languageCode="my" user={fixtureUser} meaningName="English" accessPolicy={scope?.policy} />
              : kind === 'speaking' ? <SpeakView languageCode="my" user={fixtureUser} meaningName="English"
                  sentenceAccess={fixtureSentenceAccess} />
              : kind === 'colour' ? <ColourQuizView languageCode="my" user={fixtureUser} />
              : ['ratings','rating-cards','rating-chart','rating-flags'].includes(kind) ? <RatingFixture policy={scope?.policy}
                  cards={kind==='rating-cards'} chart={kind==='rating-chart'||kind==='rating-flags'} languageCode={identity.languageCode} user={identity.user}/>
              : kind === 'path' ? <PathFixture policy={scope?.policy}/>
              : kind.startsWith('preferences') ? <PreferenceFixture policy={scope?.policy} user={identity.user}
                  languageCode={identity.languageCode} audioOnly={kind==='preferences-audio'}/>
              : kind==='flags-chart' ? <ChartView topic={{id:'food',icon:'🍎',translation:{title_native:'Food'}}}
                  vocabulary={window.__kgF1.flagWords} ratings={{}} onRate={window.__kgF1.rate}
                  languageCode={identity.languageCode} showEnglish onToggleEnglish={()=>{}} meaningName="English"/>
              : kind==='flags-colour' ? <ColourQuizView languageCode={identity.languageCode} user={identity.user}/>
              : kind==='flags-sentence' ? <SentenceQuizView languageCode={identity.languageCode} user={identity.user}
                  meaningName="English" sentenceAccess={fixtureSentenceAccess} onSessionSaved={window.__kgF1.callback}/>
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
// Compile the complete canonical App without injecting AuthContext. The
// restricted flag is altered only in this disposable test string.
const authSource = script.replace(clientSource, 'const supabase = window.__fakeClient;')
  .replace('const U3C1_SCOPED_UI_ENABLED = false;', "const U3C1_SCOPED_UI_ENABLED = new URLSearchParams(location.search).get('restricted') === 'yes';")
  .replace(mountSource, "const authRoot = ReactDOM.createRoot(document.getElementById('root')); authRoot.render(<App />); window.__kgUnmount = () => authRoot.unmount();");
assert.notEqual(authSource,script);
const {code:authCode} = await transform(authSource,{loader:'jsx',target:'es2022',format:'iife'});
const assets = new Map([
  ['/react.js', await readFile('node_modules/react/umd/react.development.js')],
  ['/react-dom.js', await readFile('node_modules/react-dom/umd/react-dom.development.js')],
  ['/fixture.js', `(${installFakeClient.toString()})();`],
  ['/app.js', code],
  ['/auth-app.js', authCode],
  ['/app.css', canonicalStyles],
]);
for (const filename of ['kg-shared.js', 'kg-learner-access.js', 'kg-sentence-access.js', 'kg-quiz-save.js']) {
  assets.set('/' + filename, await readFile('js/' + filename));
}
assets.set('/kg-audio.js',await readFile('js/kg-audio.js'));
const html = (actualAudio,authRoute) => '<!doctype html><html><head><meta charset="UTF-8"><title>Isolated F1 UI fixture</title>' +
  '<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div>' +
  [...assets.keys()].filter(path => path.endsWith('.js') && path !== '/app.js' && path !== '/auth-app.js'&&(path!=='/kg-audio.js'||actualAudio)).map(path => `<script src="${path}"></script>`).join('') +
  '<script src="' + (authRoute ? '/auth-app.js' : '/app.js') + '"></script></body></html>';
const server = createServer((req, res) => {
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
  const content = path === '/' ? html(url.searchParams.get('kind')?.startsWith('preferences'),url.searchParams.get('kind')==='auth') : assets.get(path);
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
    if(kind==='auth') { /* The test controls initial session and approval replies. */ }
    else if (kind==='typing') await page.getByRole('button', {name:'Start',exact:true}).waitFor();
    else if (kind==='speaking') await page.getByRole('button', {name:/Whole paragraph/}).waitFor();
    else if(['ratings','rating-cards','rating-chart','rating-flags'].includes(kind))await page.locator('[data-ratings-loaded="yes"]').waitFor({state:'attached'});
    else if(kind==='path')await page.locator('[data-path-ready="yes"]').waitFor({state:'attached'});
    else if(kind.startsWith('preferences')){
      if(initial?.policyState==='legacy')await page.getByRole('button',{name:'Change audio voice',exact:true}).waitFor();
      else await page.getByRole('region',{name:'Personal preferences'}).waitFor();
    }
    else if(kind==='flags-chart')await page.locator('#chart-card-22000000-0000-4000-8000-000000000001').waitFor();
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
const flagRpc='kg_chart_f2_submit_flags';
const flagDialog=(page,batch=false)=>page.getByRole('dialog',{name:batch?'Batch flags for review':'Flag for review',exact:true});
const flagRecovery=page=>page.getByRole('region',{name:'Flag recovery',exact:true});
const pendingFlags=page=>page.evaluate(()=>Object.keys(localStorage)
  .filter(key=>key.startsWith('kg-chart-flag-recovery-v1:'))
  .map(key=>JSON.parse(localStorage.getItem(key))));
async function openWordFlag(page,index=0){
  await page.locator('#chart-card-22000000-0000-4000-8000-'+String(index+1).padStart(12,'0'))
    .locator('img').click();
  await page.getByTitle('Report an issue',{exact:true}).click();
  await flagDialog(page).waitFor();
  return flagDialog(page);
}
async function openBatchFlags(page){
  await page.getByRole('button',{name:'🚩 Flag Mode',exact:true}).click();
  await page.getByRole('button',{name:'Select All',exact:true}).click();
  await page.getByRole('button',{name:'Submit Flags →',exact:true}).click();
  const dialog=flagDialog(page,true);await dialog.waitFor();
  await dialog.getByRole('button',{name:/Needs Review \/ Unsure/}).click();
  await dialog.locator('textarea').fill('Original batch notes — စမ်းသပ်');
  return dialog;
}
async function flagDownload(page,button){
  const downloadReady=page.waitForEvent('download');
  await button.click();
  const download=await downloadReady,path=await download.path();
  assert.ok(path,'The original authored flag work must be exportable');
  return JSON.parse(await readFile(path,'utf8'));
}
function assertFlagOnlyRpc(db){
  assert.equal(db.requests.filter(request=>request.table==='kg_chart_flags').length,0,
    'Restricted reports must never use direct inserts or schema compatibility fallback');
}
const preferenceReadRpc='kg_chart_f2_my_preferences';
const preferencePatchRpc='kg_chart_f2_patch_preferences';
const preferenceRegion=page=>page.getByRole('region',{name:'Personal preferences'});
const audioVoice=page=>page.getByRole('button',{name:'Change audio voice',exact:true});
const audioMute=page=>page.getByRole('button',{name:'Toggle automatic audio',exact:true});
const preferenceCalls=(db,name)=>db.preferenceRequests.filter(request=>request.name===name);
const pendingPreferences=page=>page.evaluate(()=>Object.keys(localStorage)
  .filter(key=>key.startsWith(window.KGPreferenceSave.storagePrefix))
  .map(key=>JSON.parse(localStorage.getItem(key))));
async function preferencesReady(page,voice='f',muted=false){
  await preferenceRegion(page).getByText('Personal preferences verified.',{exact:true}).waitFor();
  assert.equal(await audioVoice(page).getAttribute('title'),`Voice: ${voice==='f'?'female':'male'} (tap to switch)`);
  assert.equal(await audioMute(page).getAttribute('title'),muted?'Auto-play off (🔊 buttons still work)':'Auto-play on');
}
async function finishPreferenceTyping(page,{afterStart,delay=1250}={}){
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await afterStart?.();
  const copyPrompt=page.locator('[aria-label^="Native "]');
  const text=await copyPrompt.count()?await copyPrompt.getAttribute('aria-label'):
    'Native '+(await page.getByText(/^Word [0-3]$/).first().textContent()).trim().slice(-1);
  await page.getByRole('textbox',{name:'Type here'}).fill(text);
  // A real, short elapsed interval keeps CPM finite and exercises the actual
  // run clock; no saved metric is injected into the component.
  await page.waitForTimeout(delay);
  await page.getByRole('button',{name:'← Back',exact:true}).click();
  await page.getByText('✓ Results saved',{exact:true}).waitFor();
}
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

  // R1: wait for specific captured replies rather than substituting an injected
  // AuthContext or racing arbitrary sleeps.
  const held=async(page,kind,ownerId=null,exclude=null)=>{
    const h=await page.waitForFunction(({kind,ownerId,exclude})=>window.__kgAuth.requests().find(r=>
      r.kind===kind&&r.held&&!r.released&&(!ownerId||r.owner===ownerId)&&r.id!==exclude),{kind,ownerId,exclude});
    const row=await h.jsonValue();await h.dispose();return row;
  };
  const emit=(page,id,type)=>page.evaluate(({id,type})=>window.__kgAuth.emit(id,type),{id,type});
  const hold=(page,kind)=>page.evaluate(kind=>window.__kgAuth.hold(kind),kind);
  const releaseAuth=async(page,row,override)=>{
    await page.evaluate(({id,override})=>window.__kgAuth.release(id,override),{id:row.id,override});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const authA='11000000-0000-4000-8000-000000000001',authB='11000000-0000-4000-8000-000000000002';
  const header=page=>page.getByRole('heading',{name:'KG Vocabulary Chart'});
  const welcome=page=>page.getByRole('heading',{name:'Welcome Back'});
  const ratingDownload=page=>page.getByRole('button',{name:'Download pending rating',exact:true});
  const completionDownload=page=>page.getByRole('button',{name:'Download pending completion',exact:true});
  const noRecovery=async page=>{
    assert.equal(await ratingDownload(page).count(),0);
    assert.equal(await completionDownload(page).count(),0);
    assert.equal(await page.getByText(/original completion pending/).count(),0);
  };
  const ownerIs=async(page,email)=>{
    await header(page).waitFor();
    const menu=page.getByRole('button',{name:'👤',exact:true});
    await menu.click();await page.getByText(email,{exact:true}).waitFor();await menu.click();
  };
  const noSignout=async page=>assert.equal(await page.evaluate(()=>window.__kgAuth.signouts()),0);
  const noMutations=async page=>{
    const db=await snapshot(page);
    assert.equal(db.requests.length,0);
    assert.equal(db.ratingRequests.filter(r=>r.name==='kg_chart_f2_save_progress').length,0);
    assert.equal(db.pathRequests.filter(r=>r.name==='kg_chart_f2_complete_topic').length,0);
    assert.equal(db.preferenceRequests.filter(r=>r.name==='kg_chart_f2_patch_preferences').length,0);
  };
  const retained=async(page,original)=>{
    assert.deepEqual(await page.evaluate(()=>window.__kgAuth.pending()),{rating:[original.rating],completion:[original.completion]});
  };

  await scenario('R1 late approval after sign-out cannot open the real App','auth',async page=>{
    const first=await held(page,'approval',authA);
    await emit(page,null);await welcome(page).waitFor();
    await releaseAuth(page,first);
    await welcome(page).waitFor();assert.equal(await header(page).count(),0);
    await noRecovery(page);await noSignout(page);
  },true,{authHolds:['approval']});

  for(const approved of [true,false])await scenario('R1 stale A '+(approved?'approval':'denial')+' cannot replace or sign out B','auth',async page=>{
    const first=await held(page,'approval',authA);
    const original=await page.evaluate(()=>window.__kgAuth.seed());
    await emit(page,authB);await ownerIs(page,'b@example.invalid');await noRecovery(page);
    await releaseAuth(page,first,{data:approved,error:null});
    await ownerIs(page,'b@example.invalid');await noRecovery(page);await noSignout(page);
    await retained(page,original);await noMutations(page);
  },true,{authHolds:['approval']});

  await scenario('R1 A to B to A requires the newest approval generation','auth',async page=>{
    const old=await held(page,'approval',authA);
    await emit(page,authB);await ownerIs(page,'b@example.invalid');
    await hold(page,'approval');await emit(page,authA);
    const next=await held(page,'approval',authA,old.id);
    await releaseAuth(page,old);assert.equal(await header(page).count(),0);
    await releaseAuth(page,next);await ownerIs(page,'a@example.invalid');await noSignout(page);
  },true,{authHolds:['approval']});

  await scenario('R1 same-owner token event invalidates pending approval','auth',async page=>{
    const old=await held(page,'approval',authA);
    await hold(page,'approval');await emit(page,authA,'TOKEN_REFRESHED');
    const next=await held(page,'approval',authA,old.id);
    await releaseAuth(page,old,{data:false,error:null});await noSignout(page);
    assert.equal(await header(page).count(),0);
    await releaseAuth(page,next);await ownerIs(page,'a@example.invalid');
  },true,{authHolds:['approval']});

  for(const target of [authB,null])await scenario('R1 delayed initial session loses to '+(target?'B login':'sign-out'),'auth',async page=>{
    const initial=await held(page,'session',authA);
    await emit(page,target);
    if(target)await ownerIs(page,'b@example.invalid');else await welcome(page).waitFor();
    await releaseAuth(page,initial);
    if(target)await ownerIs(page,'b@example.invalid');else {
      await welcome(page).waitFor();assert.equal(await header(page).count(),0);
    }
    await noRecovery(page);await noSignout(page);
  },true,{authHolds:['session']});

  await scenario('R1 current denial still signs out its own account','auth',async page=>{
    const first=await held(page,'approval',authA);
    await releaseAuth(page,first,{data:false,error:null});
    await welcome(page).waitFor();await page.getByText(/isn't approved for KG Chart/).waitFor();
    assert.equal(await page.evaluate(()=>window.__kgAuth.signouts()),1);
    assert.equal(await header(page).count(),0);
  },true,{authHolds:['approval']});

  await scenario('R1 access reply after owner change stays isolated; original downloads return with A','auth',async page=>{
    const first=await held(page,'access',authA);
    const original=await page.evaluate(()=>window.__kgAuth.seed());
    await emit(page,authB);await ownerIs(page,'b@example.invalid');await noRecovery(page);
    await releaseAuth(page,first);await ownerIs(page,'b@example.invalid');await noRecovery(page);
    await retained(page,original);
    await emit(page,authA);await ownerIs(page,'a@example.invalid');
    for(const [button,event] of [[ratingDownload(page),original.rating],[completionDownload(page),original.completion]]){
      await button.waitFor();
      const downloaded=page.waitForEvent('download');await button.click();
      assert.deepEqual(JSON.parse(await readFile(await (await downloaded).path(),'utf8')),event);
    }
    await page.getByRole('button',{name:'👤',exact:true}).click();
    await page.getByRole('button',{name:'Sign Out',exact:true}).click();
    await welcome(page).waitFor();await noRecovery(page);await retained(page,original);
    assert.equal(await page.evaluate(()=>window.__kgAuth.signouts()),1);
    await emit(page,authA);await ratingDownload(page).waitFor();await completionDownload(page).waitFor();
    await retained(page,original);await noMutations(page);
  },true,{authHolds:['access']});

  await scenario('R1 current session must match access reply even before auth event arrives','auth',async page=>{
    const first=await held(page,'access',authA);
    const original=await page.evaluate(()=>window.__kgAuth.seed());
    await page.evaluate(id=>window.__kgAuth.silent(id),authB);
    await releaseAuth(page,first);
    await page.getByText('Learning access unavailable',{exact:true}).waitFor();
    await noRecovery(page);assert.equal(await header(page).count(),0);
    await emit(page,authB);await ownerIs(page,'b@example.invalid');
    await noRecovery(page);await retained(page,original);await noMutations(page);
  },true,{authHolds:['access']});

  await scenario('R1 A to B to A cannot adopt an earlier A access snapshot','auth',async page=>{
    const first=await held(page,'access',authA);
    const original=await page.evaluate(()=>window.__kgAuth.seed());
    await emit(page,authB);await ownerIs(page,'b@example.invalid');
    await hold(page,'access');await emit(page,authA);
    const next=await held(page,'access',authA,first.id);
    await releaseAuth(page,first);await noRecovery(page);assert.equal(await header(page).count(),0);
    await releaseAuth(page,next);await ratingDownload(page).waitFor();await completionDownload(page).waitFor();
    await ownerIs(page,'a@example.invalid');await retained(page,original);await noMutations(page);
  },true,{authHolds:['access']});

  await scenario('R1 unmount invalidates deferred callbacks and stale denials','auth',async page=>{
    const first=await held(page,'approval',authA);
    await page.evaluate(()=>{window.__kgAuth.emit(window.__kgAuth.b);window.__kgUnmount();});
    await releaseAuth(page,first,{data:false,error:null});
    await noSignout(page);
    assert.equal(await page.evaluate(()=>window.__kgAuth.subscribers()),0);
    assert.equal(await page.evaluate(()=>window.__kgAuth.requests().filter(r=>r.kind==='approval').length),1);
    assert.equal(await page.locator('#root').innerText(),'');
  },true,{authHolds:['approval']});

  await scenario('R1 activation-off real App keeps legacy route without access snapshot RPC','auth',async page=>{
    await ownerIs(page,'a@example.invalid');
    assert.equal(await page.evaluate(()=>window.__kgAuth.requests().filter(r=>r.kind==='access').length),0);
    await emit(page,authA,'TOKEN_REFRESHED');await ownerIs(page,'a@example.invalid');
    assert.equal(await page.evaluate(()=>window.__kgAuth.requests().filter(r=>r.kind==='approval').length),1);
    await noRecovery(page);
  },false,{authHolds:[]});

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

  // R2: use the real styled rating and flag consumers in the same Chart.
  // No synthetic modal implementation and no forced user clicks.
  const queuedRating=page=>page.locator('[role="dialog"][aria-label="Confirm rating change"]');
  const startHeldRating=async(page,batch=false)=>{
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_f2_my_progress_state','hold'));
    if(batch){
      await chartCard(page).hover();
      await chartCard(page).getByTitle("Don't know",{exact:true}).click();
    }else{
      await openWordDetail(page);
      await detailRating(page).click();
    }
    await page.waitForFunction(()=>window.__kgF1.snapshot().ratingRequests.some(r=>r.name==='kg_chart_f2_my_progress_state'));
    assert.equal(ratingWrites(await snapshot(page)).length,0);
    assert.equal(await queuedRating(page).count(),0,'Baseline is genuinely still pending');
  };
  const rootAttributes=page=>page.locator('#root').evaluate(el=>({inert:el.getAttribute('inert'),hidden:el.getAttribute('aria-hidden')}));
  const assertIsolated=async page=>{
    assert.deepEqual(await rootAttributes(page),{inert:'',hidden:'true'});
    assert.equal(await page.getByRole('dialog').count(),1,'Exactly one accessible dialog owns the surface');
  };
  const observeIsolation=page=>page.evaluate(()=>{
    const root=document.getElementById('root');window.__r2Isolation=[];
    new MutationObserver(records=>{for(const rec of records)window.__r2Isolation.push({
      attribute:rec.attributeName,old:rec.oldValue,inert:root.getAttribute('inert'),hidden:root.getAttribute('aria-hidden')});
    }).observe(root,{attributes:true,attributeOldValue:true,attributeFilter:['inert','aria-hidden']});
  });
  const assertUnbrokenIsolation=async page=>{
    const records=await page.evaluate(()=>window.__r2Isolation);
    assert.deepEqual(records,[],'Root isolation attributes must not be touched between dialogs');
  };
  const openFlagWhileHeld=async(page,batch=false)=>{
    if(batch)return openBatchFlags(page);
    await wordDetail(page).getByTitle('Report an issue',{exact:true}).click();
    const f=flagDialog(page);await f.waitFor();return f;
  };
  const releaseIntoQueue=async(page,flag)=>{
    await page.evaluate(()=>window.__kgF1.release());
    await queuedRating(page).waitFor({state:'attached'});
    assert.equal(await queuedRating(page).isVisible(),false);
    assert.equal(await queuedRating(page).evaluate(el=>el.parentElement.inert&&el.parentElement.getAttribute('aria-hidden')==='true'),true);
    await assertIsolated(page);
    assert.equal(await flag.evaluate(el=>el.contains(document.activeElement)),true);
    assert.equal(await dialog(page).count(),0);
    // Even a direct synthetic activation of a waiting button is ignored.
    await queuedRating(page).locator('button').last().evaluate(el=>el.click());
    assert.equal(ratingWrites(await snapshot(page)).length,0);
  };
  const assertCompositionEscape=async(page,flag,notes)=>{
    const input=flag.locator('textarea');
    await input.focus();
    await input.evaluate(el=>{
      el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'あ'}));
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'あ'}));
    });
    assert.equal(await flag.isVisible(),true,'Composition-tracked Escape must not dismiss the editor');
    await input.evaluate(el=>{
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,isComposing:true}));
    });
    assert.equal(await flag.isVisible(),true,'Native composing Escape must not dismiss the editor');
    assert.equal(await input.inputValue(),notes);
    await expectFocus(input);
  };

  await scenario('R2 styled detail: late rating queues behind single report; pointer close and explicit confirm retain original flag', 'rating-flags', async page=>{
    await page.locator('#root').evaluate(el=>el.setAttribute('aria-hidden','false'));
    await startHeldRating(page);
    const flag=await openFlagWhileHeld(page);
    const notes='Original overlapping report — စမ်းသပ်',suggestion='सुधार';
    await flag.locator('input').fill(suggestion);await flag.locator('textarea').fill(notes);
    await flag.locator('textarea').focus();
    await observeIsolation(page);
    await releaseIntoQueue(page,flag);
    await expectFocus(flag.locator('textarea'));
    await assertCompositionEscape(page,flag,notes);
    await page.evaluate(()=>document.querySelector('#root button').focus());
    assert.equal(await flag.evaluate(el=>el.contains(document.activeElement)),true);
    await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    await expectFocus(flag.locator('textarea'));
    await page.evaluate(name=>window.__kgF1.fault(name,'fail'),flagRpc);
    await flag.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await flag.getByText('0 of 1 flags confirmed.',{exact:true}).waitFor();
    await flag.getByRole('button',{name:'Retry exact flags',exact:true}).click({trial:true});
    const [original]=await pendingFlags(page);assert.ok(original);
    assert.equal(original.flags[0].notes,notes);assert.equal(original.flags[0].suggestion,suggestion);
    const exported=await flagDownload(page,flag.getByRole('button',{name:'Download pending flags',exact:true}));
    assert.deepEqual(exported.draft,original);
    await flag.getByRole('button',{name:'Close and keep pending flags',exact:true}).click();
    await flag.waitFor({state:'hidden'});await dialog(page).waitFor();
    await assertIsolated(page);await assertUnbrokenIsolation(page);
    await expectFocus(dialog(page).getByRole('button',{name:'Cancel',exact:true}));
    await page.keyboard.press('Shift+Tab');await expectFocus(dialog(page).getByRole('button',{name:'Confirm rating',exact:true}));
    assert.equal(ratingWrites(await snapshot(page)).length,0);
    await dialog(page).getByRole('button',{name:'Confirm rating',exact:true}).click();
    await queuedRating(page).waitFor({state:'detached'});
    await page.locator('[data-fixture-rating="4"]').waitFor({state:'attached'});
    assert.deepEqual(await rootAttributes(page),{inert:null,hidden:'false'});
    await page.waitForFunction(()=>{
      const el=document.activeElement;
      return el?.isConnected&&el!==document.body&&document.getElementById('root').contains(el)&&!el.closest('[inert],[aria-hidden="true"]');
    });
    assert.deepEqual(await pendingFlags(page),[original]);
    assert.equal((await snapshot(page)).flagRequests.length,1);
    assert.equal(ratingWrites(await snapshot(page)).length,1);
    await flagRecovery(page).getByRole('button',{name:'Retry exact flags',exact:true}).click();
    await page.waitForFunction(()=>window.__kgF1.snapshot().flagRequests.length===2&&
      !Object.keys(localStorage).some(k=>k.startsWith('kg-chart-flag-recovery-v1:')));
    const db=await snapshot(page);
    assert.deepEqual(db.flagRequests[1].args,db.flagRequests[0].args);
    assert.equal(db.tables.kg_chart_flags.length,1);
    assertFlagOnlyRpc(db);
  },true);

  await scenario('R2 styled batch: keyboard dismissal serializes late review; composition and lost-ack draft stay intact','rating-flags',async page=>{
    await page.setViewportSize({width:390,height:844});
    await startHeldRating(page,true);
    const flag=await openFlagWhileHeld(page,true);
    const notes='Original batch overlap — 日本語';
    await flag.locator('textarea').fill(notes);await flag.locator('textarea').focus();
    await observeIsolation(page);await releaseIntoQueue(page,flag);
    await assertCompositionEscape(page,flag,notes);
    await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    await expectFocus(flag.locator('textarea'));
    await page.evaluate(name=>window.__kgF1.fault(name,'lost-ack'),flagRpc);
    await flag.getByRole('button',{name:'Flag 4 Items',exact:true}).click();
    await flag.getByRole('button',{name:'Retry exact flags',exact:true}).click({trial:true});
    const [original]=await pendingFlags(page);assert.equal(original.flags.length,4);
    assert.ok(original.flags.every(f=>f.notes===notes));
    await page.keyboard.press('Escape');
    await flag.waitFor({state:'hidden'});await dialog(page).waitFor();
    await assertIsolated(page);await assertUnbrokenIsolation(page);
    await expectFocus(dialog(page).getByRole('button',{name:'Cancel',exact:true}));
    await page.keyboard.press('Tab');await expectFocus(dialog(page).getByRole('button',{name:'Confirm rating',exact:true}));
    await page.keyboard.press('Escape');await queuedRating(page).waitFor({state:'detached'});
    assert.deepEqual(await rootAttributes(page),{inert:null,hidden:null});
    assert.equal(ratingWrites(await snapshot(page)).length,0);
    assert.deepEqual(await pendingFlags(page),[original]);
    await flagRecovery(page).getByRole('button',{name:'Retry exact flags',exact:true}).click();
    await page.waitForFunction(()=>window.__kgF1.snapshot().flagRequests.length===2&&
      !Object.keys(localStorage).some(k=>k.startsWith('kg-chart-flag-recovery-v1:')));
    const db=await snapshot(page);
    assert.deepEqual(db.flagRequests[1].args,db.flagRequests[0].args);
    assert.equal(db.tables.kg_chart_flags.length,4);
    assertFlagOnlyRpc(db);
  },true);

  await scenario('R2 flag closes before rating reply; exact preexisting root attributes restored after rating cancel','rating-flags',async page=>{
    await startHeldRating(page);
    const flag=await openFlagWhileHeld(page);
    await flag.getByRole('button',{name:'Cancel',exact:true}).click();
    await flag.waitFor({state:'hidden'});
    assert.deepEqual(await rootAttributes(page),{inert:null,hidden:null});
    await page.locator('#root').evaluate(el=>{el.setAttribute('inert','preexisting');el.setAttribute('aria-hidden','false');});
    await page.evaluate(()=>window.__kgF1.release());
    await dialog(page).waitFor();await assertIsolated(page);
    await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
    await queuedRating(page).waitFor({state:'detached'});
    assert.deepEqual(await rootAttributes(page),{inert:'preexisting',hidden:'false'});
    assert.equal(ratingWrites(await snapshot(page)).length,0);
    assert.equal((await snapshot(page)).flagRequests.length,0);
  },true);

  for(const [kind,patch] of [
    ['owner',{ownerId:'11000000-0000-4000-8000-000000000002'}],
    ['language',{languageCode:'ja'}],['revision',{revision:18}]
  ])await scenario('R2 queued rating removed on '+kind+' change without stealing focus or unlocking flag editor','rating-flags',async page=>{
    await startHeldRating(page,true);
    // Flag Mode replaces the inline rating controls; keep the actual original
    // element before changing modes. Also retain the live batch opener, which
    // is still connected under the root's inert layer.
    const origin=await chartCard(page).getByTitle("Don't know",{exact:true}).elementHandle();
    const flag=await openFlagWhileHeld(page,true);
    const flagOrigin=await page.getByText('Submit Flags →',{exact:true}).elementHandle();
    await releaseIntoQueue(page,flag);
    await observeIsolation(page);
    await page.evaluate(patch=>window.__kgF1.changeScope(patch),patch);
    await queuedRating(page).waitFor({state:'detached'});
    await flag.getByRole('heading',{name:'Report context changed',exact:true}).waitFor();
    await assertIsolated(page);await assertUnbrokenIsolation(page);
    await expectFocus(flag.getByRole('button',{name:'Close',exact:true}));
    await page.keyboard.press('Escape');
    await flag.waitFor({state:'hidden'});
    assert.deepEqual(await rootAttributes(page),{inert:null,hidden:null});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await origin.evaluate(el=>document.activeElement===el),false,'No focus restore to obsolete rating scope');
    assert.equal(await flagOrigin.evaluate(el=>document.activeElement===el),false,'No focus restore to the old flag opener');
    assert.equal(ratingWrites(await snapshot(page)).length,0);
    assert.equal((await snapshot(page)).flagRequests.length,0);
  },true);

  await scenario('R2 late baseline from obsolete scope never opens after flag editor context change','rating-flags',async page=>{
    await startHeldRating(page);
    const flag=await openFlagWhileHeld(page);
    await page.evaluate(()=>window.__kgF1.changeScope({revision:18}));
    await flag.getByRole('heading',{name:'Report context changed',exact:true}).waitFor();
    await page.evaluate(()=>window.__kgF1.release());
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await queuedRating(page).count(),0);
    await assertIsolated(page);
    await flag.getByRole('button',{name:'Close',exact:true}).click();
    await flag.waitFor({state:'hidden'});
    assert.deepEqual(await rootAttributes(page),{inert:null,hidden:null});
    assert.equal(ratingWrites(await snapshot(page)).length,0);
  },true);

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

  await scenario('F2E2d actual preferences: failed read preserves unowned local history and never guesses an account baseline', 'preferences', async page=>{
    await preferenceRegion(page).getByText(/server did not confirm this preference change/i).waitFor();
    assert.equal(await audioVoice(page).isDisabled(),true);assert.equal(await audioMute(page).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Start',exact:true}).isDisabled(),true);
    await page.getByText(/Verify personal preferences before starting/).waitFor();
    assert.equal((await pendingPreferences(page)).length,0);
    let db=await snapshot(page);
    assert.equal(preferenceCalls(db,preferencePatchRpc).length,0);
    assert.equal(db.reads.some(read=>read.table==='kg_chart_user_prefs'),false);
    assert.equal(db.requests.some(request=>request.table==='kg_chart_user_prefs'),false);
    assert.equal(await page.getByText('New personal best!',{exact:true}).count(),0);
    await preferenceRegion(page).getByRole('button',{name:'Refresh preferences',exact:true}).click();
    await preferencesReady(page);
    db=await snapshot(page);
    assert.equal(preferenceCalls(db,preferencePatchRpc).length,0,'Initial account read must not upload either old local mirror');
    const local=await page.evaluate(()=>({audio:JSON.parse(localStorage.getItem('kg_chart_audio_prefs')),
      bests:JSON.parse(localStorage.getItem('kg_chart_typing_best'))}));
    assert.deepEqual(local,{audio:{voice:'m',muted:true},bests:{'my|copy|words':{cpm:99999,last:99999,at:'2026-01-01T10:00:00Z'}}});
  },true,{faults:[{table:preferenceReadRpc,mode:'fail'}],local:{
    kg_chart_audio_prefs:{voice:'m',muted:true},
    kg_chart_typing_best:{'my|copy|words':{cpm:99999,last:99999,at:'2026-01-01T10:00:00Z'}}}});

  await scenario('F2E2d actual audio controls: field-only voice and mute wait for receipt and current readback', 'preferences-audio', async page=>{
    await preferencesReady(page);
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),preferencePatchRpc);
    await audioVoice(page).dblclick();
    await page.waitForFunction(name=>window.__kgF1.snapshot().preferenceRequests.some(request=>request.name===name),preferencePatchRpc);
    assert.equal(await audioVoice(page).getAttribute('title'),'Voice: female (tap to switch)');
    assert.equal(await audioVoice(page).isDisabled(),true);assert.equal(await audioMute(page).isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.KGAudio.prefs.voice),'f');
    const [event]=await pendingPreferences(page);
    assert.deepEqual(event.patch,{audio_voice:'m'});assert.equal(event.expectedVersion,0);assert.equal(event.revision,17);
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),preferenceReadRpc);
    await page.evaluate(()=>window.__kgF1.release());
    await page.waitForFunction(name=>window.__kgF1.snapshot().preferenceRequests.filter(request=>request.name===name).length===2,preferenceReadRpc);
    assert.equal(await page.evaluate(()=>window.KGAudio.prefs.voice),'f','Receipt alone must not apply an account audio preference');
    assert.equal(await preferenceRegion(page).getByText('Preference change confirmed.',{exact:true}).count(),0);
    await page.evaluate(()=>window.__kgF1.release());
    await preferenceRegion(page).getByText('Preference change confirmed.',{exact:true}).waitFor();
    assert.equal(await audioVoice(page).getAttribute('title'),'Voice: male (tap to switch)');
    assert.equal(await page.evaluate(()=>window.KGAudio.prefs.voice),'m');
    assert.equal((await pendingPreferences(page)).length,0);
    await audioMute(page).click();
    await page.waitForFunction(name=>window.__kgF1.snapshot().preferenceRequests.filter(request=>request.name===name).length===2,preferencePatchRpc);
    await preferenceRegion(page).getByText('Preference change confirmed.',{exact:true}).waitFor();
    const db=await snapshot(page),writes=preferenceCalls(db,preferencePatchRpc),row=db.tables.kg_chart_user_prefs.find(row=>row.user_id===db.owner);
    assert.deepEqual(writes.map(request=>request.args.p_patch),[{audio_voice:'m'},{audio_muted:true}]);
    assert.equal(row.audio_voice,'m');assert.equal(row.audio_muted,true);assert.equal(db.preferenceVersions[db.owner],2);
    assert.equal(db.reads.some(read=>read.table==='kg_chart_user_prefs'),false);
    assert.equal(db.requests.some(request=>request.table==='kg_chart_user_prefs'),false);
  },true);

  await scenario('F2E2d actual audio controls: lost reply reloads without replay and exact retry preserves newer account preferences', 'preferences-audio', async page=>{
    await preferencesReady(page);
    await page.evaluate(name=>window.__kgF1.fault(name,'lost-ack'),preferencePatchRpc);
    await audioVoice(page).click();
    await preferenceRegion(page).getByText('Audio voice change is not confirmed',{exact:true}).waitFor();
    const [original]=await pendingPreferences(page);
    await page.evaluate(()=>window.__kgF1.externalPreferences({audio_voice:'f',audio_muted:true,
      typing_best:{'my|copy|words':{cpm:120,last:100,at:'2026-01-03T10:00:00Z'}}}));
    await page.reload({waitUntil:'load'});
    await preferencesReady(page,'f',true);
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,1,'Reload reads; it never replays a preference mutation');
    assert.deepEqual((await pendingPreferences(page))[0],original);
    assert.equal(await audioVoice(page).isDisabled(),true);
    await preferenceRegion(page).getByRole('button',{name:'Retry exact preference change',exact:true}).click();
    await preferenceRegion(page).getByText('The original change was accepted. Newer account preferences are now shown.',{exact:true}).waitFor();
    const db=await snapshot(page),writes=preferenceCalls(db,preferencePatchRpc),row=db.tables.kg_chart_user_prefs.find(row=>row.user_id===db.owner);
    assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
    assert.equal(row.audio_voice,'f');assert.equal(row.audio_muted,true);assert.equal(row.typing_best['my|copy|words'].cpm,120);
    assert.equal(db.preferenceVersions[db.owner],2);assert.equal((await pendingPreferences(page)).length,0);
    assert.deepEqual(await page.evaluate(()=>window.KGAudio.prefs),{voice:'f',muted:true});
  },true);

  await scenario('F2E2d actual audio controls: stale baseline stays exact until explicit current-state review and archive', 'preferences-audio', async page=>{
    await preferencesReady(page);
    await page.evaluate(()=>window.__kgF1.externalPreferences({audio_muted:true}));
    await audioVoice(page).click();
    await preferenceRegion(page).getByText(/original preference version or event conflicts/i).first().waitFor();
    const [original]=await pendingPreferences(page);
    assert.equal(original.expectedVersion,0);
    await preferenceRegion(page).getByRole('button',{name:'Refresh preferences',exact:true}).click();
    await preferencesReady(page,'f',true);
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,1);
    await preferenceRegion(page).getByRole('button',{name:'Archive outdated preference change',exact:true}).click();
    await preferenceRegion(page).getByText('Outdated preference change archived. You can now make a new change.',{exact:true}).waitFor();
    const archives=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith(window.KGPreferenceSave.archivePrefix))
      .map(key=>JSON.parse(localStorage.getItem(key))));
    assert.equal(archives.length,1);assert.deepEqual(archives[0].event,original);
    await audioVoice(page).click();
    await preferenceRegion(page).getByText('Preference change confirmed.',{exact:true}).waitFor();
    const writes=preferenceCalls(await snapshot(page),preferencePatchRpc);
    assert.equal(writes.length,2);assert.equal(writes[1].args.p_expected_version,1);
    assert.notEqual(writes[0].args.p_event_id,writes[1].args.p_event_id);
    assert.deepEqual(writes[1].args.p_patch,{audio_voice:'m'});
  },true);

  for(const kind of ['newer-slower','older-higher','older-lower-noop']){
    const at=kind==='newer-slower'?'2026-01-01T10:00:00.000Z':new Date(Date.now()+120000).toISOString();
    const before={cpm:kind==='older-higher'?1:9000,last:kind==='older-higher'?1:700,at};
    await scenario(`F2E2d actual typing best: ${kind} keeps maximum CPM separate from latest run`, 'preferences', async page=>{
      await preferencesReady(page);
      assert.equal(await page.getByRole('button',{name:/Sentences/}).count(),0,'A legacy source setting cannot introduce restricted sentence provenance');
      if(kind==='older-higher'){
        await page.setViewportSize({width:390,height:844});
        await page.evaluate(name=>window.__kgF1.fault(name,'hold'),preferenceReadRpc);
      }
      await finishPreferenceTyping(page);
      if(kind==='older-higher'){
        await page.waitForFunction(name=>window.__kgF1.snapshot().preferenceRequests.filter(request=>request.name===name).length===2,preferenceReadRpc);
        await page.getByText('This run is not confirmed as an account personal best. Your current-run score is shown above.',{exact:true}).waitFor();
        assert.equal(await page.getByText('New personal best!',{exact:true}).count(),0);
        assert.equal(await page.getByText('Typing best confirmed.',{exact:true}).count(),0);
        if(process.env.KG_PREF_SCREENSHOT)await page.screenshot({path:process.env.KG_PREF_SCREENSHOT,fullPage:true});
        await page.evaluate(()=>window.__kgF1.release());
      }
      await page.getByText('Typing best confirmed.',{exact:true}).waitFor();
      const db=await snapshot(page),writes=preferenceCalls(db,preferencePatchRpc);
      assert.equal(writes.length,1);assert.deepEqual(Object.keys(writes[0].args.p_patch),['typing_best']);
      const entries=Object.entries(writes[0].args.p_patch.typing_best);
      assert.equal(entries.length,1);assert.equal(entries[0][0],'my|copy|words|food');
      const run=entries[0][1],actual=db.tables.kg_chart_user_prefs.find(row=>row.user_id===db.owner).typing_best[entries[0][0]];
      assert.equal(run.cpm,run.last,'Only this run is authored; the previous account best is not copied into its patch');
      assert.ok(run.cpm>1&&run.cpm<9000,'The real short typing run has a finite bounded CPM');
      assert.equal(actual.cpm,Math.max(before.cpm,run.cpm));
      assert.equal(actual.last,kind==='newer-slower'?run.last:before.last);
      assert.equal(actual.at,kind==='newer-slower'?run.at:before.at);
      assert.equal(db.preferenceVersions[db.owner],1,'Even an accepted value-preserving new event advances the account version once');
      if(kind==='older-lower-noop')assert.deepEqual(actual,before);
      assert.equal(await page.getByText('New personal best!',{exact:true}).count(),kind==='older-higher'?1:0);
      assert.equal(db.reads.some(read=>read.table==='kg_chart_user_prefs'||read.table==='kg_chart_sentences'),false);
      assert.equal((await pendingPreferences(page)).length,0);
    },true,{preferences:{typing_best:{'my|copy|words|food':before}},
      local:{kg_chart_typing:{languageCode:'my',mode:'copy',source:'sentences',topicId:'food',duration:60}}});
  }

  await scenario('F2E2d actual typing recovery: original mode and topic survive a failed preference save and later setup changes', 'preferences', async page=>{
    await preferencesReady(page);
    await page.evaluate(name=>window.__kgF1.fault(name,'fail'),preferencePatchRpc);
    await finishPreferenceTyping(page);
    await preferenceRegion(page).getByText('Typing best change is not confirmed',{exact:true}).waitFor();
    await page.getByText('This run is not confirmed as an account personal best. Your current-run score is shown above.',{exact:true}).waitFor();
    const [original]=await pendingPreferences(page);
    assert.deepEqual(Object.keys(original.patch.typing_best),['my|recall|words|food']);
    assert.equal((await snapshot(page)).tables[sessions].length,1,'Quiz confirmation remains independent of the failed preference event');
    await page.getByRole('button',{name:'← Back to Setup',exact:true}).click();
    await page.getByRole('button',{name:'👀 Copy the word',exact:true}).click();
    await page.getByLabel('Topic',{exact:true}).selectOption('all');
    await preferenceRegion(page).getByRole('button',{name:'Refresh preferences',exact:true}).click();
    await preferencesReady(page);
    assert.deepEqual((await pendingPreferences(page))[0],original);
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,1);
    await preferenceRegion(page).getByRole('button',{name:'Retry exact preference change',exact:true}).click();
    await preferenceRegion(page).getByText('Preference change confirmed.',{exact:true}).waitFor();
    let db=await snapshot(page),writes=preferenceCalls(db,preferencePatchRpc);
    assert.deepEqual(writes[0],writes[1]);
    assert.equal(await page.getByText(/^Your best:/).count(),0,'An earlier recall/topic result must not become a copy/all best');
    await finishPreferenceTyping(page);
    await page.getByText('Typing best confirmed.',{exact:true}).waitFor();
    db=await snapshot(page);writes=preferenceCalls(db,preferencePatchRpc);
    assert.equal(writes.length,3);assert.deepEqual(Object.keys(writes[2].args.p_patch.typing_best),['my|copy|words']);
    assert.notEqual(writes[2].args.p_event_id,writes[0].args.p_event_id);
    assert.equal(writes[2].args.p_expected_version,1);
    assert.deepEqual(Object.keys(db.tables.kg_chart_user_prefs.find(row=>row.user_id===db.owner).typing_best).sort(),
      ['my|copy|words','my|recall|words|food']);
  },true,{local:{kg_chart_typing:{languageCode:'my',mode:'recall',source:'words',topicId:'food',duration:60}}});

  await scenario('F2E2d actual shared preferences: typing finished during held audio save keeps a separate original event without automatic rebasing', 'preferences', async page=>{
    await preferencesReady(page);
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),preferencePatchRpc);
    await audioVoice(page).click();
    await page.waitForFunction(name=>window.__kgF1.snapshot().preferenceRequests.some(request=>request.name===name),preferencePatchRpc);
    await finishPreferenceTyping(page);
    await preferenceRegion(page).getByText('Typing best change is not confirmed',{exact:true}).waitFor();
    const events=await pendingPreferences(page),typing=events.find(event=>event.patch.typing_best),voice=events.find(event=>event.patch.audio_voice);
    assert.equal(events.length,2);assert.equal(typing.expectedVersion,0);assert.equal(voice.expectedVersion,0);
    assert.notEqual(typing.eventId,voice.eventId);
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,1,'The second event is retained without another in-flight owner RPC');
    await page.evaluate(()=>window.__kgF1.release());
    await preferenceRegion(page).getByText('Preference change confirmed.',{exact:true}).waitFor();
    assert.deepEqual(await pendingPreferences(page),[typing]);
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,1,'Clearing the first event cannot automatically replay the next');
    await preferenceRegion(page).getByRole('button',{name:'Retry exact preference change',exact:true}).click();
    await preferenceRegion(page).getByText(/original preference version or event conflicts/i).first().waitFor();
    assert.deepEqual(await pendingPreferences(page),[typing]);
    const db=await snapshot(page),writes=preferenceCalls(db,preferencePatchRpc);
    assert.equal(writes.length,2);assert.equal(writes[1].args.p_event_id,typing.eventId);assert.equal(writes[1].args.p_expected_version,0);
    assert.deepEqual(writes[1].args.p_patch,typing.patch);
    assert.deepEqual(db.tables.kg_chart_user_prefs.find(row=>row.user_id===db.owner).typing_best,{});
  },true);

  await scenario('F2E2d actual audio lifecycle: old account read cannot replace the newly verified owner', 'preferences-audio', async page=>{
    await page.waitForFunction(name=>window.__kgF1.snapshot().preferenceRequests.length===1,preferenceReadRpc);
    await page.evaluate(()=>window.__kgF1.changeScope({ownerId:'11000000-0000-4000-8000-000000000099'}));
    await preferencesReady(page,'f',true);
    await page.evaluate(()=>window.__kgF1.release());
    await preferencesReady(page,'f',true);
    assert.deepEqual(await page.evaluate(()=>window.KGAudio.prefs),{voice:'f',muted:true});
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,0);
  },true,{preferences:{audio_voice:'m',audio_muted:false},otherPreferences:{audio_voice:'f',audio_muted:true},
    faults:[{table:preferenceReadRpc,mode:'hold'}]});

  for(const [kind,patch] of [
    ['owner',{ownerId:'11000000-0000-4000-8000-000000000099'}],
    ['revision',{revision:18}],
    ['logout',{logout:true}],
  ])await scenario(`F2E2d actual preference lifecycle: ${kind} change holds the original event and prevents a stale audio result`, 'preferences-audio', async page=>{
    await preferencesReady(page);
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),preferencePatchRpc);
    await audioVoice(page).click();
    await page.waitForFunction(name=>window.__kgF1.snapshot().preferenceRequests.some(request=>request.name===name),preferencePatchRpc);
    const [original]=await pendingPreferences(page);
    await page.evaluate(value=>window.__kgF1.changeScope(value),patch);
    if(kind==='owner')await preferencesReady(page,'f',true);
    else if(kind==='revision')await preferencesReady(page,'m',false);
    else await audioVoice(page).waitFor({state:'detached'});
    await page.evaluate(()=>window.__kgF1.release());
    assert.deepEqual((await pendingPreferences(page))[0],original);
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,1);
    assert.equal(await preferenceRegion(page).getByText('Preference change confirmed.',{exact:true}).count(),0);
    if(kind==='owner')assert.deepEqual(await page.evaluate(()=>window.KGAudio.prefs),{voice:'f',muted:true});
    if(kind==='revision'){
      await preferenceRegion(page).getByText('This change belongs to an earlier permission revision and is held for review.',{exact:true}).waitFor();
      assert.equal(await preferenceRegion(page).getByRole('button',{name:'Retry exact preference change',exact:true}).isDisabled(),true);
      assert.equal(await preferenceRegion(page).getByRole('button',{name:'Archive outdated preference change',exact:true}).count(),0);
    }
    if(kind==='logout')assert.equal(await page.evaluate(()=>window.KGAudio.prefs.muted),true);
  },true,{otherPreferences:{audio_voice:'f',audio_muted:true}});

  await scenario('F2E2d actual audio lifecycle: a same-owner legacy initialization reply cannot undo a later voice choice', 'preferences-audio', async page=>{
    await page.waitForFunction(()=>window.__kgF1.snapshot().reads.some(read=>read.table==='kg_chart_user_prefs'));
    await audioVoice(page).click();
    await page.waitForFunction(()=>window.__kgF1.snapshot().requests.some(request=>request.table==='kg_chart_user_prefs'));
    assert.equal(await audioVoice(page).getAttribute('title'),'Voice: male (tap to switch)');
    await page.evaluate(()=>window.__kgF1.release());
    await audioVoice(page).click({trial:true});
    assert.equal(await audioVoice(page).getAttribute('title'),'Voice: male (tap to switch)');
    assert.equal(await page.evaluate(()=>window.KGAudio.prefs.voice),'m');
    const db=await snapshot(page);
    assert.equal(db.tables.kg_chart_user_prefs.find(row=>row.user_id===db.owner).audio_voice,'m');
    assert.equal(db.preferenceRequests.length,0);
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_user_prefs','hold-read'));
    await page.evaluate(()=>window.__kgF1.changeScope({ownerId:'11000000-0000-4000-8000-000000000099'}));
    await page.waitForFunction(()=>window.__kgF1.snapshot().reads.filter(read=>read.table==='kg_chart_user_prefs').length===2);
    await page.evaluate(()=>window.__kgF1.changeScope({ownerId:'11000000-0000-4000-8000-000000000001',policyState:'restricted'}));
    await preferencesReady(page,'m',false);
    await page.evaluate(()=>window.__kgF1.release());
    await audioVoice(page).click({trial:true});
    assert.deepEqual(await page.evaluate(()=>window.KGAudio.prefs),{voice:'m',muted:false},
      'A different former legacy owner cannot replace the current restricted audio snapshot');
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,0);
  },true,{policyState:'legacy',faults:[{table:'kg_chart_user_prefs',mode:'hold-read'}]});

  await scenario('F2E2d actual preferences: offline facade keeps an exact pending event and revoked typing history is not uploaded or erased', 'preferences-audio', async page=>{
    await preferencesReady(page);
    await page.evaluate(()=>{window.KGOffline={client:window.__fakeClient};});
    await audioVoice(page).click();
    await preferenceRegion(page).getByText(/Restricted preferences require the online server/).first().waitFor();
    const [original]=await pendingPreferences(page);
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,0);
    await page.evaluate(()=>{delete window.KGOffline;});
    await preferenceRegion(page).getByRole('button',{name:'Retry exact preference change',exact:true}).click();
    await preferenceRegion(page).getByText('Preference change confirmed.',{exact:true}).waitFor();
    const db=await snapshot(page),writes=preferenceCalls(db,preferencePatchRpc),row=db.tables.kg_chart_user_prefs.find(row=>row.user_id===db.owner);
    assert.equal(writes.length,1);assert.equal(writes[0].args.p_event_id,original.eventId);
    assert.deepEqual(writes[0].args.p_patch,{audio_voice:'m'});
    assert.deepEqual(row.typing_best,{'my|copy|words|food':{cpm:95,last:80,at:'2026-01-01T10:00:00Z'}});
    assert.equal(row.audio_voice,'m');assert.equal((await pendingPreferences(page)).length,0);
  },true,{typingAllowed:false,preferences:{typing_best:{'my|copy|words|food':{cpm:95,last:80,at:'2026-01-01T10:00:00Z'}}}});

  await scenario('F2E2d actual typing attribution: current authored baseline and exact current key determine confirmation, not run-start best', 'preferences', async page=>{
    await preferencesReady(page);
    const began=Date.now();
    await page.clock.setFixedTime(began);
    await page.getByRole('button',{name:'Start',exact:true}).click();
    const word=await page.locator('[aria-label^="Native "]').getAttribute('aria-label');
    await page.getByRole('textbox',{name:'Type here'}).fill(word);
    await page.evaluate(at=>window.__kgF1.externalPreferences({typing_best:{
      'my|copy|words':{cpm:180,last:180,at}}}),new Date(began-1000).toISOString());
    await preferenceRegion(page).getByRole('button',{name:'Refresh preferences',exact:true}).click();
    await preferencesReady(page);
    // Seven non-space characters over 2.333 seconds round to 180 CPM. This
    // uses the actual run clock/input path with Playwright's supported Date
    // control; no preference or metric is injected into the component.
    await page.clock.setFixedTime(began+2333);
    await page.getByRole('button',{name:'← Back',exact:true}).click();
    await page.getByText('Typing best confirmed.',{exact:true}).waitFor();
    assert.equal(await page.getByText('New personal best!',{exact:true}).count(),0);
    let db=await snapshot(page),write=preferenceCalls(db,preferencePatchRpc)[0];
    assert.equal(write.args.p_expected_version,1);assert.equal(write.args.p_patch.typing_best['my|copy|words'].cpm,180);
    assert.equal(db.preferenceVersions[db.owner],2);
    await page.evaluate(()=>{
      const db=window.__kgF1.snapshot(),row=db.tables.kg_chart_user_prefs.find(row=>row.user_id===db.owner);
      window.__kgF1.seedPreferences({typing_best:{...row.typing_best,
        'my|recall|words':{cpm:50,last:50,at:'2026-01-01T10:00:00Z'}}},{version:2});
    });
    await preferenceRegion(page).getByRole('button',{name:'Refresh preferences',exact:true}).click();
    await preferencesReady(page);
    await page.getByText('Typing best confirmed.',{exact:true}).waitFor();
    await page.evaluate(()=>{
      const db=window.__kgF1.snapshot(),row=db.tables.kg_chart_user_prefs.find(row=>row.user_id===db.owner);
      window.__kgF1.seedPreferences({typing_best:{...row.typing_best,
        'my|copy|words':{...row.typing_best['my|copy|words'],cpm:181}}},{version:2});
    });
    await preferenceRegion(page).getByRole('button',{name:'Refresh preferences',exact:true}).click();
    await preferencesReady(page);
    await page.getByText('This run is not confirmed as an account personal best. Your current-run score is shown above.',{exact:true}).waitFor();
    assert.equal(await page.getByText('Typing best confirmed.',{exact:true}).count(),0);
    assert.equal(await page.getByText('New personal best!',{exact:true}).count(),0);
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,1);
  },true,{preferences:{typing_best:{'my|copy|words':{cpm:100,last:100,at:'2026-01-01T10:00:00Z'}}}});

  await scenario('F2E2d actual typing lifecycle: language switch retains original quiz history without relabelling an unfinished run as a new best', 'preferences', async page=>{
    await preferencesReady(page);
    await page.getByRole('button',{name:'Start',exact:true}).click();
    const word=await page.locator('[aria-label^="Native "]').getAttribute('aria-label');
    await page.getByRole('textbox',{name:'Type here'}).fill(word);
    await page.evaluate(()=>window.__kgF1.changeScope({languageCode:'ja'}));
    await page.getByRole('button',{name:'Start',exact:true}).waitFor();
    assert.equal(preferenceCalls(await snapshot(page),preferencePatchRpc).length,0);
    assert.equal((await pendingPreferences(page)).length,0);
    const drafts=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith(window.KGQuizSave.timedStoragePrefix))
      .map(key=>JSON.parse(localStorage.getItem(key))));
    assert.equal(drafts.length,1);assert.equal(drafts[0].languageCode,'my');assert.equal(drafts[0].session.quiz_type,'typing_copy');
    assert.equal(drafts[0].answers.length,1);
    assert.equal(await page.getByText('New personal best!',{exact:true}).count(),0);
  },true);

  await scenario('F2E2d actual legacy typing: late reads cannot overwrite a newer run or continue after owner and access changes', 'preferences', async page=>{
    const ownerA='11000000-0000-4000-8000-000000000001',ownerB='11000000-0000-4000-8000-000000000099';
    const keyA='kg_chart_typing_best:owner:'+ownerA,keyB='kg_chart_typing_best:owner:'+ownerB;
    await page.waitForFunction(()=>window.__kgF1.snapshot().reads.some(read=>
      read.table==='kg_chart_user_prefs'&&read.columns==='typing_best'));
    await finishPreferenceTyping(page);
    await page.waitForFunction(()=>window.__kgF1.snapshot().requests.filter(request=>request.table==='kg_chart_user_prefs').length===1);
    const fresh=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),keyA);
    assert.ok(fresh['my|copy|words'].cpm>1);
    assert.equal(fresh['my|copy|words'].last,fresh['my|copy|words'].cpm);
    await page.evaluate(()=>window.__kgF1.release());
    await audioVoice(page).click({trial:true});
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),keyA),fresh,
      'A late initialization read must not restore the older owner-scoped best after a fresh run');
    let db=await snapshot(page);
    assert.equal(db.requests.filter(request=>request.table==='kg_chart_user_prefs').length,1);
    assert.deepEqual(db.tables.kg_chart_user_prefs.find(row=>row.user_id===ownerA).typing_best,fresh);

    const withPendingMerge={...fresh,'my|recall|words':{cpm:333,last:333,at:'2026-01-03T10:00:00Z'}};
    await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:keyA,value:withPendingMerge});
    const reads=db.reads.filter(read=>read.table==='kg_chart_user_prefs'&&read.columns==='typing_best').length;
    await page.getByRole('button',{name:'Leave quiz view',exact:true}).click();
    await page.getByText('Outside quiz',{exact:true}).waitFor();
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_user_prefs','hold-typing-read'));
    await page.getByRole('button',{name:'Reopen quiz view',exact:true}).click();
    await page.waitForFunction(count=>window.__kgF1.snapshot().reads.filter(read=>
      read.table==='kg_chart_user_prefs'&&read.columns==='typing_best').length===count,reads+1);
    await page.evaluate(ownerId=>window.__kgF1.changeScope({ownerId,revision:18,policyState:'restricted'}),ownerB);
    await preferencesReady(page);
    await page.evaluate(()=>window.__kgF1.release());
    await audioVoice(page).click({trial:true});
    db=await snapshot(page);
    assert.equal(db.requests.filter(request=>request.table==='kg_chart_user_prefs').length,1,
      'The obsolete legacy merge must stop before any raw upsert after owner/revision/mode changed');
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),keyA),withPendingMerge);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),keyB),
      {'my|copy|words':{cpm:777,last:777,at:'2026-01-02T10:00:00Z'}});
    assert.deepEqual(db.tables.kg_chart_user_prefs.find(row=>row.user_id===ownerA).typing_best,fresh);
    assert.equal(await page.getByText(/^Your best:/).count(),0,'The new restricted owner must not adopt even its old legacy local mirror');
    assert.equal(preferenceCalls(db,preferencePatchRpc).length,0);
  },true,{policyState:'legacy',preferences:{typing_best:{'my|copy|words':{cpm:0,last:0,at:'2026-01-01T10:00:00Z'}}},
    otherPreferences:{typing_best:{}},faults:[{table:'kg_chart_user_prefs',mode:'hold-typing-read'}],local:{
      'kg_chart_typing_best:owner:11000000-0000-4000-8000-000000000001':{'my|copy|words':{cpm:1,last:1,at:'2026-01-02T10:00:00Z'}},
      'kg_chart_typing_best:owner:11000000-0000-4000-8000-000000000099':{'my|copy|words':{cpm:777,last:777,at:'2026-01-02T10:00:00Z'}}}});

  await scenario('F2E2e actual word flags: styled detail form keeps one immutable intent and permits a distinct later report', 'flags-chart', async page=>{
    let dialog=await openWordFlag(page);
    assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).evaluate(button=>button===document.activeElement),true);
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).evaluate(button=>button===document.activeElement),true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert.equal((await snapshot(page)).flagRequests.length,0);
    dialog=await openWordFlag(page);
    const notes='Original note — စမ်းသပ် · do not replace',suggestion='सुधार';
    await dialog.locator('input').fill(suggestion);
    await dialog.locator('textarea').fill(notes);
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),flagRpc);
    await dialog.getByRole('button',{name:'Submit Flag',exact:true}).dblclick();
    await page.waitForFunction(()=>window.__kgF1.snapshot().flagRequests.length===1);
    const [draft]=await pendingFlags(page),first=(await snapshot(page)).flagRequests[0];
    assert.equal(draft.ownerId,'11000000-0000-4000-8000-000000000001');
    assert.equal(draft.languageCode,'my');assert.equal(draft.revision,17);
    assert.equal(draft.flags.length,1);assert.deepEqual(draft.batches,[[draft.flags[0].id]]);
    assert.deepEqual(first.args,{p_expected_revision:17,p_owner_id:draft.ownerId,p_flags:draft.flags});
    assert.deepEqual(draft.flags[0],{id:draft.flags[0].id,language_code:'my',
      vocabulary_id:'22000000-0000-4000-8000-000000000001',sentence_id:null,colour_phrase_id:null,
      reason:'pronunciation',notes,status:'open',shown_devanagari:'शब्द 0',suggestion});
    await dialog.getByText('0 of 1 flags confirmed.',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Done',exact:true}).count(),0);
    assert.equal(await dialog.locator('textarea').isDisabled(),true);
    assert.equal(await dialog.locator('input').isDisabled(),true);
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);
    await page.evaluate(()=>window.__kgF1.release());
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal((await pendingFlags(page)).length,0);
    assert.equal(await page.locator('#root').getAttribute('inert'),null);
    dialog=await openWordFlag(page);
    await dialog.locator('input').fill(suggestion);await dialog.locator('textarea').fill(notes);
    await dialog.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await dialog.getByRole('button',{name:'Done',exact:true}).waitFor();
    const db=await snapshot(page);
    assert.equal(db.flagRequests.length,2);assert.equal(db.tables.kg_chart_flags.length,2);
    assert.notEqual(db.flagRequests[1].args.p_flags[0].id,draft.flags[0].id);
    assert.deepEqual({...db.flagRequests[1].args.p_flags[0],id:draft.flags[0].id},draft.flags[0]);
    assertFlagOnlyRpc(db);
  },true);

  await scenario('F2E2e actual sentence flag: the displayed sentence ID and allowed reason survive submission', 'flags-sentence', async page=>{
    await page.getByRole('button',{name:/^Start Quiz/}).click();
    const native=(await page.getByText(/^Sentence [0-3]$/).first().textContent()).trim();
    await page.getByRole('button',{name:/Meaning [0-3]/}).first().click();
    const origin=page.getByTitle('Flag wrong Devanagari, word, picture…',{exact:true}).last();
    await origin.click();
    const dialog=flagDialog(page);await dialog.waitFor();
    assert.equal(await dialog.getByRole('button',{name:/Missing Image/}).count(),0);
    await dialog.getByRole('button',{name:/Missing Translation/}).click();
    await dialog.locator('textarea').fill('Original sentence translation report');
    await dialog.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await origin.click({trial:true});
    assert.equal(await origin.evaluate(button=>button===document.activeElement),true);
    const db=await snapshot(page),flag=db.flagRequests[0].args.p_flags[0];
    assert.equal(flag.sentence_id,db.tables.kg_chart_sentences.find(row=>row.native_text===native).id);
    assert.equal(flag.vocabulary_id,null);assert.equal(flag.colour_phrase_id,null);
    assert.equal(flag.reason,'missing_translation');assert.equal(flag.suggestion,null);
    assert.equal(flag.notes,'Original sentence translation report');assert.equal(flag.language_code,'my');
    assert.equal(db.callbacks,0);assert.equal(db.levelRequests.length,0);assertFlagOnlyRpc(db);
  },true);

  await scenario('F2E2e actual colour flag: the original phrase ID is retained without invented vocabulary identity', 'flags-colour', async page=>{
    await page.getByRole('button',{name:/^Start Quiz/}).click();
    const target=await page.locator('[data-colour-target]').getAttribute('data-colour-target');
    await page.locator('[data-colour-option]').first().click();
    await page.getByTitle('Flag wrong Devanagari, word, picture…',{exact:true}).last().click();
    const dialog=flagDialog(page);await dialog.waitFor();
    assert.equal(await dialog.getByRole('button',{name:/Missing Translation/}).count(),0);
    await dialog.getByRole('button',{name:/Picture or colour looks wrong/}).click();
    await dialog.locator('textarea').fill('Original colour picture report');
    await dialog.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await dialog.getByRole('button',{name:'Done',exact:true}).waitFor();
    const db=await snapshot(page),flag=db.flagRequests[0].args.p_flags[0];
    assert.equal(flag.colour_phrase_id,target);assert.equal(flag.vocabulary_id,null);assert.equal(flag.sentence_id,null);
    assert.equal(flag.reason,'missing_image');assert.equal(flag.suggestion,null);assert.equal(flag.language_code,'my');
    assert.equal(flag.notes,'Original colour picture report');assert.equal(db.levelRequests.length,0);assertFlagOnlyRpc(db);
  },true);

  await scenario('F2E2e actual mobile batch: ten confirmed reports and a lost final reply survive reload and exact remaining retry', 'flags-chart', async page=>{
    await page.setViewportSize({width:390,height:844});
    const dialog=await openBatchFlags(page);
    await page.evaluate(name=>{window.__kgF1.fault(name,'pass');window.__kgF1.fault(name,'lost-ack');},flagRpc);
    await dialog.getByRole('button',{name:'Flag 12 Items',exact:true}).click();
    await dialog.getByText('10 of 12 flags confirmed.',{exact:true}).waitFor();
    const [draft]=await pendingFlags(page);let db=await snapshot(page);
    assert.equal(draft.flags.length,12);assert.deepEqual(draft.batches.map(batch=>batch.length),[10,2]);
    assert.equal(new Set(draft.flags.map(flag=>flag.id)).size,12);
    assert.equal(db.flagRequests.length,2);assert.equal(db.tables.kg_chart_flags.length,12);
    assert.equal(await dialog.getByRole('button',{name:'Done',exact:true}).count(),0);
    assert.equal(await page.locator('button').filter({hasText:'Exit Flag Mode'}).count(),1,'Chart must not receive onDone for a partial acknowledgement');
    if(process.env.KG_FLAG_SCREENSHOT)await page.screenshot({path:process.env.KG_FLAG_SCREENSHOT,fullPage:true});
    const close=dialog.getByRole('button',{name:'Close and keep pending flags',exact:true});
    await close.scrollIntoViewIfNeeded();
    for(const control of [close,dialog.getByRole('button',{name:'Retry exact flags',exact:true}),
      dialog.getByRole('button',{name:'Download pending flags',exact:true})]){
      await control.click({trial:true});
      const bounds=await control.boundingBox();
      assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=390&&bounds.y+bounds.height<=844,
        'Every original recovery action must remain reachable inside the phone viewport');
    }
    assert.equal(await page.locator('#root').getAttribute('inert'),'');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.KG_FLAG_SCREENSHOT)await page.screenshot({path:process.env.KG_FLAG_SCREENSHOT.replace(/\.png$/,'-controls.png')});
    await page.reload({waitUntil:'load'});
    await flagRecovery(page).getByText('10 of 12 flags confirmed.',{exact:true}).waitFor();
    assert.deepEqual(await pendingFlags(page),[draft]);
    assert.equal((await snapshot(page)).flagRequests.length,2,'Reload must only display original recovery work');
    await page.evaluate(({id,name})=>{window.__kgF1.moderateFlag(id);window.__kgF1.fault(name,'reversed');},
      {id:draft.batches[1][0],name:flagRpc});
    await flagRecovery(page).getByRole('button',{name:'Retry exact flags',exact:true}).click();
    await flagRecovery(page).getByText('12 flags confirmed for review.',{exact:true}).waitFor();
    db=await snapshot(page);
    assert.equal(db.flagRequests.length,3);assert.deepEqual(db.flagRequests[2].args,db.flagRequests[1].args);
    assert.equal(db.tables.kg_chart_flags.length,12);assert.equal((await pendingFlags(page)).length,0);
    assert.equal(db.tables.kg_chart_flags.find(flag=>flag.id===draft.batches[1][0]).status,'resolved');
    assert.equal(db.tables.kg_chart_flags.find(flag=>flag.id===draft.batches[1][0]).resolved_at,'2026-11-28T12:00:00Z');
    assert.equal(await page.getByRole('heading',{name:/approved|resolved/i}).count(),0);
    assertFlagOnlyRpc(db);
  },true);

  await scenario('F2E2e actual batch: malformed receipt IDs counts and revision never advance or rewrite the original selection', 'flags-chart', async page=>{
    const dialog=await openBatchFlags(page);
    const faults=['wrong-id','duplicate-id','extra-id','wrong-count','wrong-revision'];
    await page.evaluate(({name,mode})=>window.__kgF1.fault(name,mode),{name:flagRpc,mode:faults[0]});
    await dialog.getByRole('button',{name:'Flag 12 Items',exact:true}).click();
    await dialog.getByText('The server did not confirm exactly this original batch of reports.',{exact:true}).waitFor();
    const [draft]=await pendingFlags(page),original=(await snapshot(page)).flagRequests[0].args;
    for(const mode of faults.slice(1)){
      await page.evaluate(({name,mode})=>window.__kgF1.fault(name,mode),{name:flagRpc,mode});
      await dialog.getByRole('button',{name:'Retry exact flags',exact:true}).click();
      await dialog.getByText('The server did not confirm exactly this original batch of reports.',{exact:true}).waitFor();
      await dialog.getByRole('button',{name:'Retry exact flags',exact:true}).click({trial:true});
      assert.deepEqual(await pendingFlags(page),[draft]);
      await dialog.getByText('0 of 12 flags confirmed.',{exact:true}).waitFor();
    }
    let db=await snapshot(page);
    assert.equal(db.flagRequests.length,5);assert.equal(db.tables.kg_chart_flags.length,10);
    assert.ok(db.flagRequests.every(request=>JSON.stringify(request.args)===JSON.stringify(original)));
    assert.equal(await dialog.getByRole('button',{name:'Done',exact:true}).count(),0);
    await page.evaluate(name=>window.__kgF1.fault(name,'reversed'),flagRpc);
    await dialog.getByRole('button',{name:'Retry exact flags',exact:true}).click();
    await dialog.getByRole('button',{name:'Done',exact:true}).waitFor();
    db=await snapshot(page);assert.equal(db.flagRequests.length,7);assert.equal(db.tables.kg_chart_flags.length,12);
    assert.deepEqual(db.flagRequests[5].args,original);assert.equal((await pendingFlags(page)).length,0);assertFlagOnlyRpc(db);
  },true);

  await scenario('F2E2e actual batch: closing a busy dialog stops later batches until explicit original recovery', 'flags-chart', async page=>{
    const dialog=await openBatchFlags(page);
    await page.evaluate(name=>window.__kgF1.fault(name,'hold'),flagRpc);
    await dialog.getByRole('button',{name:'Flag 12 Items',exact:true}).click();
    await page.waitForFunction(()=>window.__kgF1.snapshot().flagRequests.length===1);
    const [draft]=await pendingFlags(page);
    await dialog.getByRole('button',{name:'Close and keep pending flags',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await page.evaluate(()=>window.__kgF1.release());
    await flagRecovery(page).getByRole('button',{name:'Retry exact flags',exact:true}).click({trial:true});
    assert.equal((await snapshot(page)).flagRequests.length,1);
    assert.deepEqual(await pendingFlags(page),[draft]);
    await flagRecovery(page).getByRole('button',{name:'Retry exact flags',exact:true}).click();
    await flagRecovery(page).getByText('12 flags confirmed for review.',{exact:true}).waitFor();
    const db=await snapshot(page);
    assert.equal(db.tables.kg_chart_flags.length,12);
    assert.deepEqual(db.flagRequests.at(-1).args.p_flags,draft.flags.filter(flag=>draft.batches[1].includes(flag.id)));
    for(const request of db.flagRequests)for(const flag of request.args.p_flags)
      assert.deepEqual(flag,draft.flags.find(original=>original.id===flag.id));
    assert.equal((await pendingFlags(page)).length,0);assertFlagOnlyRpc(db);
  },true);

  for(const [kind,patch] of [['owner',{ownerId:'11000000-0000-4000-8000-000000000099'}],
    ['language',{languageCode:'ja'}],['revision',{revision:18}]])await scenario(
    `F2E2e actual batch: ${kind} change rejects stale completion and stops continuation under the original IDs`, 'flags-chart', async page=>{
      const dialog=await openBatchFlags(page);
      await page.evaluate(name=>window.__kgF1.fault(name,'hold'),flagRpc);
      await dialog.getByRole('button',{name:'Flag 12 Items',exact:true}).click();
      await page.waitForFunction(()=>window.__kgF1.snapshot().flagRequests.length===1);
      const [draft]=await pendingFlags(page);
      await page.evaluate(patch=>window.__kgF1.changeScope(patch),patch);
      await page.evaluate(()=>window.__kgF1.release());
      await page.waitForFunction(()=>document.querySelector('[role="dialog"]')===null||
        document.querySelector('[role="dialog"]').textContent.includes('Report context changed'));
      // Scope invalidation must become visible before inspecting the stopped
      // task; the panel exposes changed-revision work but never another owner.
      if(await dialog.count())await dialog.getByRole('button',{name:/Close|Cancel/}).click();
      await dialog.waitFor({state:'hidden'});
      assert.equal((await snapshot(page)).flagRequests.length,1);
      assert.deepEqual(await pendingFlags(page),[draft]);
      assert.equal(draft.ownerId,'11000000-0000-4000-8000-000000000001');
      assert.equal(draft.languageCode,'my');assert.equal(draft.revision,17);
      if(kind==='revision'){
        await flagRecovery(page).getByText('These flags belong to an earlier permission revision and are held for review.',{exact:true}).waitFor();
        assert.equal(await flagRecovery(page).getByRole('button',{name:'Retry exact flags',exact:true}).isDisabled(),true);
      }else assert.equal(await flagRecovery(page).count(),0,'Another owner or language must not expose the original report text');
      assert.equal(await page.getByRole('button',{name:'Done',exact:true}).count(),0);
      assertFlagOnlyRpc(await snapshot(page));
    },true);

  await scenario('F2E2e actual editor: changed language cannot submit typed notes against replacement props', 'flags-chart', async page=>{
    const dialog=await openWordFlag(page);
    await dialog.locator('textarea').fill('Unsubmitted original Burmese report');
    await page.evaluate(()=>window.__kgF1.changeScope({languageCode:'ja'}));
    await page.waitForFunction(()=>document.querySelector('[role="dialog"]')===null||
      document.querySelector('[role="dialog"]').textContent.includes('Report context changed'));
    if(await dialog.count()){
      const submit=dialog.getByRole('button',{name:'Submit Flag',exact:true});
      assert.ok(await submit.count()===0||await submit.isDisabled());
      assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true,
        'Replacing an idle editor must keep focus within its context-changed dialog');
      await page.keyboard.press('Escape');
    }
    await dialog.waitFor({state:'hidden'});
    assert.equal((await snapshot(page)).flagRequests.length,0);assert.equal((await pendingFlags(page)).length,0);
    const current=await openWordFlag(page);
    assert.equal(await current.locator('textarea').inputValue(),'');
    await current.locator('textarea').fill('Intentional current Japanese report');
    await current.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await current.getByRole('button',{name:'Done',exact:true}).waitFor();
    const [request]=(await snapshot(page)).flagRequests;
    assert.equal(request.args.p_flags[0].language_code,'ja');
    assert.equal(request.args.p_flags[0].notes,'Intentional current Japanese report');
  },true);

  await scenario('F2E2e actual flag replay: revoked targets remain pending even when the original report already exists', 'flags-chart', async page=>{
    let dialog=await openWordFlag(page);
    await dialog.locator('textarea').fill('Report pending current permission');
    await dialog.locator('input').fill('Original pronunciation suggestion');
    await page.evaluate(name=>window.__kgF1.fault(name,'lost-ack'),flagRpc);
    await dialog.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await dialog.getByText('This batch was not confirmed. Retry the original reports.',{exact:true}).waitFor();
    const [draft]=await pendingFlags(page);
    await dialog.getByRole('button',{name:'Close and keep pending flags',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    dialog=await openWordFlag(page);
    await dialog.getByRole('heading',{name:'Original reports are waiting',exact:true}).waitFor();
    await dialog.getByText('Report pending current permission',{exact:true}).waitFor();
    await dialog.getByText('Suggestion: Original pronunciation suggestion',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Submit Flag',exact:true}).count(),0);
    assert.equal((await snapshot(page)).flagRequests.length,1,'Reopening must not resend or create replacement report IDs');
    const retained=await flagDownload(page,dialog.getByRole('button',{name:'Download pending flags',exact:true}));
    assert.deepEqual(retained.draft,draft);
    await dialog.getByRole('button',{name:'Create another report',exact:true}).click();
    assert.equal(await dialog.locator('textarea').inputValue(),'');
    await dialog.locator('textarea').fill('A deliberate separate report while the original is pending');
    await dialog.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    let db=await snapshot(page);
    assert.equal(db.flagRequests.length,2);assert.equal(db.tables.kg_chart_flags.length,2);
    assert.notEqual(db.flagRequests[1].args.p_flags[0].id,draft.flags[0].id);
    assert.equal(db.flagRequests[1].args.p_flags[0].notes,'A deliberate separate report while the original is pending');
    assert.deepEqual(await pendingFlags(page),[draft]);
    dialog=await openWordFlag(page);
    await dialog.getByRole('heading',{name:'Original reports are waiting',exact:true}).waitFor();
    await page.evaluate(id=>window.__kgF1.denyFlagTarget(id),draft.flags[0].vocabulary_id);
    await dialog.getByRole('button',{name:'Retry exact flags',exact:true}).click();
    await dialog.getByText('These reports are not currently permitted. Their original IDs and scope are retained.',{exact:true}).waitFor();
    db=await snapshot(page);
    assert.equal(db.flagRequests.length,3);assert.deepEqual(db.flagRequests[2].args,db.flagRequests[0].args);
    assert.equal(db.tables.kg_chart_flags.length,2);assert.deepEqual(await pendingFlags(page),[draft]);
    assert.equal(await dialog.getByRole('button',{name:'Done',exact:true}).count(),0);assertFlagOnlyRpc(db);
  },true);

  await scenario('F2E2e actual offline flag: device facade cannot acknowledge and explicit retry preserves the exported original', 'flags-chart', async page=>{
    const dialog=await openWordFlag(page);
    await dialog.locator('textarea').fill('Offline original report');
    await page.evaluate(()=>{window.KGOffline={client:window.__fakeClient};});
    await dialog.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await dialog.getByText('Restricted reports require the online server. The original selection is retained.',{exact:true}).waitFor();
    const [draft]=await pendingFlags(page);
    assert.equal((await snapshot(page)).flagRequests.length,0);
    const exported=await flagDownload(page,dialog.getByRole('button',{name:'Download pending flags',exact:true}));
    assert.equal(exported.contract,'kg-flag-recovery-v1');assert.deepEqual(exported.draft,draft);
    await page.evaluate(()=>{delete window.KGOffline;});
    await dialog.getByRole('button',{name:'Retry exact flags',exact:true}).click();
    await dialog.getByRole('button',{name:'Done',exact:true}).waitFor();
    const db=await snapshot(page);
    assert.equal(db.flagRequests.length,1);assert.deepEqual(db.flagRequests[0].args.p_flags,draft.flags);
    assert.equal((await pendingFlags(page)).length,0);assertFlagOnlyRpc(db);
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await page.evaluate(()=>window.__kgF1.changeScope({policyState:'unknown'}));
    const unavailable=await openWordFlag(page);
    await unavailable.getByText('Report permissions have not been verified. Close and reopen after reconnecting.',{exact:true}).waitFor();
    assert.equal(await unavailable.getByRole('button',{name:'Submit Flag',exact:true}).isDisabled(),true);
    assert.equal((await snapshot(page)).flagRequests.length,1);assert.equal((await pendingFlags(page)).length,0);
  },true);

  for(const checkpoint of [false,true])await scenario(`F2E2e actual flag storage: ${checkpoint?'failed receipt checkpoint stops later batches':'failed original persistence sends nothing'} and exact exported work remains recoverable`, 'flags-chart', async page=>{
    const dialog=checkpoint?await openBatchFlags(page):await openWordFlag(page);
    if(!checkpoint)await dialog.locator('textarea').fill('Memory-only original report');
    await page.evaluate(checkpoint=>{
      const original=Storage.prototype.setItem,prefix=checkpoint?window.KGFlagSave.receiptPrefix:window.KGFlagSave.storagePrefix;
      window.__restoreFlagStorage=()=>{Storage.prototype.setItem=original;};
      Storage.prototype.setItem=function(key,value){
        if(String(key).startsWith(prefix))throw new DOMException('Synthetic flag quota failure','QuotaExceededError');
        return original.call(this,key,value);
      };
    },checkpoint);
    await dialog.getByRole('button',{name:checkpoint?'Flag 12 Items':'Submit Flag',exact:true}).click();
    await dialog.getByText('Recovery storage is unavailable. Download the original flags before leaving this page.',{exact:true}).waitFor();
    assert.equal((await snapshot(page)).flagRequests.length,checkpoint?1:0);
    await dialog.getByText(`0 of ${checkpoint?12:1} flags confirmed.`,{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Done',exact:true}).count(),0);
    const exported=await flagDownload(page,dialog.getByRole('button',{name:'Download pending flags',exact:true}));
    const draft=exported.draft;
    assert.equal(draft.flags.length,checkpoint?12:1);
    assert.equal(draft.flags[0].notes,checkpoint?'Original batch notes — စမ်းသပ်':'Memory-only original report');
    if(checkpoint)assert.deepEqual(await pendingFlags(page),[draft]);else assert.equal((await pendingFlags(page)).length,0);
    await page.evaluate(()=>window.__restoreFlagStorage());
    await dialog.getByRole('button',{name:'Retry exact flags',exact:true}).click();
    await dialog.getByRole('button',{name:'Done',exact:true}).waitFor();
    const db=await snapshot(page);
    assert.equal(db.flagRequests.length,checkpoint?3:1);assert.equal(db.tables.kg_chart_flags.length,draft.flags.length);
    for(const request of db.flagRequests)for(const flag of request.args.p_flags)
      assert.deepEqual(flag,draft.flags.find(original=>original.id===flag.id));
    assert.equal((await pendingFlags(page)).length,0);assertFlagOnlyRpc(db);
  },true);

  await scenario('F2E2e actual legacy flags: compatibility remains legacy-only and a late reply cannot continue after access changes', 'flags-chart', async page=>{
    let dialog=await openWordFlag(page);
    await dialog.locator('textarea').fill('Legacy report compatibility');
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_flags','missing-column'));
    await dialog.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    let db=await snapshot(page);
    assert.equal(db.flagRequests.length,0);assert.equal(db.requests.filter(request=>request.table==='kg_chart_flags').length,2);
    assert.equal(db.tables.kg_chart_flags.length,1);assert.equal(db.tables.kg_chart_flags[0].reporter_id,db.owner);
    assert.equal((await pendingFlags(page)).length,0);
    dialog=await openWordFlag(page,1);
    await dialog.locator('textarea').fill('Old legacy report must not follow a new account');
    await page.evaluate(()=>window.__kgF1.fault('kg_chart_flags','hold-missing-column'));
    await dialog.getByRole('button',{name:'Submit Flag',exact:true}).click();
    await page.waitForFunction(()=>window.__kgF1.snapshot().requests.filter(request=>request.table==='kg_chart_flags').length===3);
    await page.evaluate(()=>window.__kgF1.changeScope({ownerId:'11000000-0000-4000-8000-000000000099',revision:18,policyState:'restricted'}));
    await page.evaluate(()=>window.__kgF1.release());
    if(await dialog.count())await dialog.getByRole('button',{name:/Close|Cancel/}).click();
    await dialog.waitFor({state:'hidden'});
    db=await snapshot(page);
    assert.equal(db.requests.filter(request=>request.table==='kg_chart_flags').length,3,'An obsolete legacy reply must stop before the compatibility fallback');
    assert.equal(db.flagRequests.length,0);assert.equal(db.tables.kg_chart_flags.length,1);
    assert.equal(await page.getByRole('button',{name:'Done',exact:true}).count(),0);
  },true,{policyState:'legacy'});

  assert.ok(passed>0,'The scenario filter must select at least one real scenario');
  console.log(`U4B2B3D_RENDERED_QUIZ_UI_PASS: ${passed} scenarios; isolated fictional clients; physical devices not tested`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
