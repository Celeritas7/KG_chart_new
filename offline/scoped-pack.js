/* KG Chart U3D2A — synthetic-only, restrictive offline pack CONTENT contract.
 * No private media can be cached by this module. No SQL/Storage changes.
 * A filtered preview is NOT authorization for offline delivery or revocation:
 * the server must enforce every source query and a previous public pack can
 * never be retrospectively erased from a learner's device.
 */
(function(root){
  'use strict';
  const TABLES={
    languages:'kg_chart_languages',
    topics:'kg_chart_topics',
    topicTranslations:'kg_chart_topic_translations',
    vocabulary:'kg_chart_vocabulary',
    vocabularyTranslations:'kg_chart_vocabulary_translations',
    sentences:'kg_chart_sentences',
    colours:'kg_chart_colour_phrases',
    settings:'kg_chart_settings',
  };
  const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const LANG=/^[a-z]{2,3}$/;
  const FIELDS={
    [TABLES.languages]:['code','name_english','name_native','flag_emoji','sort_order','is_active'],
    [TABLES.topics]:['id','icon','sort_order','name_english','created_at'],
    [TABLES.topicTranslations]:['topic_id','language_code','title_native','title_english',
      'question_native','question_english','pinyin','question_pinyin','notes'],
    [TABLES.vocabulary]:['id','topic_id','english_text','image_filename','sort_order','extra_data'],
    [TABLES.vocabularyTranslations]:['vocabulary_id','language_code','native_text',
      'devanagari','pronunciation','notes','meaning_native'],
    [TABLES.sentences]:['id','language_code','group_name','native_text','english_text',
      'meaning_text','meaning_english','meaning_native','speaker','speaker_label',
      'sort_order','created_at','extra_data'],
    [TABLES.colours]:['id','language_code','native_text','picture','colour_id','noun_id'],
  };
  const forbid=message=>{throw Error('Restricted offline candidate refused: '+message);};
  const list=(data,table)=>{
    const value=data?.[table];
    if(!Array.isArray(value)||value.length>150000)forbid('missing or malformed '+table);
    if(value.some(x=>!x||typeof x!=='object'||Array.isArray(x)))forbid('invalid row in '+table);
    return value;
  };
  const select=(row,fields)=>Object.fromEntries(fields.filter(k=>
    Object.prototype.hasOwnProperty.call(row,k)).map(k=>[k,row[k]]));
  const refId=x=>typeof x==='string'&&UUID.test(x);
  const validTopic=x=>typeof x==='string'&&x.length>0&&x.length<=150;
  const unique=(arr,key,label)=>{
    const ids=new Set();
    for(const value of arr){
      const id=key(value);
      if(!id||ids.has(id))forbid('duplicate/invalid '+label);
      ids.add(id);
    }
    return arr;
  };
  const saneStrings=(xs,label)=>{
    if(!Array.isArray(xs)||xs.length>2000||xs.some(x=>typeof x!=='string'||x.length>250))
      forbid('invalid '+label);
    return new Set(xs);
  };
  const safeExtra=value=>{
    if(value==null)return null;
    if(!value||typeof value!=='object'||Array.isArray(value))
      forbid('unexpected extra_data');
    const output={};
    if(value.colorCode!==undefined){
      if(typeof value.colorCode!=='string'||!/^#[0-9a-f]{6}$/i.test(value.colorCode))
        forbid('invalid colour metadata');
      output.colorCode=value.colorCode;
    }
    if(value.content_type!==undefined){
      if(!['person_name','word','colour'].includes(value.content_type))
        forbid('unexpected content_type');
      output.content_type=value.content_type;
    }
    return output;
  };
  const safePron=value=>{
    if(value==null)return null;
    if(!value||typeof value!=='object'||Array.isArray(value))
      forbid('invalid pronunciation');
    const output={};
    for(const k of ['pinyin','roman','kana','hiragana','katakana']){
      if(value[k]!==undefined){
        if(typeof value[k]!=='string'||value[k].length>500)forbid('invalid pronunciation field');
        output[k]=value[k];
      }
    }
    return output;
  };
  const safePictureName=value=>{
    if(value==null||value==='')return null;
    if(typeof value!=='string'||value.length>180)forbid('unsafe picture filename');
    if(value.startsWith('emoji:')){
      const emoji=value.slice(6);
      if(!emoji || !/^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f ]{1,30}$/u.test(emoji))
        forbid('invalid local emoji picture');
      return value;
    }
    // Do NOT persist public paths/URLs in a restricted offline candidate.
    // U3D2B must store separately verified source-bound private media bytes.
    return null;
  };
  const safeColourPicture=value=>{
    if(value==null||value==='')return null;
    if(typeof value!=='string'||value.length>200)forbid('unsafe colour picture');
    if(value.startsWith('https:')||value.startsWith('http:')||value.startsWith('/')||
       value.includes('url(')||value.includes('data:')||value.includes('blob:'))
      forbid('remote or embedded colour picture');
    if(value.startsWith('emoji:')){
      const emoji=value.slice(6);
      if(!emoji || !/^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f ]{1,30}$/u.test(emoji))
        forbid('invalid local colour emoji');
      return value;
    }
    if(/^#[0-9a-f]{6}$/i.test(value))return value;
    if(/^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f ]{1,30}$/u.test(value))
      return value;
    forbid('unsupported colour picture format');
  };
  const media=(type,id,topicId,language,additional={})=>{
    if(type!=='topic_audio'&&!refId(id))forbid('media lacks real source ID');
    return {type,id:type==='topic_audio'?null:id,topicId:topicId||null,language,...additional};
  };

  function buildScopedPack({data,language,ownerId,policyRecord,sentenceResponse,
    privateVisibility,checkedAt=Date.now()}){
    if(!refId(ownerId)||typeof language!=='string'||!LANG.test(language))
      forbid('invalid learner or language');
    const access=root.KGOfflineAccess;
    if(!access||access.fromCache(policyRecord,ownerId,checkedAt)?.state!=='restricted_pending')
      forbid('verified, fresh restricted owner policy required');
    const policy=root.KGLearnerAccess?.parseSnapshot(policyRecord?.snapshot);
    if(policy?.state!=='restricted'||!policy.languages.includes(language))
      forbid('language is not granted');
    const allowTopics=new Set(policy.topics.filter(k=>k.startsWith(language+'|'))
      .map(k=>k.slice(language.length+1)));
    if(!allowTopics.size)forbid('no granted topics for requested language');
    const deniedTopics=saneStrings(privateVisibility?.topics,'private topic visibility');
    const deniedGroups=saneStrings(privateVisibility?.groups,'private group visibility');
    if(privateVisibility?.contract!==1)forbid('unverified private lesson visibility');

    const languages=list(data,TABLES.languages);
    const chosenLanguages=languages.filter(x=>x.code===language&&x.is_active!==false);
    if(chosenLanguages.length!==1)forbid('missing/duplicate active language');
    const languageRows=chosenLanguages.map(x=>select(x,FIELDS[TABLES.languages]));

    const topicTranslations=list(data,TABLES.topicTranslations);
    unique(topicTranslations,x=>x.topic_id+'|'+x.language_code,'topic translation');
    const translatedTopics=new Set(topicTranslations.filter(x=>x.language_code===language)
      .map(x=>x.topic_id));
    const topics=unique(list(data,TABLES.topics),x=>x.id,'topic')
      .filter(x=>allowTopics.has(x.id)&&translatedTopics.has(x.id)&&
        !deniedTopics.has(x.id));
    if(!topics.length)forbid('no translated, non-private granted topics');
    const topicIds=new Set(topics.map(x=>x.id));
    const topicRows=topics.map(x=>select(x,FIELDS[TABLES.topics]));
    const topicTranslationRows=topicTranslations.filter(x=>x.language_code===language&&
      topicIds.has(x.topic_id)).map(x=>select(x,FIELDS[TABLES.topicTranslations]));

    const wordTranslations=list(data,TABLES.vocabularyTranslations);
    unique(wordTranslations,x=>x.vocabulary_id+'|'+x.language_code,'word translation');
    const translatedWords=new Set(wordTranslations.filter(x=>x.language_code===language)
      .map(x=>x.vocabulary_id));
    const words=unique(list(data,TABLES.vocabulary),x=>x.id,'vocabulary')
      .filter(x=>topicIds.has(x.topic_id)&&translatedWords.has(x.id));
    if(words.some(w=>!refId(w.id)||!validTopic(w.topic_id)))
      forbid('invalid vocabulary source IDs');
    const wordIds=new Set(words.map(x=>x.id));
    const wordRows=words.map(w=>{
      const row=select(w,FIELDS[TABLES.vocabulary]);
      row.image_filename=safePictureName(w.image_filename);
      row.extra_data=safeExtra(w.extra_data);
      return row;
    });
    const translationRows=wordTranslations.filter(x=>x.language_code===language&&
      wordIds.has(x.vocabulary_id)).map(t=>{
        const row=select(t,FIELDS[TABLES.vocabularyTranslations]);
        row.pronunciation=safePron(t.pronunciation);
        return row;
      });

    const permitSentences=policy.features.includes('quiz.sentences')||
      policy.features.includes('quiz.speak');
    let groupScope=null;
    if(permitSentences){
      groupScope=root.KGSentenceAccess?.parseGroupSnapshot(sentenceResponse,policy,language);
      if(groupScope?.state!=='restricted'||groupScope.serverEnforced!==true)
        forbid('verified sentence group-topic mapping required');
    }
    const verifiedGroups=permitSentences?new Set(groupScope.groups):new Set();
    const sentenceRows=unique(list(data,TABLES.sentences),x=>x.id,'sentence')
      .filter(x=>x.language_code===language&&verifiedGroups.has(x.group_name)&&
        !deniedGroups.has(x.group_name)&&
        topicIds.has(groupScope.groupTopics[x.group_name]))
      .map(x=>{
        if(!refId(x.id))forbid('invalid sentence source ID');
        const row=select(x,FIELDS[TABLES.sentences]);
        // Freeform extra_data can embed entire unrelated source content.
        delete row.extra_data;
        return row;
      });

    const permitColours=policy.features.includes('quiz.colours');
    const colourRows=unique(list(data,TABLES.colours),x=>x.id,'colour phrase')
      .filter(x=>permitColours&&x.language_code===language&&
        wordIds.has(x.colour_id)&&wordIds.has(x.noun_id))
      .map(x=>{
        if(!refId(x.id))forbid('invalid colour source ID');
        const row=select(x,FIELDS[TABLES.colours]);
        row.picture=safeColourPicture(x.picture);
        return row;
      });

    // Only identities, source types and voice-specific intent are staged.
    // No public text hashes, audio manifests, signed URLs or media bytes.
    const planned=[];
    for(const w of words){
      if(w.image_filename&&!w.image_filename.startsWith('emoji:')&&!w.extra_data?.colorCode)
        planned.push(media('word_image',w.id,w.topic_id,language));
      if(translationRows.find(t=>t.vocabulary_id===w.id)?.native_text)
        for(const voice of ['m','f'])
          planned.push(media('word_audio',w.id,w.topic_id,language,{voice}));
    }
    for(const topic of topics){
      const translated=topicTranslationRows.find(t=>t.topic_id===topic.id);
      if(translated?.question_native)
        for(const voice of ['m','f'])planned.push(media('topic_audio',null,topic.id,language,{voice}));
    }
    for(const sentence of sentenceRows)
      for(const voice of ['m','f'])
        planned.push(media('sentence_audio',sentence.id,groupScope.groupTopics[sentence.group_name],
          language,{groupName:sentence.group_name,voice}));
    for(const c of colourRows)
      for(const voice of ['m','f'])planned.push(media('colour_audio',c.id,null,language,{voice}));

    const result={
      [TABLES.languages]:languageRows,
      [TABLES.topics]:topicRows,
      [TABLES.topicTranslations]:topicTranslationRows,
      [TABLES.vocabulary]:wordRows,
      [TABLES.vocabularyTranslations]:translationRows,
      [TABLES.sentences]:sentenceRows,
      [TABLES.colours]:colourRows,
      [TABLES.settings]:[
        // All inaccessible topic/group names are already omitted.
        {key:'kg_private_visibility:'+language,value:{contract:1,topics:[],groups:[]}},
      ],
    };
    return {
      content:result,
      mediaPlan:planned,
      // Preview data are never promoted to a pack or sent to a shared cache.
      manifest:{contract:1,edition:'restricted-candidate',
        ownerId,language,policyRevision:policy.revision,
        policyCheckedAt:policyRecord.checkedAt,mediaVerified:false,
        counts:{topics:topicRows.length,words:wordRows.length,
          sentences:sentenceRows.length,colours:colourRows.length,
          requestedMediaSources:planned.length}},
    };
  }

  root.KGScopedPack={buildScopedPack,TABLES};
})(typeof window!=='undefined'?window:globalThis);
