// U3D2B1: owner-specific, source-bound PRIVATE media staging only.
// A verified stage is NOT an installed pack or permission to read it offline.
// Activation, SW routes and revoked-policy outbox handling belong to B2/U3D3.
// Signed URL tokens must never be written into CacheStorage or IDB.
import {acquireProtectedMedia,mediaSourceKey} from './kg-protected-player.mjs';
import {sourceRequest} from './kg-protected-media-context.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const LANG=/^[a-z]{2,3}$/;
const CACHE_PREFIX='kg-private-stage-v1-';
const CACHE_PATH='/__kg_private_media_v1__/';
const MAX_IMAGE=8*1024*1024;
const MAX_AUDIO=16*1024*1024;
const MAX_TOTAL=256*1024*1024;
const MAX_ITEMS=3000;
const MIME_EXT=new Map([
  ['audio/mpeg','.mp3'],['image/jpeg','.jpg'],['image/png','.png'],
  ['image/webp','.webp'],['image/gif','.gif'],
]);

const failure=reason=>{throw Error('KG private media stage denied: '+reason);};
const validRevision=revision=>Number.isSafeInteger(revision)&&revision>=0;
const str=x=>typeof x==='string'&&x.length>0;
function originOf(appOrigin){
  try{
    const url=new URL(appOrigin);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
       url.pathname!=='/'||!url.hostname||url.port)failure('untrusted app origin');
    return url.origin;
  }catch(_){failure('invalid app origin');}
}
function stageName(ownerId,language,revision,nonce){
  if(!UUID.test(String(ownerId))||!LANG.test(String(language))||
     !validRevision(revision)||!UUID.test(String(nonce)))
    failure('invalid account/language/revision/stage nonce');
  return CACHE_PREFIX+ownerId+'-'+language+'-'+revision+'-'+nonce;
}
function manifestUrl(appOrigin,ownerId,language,revision){
  return originOf(appOrigin)+CACHE_PATH+ownerId+'/'+language+'/'+revision+'/manifest.json';
}
async function sha256(bytes,cryptoApi){
  if(!cryptoApi?.subtle?.digest)failure('secure hash unavailable');
  const hash=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes));
  return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
}
function asBytes(bytes){
  if(!bytes||typeof bytes.byteLength!=='number')failure('missing asset bytes');
  return new Uint8Array(bytes);
}
function mimeOf(headers){
  return String(headers?.get?.('Content-Type')||'').split(';')[0].trim().toLowerCase();
}
function magicOK(type,b){
  if(type==='image/png')return b.length>=8&&
    [137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n);
  if(type==='image/jpeg')return b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255;
  if(type==='image/gif')return b.length>=6&&
    String.fromCharCode(...b.slice(0,6)).match(/^GIF8[79]a$/)!=null;
  if(type==='image/webp')return b.length>=12&&
    String.fromCharCode(...b.slice(0,4))==='RIFF'&&
    String.fromCharCode(...b.slice(8,12))==='WEBP';
  if(type==='audio/mpeg')return b.length>=64&&(
    (b[0]===73&&b[1]===68&&b[2]===51)||
    (b[0]===255&&(b[1]&224)===224));
  return false;
}
function policyContext({ownerId,language,policyRecord,offlineAccess,learnerAccess,now}){
  if(!UUID.test(String(ownerId))||!LANG.test(String(language))||!policyRecord||
     offlineAccess?.fromCache(policyRecord,ownerId,now)?.state!=='restricted_pending')
    failure('missing fresh verified restricted account policy');
  const policy=learnerAccess?.parseSnapshot(policyRecord.snapshot);
  if(policy?.state!=='restricted'||!validRevision(policy.revision)||
     !policy.languages.includes(language)||
     policy.revision!==policyRecord.snapshot.revision)
    failure('language or policy is not authorized');
  return policy;
}
function checkedPlan(mediaPlan,language,policy,sentenceScope){
  if(!Array.isArray(mediaPlan)||mediaPlan.length<1||mediaPlan.length>MAX_ITEMS)
    failure('invalid or empty planned media set');
  const ids=new Set(),entries=[];
  for(const source of mediaPlan){
    if(!source||typeof source!=='object'||Array.isArray(source)||
       !['word_image','word_audio','topic_audio','sentence_audio','colour_audio'].includes(source.type)||
       source.language!==language||
       (source.type==='topic_audio'
         ? source.id!=null||!str(source.topicId)||source.topicId.length>150
         : !UUID.test(String(source.id||'')))||
       ((source.type==='word_audio'||source.type==='word_image')&&
         (!str(source.topicId)||source.topicId.length>150))||
       (source.type==='sentence_audio'&&
         (!str(source.groupName)||source.groupName.length>250))||
       (source.type==='word_image' ? source.voice!=null : !['m','f'].includes(source.voice))||
       !sourceRequest(source,policy,sentenceScope))
      failure('unverified or malformed source in media plan');
    const key=mediaSourceKey(source);
    if(!key||ids.has(key))failure('duplicate source or voice in media plan');
    ids.add(key);
    entries.push({source:{...source},sourceKey:key,
      kind:source.type==='word_image'?'image':'audio'});
  }
  return entries;
}
function cacheKey(appOrigin,ownerId,language,revision,hash){
  if(!/^[a-f0-9]{64}$/.test(hash))failure('invalid source hash');
  return originOf(appOrigin)+CACHE_PATH+ownerId+'/'+language+'/'+revision+'/'+hash+'.bin';
}
function expectedType(signed){
  let ext,path='';
  try{
    path=new URL(signed).pathname;
    ext=path.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
  }catch(_){failure('signed media location is not a valid URL');}
  for(const [type,suffix] of MIME_EXT)if(ext===suffix)return type;
  failure('unexpected private asset extension ('+String(ext)+', path ending '+path.slice(-8)+')');
}
function safeDescriptor(descriptor,{ownerId,language,policyRecord,appOrigin}){
  if(!descriptor||descriptor.contract!==1||
     descriptor.kind!=='kg-protected-staged-media'||
     descriptor.ownerId!==ownerId||descriptor.language!==language||
     descriptor.revision!==policyRecord.snapshot.revision||
     !/^kg-private-stage-v1-[a-f0-9-]+$/.test(descriptor.cacheName)||
     !descriptor.cacheName.startsWith(CACHE_PREFIX+ownerId+'-'+language+'-'+descriptor.revision+'-')||
     descriptor.manifestUrl!==manifestUrl(appOrigin,ownerId,language,descriptor.revision)||
     !/^[0-9a-f]{64}$/.test(descriptor.manifestSha256||''))
    failure('staged media manifest is not bound to this account');
  return descriptor;
}
function requireDependencies(cacheStorage,fetcher,cryptoApi){
  if(!cacheStorage||typeof cacheStorage.open!=='function'||
     typeof cacheStorage.delete!=='function'||
     typeof cacheStorage.keys!=='function'||typeof fetcher!=='function'||
     !cryptoApi?.subtle?.digest||typeof cryptoApi.randomUUID!=='function')
    failure('secure storage/transport is not supported');
}
async function readBounded(response,limit){
  // Never buffer an untrusted unbounded response at once.
  const reader=response.body?.getReader?.();
  if(!reader)failure('private media stream unavailable');
  const pieces=[];
  let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))failure('invalid media stream chunk');
      total+=value.byteLength;
      if(total>limit)failure('private media exceeds stream byte limit');
      pieces.push(value);
    }
  }finally{try{reader.releaseLock();}catch(_){}}
  const all=new Uint8Array(total);
  let i=0;for(const piece of pieces){all.set(piece,i);i+=piece.byteLength;}
  return all;
}
async function decodeWithBrowser({bytes,mime}){
  if(typeof createImageBitmap!=='function')
    failure('private image decoding is unsupported on this device');
  let bitmap;
  try{bitmap=await createImageBitmap(new Blob([bytes],{type:mime}));}
  catch(_){failure('private image could not be decoded');}
  try{
    if(!Number.isFinite(bitmap.width)||!Number.isFinite(bitmap.height)||
       bitmap.width<1||bitmap.height<1)
      failure('private image has invalid dimensions');
  }finally{bitmap.close?.();}
}
async function validateDownloaded({signed,response,kind,cryptoApi,decodeImage}){
  if(!response?.ok||response.type==='opaque'||response.redirected)
    failure('private media not available; redirects are not allowed');
  const expected=expectedType(signed),mime=mimeOf(response.headers);
  if(expected!==mime||
     (kind==='audio'&&mime!=='audio/mpeg')||
     (kind==='image'&&!mime.startsWith('image/')))
    failure('response MIME does not match signed source');
  const limit=kind==='audio'?MAX_AUDIO:MAX_IMAGE;
  const rawLength=response.headers?.get?.('Content-Length');
  if(rawLength!=null&&(!/^\d+$/.test(rawLength)||Number(rawLength)<1||
      Number(rawLength)>limit))
    failure('private media content length invalid');
  const bytes=asBytes(await readBounded(response,limit));
  if(bytes.byteLength<1||bytes.byteLength>limit||
     (rawLength!=null&&Number(rawLength)!==bytes.byteLength))
    failure('private media bytes exceed limit or mismatch length');
  if(!magicOK(mime,bytes))failure('private media header is corrupt or disguised');
  if(kind==='image')await (decodeImage||decodeWithBrowser)({bytes,mime});
  return {bytes,mime,digest:await sha256(bytes,cryptoApi)};
}
function current(assertCurrent,signal){
  if(signal?.aborted)failure('stage cancelled');
  if(typeof assertCurrent==='function')assertCurrent();
}

