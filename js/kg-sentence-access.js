/* KG Chart U3C2A — pure per-account sentence group authorization.
 * Read-only UI filter, never an authorization token. Server RLS remains
 * responsible for every SELECT and write. Restricted mode requires a
 * verified server-enforced group mapping; old/missing maps fail CLOSED.
 */
(function(root){
  'use strict';
  const validGroup=x=>typeof x==='string'&&x.length>0&&x.length<=250
    &&x.trim()===x&&!['__proto__','prototype','constructor'].includes(x);
  const validTopic=x=>typeof x==='string'&&x.length>0&&x.length<=150;
  const blocked=reason=>({state:'blocked',reason,groups:[],groupTopics:{},serverEnforced:false});
  const legacy=()=>({state:'legacy',reason:null,groups:null,groupTopics:{},serverEnforced:false});

  function parseGroupSnapshot(data,policy,language){
    if(policy?.state==='legacy')return legacy();
    if(policy?.state!=='restricted'||!language||typeof language!=='string')
      return blocked('unverified_identity');
    if(!data||data.contract!==1||data.language_code!==language||
      data.mode!=='restricted'||data.server_enforced!==true||
      !Array.isArray(data.groups)||data.groups.length>1000)
      return blocked('unverified_mapping');

    const grants=new Set(policy.topics||[]);
    const topics=Object.create(null),groupNames=new Set();
    for(const item of data.groups){
      if(!item||Object.keys(item).some(k=>!['group_name','topic_id'].includes(k))
         ||!validGroup(item.group_name)||!validTopic(item.topic_id)
         ||groupNames.has(item.group_name)
         ||!grants.has(language+'|'+item.topic_id))
        return blocked('invalid_group_mapping');
      groupNames.add(item.group_name);
      topics[item.group_name]=item.topic_id;
    }
    return {state:'restricted',reason:null,groups:[...groupNames],
      groupTopics:topics,serverEnforced:true};
  }

  function isAllowed(scope,group){
    if(scope?.state==='legacy')return true;
    return scope?.state==='restricted'&&typeof group==='string'
      &&Object.prototype.hasOwnProperty.call(scope.groupTopics,group);
  }
  function filterSentences(scope,rows){
    if(scope?.state==='legacy')return rows||[];
    if(scope?.state!=='restricted')return [];
    return (rows||[]).filter(row=>isAllowed(scope,row.group_name));
  }
  function visibleGroups(scope){
    return scope?.state==='restricted'?[...scope.groups]:
      scope?.state==='legacy'?null:[];
  }
  root.KGSentenceAccess={parseGroupSnapshot,filterSentences,isAllowed,visibleGroups};
})(typeof window!=='undefined'?window:globalThis);
