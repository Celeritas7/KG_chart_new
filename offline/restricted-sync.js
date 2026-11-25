/* KG Chart U3D3C — staged, owner-verified restricted synchronization.
 * OFF by default until verified U3A/U3B/U3C backend, real RLS, U4 hardware.
 * No security decision relies on a caller-supplied email, lesson text, public
 * media URL, stale legacy pack or optimistic write response.
 *
 * This is a defense-in-depth CLIENT contract. Supabase RLS/write predicates
 * and current auth.uid() remain mandatory. It cannot atomically lock a server
 * grant revision across separate RPC and INSERT calls. A changed revision
 * after a write prevents local ACK and leaves a recoverable/idempotent retry.
 */
(function(root){
  'use strict';
  const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const LANG=/^[a-z]{2,3}$/;
  const LIMIT=200;
  const TABLE=Object.freeze({
    ratings:'kg_chart_user_ratings',
    sessions:'kg_chart_quiz_sessions',
    answers:'kg_chart_quiz_answers',
    completions:'kg_chart_topic_completions',
  });
  const ALLOWED={
    [TABLE.ratings]:new Set(['user_id','vocabulary_id','language_code',
      'rating','last_reviewed_at','updated_at']),
    [TABLE.sessions]:new Set(['id','user_id','language_code','topic_id',
      'quiz_type','total_questions','correct_answers','difficulty',
      'completed_at','created_at','quiz_level']),
    [TABLE.answers]:new Set(['id','session_id','vocabulary_id','sentence_id',
      'selected_vocabulary_id','is_correct','answer_text',
      'answered_at','completed_at','created_at']),
    [TABLE.completions]:new Set(['user_id','language_code','topic_id','completed_at']),
  };
  const MODES=Object.freeze({
    native_to_image:'quiz.words',image_to_native:'quiz.words',
    devanagari_to_image:'quiz.words',english_to_native:'quiz.words',
    listen_to_image:'quiz.words',listen_to_native:'quiz.words',
    word_builder:'quiz.words',type_word:'quiz.words',
    typing_copy:'quiz.typing',typing_recall:'quiz.typing',
    sentence_to_meaning:'quiz.sentences',
    meaning_to_sentence:'quiz.sentences',build_sentence:'quiz.sentences',
    speak_lines:'quiz.speak',speak_paragraph:'quiz.speak',
  });
  const SENTENCE=new Set(['quiz.sentences','quiz.speak']);
  const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const isId=x=>typeof x==='string'&&UUID.test(x);
  const validRevision=x=>Number.isSafeInteger(x)&&x>=0;
  const hold=reason=>({approved:false,reason});
  const err=e=>String(e?.message||'').slice(0,0); // never log backend details
  const sameSnapshot=(a,b)=>JSON.stringify(a?.snapshot)===JSON.stringify(b?.snapshot);
  function access({ownerId,policyRecord,clock=Date.now,offlineAccess=root.KGOfflineAccess,
    learnerAccess=root.KGLearnerAccess}){
    if(!isId(ownerId)||!policyRecord||policyRecord.ownerId!==ownerId||
       offlineAccess?.fromCache?.(policyRecord,ownerId,clock())?.state!=='restricted_pending')
      return null;
    const policy=learnerAccess?.parseSnapshot?.(policyRecord.snapshot);
    return policy?.state==='restricted'&&validRevision(policy.revision)&&
      policy.revision===policyRecord.snapshot.revision ? policy : null;
  }
  const grantedTopic=(p,lang,topic)=>typeof topic==='string'&&topic.length>0&&
    p.languages.includes(lang)&&p.topics.includes(lang+'|'+topic);
  function shape(event,ownerId,policy){
    if(!isObj(event)||!isId(event.id)||event.ownerId!==ownerId||
       !isObj(event.row)||!Array.isArray(event.filters)||
       event.filters.some(x=>!Array.isArray(x)||x.length!==3||
         !['eq','in','is'].includes(x[0]))||
       !ALLOWED[event.table]||
       Object.keys(event.row).some(x=>!ALLOWED[event.table].has(x))||
       event.row.user_id!=null&&event.row.user_id!==ownerId)
      return 'malformed_or_foreign';
    if(!validRevision(event.permissionRevision))return 'untagged_legacy';
    if(event.permissionRevision!==policy.revision)return 'revision_changed';
    const kinds={
      [TABLE.ratings]:['upsert','insert','delete'],
      [TABLE.completions]:['upsert','insert'],
      [TABLE.sessions]:['insert'],
      [TABLE.answers]:['insert'],
    };
    if(!kinds[event.table].includes(event.kind))
      return 'unsupported_mutation';
    if(event.table===TABLE.ratings||event.table===TABLE.completions||
       event.table===TABLE.sessions){
      if(typeof event.row.language_code!=='string'||
         !LANG.test(event.row.language_code)||
         !policy.languages.includes(event.row.language_code))
        return 'language_denied';
    }
    if(event.table===TABLE.sessions){
      if(!isId(event.row.id)||event.row.user_id!==ownerId||
         !grantedTopic(policy,event.row.language_code,event.row.topic_id)||
         !MODES[event.row.quiz_type]||
         !policy.features.includes(MODES[event.row.quiz_type]))
        return 'session_scope_denied';
    }
    if(event.table===TABLE.completions){
      if(event.row.user_id!==ownerId||
         !grantedTopic(policy,event.row.language_code,event.row.topic_id)||
         !(['chart','quiz.words'].some(x=>policy.features.includes(x))))
        return 'completion_scope_denied';
    }
    if(event.table===TABLE.ratings){
      if(event.row.user_id!==ownerId||!isId(event.row.vocabulary_id)||
         !['chart','cards','quiz.words','quiz.typing']
           .some(x=>policy.features.includes(x)))
        return 'rating_scope_denied';
      if(event.kind==='delete'&&(!Array.isArray(event.filters)||
         event.filters.length!==3||
         !['user_id','vocabulary_id','language_code']
           .every(k=>event.filters.some(([op,key,val])=>
             op==='eq'&&key===k&&val===event.row[k]))))
        return 'unsafe_rating_delete';
    }
    if(event.table===TABLE.answers){
      if(!isId(event.row.id)||!isId(event.row.session_id)||
         (isId(event.row.vocabulary_id)===isId(event.row.sentence_id))||
         (event.row.vocabulary_id!=null&&!isId(event.row.vocabulary_id))||
         (event.row.sentence_id!=null&&!isId(event.row.sentence_id)))
        return 'answer_source_ambiguous';
    }
    return null;
  }
  async function rpcTrue(client,name,args,assertCurrent){
    assertCurrent?.();
    const {data,error}=await client.rpc(name,args);
    assertCurrent?.();
    return !error&&data===true;
  }
  async function row(client,table,filter,columns,assertCurrent){
    if(!Object.keys(filter).length) return null;
    assertCurrent?.();
    let request=client.from(table).select(columns);
    for(const [key,value] of Object.entries(filter))request=request.eq(key,value);
    const {data,error}=await request.maybeSingle();
    assertCurrent?.();
    return !error&&isObj(data)?data:null;
  }
  async function authorize({
    event,ownerId,policyRecord,client,clock=Date.now,
    offlineAccess=root.KGOfflineAccess,learnerAccess=root.KGLearnerAccess,
    sentenceAccess=root.KGSentenceAccess,assertCurrent,
  }={}){
    const policy=access({ownerId,policyRecord,clock,offlineAccess,learnerAccess});
    if(!policy||!client?.rpc||!client?.from)return hold('unverified_current_policy');
    const why=shape(event,ownerId,policy);
    if(why)return hold(why);
    try{
      const r=event.row;
      if(event.table===TABLE.ratings){
        const args={p_lang:r.language_code,p_vocab:r.vocabulary_id};
        if(!await rpcTrue(client,'kg_chart_u3b2_can_rating',args,assertCurrent)||
           !await rpcTrue(client,'kg_chart_u3b3b1_can_private_rating',args,assertCurrent))
          return hold('server_rating_denied');
        const word=await row(client,'kg_chart_vocabulary',
          {id:r.vocabulary_id},'id,topic_id',assertCurrent);
        if(!word||!grantedTopic(policy,r.language_code,word.topic_id))
          return hold('server_word_scope_denied');
      }else if(event.table===TABLE.completions){
        const args={p_lang:r.language_code,p_topic:r.topic_id};
        if(!await rpcTrue(client,'kg_chart_u3b2_can_completion',args,assertCurrent)||
           !await rpcTrue(client,'kg_chart_u3b3b1_can_private_session',args,assertCurrent))
          return hold('server_completion_denied');
      }else{
        let session;
        if(event.table===TABLE.sessions)session=r;
        else{
          session=await row(client,'kg_chart_quiz_sessions',
            {id:r.session_id,user_id:ownerId},
            'id,user_id,language_code,topic_id,quiz_type',assertCurrent);
          if(!session)return hold('session_not_server_verified');
        }
        const language=session.language_code,topic=session.topic_id,
          mode=session.quiz_type,feature=MODES[mode];
        if(!LANG.test(String(language))||!grantedTopic(policy,language,topic)||
           !feature||!policy.features.includes(feature))
          return hold('server_session_scope_denied');
        if(!await rpcTrue(client,'kg_chart_u3b2_can_quiz_session',
              {p_lang:language,p_topic:topic,p_type:mode},assertCurrent)||
           !await rpcTrue(client,'kg_chart_u3b3b1_can_private_session',
              {p_lang:language,p_topic:topic},assertCurrent))
          return hold('server_session_denied');
        // A verified sentence-group mapping must exist, even if the session
        // has an apparently allowed topic ID. Synthetic/old false snapshots
        // do not grant permissions.
        if(SENTENCE.has(feature)){
          if(!await rpcTrue(client,'kg_chart_u3c2_can_sentence_session',
            {p_lang:language,p_topic:topic,p_type:mode},assertCurrent))
            return hold('server_sentence_session_denied');
        }
        if(event.table===TABLE.answers){
          const args={p_session:r.session_id,p_vocab:r.vocabulary_id||null,
            p_sentence:r.sentence_id||null};
          if(!await rpcTrue(client,'kg_chart_u3b2_can_answer',args,assertCurrent)||
             !await rpcTrue(client,'kg_chart_u3b3b1_can_private_answer',args,assertCurrent))
            return hold('server_answer_denied');
          if(r.vocabulary_id){
            if(SENTENCE.has(feature))return hold('word_not_sentence_mode');
            const word=await row(client,'kg_chart_vocabulary',
              {id:r.vocabulary_id},'id,topic_id',assertCurrent);
            if(!word||word.topic_id!==topic||
               !grantedTopic(policy,language,word.topic_id))
              return hold('word_parent_topic_mismatch');
          }else{
            const s=await row(client,'kg_chart_sentences',
              {id:r.sentence_id,language_code:language},
              'id,language_code,group_name',assertCurrent);
            if(!s||!SENTENCE.has(feature))return hold('sentence_source_denied');
            if(!await rpcTrue(client,'kg_chart_u3c2_can_sentence_group',
                 {p_lang:language,p_group:s.group_name},assertCurrent))
              return hold('sentence_group_denied');
            const {data:groups,error}=await client.rpc(
              'kg_chart_u3c2_my_sentence_groups',{p_language:language});
            assertCurrent?.();
            if(error)return hold('sentence_mapping_unverified');
            const verified=sentenceAccess?.parseGroupSnapshot?.(groups,policy,language);
            if(verified?.state!=='restricted'||verified.serverEnforced!==true||
               verified.groupTopics?.[s.group_name]!==topic)
              return hold('sentence_parent_topic_mismatch');
          }
        }
      }
      assertCurrent?.();
      // This is not a write authorization by itself. The server's current
      // RESTRICTIVE INSERT/UPDATE policies MUST independently accept the
      // subsequent mutation; later policy recheck controls local ACK.
      return {approved:true,reason:null,revision:policy.revision};
    }catch(_){
      return hold('server_verification_unavailable');
    }
  }
  function compatible(record,ownerId,expected,clock,
    offlineAccess=root.KGOfflineAccess,learnerAccess=root.KGLearnerAccess){
    const p=access({ownerId,policyRecord:record,clock,
      offlineAccess,learnerAccess});
    return !!p&&p.revision===expected.snapshot.revision&&
      sameSnapshot(record,expected);
  }
  async function reconcile({
    events,ownerId,policyRecord,client,
    refresh,apply,ack,assertCurrent,clock=Date.now,
    offlineAccess=root.KGOfflineAccess,learnerAccess=root.KGLearnerAccess,
    sentenceAccess=root.KGSentenceAccess,maxEvents=LIMIT,
  }={}){
    if(!Array.isArray(events)||events.length>100000||!isId(ownerId)||
       typeof refresh!=='function'||typeof apply!=='function'||
       typeof ack!=='function'||!client)return {
      contract:1,mode:'hold',checked:0,acknowledged:0,
      held:Array.isArray(events)?events.length:0,reasonCounts:{invalid_inventory:1},
      publishable:false};
    const reasons=Object.create(null);let checked=0,acknowledged=0;
    const add=reason=>{reasons[reason]=(reasons[reason]||0)+1;};
    const cap=Math.min(Math.max(0,Math.floor(maxEvents)||LIMIT),LIMIT);
    const now=()=>clock();
    if(!compatible(policyRecord,ownerId,policyRecord,now,
      offlineAccess,learnerAccess)){
      return {contract:1,mode:'hold',checked:0,acknowledged:0,
        held:events.length,reasonCounts:{unverified_current_policy:events.length},
        publishable:false};
    }
    for(const event of events.slice(0,cap)){
      checked++;
      assertCurrent?.();
      const v=await authorize({event,ownerId,policyRecord,client,clock,
        offlineAccess,learnerAccess,sentenceAccess,assertCurrent});
      if(!v.approved){add(v.reason);continue;}
      // Refresh Auth + server permission snapshot BEFORE the write.
      let fresh;
      try{fresh=await refresh();assertCurrent?.();}
      catch(_){add('fresh_server_grant_unavailable');break;}
      if(!compatible(fresh,ownerId,policyRecord,now,
        offlineAccess,learnerAccess)){
        add('grant_changed_before_write');break;
      }
      try{
        await apply(event);assertCurrent?.();
      }catch(_){add('server_write_not_acknowledged');continue;}
      // A server write may succeed while the policy changes. Never delete
      // local evidence until a SECOND live grant check passes.
      let after;
      try{after=await refresh();assertCurrent?.();}
      catch(_){add('post_write_grant_unavailable');break;}
      if(!compatible(after,ownerId,policyRecord,now,
        offlineAccess,learnerAccess)){
        add('post_write_grant_changed');break;
      }
      try{
        await ack(event,after);assertCurrent?.();
        acknowledged++;
      }catch(_){add('local_ack_not_committed');break;}
    }
    const held=events.length-acknowledged;
    if(checked<events.length && !Object.keys(reasons).length)
      add('not_yet_reviewed');
    return {contract:1,mode:'restricted_review',
      checked,acknowledged,held,
      reasonCounts:Object.fromEntries(Object.entries(reasons).sort()),
      publishable:false}; // no blanket upload permission, per event only
  }
  root.KGRestrictedSync={authorize,reconcile,compatible,TABLE,LIMIT};
})(typeof window!=='undefined'?window:globalThis);
