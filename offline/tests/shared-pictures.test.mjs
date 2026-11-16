import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
const source=await fs.readFile(new URL('../pictures.js',import.meta.url),'utf8');
const owner='88888888-8888-4888-8888-888888888888';
const image=body=>new Response(body,{headers:{'Content-Type':'image/jpeg','X-KG-SHA256':createHash('sha256').update(body).digest('hex'),'X-KG-Bytes':String(body.length),'X-KG-Revision':'one'}});
function storage(){const stores=new Map();const caches={open:async name=>{if(!stores.has(name)){const rows=new Map();stores.set(name,{rows,put:async(k,r)=>rows.set(String(k),r.clone()),match:async k=>rows.get(String(k))?.clone()});}return stores.get(name);}};
const ctx={window:{},caches,crypto:webcrypto,Headers,Response,Uint8Array};vm.runInNewContext(source,ctx);return {api:ctx.window.KGSharedPictures,caches,stores};}
test('two language packs reference one picture payload, but retain separate audio and catalogs',async()=>{
 const s=storage();const my=await s.api.open('kg-offline-pack-'+owner+'-my-v2',owner),zh=await s.api.open('kg-offline-pack-'+owner+'-zh-v2',owner);
 await my.put('https://example.test/cat.jpg',image('cat bytes'));await zh.put('https://example.test/cat.jpg',image('cat bytes'));
 const shared=s.stores.get(s.api.PREFIX+owner);assert.equal(shared.rows.size,1);
 for(const lang of ['my','zh']){const entry=await s.stores.get('kg-offline-pack-'+owner+'-'+lang+'-v2').match('https://example.test/cat.jpg');assert.equal((await entry.blob()).size,0);assert(entry.headers.get('X-KG-Picture-Hash'));}
 assert.equal(await (await my.match('https://example.test/cat.jpg')).text(),'cat bytes');
 await my.put('audio/my/clip.mp3',new Response('Burmese',{headers:{'Content-Type':'audio/mpeg'}}));
 await zh.put('audio/zh/clip.mp3',new Response('Chinese',{headers:{'Content-Type':'audio/mpeg'}}));
 assert.equal(await (await my.match('audio/my/clip.mp3')).text(),'Burmese');assert.equal(await zh.match('audio/my/clip.mp3'),undefined);
});
test('replacement at the same URL retains the previous pack and legacy raw entries',async()=>{
 const s=storage(),name='kg-offline-pack-'+owner+'-my-old';await (await s.caches.open(name)).put('cat.jpg',image('legacy'));
 const old=await s.api.open(name,owner),fresh=await s.api.open('kg-offline-pack-'+owner+'-my-new',owner);
 await fresh.put('cat.jpg',image('new'));assert.equal(await (await old.match('cat.jpg')).text(),'legacy');
 assert.equal(await (await fresh.match('cat.jpg')).text(),'new');
 await assert.rejects(s.api.open(name,'99999999-9999-4999-8999-999999999999'),/account mismatch/);
});
test('missing shared bytes cannot appear ready; retry repairs corrupt payload without deleting other packs',async()=>{
 const s=storage(),p=await s.api.open('kg-offline-pack-'+owner+'-my-v2',owner);await p.put('cat.jpg',image('cat'));
 const shared=s.stores.get(s.api.PREFIX+owner),key=[...shared.rows.keys()][0];shared.rows.delete(key);assert.equal(await p.match('cat.jpg'),undefined);
 await p.put('cat.jpg',image('cat'));shared.rows.set(key,new Response('corrupt'));await p.put('cat.jpg',image('cat'));assert.equal(await (await p.match('cat.jpg')).text(),'cat');
 await assert.rejects(p.put('bad.jpg',new Response('bad',{headers:{'Content-Type':'image/jpeg','X-KG-SHA256':'a'.repeat(64)}})),/hash mismatch/);
});

test('older controlling workers keep full legacy entries until shared-picture capability is verified',async()=>{
 const s=storage(),name='kg-offline-pack-'+owner+'-my-legacy-controller';
 const pack=await s.api.open(name,owner,false);await pack.put('cat.jpg',image('legacy safe'));
 assert.equal(await (await s.stores.get(name).match('cat.jpg')).text(),'legacy safe');assert(!s.stores.has(s.api.PREFIX+owner));
});
