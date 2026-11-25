/* KG Chart U3D1 — staged, fail-closed offline policy snapshot contract.
 * This is a UX/availability gate, NOT cryptographic proof of offline grants:
 * a device owner can inspect/alter IndexedDB or previously downloaded bytes.
 * Restricted offline packs are intentionally DISABLED until U3D2/U3D3.
 * No emails, bearer tokens, signed media URLs, or user data belong here.
 */
(function(root) {
  'use strict';
  const CONTRACT=1;
  const MAX_AGE_MS=24*60*60*1000;
  const CLOCK_SKEW_MS=2*60*1000;
  const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const blank=(reason)=>({state:'blocked',reason,revision:null,ownerId:null});
  const validOwner=id=>typeof id==='string'&&UUID.test(id);
  const parsedPolicy=snapshot=>root.KGLearnerAccess?.parseSnapshot?.(snapshot);
  const validTime=time=>Number.isSafeInteger(time)&&time>0;

  function canonical(raw) {
    const parsed=parsedPolicy(raw);
    if(!parsed||!['legacy','restricted'].includes(parsed.state))return null;
    if(parsed.state==='legacy')return {
      contract:CONTRACT,mode:'legacy',revision:parsed.revision,
      server_enforced:false,languages:null,topics:null,features:null,
    };
    if(raw?.server_enforced!==true)return null;
    return {
      contract:CONTRACT,mode:'restricted',revision:parsed.revision,
      server_enforced:true,languages:[...parsed.languages].sort(),
      topics:parsed.topics.map(key=>{
        const boundary=key.indexOf('|');
        return {language_code:key.slice(0,boundary),topic_id:key.slice(boundary+1)};
      }).sort((a,b)=>a.language_code.localeCompare(b.language_code)||
        a.topic_id.localeCompare(b.topic_id)),
      features:[...parsed.features].sort(),
    };
  }
  function validRecord(record,ownerId) {
    return !!record&&record.contract===CONTRACT&&
      validOwner(ownerId)&&record.ownerId===ownerId&&
      validTime(record.checkedAt)&&
      canonical(record.snapshot)!=null&&
      JSON.stringify(record.snapshot)===JSON.stringify(canonical(record.snapshot));
  }
  function fromCache(record,ownerId,clock=Date.now()) {
    if(!validRecord(record,ownerId))return blank('missing_or_invalid_account_policy');
    if(!validTime(clock)||record.checkedAt>clock+CLOCK_SKEW_MS||
       clock-record.checkedAt>MAX_AGE_MS)return blank('offline_policy_expired');
    const {snapshot}=record;
    if(snapshot.mode==='restricted')return {
      state:'restricted_pending',reason:'restricted_offline_pack_not_authorized',
      revision:snapshot.revision,ownerId,
    };
    return {state:'legacy',reason:null,revision:snapshot.revision,ownerId};
  }
  function fromServer(raw,ownerId,checkedAt=Date.now(),previous=null) {
    if(!validOwner(ownerId)||!validTime(checkedAt))
      return {view:blank('unverified_identity'),record:null};
    const snapshot=canonical(raw);
    if(!snapshot)return {view:blank('unverified_server_policy'),record:null};
    if(previous) {
      if(!validRecord(previous,ownerId))
        return {view:blank('previous_policy_invalid'),record:null};
      if(snapshot.revision<previous.snapshot.revision)
        return {view:blank('policy_revision_rollback'),record:null};
      if(snapshot.revision===previous.snapshot.revision&&
         JSON.stringify(snapshot)!==JSON.stringify(previous.snapshot))
        return {view:blank('same_revision_policy_changed'),record:null};
    }
    const record={contract:CONTRACT,ownerId,checkedAt,snapshot};
    return {
      // Do NOT grant access to existing broad offline packs for a restricted
      // learner. U3D2 will add independently verified filtered entitlements.
      view:snapshot.mode==='legacy' ?
        {state:'legacy',reason:null,revision:snapshot.revision,ownerId} :
        {state:'restricted_pending',reason:'restricted_offline_pack_not_authorized',
          revision:snapshot.revision,ownerId},
      record,
    };
  }
  function mayUseLegacyPack(view,ownerId) {
    return validOwner(ownerId)&&view?.ownerId===ownerId&&view.state==='legacy';
  }
  // This function gates ONLY this offline edition's local APIs. The database
  // and private Edge/Storage rules remain the remote security boundary.
  root.KGOfflineAccess={
    CONTRACT,MAX_AGE_MS,fromServer,fromCache,mayUseLegacyPack,
  };
})(typeof window!=='undefined'?window:globalThis);
