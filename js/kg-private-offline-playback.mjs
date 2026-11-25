// U3D2B2: private offline media activation and playback, default OFF.
// Client-side cache ownership is NOT cryptographic access control or remote
// revocation. Never navigate/fetch private cache keys as HTTP routes.
import {inspectPrivateMediaStage,PRIVATE_MEDIA_STAGING_CONTRACT as LIMITS} from './kg-private-offline-media.mjs';
import {sourceRequest} from './kg-protected-media-context.mjs';
import {mediaSourceKey} from './kg-protected-player.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const LANG=/^[a-z]{2,3}$/;
const TYPES=new Set(['word_audio','word_image','topic_audio','sentence_audio','colour_audio']);
const MIME=new Set(['image/png','image/jpeg','image/webp','image/gif','audio/mpeg']);
const deny=why=>{throw Error('Private offline media denied: '+why);};
const hash=async(bytes,cryptoApi)=>{
  if(!cryptoApi?.subtle?.digest)deny('no secure digest');
  return Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes)),
    n=>n.toString(16).padStart(2,'0')).join('');
};
const origin=appOrigin=>{
  let u;try{u=new URL(appOrigin);}catch(_){deny('bad app origin');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||
     u.search||u.hash)deny('unexpected app origin');
  return u.origin;
};
function currentPolicy({ownerId,language,policyRecord,offlineAccess,learnerAccess,clock}){
  if(!UUID.test(String(ownerId))||!LANG.test(String(language))||
     offlineAccess?.fromCache?.(policyRecord,ownerId,clock())?.state!=='restricted_pending')
    deny('owner policy not current');
  const policy=learnerAccess?.parseSnapshot?.(policyRecord.snapshot);
  if(policy?.state!=='restricted'||!policy.languages.includes(language)||
     policy.revision!==policyRecord.snapshot.revision)
    deny('language or policy revision denied');
  return policy;
}
function scopeCopy(scope){
  if(scope==null)return null;
  if(scope.state!=='restricted'||scope.serverEnforced!==true||
     !Array.isArray(scope.groups)||scope.groups.length>1000||
     !scope.groupTopics||typeof scope.groupTopics!=='object')
    deny('sentence scope not verified');
  const groupTopics=Object.create(null);
  const names=new Set();
  for(const group of scope.groups){
    if(typeof group!=='string'||!group||group.length>250||
       group.trim()!==group||names.has(group)||
       ['__proto__','constructor','prototype'].includes(group)||
       typeof scope.groupTopics[group]!=='string')
      deny('invalid verified sentence group');
    names.add(group);groupTopics[group]=scope.groupTopics[group];
  }
  if(Object.keys(scope.groupTopics).length!==names.size)
    deny('unexpected sentence group names');
  return {state:'restricted',serverEnforced:true,
    groups:[...names].sort(),groupTopics};
}
function permitted(source,policy,scope,language){
  return !!source&&TYPES.has(source.type)&&source.language===language&&
    (source.type==='word_image'?source.voice==null:['m','f'].includes(source.voice))&&
    !!sourceRequest(source,policy,scope)&&
    (source.type!=='sentence_audio'||scope?.groupTopics?.[source.groupName]===source.topicId);
}
function keysFor(plan,policy,scope,language){
  if(!Array.isArray(plan)||plan.length<1||plan.length>LIMITS.maxItems)
    deny('invalid approved media plan');
  const keys=new Set();
  for(const s of plan){
    if(!permitted(s,policy,scope,language))deny('ungranted source in media plan');
    const k=mediaSourceKey(s);
    if(!k||keys.has(k))deny('duplicate media source');
    keys.add(k);
  }
  return [...keys].sort();
}
function checkPointer(pointer,{ownerId,language,policyRecord,appOrigin}){
  if(!pointer||pointer.contract!==1||pointer.kind!=='kg-private-offline-active-media'||
     pointer.ownerId!==ownerId||pointer.language!==language||
     pointer.revision!==policyRecord?.snapshot?.revision||
     pointer.checkedAt!==policyRecord?.checkedAt||
     pointer.appOrigin!==origin(appOrigin)||
     pointer.descriptor?.ownerId!==ownerId||
     pointer.descriptor?.language!==language||
     pointer.descriptor?.revision!==pointer.revision||
     !Array.isArray(pointer.sourceKeys)||!pointer.sourceKeys.length||
     pointer.sourceKeys.length>LIMITS.maxItems||
     pointer.sourceKeys.some(k=>typeof k!=='string'||k.length>500)||
     JSON.stringify(pointer.sourceKeys)!==JSON.stringify([...new Set(pointer.sourceKeys)].sort()))
    deny('active pointer does not match enrolled identity and revision');
  return pointer;
}
async function readManifest(pointer,cacheStorage,cryptoApi){
  if(!cacheStorage?.keys||!cacheStorage?.open||
     !(await cacheStorage.keys()).includes(pointer.descriptor.cacheName))
    deny('active private cache not present');
  const cache=await cacheStorage.open(pointer.descriptor.cacheName);
  const stored=await cache.match(pointer.descriptor.manifestUrl);
  if(!stored?.ok||String(stored.headers?.get('Content-Type')||'').split(';')[0]!=='application/json')
    deny('private manifest unavailable');
  const raw=await stored.text();
  if(raw.length>2_000_000||
     await hash(new TextEncoder().encode(raw),cryptoApi)!==pointer.descriptor.manifestSha256)
    deny('private manifest checksum changed');
  let manifest;try{manifest=JSON.parse(raw);}catch(_){deny('invalid media manifest');}
  if(manifest?.contract!==1||manifest.kind!=='kg-protected-staged-media'||
     manifest.ownerId!==pointer.ownerId||manifest.language!==pointer.language||
     manifest.revision!==pointer.revision||manifest.policyCheckedAt!==pointer.checkedAt||
     !Array.isArray(manifest.media)||manifest.media.length!==pointer.sourceKeys.length||
     manifest.media.length!==pointer.descriptor.assetCount||
     manifest.bytesTotal!==pointer.descriptor.bytesTotal)
    deny('private manifest does not match active grant');
  if(JSON.stringify(manifest.media.map(x=>x.sourceKey).sort())!==JSON.stringify(pointer.sourceKeys))
    deny('unapproved or missing media source in manifest');
  return {cache,manifest};
}
async function bytesBounded(response,limit){
  const reader=response?.body?.getReader?.();
  if(!reader)deny('private bytes unavailable');
  const chunks=[];let length=0;
  try{for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    if(!(value instanceof Uint8Array))deny('invalid cache chunk');
    length+=value.byteLength;
    if(length>limit)deny('media byte limit exceeded');
    chunks.push(value);
  }}finally{try{reader.releaseLock();}catch(_){}}
  const bytes=new Uint8Array(length);
  let off=0;for(const chunk of chunks){bytes.set(chunk,off);off+=chunk.byteLength;}
  return bytes;
}
function magicOK(mime,b){
  if(mime==='image/png')return b.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n);
  if(mime==='image/jpeg')return b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255;
  if(mime==='image/gif')return b.length>=6&&/^GIF8[79]a$/.test(String.fromCharCode(...b.slice(0,6)));
  if(mime==='image/webp')return b.length>=12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
  if(mime==='audio/mpeg')return b.length>=64&&((b[0]===73&&b[1]===68&&b[2]===51)||(b[0]===255&&(b[1]&224)===224));
  return false;
}
export async function preparePrivateMediaActivation({
  descriptor,authorizedPlan,ownerId,language,policyRecord,sentenceScope,
  appOrigin,cacheStorage=globalThis.caches,cryptoApi=globalThis.crypto,
  offlineAccess=globalThis.KGOfflineAccess,learnerAccess=globalThis.KGLearnerAccess,
  clock=Date.now,assertCurrent,
}){
  const policy=currentPolicy({ownerId,language,policyRecord,offlineAccess,learnerAccess,clock});
  const scope=scopeCopy(sentenceScope);
  const keys=keysFor(authorizedPlan,policy,scope,language);
  assertCurrent?.();
  const inspection=await inspectPrivateMediaStage({
    descriptor,ownerId,language,policyRecord,appOrigin,
    cacheStorage,cryptoApi,offlineAccess,learnerAccess,clock,
  });
  if(!inspection.verified||inspection.assetCount!==keys.length)deny('unverified staged asset inventory');
  const pointer={contract:1,kind:'kg-private-offline-active-media',
    ownerId,language,revision:policy.revision,
    checkedAt:policyRecord.checkedAt,appOrigin:origin(appOrigin),
    sourceKeys:keys,sentenceScope:scope,descriptor:{...descriptor}};
  checkPointer(pointer,{ownerId,language,policyRecord,appOrigin});
  await readManifest(pointer,cacheStorage,cryptoApi);
  assertCurrent?.();
  currentPolicy({ownerId,language,policyRecord,offlineAccess,learnerAccess,clock});
  return pointer;
}
export async function readPrivateOfflineMedia({
  pointer,resource,ownerId,language,policyRecord,appOrigin,
  cacheStorage=globalThis.caches,cryptoApi=globalThis.crypto,
  urlFactory=globalThis.URL,offlineAccess=globalThis.KGOfflineAccess,
  learnerAccess=globalThis.KGLearnerAccess,clock=Date.now,assertCurrent,
}){
  const policy=currentPolicy({ownerId,language,policyRecord,offlineAccess,learnerAccess,clock});
  checkPointer(pointer,{ownerId,language,policyRecord,appOrigin});
  const scope=scopeCopy(pointer.sentenceScope);
  if(!permitted(resource,policy,scope,language))
    deny('requested source is not in active grant');
  const sourceKey=mediaSourceKey(resource);
  if(!pointer.sourceKeys.includes(sourceKey))deny('source not included in installed media');
  assertCurrent?.();
  const {cache,manifest}=await readManifest(pointer,cacheStorage,cryptoApi);
  const entry=manifest.media.find(x=>x.sourceKey===sourceKey);
  if(!entry||!MIME.has(entry.contentType)||!/^[a-f0-9]{64}$/.test(entry.sha256||'')||
     !Number.isSafeInteger(entry.bytes))
    deny('invalid private source entry');
  if(resource.type==='word_image'? !entry.contentType.startsWith('image/'):entry.contentType!=='audio/mpeg')
    deny('media type does not match source');
  const limit=entry.contentType==='audio/mpeg'?LIMITS.maxAudioBytes:LIMITS.maxImageBytes;
  if(entry.bytes<1||entry.bytes>limit)deny('saved media size invalid');
  const keyHash=await hash(new TextEncoder().encode(sourceKey),cryptoApi);
  const expected=pointer.appOrigin+'/__kg_private_media_v1__/'+ownerId+'/'+language+'/'+pointer.revision+'/'+keyHash+'.bin';
  if(entry.cacheKey!==expected)deny('cross-account media key');
  const saved=await cache.match(expected);
  if(!saved?.ok||String(saved.headers?.get('Content-Type')||'').split(';')[0]!==entry.contentType||
     saved.headers.get('X-KG-Private-SHA256')!==entry.sha256||
     saved.headers.get('X-KG-Private-Bytes')!==String(entry.bytes))
    deny('missing or modified private media');
  const bytes=await bytesBounded(saved,limit);
  if(bytes.byteLength!==entry.bytes||!magicOK(entry.contentType,bytes)||
     await hash(bytes,cryptoApi)!==entry.sha256)
    deny('saved private byte integrity mismatch');
  assertCurrent?.();
  currentPolicy({ownerId,language,policyRecord,offlineAccess,learnerAccess,clock});
  if(!urlFactory?.createObjectURL||!urlFactory?.revokeObjectURL)
    deny('temporary blob URLs unavailable');
  const url=urlFactory.createObjectURL(new Blob([bytes],{type:entry.contentType}));
  let released=false;
  return {url,contentType:entry.contentType,bytes:bytes.byteLength,
    release(){if(!released){released=true;urlFactory.revokeObjectURL(url);}}};
}
export function privateAudioRangeResponse(bytes,range=null){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>LIMITS.maxAudioBytes)
    deny('invalid audio range source');
  const size=bytes.byteLength;
  const headers=new Headers({'Content-Type':'audio/mpeg','Accept-Ranges':'bytes',
    'Cache-Control':'private, no-store'});
  if(!range)return new Response(bytes,{status:200,headers});
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match||(!match[1]&&!match[2]))
    return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
  const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
  const end=match[1]?(match[2]?Math.min(Number(match[2]),size-1):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)
    return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
  headers.set('Content-Range','bytes '+start+'-'+end+'/'+size);
  headers.set('Content-Length',String(end-start+1));
  return new Response(bytes.slice(start,end+1),{status:206,headers});
}
export const PRIVATE_OFFLINE_PLAYBACK=Object.freeze({
  activeByDefault:false,format:1,installedWithoutU3D3:false,
});
