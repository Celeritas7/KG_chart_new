import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
const source=await fs.readFile(new URL('../runtime.js',import.meta.url),'utf8');
const owner='88888888-8888-4888-8888-888888888888';
async function context({blocked=false}={}) {
 const idb=new IDBFactory();
 const db=await new Promise(resolve=>{const r=idb.open('kg-chart-offline-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('kv');r.result.createObjectStore('outbox',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);});
 await new Promise(resolve=>{const tx=db.transaction('kv','readwrite');const kv=tx.objectStore('kv');
 kv.put(owner,'active-owner');kv.put({id:owner,email:'test@example.org',unlocked:true},'enroll:'+owner);
 kv.put('my-pack','active:'+owner+':my');kv.put({ownerId:owner,schemaVersion:1,lang:'my',assets:[],data:{kg_chart_vocabulary:[{id:'saved'}]}},'pack:my-pack');tx.oncomplete=resolve;});db.close();
 const timers=new Map();let timer=0;
 const panel={innerHTML:'',querySelector:()=>({addEventListener(){}})};
 const ctx={window:{KG_UNIFIED:true},document:{getElementById:id=>id==='kg-offline-panel'?panel:null,addEventListener(){},hidden:false},navigator:{onLine:false,serviceWorker:{controller:{postMessage(){}},addEventListener(){}},connection:{addEventListener(){}}},location:{href:'https://test.example/',hash:''},URL,Response,TextEncoder,console,
 setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:n=>timers.delete(n),addEventListener(){},fetch:async()=>({ok:false}),indexedDB:blocked?{open:()=>({})}:idb};
 vm.runInNewContext(source,ctx);return {ctx,panel,timers,api:ctx.window.KGOffline};
}
test('unified app reads saved lessons offline and undownloaded languages online without a forced download panel',async()=>{
 const {ctx,panel,api}=await context();await api.ready;
 assert.doesNotMatch(panel.innerHTML,/<details open/);
 const remote={select(){return this;},then(resolve){return Promise.resolve({data:[{id:'remote'}],error:null}).then(resolve);}};
 const client=api.wrapClient({storage:{from:()=>({getPublicUrl:x=>({data:{publicUrl:'https://example.supabase.co/storage/v1/object/public/vocabulary-assets/'+x}})})},auth:{},from:()=>remote});
 assert.equal((await client.from('kg_chart_vocabulary').select()).data[0].id,'saved');
 api.setLanguage('zh');assert.equal((await client.from('kg_chart_vocabulary').select()).error.code,'KG_INTERNET_REQUIRED');
 ctx.navigator.onLine=true;assert.equal((await client.from('kg_chart_vocabulary').select()).data[0].id,'remote');
 api.setLanguage('my');assert.equal((await client.from('kg_chart_vocabulary').select()).data[0].id,'saved');
});
test('blocked local startup rejects with recovery guidance instead of waiting forever',async()=>{
 const {api,timers}=await context({blocked:true});const rejection=assert.rejects(api.ready,/timed out/);
 for(const fn of [...timers.values()])fn();await rejection;
});
