// U3C2B1 — opt-in, source-bound protected media acquisition.
// Never substitute a public Storage URL when a media request is denied,
// incomplete, expired or cannot be authorized. Production gate stays OFF.
// This module does not cache signed links or put them in persistent storage.
import {sourceRequest, resolveContextMedia} from './kg-protected-media-context.mjs';

const AUDIO=new Set(['word_audio','topic_audio','sentence_audio','colour_audio']);
const EXT={
  'audio/mpeg':'.mp3','image/jpeg':'.jpg',
  'image/png':'.png','image/webp':'.webp','image/gif':'.gif',
};
const UUID='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const PRIVATE_PATH=new RegExp('^/storage/v1/object/sign/kg-chart-private-media/protected/('+UUID+')(\\.[a-z0-9]+)$','i');

export function mediaSourceKey(resource){
  if(!resource||typeof resource!=='object')return null;
  return JSON.stringify([
    resource.type,resource.language,resource.id||null,
    resource.topicId||null,resource.groupName||null,resource.voice||null,
  ]);
}

export async function acquireProtectedMedia({
  kind,resource,policy,sentenceScope,supabase,projectUrl,
  resolve=resolveContextMedia,
}){
  // Client source validation is a UX gate; SQL/Edge must reauthorize the
  // actual referenced word, topic, sentence or colour phrase on EVERY call.
  if(!['audio','image'].includes(kind)||
     (kind==='audio'&&!AUDIO.has(resource?.type))||
     (kind==='image'&&resource?.type!=='word_image')||
     (kind==='audio'&&!['m','f'].includes(resource?.voice))||
     (kind==='image'&&resource?.voice!=null)||
     !sourceRequest(resource,policy,sentenceScope)||
     !supabase||typeof projectUrl!=='string')return null;

  const signed=await resolve({resource,policy,sentenceScope,supabase,projectUrl});
  if(!signed||!EXT[signed.contentType]||
     (kind==='audio'&&signed.contentType!=='audio/mpeg')||
     (kind==='image'&&!signed.contentType.startsWith('image/'))||
     !Number.isInteger(signed.expiresIn)||signed.expiresIn<1||
     signed.expiresIn>30)return null;

  // Independent defense against accidental untrusted redirects or URLs in
  // a future resolver; the existing signer validates the exact asset ID.
  let base,url;
  try{base=new URL(projectUrl);url=new URL(signed.url);}catch(_){return null;}
  const match=PRIVATE_PATH.exec(url.pathname);
  if(base.protocol!=='https:'||url.protocol!=='https:'||
     base.origin!==url.origin||!match||
     match[2].toLowerCase()!==EXT[signed.contentType]||
     !url.searchParams.has('token'))return null;
  return url.href;
}
