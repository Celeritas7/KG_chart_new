import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadProtectedWordPicture,MAX_IMAGE_BYTES} from '../../js/kg-protected-image.mjs';

const WORD='10000000-0000-4000-8000-000000000001';
const ASSET='81000000-0000-4000-8000-000000000001';
const PROJECT='https://fakeproject.supabase.co';
const PRIVATE=PROJECT+'/storage/v1/object/sign/kg-chart-private-media/protected/'+ASSET+'.png?token=fake';
const resource={type:'word_image',language:'my',id:WORD,topicId:'food'};
const policy={state:'restricted',languages:['my'],topics:['my|food'],features:['chart']};
const scope={};
const supabase={rpc(){throw Error('No live RPC permitted in unit test');}};
const signed=async()=>({url:PRIVATE,expiresIn:30,contentType:'image/png'});
const params={resource,policy,sentenceScope:scope,supabase,projectUrl:PROJECT,resolve:signed};

function fakeFetch({mime='image/png',bytes='synthetic-image',sizeHeader,abortDuring=false}={}){
  const calls=[];
  const fetcher=async (url,options)=>{
    calls.push({url,options});
    if(abortDuring)options.signal?.throwIfAborted();
    const blob=new Blob([bytes],{type:mime});
    const headers={'Content-Type':mime,'Content-Length':sizeHeader??String(blob.size)};
    return {ok:true,headers:{get:key=>headers[key]??null},blob:async()=>blob};
  };
  return {fetcher,calls};
}
function factory(){
  const made=[],revoked=[];
  return {made,revoked,createObjectURL(blob){made.push(blob);return 'blob:kg-private-'+made.length;},
    revokeObjectURL(url){revoked.push(url);}};
}

test('Authorized private picture fetches source-verified bytes without a persistent cache or URL token in the DOM',async()=>{
  const transport=fakeFetch(),urls=factory(),controller=new AbortController();
  const lease=await loadProtectedWordPicture({...params,fetcher:transport.fetcher,
    urlFactory:urls,signal:controller.signal});
  assert.equal(lease.url,'blob:kg-private-1');
  assert.equal(transport.calls.length,1);
  assert.equal(transport.calls[0].url,PRIVATE);
  assert.equal(transport.calls[0].options.cache,'no-store');
  assert.equal(transport.calls[0].options.redirect,'error');
  assert.equal(transport.calls[0].options.referrerPolicy,'no-referrer');
  assert.equal(transport.calls[0].options.mode,'cors');
  assert.equal(transport.calls[0].options.signal,controller.signal);
  assert.equal(urls.made.length,1);
  assert(!lease.url.includes('token='));
  lease.release();lease.release();assert.deepEqual(urls.revoked,['blob:kg-private-1']);
});

test('Missing/denied source, public signed URL and cross-topic grant never fetch image bytes',async()=>{
  let count=0;
  const fetcher=async()=>{count++;throw Error('No private image should be fetched');};
  const bad=[
    {...params,resource:{...resource,topicId:'friends_names'}},
    {...params,resource:{...resource,id:'hash-not-a-source-id'}},
    {...params,resolve:async()=>null},
    {...params,resolve:async()=>({url:PROJECT+'/storage/v1/object/public/vocabulary-assets/food/item.png',contentType:'image/png',expiresIn:30})},
  ];
  for(const request of bad)
    assert.equal(await loadProtectedWordPicture({...request,fetcher,urlFactory:factory()}),null);
  assert.equal(count,0);
});

test('Only expected, small, matching image MIME bytes are accepted',async()=>{
  const cases=[
    {mime:'application/octet-stream'},
    {mime:'text/html'},
    {mime:'image/svg+xml'},
    {mime:'image/png',sizeHeader:String(MAX_IMAGE_BYTES+1)},
    {mime:'image/png',sizeHeader:'oops'},
    {mime:'image/png',bytes:''},
  ];
  for(const data of cases){
    const urls=factory(),f=fakeFetch(data);
    assert.equal(await loadProtectedWordPicture({...params,fetcher:f.fetcher,urlFactory:urls}),null,
      JSON.stringify(data));
    assert.equal(urls.made.length,0);
  }
});

test('A cancelled owner/revision request never fetches, retains or returns image bytes',async()=>{
  const controller=new AbortController();controller.abort();
  const f=fakeFetch(),urls=factory();
  assert.equal(await loadProtectedWordPicture({...params,signal:controller.signal,
    fetcher:f.fetcher,urlFactory:urls}),null);
  assert.equal(f.calls.length,0);
  const controller2=new AbortController();
  assert.equal(await loadProtectedWordPicture({...params,signal:controller2.signal,
    resolve:async()=>{controller2.abort();return signed();},
    fetcher:f.fetcher,urlFactory:urls}),null);
  assert.equal(f.calls.length,0);
  assert.equal(urls.made.length,0);
});

test('A signed link is reacquired for each picture fetch and object URLs are individually revoked',async()=>{
  let acquired=0;
  const urls=factory(),f=fakeFetch();
  const resolve=async()=>{acquired++;return signed();};
  const a=await loadProtectedWordPicture({...params,resolve,urlFactory:urls,fetcher:f.fetcher});
  const b=await loadProtectedWordPicture({...params,resolve,urlFactory:urls,fetcher:f.fetcher});
  assert.equal(acquired,2);assert.equal(f.calls.length,2);
  assert.notEqual(a.url,b.url);
  a.release();b.release();assert.equal(urls.revoked.length,2);
});

test('Learner media calls identify real word, topic, sentence and colour records',async()=>{
  const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
  const js=await fs.readFile(new URL('../../js/kg-audio.js',import.meta.url),'utf8');
  const builder=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');
  assert.match(html,/const U3C1_SCOPED_UI_ENABLED = false;/);
  for(const type of ['word_audio','topic_audio','sentence_audio','colour_audio'])
    assert.match(html,new RegExp("type:\\s*['\"]"+type+"['\"]"));
  const calls=html.split('\n').filter(s=>/window\.KGAudio\.(?:play|autoPlay|stateOf|has)\(/.test(s));
  assert(calls.length>=30,'expected all learner audio surfaces to be reviewed');
  for(const line of calls){
    assert.match(line,/(?:wordAudioResource|sentenceAudioResource|colourAudioResource|resource)/,
      'text-only audio call: '+line.trim());
  }
  const buttons=html.split('\n').filter(s=>s.includes('<SpeakButton '));
  assert(buttons.length>=19);
  for(const line of buttons)assert.match(line,/resource=/,
    'Unbound speak button: '+line.trim());
  assert.match(html,/const protectedQuizPictures = U3C1_SCOPED_UI_ENABLED/);
  assert.match(html,/privateQuizImages\.key === imageKey/);
  assert.match(html,/if \(protectedQuizPictures \|\| !quizStarted/);
  assert.match(html,/\(!api \|\| !publicPictureAllowed\) return null/);
  assert.match(html,/<ProtectedWordImage item=\{current\}/);
  assert.match(js,/p\.retries === 0/);
  assert.match(js,/startProtectedPlayback\(p, position\)/);
  assert.match(js,/if \(mediaGate && audio\.src/);
  assert(builder.includes("'js/kg-protected-image.mjs', 'js/kg-protected-image.mjs'"));
});
