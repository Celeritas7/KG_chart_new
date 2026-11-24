/* KG Chart U3C1 — pure, caller-verified learner UI access contract.
 * This is UI filtering, NOT a substitute for database RLS or private media.
 * An unknown/error/pending-enforcement restricted policy never falls back to
 * legacy and never exposes a formerly saved language, topic or quiz choice.
 */
(function(root){
  'use strict';
  const VIEWS=['chart','quiz','flashcard','progress'];
  const QUIZ_MODES=['words','sentences','typing','speak','say','colours'];
  const FEATURE={
    chart:'chart',flashcard:'cards',progress:'progress',
    words:'quiz.words',sentences:'quiz.sentences',typing:'quiz.typing',
    speak:'quiz.speak',say:'quiz.say',colours:'quiz.colours',
  };
  const key=(lang,topic)=>String(lang)+'|'+String(topic);
  const unique=(arr)=>new Set(arr);
  const blank=(reason)=>({state:'blocked',reason,revision:0,languages:[],topics:[],features:[]});
  const validArray=(xs,pred,max)=>Array.isArray(xs)&&xs.length<=max&&xs.every(pred);
  const isLang=(x)=>typeof x==='string'&&/^[a-z]{2,3}$/.test(x);
  const isFeature=(x)=>typeof x==='string'&&/^[a-z][a-z0-9.]*$/.test(x);
  const isTopic=(x)=>!!x&&typeof x==='object'&&isLang(x.language_code)&&
    typeof x.topic_id==='string'&&x.topic_id.length>0&&x.topic_id.length<=150;

  function parseSnapshot(data) {
    if(!data||data.contract!==1||!Number.isSafeInteger(data.revision)||
       data.revision<0||typeof data.server_enforced!=='boolean'||
       !['legacy','restricted'].includes(data.mode))
      return blank('invalid');
    if(data.mode==='legacy'){
      if(data.languages!==null||data.topics!==null||data.features!==null)
        return blank('invalid_legacy');
      return {state:'legacy',reason:null,revision:data.revision,
        languages:[],topics:[],features:[]};
    }
    if(!validArray(data.languages,isLang,100)||
       !validArray(data.topics,isTopic,2000)||
       !validArray(data.features,isFeature,100))
      return blank('invalid_restricted');
    if(!data.server_enforced)return blank('not_enforced');
    const langs=unique(data.languages),allowedFeatures=unique(data.features);
    const topics=data.topics.filter(t=>langs.has(t.language_code));
    if(topics.length!==data.topics.length)return blank('invalid_scopes');
    return {state:'restricted',reason:null,revision:data.revision,
      languages:[...langs],topics:[...unique(topics.map(t=>key(t.language_code,t.topic_id)))],
      features:[...allowedFeatures]};
  }
  const ready=policy=>policy?.state==='legacy'||policy?.state==='restricted';
  const isLegacy=policy=>policy?.state==='legacy';
  const canLanguage=(policy,lang)=>!!ready(policy)&&(
    isLegacy(policy)||policy.languages.includes(lang));
  const canTopic=(policy,lang,topic)=>!!ready(policy)&&(
    isLegacy(policy)||policy.topics.includes(key(lang,topic)));
  const canFeature=(policy,feature)=>!!ready(policy)&&(
    isLegacy(policy)||policy.features.includes(feature));
  const viewFeature=(v)=>FEATURE[v]||null;
  const canView=(policy,view)=>VIEWS.includes(view)&&(
    view==='quiz'?QUIZ_MODES.some(mode=>canFeature(policy,FEATURE[mode])):
      canFeature(policy,FEATURE[view]));
  const visibleViews=(policy)=>VIEWS.filter(v=>canView(policy,v));
  const visibleQuizModes=(policy)=>QUIZ_MODES.filter(m=>canFeature(policy,FEATURE[m]));
  function visibleLanguages(policy,languages){
    return ready(policy)?(languages||[]).filter(l=>l?.is_active!==false&&canLanguage(policy,l.code)):[];
  }
  function visibleTopics(policy,lang,topics){
    return canLanguage(policy,lang)?(topics||[]).filter(t=>canTopic(policy,lang,t.id)):[];
  }
  function visibleVocabulary(policy,lang,words,topics){
    const permitted=unique(visibleTopics(policy,lang,topics).map(t=>t.id));
    return canLanguage(policy,lang)?(words||[]).filter(v=>permitted.has(v.topic_id)):[];
  }
  function chooseLanguage(policy,saved,languages){
    const codes=visibleLanguages(policy,languages).map(l=>l.code);
    return codes.includes(saved)?saved:(codes[0]||null);
  }
  function chooseView(policy,saved){
    const candidates=visibleViews(policy);
    return candidates.includes(saved)?saved:(candidates[0]||null);
  }
  function chooseQuizMode(policy,saved){
    const candidates=visibleQuizModes(policy);
    return candidates.includes(saved)?saved:(candidates[0]||null);
  }
  root.KGLearnerAccess={
    parseSnapshot,ready,canLanguage,canTopic,canFeature,canView,
    visibleLanguages,visibleTopics,visibleVocabulary,visibleViews,
    visibleQuizModes,chooseLanguage,chooseView,chooseQuizMode,
  };
})(typeof window!=='undefined'?window:globalThis);
