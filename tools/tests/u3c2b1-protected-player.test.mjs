import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {acquireProtectedMedia,mediaSourceKey} from '../../js/kg-protected-player.mjs';

const WORD='10000000-0000-4000-8000-000000000001';
const ASSET='81000000-0000-4000-8000-000000000001';
const PROJECT='https://fakeproject.supabase.co';
const URL_AUDIO=PROJECT+'/storage/v1/object/sign/kg-chart-private-media/protected/'+ASSET+'.mp3?token=fake';
const URL_IMAGE=PROJECT+'/storage/v1/object/sign/kg-chart-private-media/protected/'+ASSET+'.jpg?token=fake';
const policy={state:'restricted',revision:8,languages:['my'],
  topics:['my|food'],features:['chart','quiz.words']};
const word={type:'word_audio',language:'my',id:WORD,topicId:'food',voice:'f'};
const picture={type:'word_image',language:'my',id:WORD,topicId:'food'};
const sb={rpc:()=>{throw Error('mock resolver must not use real RPC');}};
const opts={policy,sentenceScope:null,supabase:sb,projectUrl:PROJECT};

test('Source-key includes the exact ID and context, not only text/clip hash',()=>{
  assert.notEqual(mediaSourceKey(word),mediaSourceKey({...word,id:'10000000-0000-4000-8000-000000000002'}));
  assert.notEqual(mediaSourceKey(word),mediaSourceKey({...word,topicId:'friends_names'}));
  assert.notEqual(mediaSourceKey(word),mediaSourceKey({...word,voice:'m'}));
  assert.equal(mediaSourceKey(null),null);
});

test('Audio must be issued for an explicitly permitted word source with a signed private URL',async()=>{
  let seen=0;
  const url=await acquireProtectedMedia({...opts,kind:'audio',resource:word,resolve:async args=>{
    seen++;assert.equal(args.resource.id,WORD);
    assert.equal(args.resource.topicId,'food');
    return {url:URL_AUDIO,contentType:'audio/mpeg',expiresIn:30};
  }});
  assert.equal(url,URL_AUDIO);
  assert.equal(seen,1);
});

test('Picture uses the exact source word and never a public text-hash fallback',async()=>{
  const url=await acquireProtectedMedia({...opts,kind:'image',resource:picture,resolve:async args=>{
    assert.equal(args.resource.id,WORD);
    return {url:URL_IMAGE,contentType:'image/jpeg',expiresIn:15};
  }});
  assert.equal(url,URL_IMAGE);
  assert.equal(await acquireProtectedMedia({...opts,kind:'image',resource:picture,resolve:async()=>null}),null);
  assert.equal(await acquireProtectedMedia({...opts,kind:'image',resource:picture,resolve:async()=>({url:PROJECT+'/storage/v1/object/public/vocabulary-assets/food/pic.jpg',contentType:'image/jpeg',expiresIn:30})}),null);
});

test('Denied, unmatched, missing and malformed resources never invoke signer',async()=>{
  const fail=()=>{throw Error('must not contact signer');};
  const variants=[
    {kind:'audio',resource:{...word,id:'not-a-uuid'}},
    {kind:'audio',resource:{...word,topicId:'friends_names'}},
    {kind:'audio',resource:{...word,language:'ja'}},
    {kind:'image',resource:word},
    {kind:'audio',resource:picture},
    {kind:'audio',resource:null},
    {kind:'audio',resource:{...word,voice:null}},
  ];
  for(const variant of variants){
    assert.equal(await acquireProtectedMedia({...opts,...variant,resolve:fail}),null);
  }
});

