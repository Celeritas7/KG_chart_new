// U3C2B2 — transient image bytes for authorized, verified word sources.
// The signer returns a 30s URL. Fetch its bytes immediately and display a
// revocable in-memory blob URL; never store signed tokens or pictures in
// CacheStorage, IndexedDB, localStorage, history or the HTML DOM.
import {acquireProtectedMedia} from './kg-protected-player.mjs';

const TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif']);
export const MAX_IMAGE_BYTES=8*1024*1024;
export async function loadProtectedWordPicture({
  resource,policy,sentenceScope,supabase,projectUrl,
  signal,fetcher=globalThis.fetch,urlFactory=globalThis.URL,
  resolve,
}){
  if(signal?.aborted||resource?.type!=='word_image')return null;
  // A restricted offline picture must be served only as a freshly checked
  // owner-bound blob lease. Missing/denied bytes NEVER trigger the signer or
  // any public vocabulary-assets fetch, even when the worker is offline.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const reader=globalThis.KGOffline?.readPrivateMedia;
    if (typeof reader!=='function') return null;
    const lease=await reader(resource);
    if (signal?.aborted) { lease?.release?.();return null; }
    if(!lease||typeof lease.url!=='string'||!lease.url.startsWith('blob:')||
       !['image/jpeg','image/png','image/webp','image/gif'].includes(lease.contentType)){
      lease?.release?.();return null;
    }
    return lease;
  }
  // Tests can inject a fake signer; no user email/path/text hash is accepted.
  const signed=await acquireProtectedMedia({
    kind:'image',resource,policy,sentenceScope,supabase,projectUrl,
    ...(resolve?{resolve}:{}),
  });
  if(!signed||signal?.aborted)return null;
  let response;
  try{
    response=await fetcher(signed,{
      mode:'cors',cache:'no-store',redirect:'error',
      referrerPolicy:'no-referrer',signal,
    });
  }catch(error){
    if(signal?.aborted)return null;
    throw error;
  }
  if(signal?.aborted||!response?.ok)return null;
  const mime=String(response.headers?.get('Content-Type')||'')
    .split(';')[0].trim().toLowerCase();
  const bytesHeader=response.headers?.get('Content-Length');
  const estimated=bytesHeader==null?null:Number(bytesHeader);
  if(!TYPES.has(mime)||(estimated!=null&&
      (!Number.isSafeInteger(estimated)||estimated<1||estimated>MAX_IMAGE_BYTES)))
    return null;
  const blob=await response.blob();
  if(signal?.aborted||!blob||blob.size<1||blob.size>MAX_IMAGE_BYTES)
    return null;
  const blobMime=String(blob.type||'').split(';')[0].trim().toLowerCase();
  if(blobMime!==mime)return null;
  if(!urlFactory||typeof urlFactory.createObjectURL!=='function'||
     typeof urlFactory.revokeObjectURL!=='function')return null;
  const url=urlFactory.createObjectURL(blob);
  let released=false;
  return {url,release(){
    if(released)return;
    released=true;urlFactory.revokeObjectURL(url);
  }};
}
