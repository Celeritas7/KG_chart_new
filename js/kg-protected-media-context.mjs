// U3C2 media-source adapter for the later protected player integration.
// This does not change current public playback or downloaded offline media.
// It intentionally accepts a real KG Chart SOURCE ID, not an audio-text hash.
// It never constructs private bucket paths or falls back to public media.
// Server-side U3B3B2 registry/RPC still makes the final authorization decision.
import {resolveProtectedMedia} from './kg-private-media-client.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const TYPES=new Set([
  'word_audio','word_image','topic_audio','sentence_audio','colour_audio',
]);
export function sourceRequest(resource,policy,sentenceScope){
  if(!resource||!TYPES.has(resource.type)||typeof resource.language!=='string'||
     !/^[a-z]{2,3}$/.test(resource.language)||
     !['legacy','restricted'].includes(policy?.state))
    return null;
  if(policy.state==='restricted' &&
    !policy.languages.includes(resource.language))return null;

  const isWord=resource.type==='word_audio'||resource.type==='word_image';
  const isSentence=resource.type==='sentence_audio';
  const isTopic=resource.type==='topic_audio';
  const isColour=resource.type==='colour_audio';
  if(!isTopic&&(!UUID.test(String(resource.id||''))))return null;
  if(isTopic&&(typeof resource.topicId!=='string'||!resource.topicId))return null;
  if(isWord&&(typeof resource.topicId!=='string'||!resource.topicId))return null;
  if(isSentence&&(typeof resource.groupName!=='string'||!resource.groupName))
    return null;

  // Client filtering is a UX guard, never a security boundary: the actual
  // asset registry and live source membership are checked by PostgreSQL.
  if(policy.state==='restricted'){
    if((isWord||isTopic)&&
       !policy.topics.includes(resource.language+'|'+resource.topicId))
      return null;
    if(isSentence&&(!sentenceScope||sentenceScope.state!=='restricted'||
      sentenceScope.serverEnforced!==true||
      !sentenceScope.groups.includes(resource.groupName)))
      return null;
    if(isColour&&!policy.features.includes('quiz.colours'))
      return null;
  }
  const voice=resource.type==='word_image'?null:resource.voice;
  if(voice!==null&&voice!=='m'&&voice!=='f')return null;
  return {
    sourceType:resource.type,
    sourceId:isTopic?null:resource.id,
    topicId:isTopic?resource.topicId:null,
    language:resource.language,
    voice,
  };
}

export async function resolveContextMedia({
  resource,policy,sentenceScope,supabase,projectUrl,
}){
  const request=sourceRequest(resource,policy,sentenceScope);
  if(!request)return null;
  // A denied lookup, a missing staged private file or a network error is
  // NOT permission to use the old public media URL.
  return resolveProtectedMedia({...request,supabase,projectUrl});
}
