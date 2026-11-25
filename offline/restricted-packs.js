/* KG Chart U3D3B — restricted text + private media bundle contract.
 * NO network, database, CacheStorage, service worker or public URL access.
 * This validates the current enrolled-owner snapshot and the exact scoped
 * lesson/media source inventory. Native IndexedDB pointer swap is staged
 * separately in offline/runtime.js, in ONE kv transaction.
 *
 * This is local defensive filtering, not cryptographic DRM, server RLS,
 * revocation of previously copied bytes or permission to sync the outbox.
 */
(function(root){
  'use strict';
  const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const LANG=/^[a-z]{2,3}$/;
  const TABLES=Object.freeze({
    languages:'kg_chart_languages',
    topics:'kg_chart_topics',
    topicTranslations:'kg_chart_topic_translations',
    vocabulary:'kg_chart_vocabulary',
    vocabularyTranslations:'kg_chart_vocabulary_translations',
    sentences:'kg_chart_sentences',
    colours:'kg_chart_colour_phrases',
    settings:'kg_chart_settings',
  });
  const fields={
    [TABLES.languages]:['code','name_english','name_native','flag_emoji','sort_order','is_active'],
    [TABLES.topics]:['id','icon','sort_order','name_english','created_at'],
    [TABLES.topicTranslations]:['topic_id','language_code','title_native','title_english',
      'question_native','question_english','pinyin','question_pinyin','notes'],
    [TABLES.vocabulary]:['id','topic_id','english_text','image_filename','sort_order','extra_data'],
    [TABLES.vocabularyTranslations]:['vocabulary_id','language_code','native_text',
      'devanagari','pronunciation','notes','meaning_native'],
    [TABLES.sentences]:['id','language_code','group_name','native_text','english_text',
      'meaning_text','meaning_english','meaning_native','speaker','speaker_label',
      'sort_order','created_at'],
    [TABLES.colours]:['id','language_code','native_text','picture','colour_id','noun_id'],
    [TABLES.settings]:['key','value'],
  };
  const fail=why=>{throw Error('Restricted pack denied: '+why);};
  const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const owned=(owner,lang)=>typeof owner==='string'&&UUID.test(owner)&&
    typeof lang==='string'&&LANG.test(lang);
  const rev=n=>Number.isSafeInteger(n)&&n>=0;
  const canonical=x=>JSON.stringify(x);
  const sha256=async(value,cryptoApi)=>{
    if(!cryptoApi?.subtle?.digest)fail('secure content hash unavailable');
    const buf=new TextEncoder().encode(canonical(value));
    return Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',buf)),
      b=>b.toString(16).padStart(2,'0')).join('');
  };
  const safeList=(data,table)=>{
    const xs=data?.[table];
    if(!Array.isArray(xs)||xs.length>150000||
       xs.some(x=>!isObj(x)||Object.keys(x).some(k=>!fields[table].includes(k))))
      fail('unverified content table '+table);
    return xs;
  };
  function policyFor(ownerId,language,record,clock){
    if(!owned(ownerId,language)||!record||
       !Number.isSafeInteger(clock)||clock<=0||
       root.KGOfflineAccess?.fromCache?.(record,ownerId,clock)?.state!=='restricted_pending')
      fail('account or permission snapshot not verified');
    const policy=root.KGLearnerAccess?.parseSnapshot?.(record.snapshot);
    if(policy?.state!=='restricted'||policy.revision!==record.snapshot.revision||
       !policy.languages.includes(language))fail('language denied');
    return policy;
  }
  function sentenceScopeOf(scope){
    if(scope==null)return null;
    if(scope.state!=='restricted'||scope.serverEnforced!==true||
       !Array.isArray(scope.groups)||scope.groups.length>1000||
       !isObj(scope.groupTopics))fail('sentence mapping not verified');
    const seen=new Set();
    const mapped=Object.create(null);
    for(const group of scope.groups){
      if(typeof group!=='string'||!group||group.length>250||
         group!==group.trim()||seen.has(group)||
         ['__proto__','constructor','prototype'].includes(group)||
         typeof scope.groupTopics[group]!=='string'||
         !scope.groupTopics[group]||scope.groupTopics[group].length>150)
        fail('unverified sentence group');
      seen.add(group);mapped[group]=scope.groupTopics[group];
    }
    if(Object.keys(scope.groupTopics).length!==seen.size)
      fail('unexpected sentence mapping');
    return {state:'restricted',serverEnforced:true,
      groups:[...seen].sort(),groupTopics:mapped};
  }
  function checkRows(data,language,policy,scope){
    if(!isObj(data)||Object.keys(data).sort().join('|')!==
       Object.values(TABLES).sort().join('|'))fail('unexpected lesson table');
    const lang=safeList(data,TABLES.languages);
    if(lang.length!==1||lang[0].code!==language||lang[0].is_active!==true)
      fail('inactive or mixed language');
    const topics=safeList(data,TABLES.topics);
    if(!topics.length)fail('empty granted topics');
    const topicIds=new Set();
    for(const row of topics){
      if(typeof row.id!=='string'||!row.id||row.id.length>150||
         topicIds.has(row.id)||!policy.topics.includes(language+'|'+row.id))
        fail('ungranted or duplicate topic');
      topicIds.add(row.id);
    }
    const topicTranslations=safeList(data,TABLES.topicTranslations);
    if(topicTranslations.length!==topics.length)fail('incomplete topic translations');
    const seenTT=new Set();
    for(const t of topicTranslations){
      if(t.language_code!==language||!topicIds.has(t.topic_id)||
         seenTT.has(t.topic_id))fail('foreign topic translation');
      seenTT.add(t.topic_id);
    }
    const words=safeList(data,TABLES.vocabulary),wordIds=new Set(),wordTopics=new Map();
    for(const w of words){
      if(typeof w.id!=='string'||!UUID.test(w.id)||wordIds.has(w.id)||
         !topicIds.has(w.topic_id))fail('ungranted or duplicate word');
      if(w.image_filename!=null &&
         (typeof w.image_filename!=='string'||!w.image_filename.startsWith('emoji:')||
          w.image_filename.length>50||
          !/^[\\p{Emoji_Presentation}\\p{Emoji}\\u200d\\ufe0f ]{1,30}$/u.test(w.image_filename.slice(6))))
        fail('public or invalid picture filename in restricted pack');
      if(w.extra_data!=null && (!isObj(w.extra_data)||
         Object.keys(w.extra_data).some(k=>!['colorCode','content_type'].includes(k))))
        fail('unreviewed vocabulary metadata');
      wordIds.add(w.id);wordTopics.set(w.id,w.topic_id);
    }
    const wt=safeList(data,TABLES.vocabularyTranslations);
    if(wt.length!==words.length)fail('incomplete word translations');
    const seenWT=new Set();
    for(const t of wt){
      if(t.language_code!==language||!wordIds.has(t.vocabulary_id)||
         seenWT.has(t.vocabulary_id))fail('foreign word translation');
      seenWT.add(t.vocabulary_id);
    }
    const sentences=safeList(data,TABLES.sentences),sentenceTopics=new Map();
    if(sentences.length && (!scope || !(policy.features.includes('quiz.sentences')||
        policy.features.includes('quiz.speak'))))
      fail('sentence feature not granted');
    const seenSent=new Set();
    for(const s of sentences){
      if(!UUID.test(String(s.id||''))||seenSent.has(s.id)||
         s.language_code!==language||!scope?.groups.includes(s.group_name)||
         !topicIds.has(scope.groupTopics[s.group_name]))
        fail('unverified sentence group/topic');
      seenSent.add(s.id);sentenceTopics.set(s.id,{
        groupName:s.group_name,topicId:scope.groupTopics[s.group_name]});
    }
    const colours=safeList(data,TABLES.colours);
    if(colours.length && !policy.features.includes('quiz.colours'))
      fail('colours feature not granted');
    const seenColours=new Set();
    for(const c of colours){
      if(!UUID.test(String(c.id||''))||seenColours.has(c.id)||
         c.language_code!==language||!wordIds.has(c.colour_id)||
         !wordIds.has(c.noun_id)||
         (c.picture!=null &&
           (typeof c.picture!=='string' ||
            !( /^#[0-9a-f]{6}$/i.test(c.picture) ||
              /^[\\p{Emoji_Presentation}\\p{Emoji}\\u200d\\ufe0f ]{1,30}$/u.test(
                c.picture.startsWith('emoji:')?c.picture.slice(6):c.picture)))))
        fail('ungranted colour phrase or remote picture');
      seenColours.add(c.id);
    }
    const settings=safeList(data,TABLES.settings);
    if(settings.length!==1||settings[0].key!=='kg_private_visibility:'+language||
       settings[0].value?.contract!==1||
       !Array.isArray(settings[0].value.topics)||settings[0].value.topics.length||
       !Array.isArray(settings[0].value.groups)||settings[0].value.groups.length||
       Object.keys(settings[0].value).sort().join('|')!=='contract|groups|topics')
      fail('private lesson visibility is not sanitized');
    return {topics:topicIds.size,words:wordIds.size,
      sentences:seenSent.size,colours:seenColours.size,
      // The following source relationships are NOT serialized as extra
      // learner data: used only to validate the exact media source plan.
      wordTopics,sentenceTopics,colourIds:seenColours,topicIds};
  }
  function sourceKey(s){
    return canonical([s.type,s.language,s.id||null,s.topicId||null,
      s.groupName||null,s.voice||null]);
  }
  function validateMediaPlan(plan,mediaPointer,language,policy,scope,record,links){
    if(!Array.isArray(plan)||plan.length<1||plan.length>3000)
      fail('private media plan missing');
    if(!isObj(mediaPointer)||mediaPointer.kind!=='kg-private-offline-active-media'||
       mediaPointer.ownerId!==record.ownerId||mediaPointer.language!==language||
       mediaPointer.revision!==policy.revision||
       mediaPointer.grants!==canonical(record.snapshot)||
       mediaPointer.checkedAt!==record.checkedAt||
       !Array.isArray(mediaPointer.sourceKeys))
      fail('private media pointer does not match lesson grant');
    const keys=new Set();
    for(const s of plan){
      if(!isObj(s)||s.language!==language||
         !['word_image','word_audio','topic_audio','sentence_audio','colour_audio'].includes(s.type)||
         (s.type==='word_image'?s.voice!=null:!['m','f'].includes(s.voice))||
         !root.KGLearnerAccess.canLanguage(policy,language))
        fail('invalid media source');
      if((s.type==='word_audio'||s.type==='word_image'||s.type==='topic_audio')&&
         !root.KGLearnerAccess.canTopic(policy,language,s.topicId))
        fail('ungranted word or topic media');
      if((s.type==='word_audio'||s.type==='word_image')&&
         (!links.wordTopics.has(s.id)||links.wordTopics.get(s.id)!==s.topicId))
        fail('word media not in approved lesson bundle');
      if(s.type==='topic_audio'&&!links.topicIds.has(s.topicId))
        fail('topic audio not in approved lesson bundle');
      if(s.type==='colour_audio'&&!links.colourIds.has(s.id))
        fail('colour audio not in approved lesson bundle');
      if(s.type==='sentence_audio'){
        const attached=links.sentenceTopics.get(s.id);
        if(!attached||attached.groupName!==s.groupName||
           attached.topicId!==s.topicId)
          fail('sentence media not in approved lesson bundle');
      }
      if(s.type==='sentence_audio' &&
         (!scope||!scope.groups.includes(s.groupName)||
          scope.groupTopics[s.groupName]!==s.topicId))
        fail('unverified sentence media');
      if(s.type==='colour_audio'&&!policy.features.includes('quiz.colours'))
        fail('ungranted colour audio');
      const key=sourceKey(s);
      if(keys.has(key))fail('duplicate media source');
      keys.add(key);
    }
    if(canonical([...keys].sort())!==canonical(mediaPointer.sourceKeys))
      fail('private media plan is not complete');
    return [...keys].sort();
  }
  function keys(ownerId,language){
    if(!owned(ownerId,language))fail('invalid account key');
    return {
      active:'restricted-active:'+ownerId+':'+language,
      previous:'restricted-previous:'+ownerId+':'+language,
      payloadPrefix:'restricted-body:'+ownerId+':'+language+':',
    };
  }
  async function prepare({
    ownerId,language,policyRecord,content,mediaPlan,mediaPointer,sentenceScope,
    cryptoApi=root.crypto,checkedAt=Date.now(),packageId
  }={}){
    const policy=policyFor(ownerId,language,policyRecord,checkedAt);
    if(typeof packageId!=='string'||!UUID.test(packageId))
      fail('missing verified pack nonce');
    const scope=sentenceScopeOf(sentenceScope);
    const links=checkRows(content,language,policy,scope);
    const sourceKeys=validateMediaPlan(mediaPlan,mediaPointer,language,policy,scope,
      policyRecord,links);
    const counts={topics:links.topics,words:links.words,
      sentences:links.sentences,colours:links.colours};
    const cloned=JSON.parse(canonical(content));
    const contentHash=await sha256(cloned,cryptoApi);
    return {
      body:{contract:1,kind:'kg-restricted-text-body',
        ownerId,language,revision:policy.revision,content:cloned},
      pointer:{contract:1,kind:'kg-restricted-pack',
        ownerId,language,revision:policy.revision,createdAt:checkedAt,
        policyCheckedAt:policyRecord.checkedAt,
        grants:canonical(policyRecord.snapshot),
        packageId,contentHash,counts,mediaPointer,
        sourceKeys,sentenceScope:scope},
    };
  }
  async function verify({
    ownerId,language,policyRecord,pointer,body,
    cryptoApi=root.crypto,checkedAt=Date.now()
  }={}){
    const policy=policyFor(ownerId,language,policyRecord,checkedAt);
    if(!isObj(pointer)||pointer.contract!==1||
       pointer.kind!=='kg-restricted-pack'||
       pointer.ownerId!==ownerId||pointer.language!==language||
       pointer.revision!==policy.revision||
       pointer.grants!==canonical(policyRecord.snapshot)||
       typeof pointer.packageId!=='string'||!UUID.test(pointer.packageId)||
       typeof pointer.contentHash!=='string'||
       !/^[a-f0-9]{64}$/.test(pointer.contentHash)||
       !rev(pointer.policyCheckedAt)||pointer.policyCheckedAt>policyRecord.checkedAt||
       !isObj(body)||body.contract!==1||
       body.kind!=='kg-restricted-text-body'||
       body.ownerId!==ownerId||body.language!==language||
       body.revision!==policy.revision)
      fail('stale, cross-account or legacy bundle');
    const actual=await sha256(body.content,cryptoApi);
    if(actual!==pointer.contentHash)fail('restricted lesson bytes changed');
    const scope=sentenceScopeOf(pointer.sentenceScope);
    const links=checkRows(body.content,language,policy,scope);
    const counts={topics:links.topics,words:links.words,
      sentences:links.sentences,colours:links.colours};
    if(canonical(counts)!==canonical(pointer.counts))
      fail('restricted lesson inventory changed');
    if(!isObj(pointer.mediaPointer)||
       pointer.mediaPointer.kind!=='kg-private-offline-active-media'||
       pointer.mediaPointer.ownerId!==ownerId||
       pointer.mediaPointer.language!==language||
       pointer.mediaPointer.revision!==policy.revision||
       pointer.mediaPointer.grants!==canonical(policyRecord.snapshot)||
       !Array.isArray(pointer.sourceKeys)||
       canonical(pointer.sourceKeys)!==canonical(pointer.mediaPointer.sourceKeys))
      fail('private media pointer does not match restricted lessons');
    const sources=pointer.sourceKeys.map(key=>{
      let values;
      try{values=JSON.parse(key);}catch(_){fail('invalid private source key');}
      if(!Array.isArray(values)||values.length!==6)
        fail('invalid private source tuple');
      return {type:values[0],language:values[1],id:values[2],
        topicId:values[3],groupName:values[4],voice:values[5]};
    });
    validateMediaPlan(sources,pointer.mediaPointer,language,policy,scope,
      policyRecord,links);
    // The private media adapter independently verifies its own SHA-256,
    // byte limits, source keys and cached manifest on every media read.
    // This method checks the atomic cross-reference, not remote auth.
    return body.content;
  }
  root.KGRestrictedPacks={TABLES,keys,prepare,verify};
})(typeof window!=='undefined'?window:globalThis);