test('Reject wrong origin, bucket, MIME, expiry, unsigned URL and malformed scheme',async()=>{
  const good={url:URL_AUDIO,contentType:'audio/mpeg',expiresIn:30};
  const bad=[
    {...good,url:'https://attacker.test'+new URL(URL_AUDIO).pathname+'?token=bad'},
    {...good,url:URL_AUDIO.replace('kg-chart-private-media','vocabulary-assets')},
    {...good,url:URL_AUDIO.replace('?token=fake','')},
    {...good,url:URL_AUDIO.replace('https:', 'http:')},
    {...good,url:URL_AUDIO.replace('.mp3?', '.jpg?')},
    {...good,contentType:'image/jpeg'},
    {...good,expiresIn:31},
    {...good,expiresIn:0},
    {...good,expiresIn:1.5},
    {...good,url:'javascript:alert(1)'},
  ];
  for(const response of bad){
    assert.equal(await acquireProtectedMedia({...opts,kind:'audio',resource:word,resolve:async()=>response}),null,
      JSON.stringify(response));
  }
});

test('Every request rechecks the signer; no signed URL is cached by the client',async()=>{
  let calls=0;
  const resolve=async()=>{
    calls++;
    return {url:URL_AUDIO.replace('token=fake','token='+calls),contentType:'audio/mpeg',expiresIn:30};
  };
  assert.match(await acquireProtectedMedia({...opts,kind:'audio',resource:word,resolve}),/token=1$/);
  assert.match(await acquireProtectedMedia({...opts,kind:'audio',resource:word,resolve}),/token=2$/);
  assert.equal(calls,2);
});

test('Legacy audio is preserved only with the source-controlled gate OFF',async()=>{
  const code=await fs.readFile(new URL('../../js/kg-audio.js',import.meta.url),'utf8');
  let fetches=0;
  class FakeAudio{
    src='';preload='';playbackRate=1;
    addEventListener(){}
    pause(){}
    removeAttribute(name){if(name==='src')this.src='';}
    load(){}
    play(){return Promise.resolve();}
  }
  const w={};
  vm.runInNewContext(code,{
    window:w,Audio:FakeAudio,TextEncoder,localStorage:{getItem:()=>null},
    fetch:()=>{fetches++;return Promise.resolve({ok:false});},
    document:{},console,
  });
  const a=w.KGAudio;
  assert.equal(a.canUsePublicMedia(),true);
  a.requireVerifiedMediaPolicy(true);
  assert.equal(a.canUsePublicMedia(),false);
  assert.equal(a.has('word','my'),false);
  a.loadManifest('my');
  assert.equal(fetches,0,'restricted/unknown sessions must not fetch public audio manifests');
  assert.equal(a.play('word','my',{silent:true}),false);
  a.setVerifiedMediaPolicy({ownerId:'u-1',policy,supabase:sb,projectUrl:PROJECT});
  assert.equal(a.canUsePublicMedia(),false);
  assert.equal(a.play('word','my',{silent:true}),false,'No source ID means no playback');
  a.setVerifiedMediaPolicy(null);
  assert.equal(a.canUsePublicMedia(),false,'Unknown policy cannot become legacy');
  a.requireVerifiedMediaPolicy(false);
  assert.equal(a.canUsePublicMedia(),true);
});

test('HTML/packaging remain default-OFF and include signed-media modules',async()=>{
  const index=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
  const build=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');
  const offlineCatalog=await fs.readFile(new URL('../../offline/audio-manifest.js',import.meta.url),'utf8');
  assert.match(offlineCatalog,/if \(!canUsePublicMedia\(\) \|\| !lang/);
  assert.match(index,/const U3C1_SCOPED_UI_ENABLED = false/);
  assert.match(index,/requireVerifiedMediaPolicy\(U3C1_SCOPED_UI_ENABLED\)/);
  assert.match(index,/if \(!window\.KGAudio\.canUsePublicMedia\(\)\) return null/);
  assert.match(index,/<ProtectedWordImage item=\{item\}/);
  assert.match(index,/resource=\{\{ type: "word_audio", id: item\.id/);
  for(const name of ['kg-private-media-client.mjs','kg-protected-media-context.mjs','kg-protected-player.mjs'])
    assert.ok(build.includes("'js/"+name+"'"),name+' must be copied into the offline shell');
});
