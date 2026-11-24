/* KG Chart U2: pure draft validation and proposed restricted-visibility preview.
 * No browser storage, database, network or auth. Can be tested in Node VM.
 */
(function(root){
  'use strict';
  const unique = xs => [...new Set(xs || [])];
  const topicKey = (language,topic) => language + '|' + topic;
  const keyParts = value => {
    const index = String(value).indexOf('|');
    return index < 0 ? null : {language_code:String(value).slice(0,index), topic_id:String(value).slice(index+1)};
  };
  const clean = value => typeof value === 'string' ? value.trim() : '';

  function createDraft(raw){
    const languages=unique((raw?.languages||[]).map(clean).filter(Boolean));
    const features=unique((raw?.features||[]).map(clean).filter(Boolean));
    const keys=unique((raw?.topics||[]).map(v=>
      typeof v==='string' ? v : topicKey(v.language_code,v.topic_id)));
    const topics=keys.map(keyParts).filter(Boolean);
    return {languages,topics,features};
  }

  function validateDraft(draft,catalog){
    const languages=new Set(draft.languages), features=new Set(draft.features);
    const availableLang=new Set((catalog.languages||[]).filter(x=>x.is_active===true).map(x=>x.code));
    const availableFeatures=new Set((catalog.features||[]).filter(x=>x.is_active).map(x=>x.feature_key));
    const availableTopics=new Set((catalog.topicTranslations||[]).map(x=>topicKey(x.language_code,x.topic_id)));
    for(const lang of languages) if(!availableLang.has(lang))return 'An inactive or unknown language is selected.';
    for(const f of features)if(!availableFeatures.has(f))return 'An unavailable learning feature is selected.';
    for(const pair of draft.topics){
      if(!languages.has(pair.language_code))return 'A topic is selected outside its permitted language.';
      if(!availableTopics.has(topicKey(pair.language_code,pair.topic_id)))return 'Selected topic has no translation in this language.';
    }
    if(new Set(draft.topics.map(x=>topicKey(x.language_code,x.topic_id))).size!==draft.topics.length)
      return 'Duplicate topic selected.';
    return null;
  }

  // A preview is NEVER an authorization result: it predicts only the topic/UI
  // intersection, not the eventual U3 database/Edge Function enforcement.
  function previewDraft(draft, catalog, userEmail, privateLessons){
    const langs=(catalog.languages||[]).filter(x=>x.is_active===true && draft.languages.includes(x.code));
    const langSet=new Set(langs.map(x=>x.code));
    const topics=(catalog.topicTranslations||[]).filter(t=>{
      if(!langSet.has(t.language_code))return false;
      if(!draft.topics.some(x=>x.language_code===t.language_code && x.topic_id===t.topic_id))return false;
      const topic=(catalog.topics||[]).find(x=>x.id===t.topic_id);
      if(topic?.is_hidden===true)return false;
      return !(privateLessons||[]).some(rule=>
        rule.topic_id===t.topic_id &&
        (!rule.language_code||rule.language_code===t.language_code) &&
        !(rule.emails||[]).some(e=>String(e).toLowerCase()===String(userEmail).toLowerCase()));
    });
    return {languages:langs, topics,features:(catalog.features||[]).filter(f=>f.is_active===true && draft.features.includes(f.feature_key))};
  }

  function payload(email,revision,draft){
    return {
      p_email:String(email).toLowerCase().trim(),
      p_expected_revision:revision,
      p_languages:[...draft.languages].sort(),
      p_topics:[...draft.topics].sort((a,b)=>topicKey(a.language_code,a.topic_id).localeCompare(topicKey(b.language_code,b.topic_id))),
      p_features:[...draft.features].sort()
    };
  }
  root.KGAccessCore={createDraft,validateDraft,previewDraft,payload,topicKey,keyParts};
})(typeof window!=='undefined'?window:globalThis);
