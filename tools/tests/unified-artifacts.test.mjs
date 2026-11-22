import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root=path.resolve('.');
const read=async (edition,filename)=>fs.readFile(path.join(root,edition,filename));
const json=async (edition,filename)=>JSON.parse((await read(edition,filename)).toString('utf8'));
const editions=['dist-offline','dist-unified'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('unified candidate preserves the installed offline PWA identity and scope',async()=>{
 const [oldManifest,nextManifest]=await Promise.all(editions.map(e=>json(e,'manifest.webmanifest')));
 for(const key of ['id','start_url','scope','display']) assert.deepEqual(nextManifest[key],oldManifest[key],key);
 assert.equal(nextManifest.id,'/kg-chart-offline');
 assert.equal(nextManifest.start_url,'./');
 assert.equal(nextManifest.scope,'./');
 assert.equal(nextManifest.name,'KG Chart');
});

test('unified and offline builds retain byte-identical storage, picture and auth runtime code',async()=>{
 for(const filename of ['js/offline-pictures.js','js/offline-install.js','js/offline-runtime.js']){
  const [oldBytes,nextBytes]=await Promise.all(editions.map(e=>read(e,filename)));
  if(filename==='js/offline-runtime.js'){
   const stripRevision=bytes=>bytes.toString('utf8').replace(/^window\.KG_APP_VERSION = [^\n]*\n/,'');
   assert.equal(stripRevision(nextBytes),stripRevision(oldBytes),filename);
  }else assert.deepEqual(nextBytes,oldBytes,filename);
 }
 const runtime=(await read('dist-unified','js/offline-runtime.js')).toString();
 assert.match(runtime,/kg-chart-offline-v1/);
 assert.match(runtime,/kg-chart-offline-auth/);
 assert.match(runtime,/outbox/);
 const sw=(await read('dist-unified','sw.js')).toString();
 assert.match(sw,/kg-offline-pictures-v1/);
 assert.match(sw,/kg-offline-shell-/);
});

test('all generated edition revisions and shell file hashes agree without deleting older caches',async()=>{
 for(const edition of editions){
  const meta=await json(edition,'offline-build.json');
  const shell=await json(edition,'shell-manifest.json');
  const manifest=await json(edition,'manifest.webmanifest');
  assert.equal(meta.appVersion,shell.version);
  assert.equal(manifest.version,shell.version);
  assert.equal(meta.schemaVersion,1);
  assert.equal(meta.edition,edition==='dist-unified'?'unified':'separate-offline');
  assert.equal(shell.version.endsWith('-unified'),edition==='dist-unified');
  const listed=new Set();
  for(const entry of shell.files){
   assert(!listed.has(entry.path),'duplicate shell entry: '+entry.path);
   listed.add(entry.path);
   assert.equal(sha256(await read(edition,entry.path)),entry.sha256,entry.path);
  }
  assert(listed.has('sw.js'));
  assert(listed.has('index.html'));
  assert(listed.has('js/offline-runtime.js'));
 }
});

test('unified entry keeps local dependencies and does not silently convert to original online origin',async()=>{
 const html=(await read('dist-unified','index.html')).toString();
 assert.match(html,/window\.KG_UNIFIED=true/);
 assert.match(html,/\.\/manifest\.webmanifest/);
 assert.doesNotMatch(html,/https:\/\/(?:unpkg\.com|cdn\.tailwindcss\.com|fonts\.googleapis\.com)/);
 const app=(await read('dist-unified','assets/app.js')).toString();
 assert.match(app,/KGOffline\.ready/);
 assert.match(app,/KGOffline\.wrapClient/);
 assert.match(app,/KGOffline\.setLanguage/);
});
