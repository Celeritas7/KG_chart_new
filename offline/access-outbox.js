/* KG Chart U3D3A — review-only permission-aware offline outbox inventory.
 * This module NEVER calls Supabase, deletes an event, mutates an existing
 * record, restores a pack, or authorizes a server write. It deliberately
 * marks EVERY restricted event as held until U3D3B audited synchronization.
 * A local permission snapshot is not server RLS or cryptographic proof.
 */
(function(root){
  'use strict';
  const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const LANG=/^[a-z]{2,3}$/;
  const MAX_EVENTS=100000;
  const TABLES={
    ratings:'kg_chart_user_ratings',
    sessions:'kg_chart_quiz_sessions',
    answers:'kg_chart_quiz_answers',
    levels:'kg_chart_user_levels',
    completions:'kg_chart_topic_completions',
    prefs:'kg_chart_user_prefs',
  };
  const MUTATIONS=new Set(['insert','update','upsert','delete']);
  const REASONS=[
    'invalid_event','wrong_account','unverified_policy','unknown_table',
    'legacy_untagged','revision_changed','language_not_granted',
    'topic_not_granted','source_not_verified','session_not_verified',
    'requires_server_review',
  ];
  const blocked=reason=>({contract:1,mode:'hold',reason,total:0,held:0,
    policyRevision:null,reasonCounts:{},tableCounts:{},publishable:false});
  const okId=id=>typeof id==='string'&&UUID.test(id);
  const validRev=v=>Number.isSafeInteger(v)&&v>=0;
  const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const knownTable=t=>Object.values(TABLES).includes(t);
  function policyOf(ownerId,record,now){
    if(!okId(ownerId)||!Number.isSafeInteger(now)||now<1)return null;
    const state=root.KGOfflineAccess?.fromCache?.(record,ownerId,now);
    if(state?.state!=='restricted_pending')return null;
    const policy=root.KGLearnerAccess?.parseSnapshot?.(record.snapshot);
    if(policy?.state!=='restricted'||!validRev(policy.revision)||
       policy.revision!==record.snapshot.revision)return null;
    return policy;
  }
  function eventReason(event,ownerId,policy){
    if(!isObj(event)||!okId(event.id)||!isObj(event.row)||
       !MUTATIONS.has(event.kind)||typeof event.table!=='string'||
       !Array.isArray(event.filters))
      return 'invalid_event';
    if(event.ownerId!==ownerId||event.row.user_id!=null&&event.row.user_id!==ownerId)
      return 'wrong_account';
    if(!policy)return 'unverified_policy';
    if(!knownTable(event.table))return 'unknown_table';
    // Old outbox entries have no trusted creation permission revision.
    // They can be retained/restored, but NEVER upgraded by guessing
    // that today's policy also applied at their creation time.
    if(!validRev(event.permissionRevision))return 'legacy_untagged';
    if(event.permissionRevision!==policy.revision)return 'revision_changed';
    if(event.table===TABLES.prefs)return 'requires_server_review';
    // Answers have no direct topic/language owner; their session must be
    // resolved against approved server history, never inferred by text.
    if(event.table===TABLES.answers)return 'session_not_verified';
    const lang=event.row.language_code;
    if(typeof lang!=='string'||!LANG.test(lang)||
       !policy.languages.includes(lang))
      return 'language_not_granted';
    if(event.table===TABLES.ratings)
      return 'source_not_verified'; // UUID alone doesn't prove its topic
    if(event.table===TABLES.completions||event.table===TABLES.sessions){
      const topic=event.row.topic_id;
      if(typeof topic!=='string'||!topic||
         !policy.topics.includes(lang+'|'+topic))
        return 'topic_not_granted';
    }
    // Even an apparently permitted source must be reauthorized by server
    // RLS/RPC after a fresh policy and by a verified pack entitlement.
    return 'requires_server_review';
  }
  function analyzeOutbox({
    ownerId,policyRecord,events,checkedAt=Date.now(),
  }={}){
    if(!okId(ownerId)||!Array.isArray(events)||events.length>MAX_EVENTS||
       !Number.isSafeInteger(checkedAt)||checkedAt<1)
      return blocked('invalid_inventory');
    const policy=policyOf(ownerId,policyRecord,checkedAt);
    const reasons=Object.create(null),tables=Object.create(null);
    for(const reason of REASONS)reasons[reason]=0;
    // Only counts are returned: never duplicate a quiz answer or private
    // vocabulary row in diagnostics, logs, analytics or a new KV record.
    const seen=new Set();
    for(const event of events){
      let reason=eventReason(event,ownerId,policy);
      if(isObj(event)&&okId(event.id)){
        if(seen.has(event.id))reason='invalid_event';
        seen.add(event.id);
      }
      reasons[reason]++;
      const table=event?.table;
      const label=knownTable(table)?table:'unknown';
      tables[label]=(tables[label]||0)+1;
    }
    const reasonCounts=Object.fromEntries(Object.entries(reasons).filter(([,n])=>n));
    return {contract:1,mode:'hold',
      reason:policy?'restricted_outbox_review_required':'unverified_policy',
      total:events.length,held:events.length,
      policyRevision:policy?.revision??null,
      reasonCounts,tableCounts:Object.fromEntries(Object.entries(tables).sort()),
      publishable:false};
  }
  root.KGAccessOutbox={analyzeOutbox,MAX_EVENTS,TABLES};
})(typeof window!=='undefined'?window:globalThis);
