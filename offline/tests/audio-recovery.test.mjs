import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const adapter=await fs.readFile(new URL('../audio-manifest.js',import.meta.url),'utf8');
function player(){
 const events={};let local=null,network=0,stops=0;
 const context={BASE:'https://example.supabase.co/storage/v1/object/public/vocabulary-assets/audio',manifests:{},emit(){},stop(){stops++;},AbortController,setTimeout,clearTimeout,
 window:{KGOffline:{readMedia:async()=>local?.clone()},addEventListener:(n,f)=>events[n]=f},navigator:{serviceWorker:{addEventListener:(n,f)=>events[n]=f}},fetch:async()=>{network++;throw Error('offline');}};
 vm.runInNewContext(adapter+'\nglobalThis.load=loadManifest;',context);
 return {context,events,set local(r){local=r;},get network(){return network;},get stops(){return stops;}};
}
test('failed catalog can retry and use an existing downloaded catalog with no network',async()=>{
 const p=player();await p.context.load('my');assert.equal(p.context.manifests.my,null);
 p.local=new Response(JSON.stringify({m:['12345678'],f:[]}));await p.context.load('my');
 assert(p.context.manifests.my.m.has('12345678'));assert.equal(p.network,1);
});
test('successful catalog survives failed refresh and account lock clears playback state',async()=>{
 const p=player();p.local=new Response(JSON.stringify({m:[],f:['abcdef12']}));await p.context.load('zh');
 p.local=null;await p.context.load('zh',true);assert(p.context.manifests.zh.f.has('abcdef12'));
 p.events['kg-account-locked']();assert.equal(p.stops,1);assert.equal(p.context.manifests.zh,undefined);
});
test('pack completion refreshes a previously unavailable audio catalog',async()=>{
 const p=player();await p.context.load('my');p.local=new Response(JSON.stringify({m:['12345678'],f:[]}));
 await p.events['kg-pack-ready']({detail:{lang:'my'}});assert(p.context.manifests.my.m.has('12345678'));
});
const sw=await fs.readFile(new URL('../sw.js',import.meta.url),'utf8');
const ctx={Headers,Response};vm.runInNewContext(sw.slice(sw.indexOf('async function audioRange('),sw.indexOf("self.addEventListener('fetch'"))+'\nglobalThis.range=audioRange;',ctx);
test('downloaded MP3 supports byte ranges, suffix requests and unsatisfiable ranges',async()=>{
 const req=range=>({url:'https://example.test/voice.mp3',headers:new Headers({Range:range})});
 let r=await ctx.range(new Response('0123456789'),req('bytes=2-5'));assert.equal(r.status,206);assert.equal(await r.text(),'2345');assert.equal(r.headers.get('Content-Range'),'bytes 2-5/10');
 r=await ctx.range(new Response('0123456789'),req('bytes=-3'));assert.equal(await r.text(),'789');
 r=await ctx.range(new Response('0123456789'),req('bytes=10-'));assert.equal(r.status,416);
});