export async function stagePrivateMedia({
  ownerId,language,policyRecord,mediaPlan,sentenceScope=null,
  offlineAccess=globalThis.KGOfflineAccess,
  learnerAccess=globalThis.KGLearnerAccess,
  cacheStorage=globalThis.caches,fetcher=globalThis.fetch,
  cryptoApi=globalThis.crypto,projectUrl,appOrigin,
  supabase,signal,assertCurrent,clock=Date.now,
  resolve, // only for isolated tests, never a public-URL fallback
  decodeImage, // optional isolated test decoder; production decodes real bytes
}){
  requireDependencies(cacheStorage,fetcher,cryptoApi);
  const origin=originOf(appOrigin);
  const now=clock();
  const policy=policyContext({ownerId,language,policyRecord,offlineAccess,learnerAccess,now});
  const entries=checkedPlan(mediaPlan,language,policy,sentenceScope);
  if(!supabase||!str(projectUrl))failure('signed private-media client not configured');
  const name=stageName(ownerId,language,policy.revision,cryptoApi.randomUUID());
  const existing=await cacheStorage.keys();
  if(existing.includes(name))failure('stage nonce collision');
  const cache=await cacheStorage.open(name);
  const manifestKey=manifestUrl(origin,ownerId,language,policy.revision);
  let committed=false,bytesTotal=0;
  try{
    const media=[];
    for(const item of entries){
      current(assertCurrent,signal);
      const signed=await acquireProtectedMedia({
        kind:item.kind,resource:item.source,policy,sentenceScope,
        supabase,projectUrl,...(resolve?{resolve}:{})
      });
      if(!signed)failure('source rejected or private asset is missing');
      current(assertCurrent,signal);
      let response;
      try{
        response=await fetcher(signed,{
          method:'GET',mode:'cors',cache:'no-store',redirect:'error',
          credentials:'omit',referrerPolicy:'no-referrer',signal,
        });
      }catch(_){failure('private media download unavailable');}
      current(assertCurrent,signal);
      const verified=await validateDownloaded({
        signed,response,kind:item.kind,cryptoApi,decodeImage,
      });
      current(assertCurrent,signal);
      bytesTotal+=verified.bytes.byteLength;
      if(bytesTotal>MAX_TOTAL)failure('private pack exceeds total media limit');
      const hash=await sha256(new TextEncoder().encode(item.sourceKey),cryptoApi);
      const key=cacheKey(origin,ownerId,language,policy.revision,hash);
      await cache.put(key,new Response(verified.bytes,{
        status:200,headers:{
          'Content-Type':verified.mime,
          'X-KG-Private-SHA256':verified.digest,
          'X-KG-Private-Bytes':String(verified.bytes.byteLength),
          'X-KG-Private-Source':hash,
          'Cache-Control':'private, no-store',
        },
      }));
      current(assertCurrent,signal);
      media.push({
        sourceKey:item.sourceKey,cacheKey:key,sha256:verified.digest,
        bytes:verified.bytes.byteLength,contentType:verified.mime,
      });
    }
    // Recheck owner and policy age BEFORE creating the manifest; never
    // publish a stage created during sign-out or a policy refresh failure.
    current(assertCurrent,signal);
    policyContext({ownerId,language,policyRecord,offlineAccess,learnerAccess,now:clock()});
    const manifest={contract:1,kind:'kg-protected-staged-media',
      ownerId,language,revision:policy.revision,
      policyCheckedAt:policyRecord.checkedAt,
      media,bytesTotal};
    const encoded=JSON.stringify(manifest);
    const digest=await sha256(new TextEncoder().encode(encoded),cryptoApi);
    await cache.put(manifestKey,new Response(encoded,{
      status:200,headers:{
        'Content-Type':'application/json',
        'X-KG-Private-SHA256':digest,
        'Cache-Control':'private, no-store',
      },
    }));
    current(assertCurrent,signal);
    committed=true;
    return {contract:1,kind:'kg-protected-staged-media',
      ownerId,language,revision:policy.revision,
      cacheName:name,manifestUrl:manifestKey,manifestSha256:digest,
      assetCount:media.length,bytesTotal,readyToInstall:false};
  } finally{
    // Cleanup touches only the freshly created stage, never the existing
    // three language packs, previous stage, shared pictures or unsent work.
    if(!committed)await cacheStorage.delete(name).catch(()=>{});
  }
}
export async function inspectPrivateMediaStage({
  descriptor,ownerId,language,policyRecord,appOrigin,
  offlineAccess=globalThis.KGOfflineAccess,
  learnerAccess=globalThis.KGLearnerAccess,
  cacheStorage=globalThis.caches,cryptoApi=globalThis.crypto,
  clock=Date.now,
}){
  const policy=policyContext({ownerId,language,policyRecord,offlineAccess,learnerAccess,now:clock()});
  safeDescriptor(descriptor,{ownerId,language,policyRecord,appOrigin});
  if(!cacheStorage?.open||!cryptoApi?.subtle?.digest)failure('private cache unavailable');
  const known=await cacheStorage.keys();
  if(!known.includes(descriptor.cacheName))failure('stage cache is missing');
  const cache=await cacheStorage.open(descriptor.cacheName);
  const response=await cache.match(descriptor.manifestUrl);
  if(!response?.ok||mimeOf(response.headers)!=='application/json')
    failure('missing private stage manifest');
  const encoded=await response.text();
  if(await sha256(new TextEncoder().encode(encoded),cryptoApi)!==descriptor.manifestSha256)
    failure('private stage manifest was modified');
  let manifest;
  try{manifest=JSON.parse(encoded);}catch(_){failure('invalid stage manifest');}
  if(manifest.contract!==1||manifest.kind!=='kg-protected-staged-media'||
     manifest.ownerId!==ownerId||manifest.language!==language||
     manifest.revision!==policy.revision||
     manifest.policyCheckedAt!==policyRecord.checkedAt||
     !Array.isArray(manifest.media)||manifest.media.length!==descriptor.assetCount||
     !Number.isSafeInteger(manifest.bytesTotal)||manifest.bytesTotal!==descriptor.bytesTotal)
    failure('staged grant or source inventory changed');
  let total=0;
  const keys=new Set();
  for(const entry of manifest.media){
    if(!str(entry.sourceKey)||!/^[a-f0-9]{64}$/.test(entry.sha256||'')||
       !Number.isSafeInteger(entry.bytes)||entry.bytes<1||
       !MIME_EXT.has(entry.contentType)||!str(entry.cacheKey)||
       keys.has(entry.cacheKey))
      failure('invalid staged source entry');
    const expected=cacheKey(appOrigin,ownerId,language,policy.revision,
      await sha256(new TextEncoder().encode(entry.sourceKey),cryptoApi));
    if(entry.cacheKey!==expected)failure('staged media key is not account-scoped');
    keys.add(expected);
    const saved=await cache.match(expected);
    if(!saved?.ok||mimeOf(saved.headers)!==entry.contentType||
       saved.headers.get('X-KG-Private-SHA256')!==entry.sha256||
       saved.headers.get('X-KG-Private-Bytes')!==String(entry.bytes))
      failure('staged private media missing or metadata corrupt');
    const bytes=asBytes(await saved.arrayBuffer());
    if(bytes.byteLength!==entry.bytes||!magicOK(entry.contentType,bytes)||
       await sha256(bytes,cryptoApi)!==entry.sha256)
      failure('private media changed after staging');
    total+=bytes.byteLength;
    if(total>MAX_TOTAL)failure('oversized staged media');
  }
  if(total!==manifest.bytesTotal)failure('private stage byte count changed');
  if(typeof cache.keys==='function'){
    const savedKeys=await cache.keys();
    const allowed=new Set([...keys,descriptor.manifestUrl]);
    if(savedKeys.length!==allowed.size||savedKeys.some(request=>
      !allowed.has(typeof request==='string'?request:request.url)))
      failure('unexpected resource stored in private media stage');
  }
  return {verified:true,readyToInstall:false,ownerId,language,
    revision:policy.revision,assetCount:manifest.media.length,bytesTotal:total};
}
export async function discardPrivateMediaStage({descriptor,ownerId,language,
  policyRecord,appOrigin,cacheStorage=globalThis.caches}){
  safeDescriptor(descriptor,{ownerId,language,policyRecord,appOrigin});
  if(!cacheStorage?.delete||!cacheStorage?.keys)failure('private cache unavailable');
  // Never delete a legacy/public pack or another owner's stage.
  if(!(await cacheStorage.keys()).includes(descriptor.cacheName))return false;
  return cacheStorage.delete(descriptor.cacheName);
}
export const PRIVATE_MEDIA_STAGING_CONTRACT=Object.freeze({
  cachePrefix:CACHE_PREFIX,maxImageBytes:MAX_IMAGE,maxAudioBytes:MAX_AUDIO,
  maxTotalBytes:MAX_TOTAL,maxItems:MAX_ITEMS,
  installed:false,
});
