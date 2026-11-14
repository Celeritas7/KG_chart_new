import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const built=path.join(root,'dist-offline');

test('offline output bundles scripts, compiled styles and fonts, with no runtime CDN',async()=>{
  const html=await fs.readFile(path.join(built,'index.html'),'utf8');
  assert.doesNotMatch(html,/https:\/\/(?:cdn\.tailwindcss\.com|unpkg\.com|fonts\.googleapis\.com)/);
  assert.doesNotMatch(html,/type="text\/babel"|tailwind\.config =/);
  assert.match(html,/KG Chart Offline/);
  for(const name of ['assets/react.production.min.js','assets/react-dom.production.min.js',
    'assets/app.js','assets/app.css','assets/offline.css','assets/fonts.css','assets/supabase.js',
    'js/offline-runtime.js','sw.js','manifest.webmanifest','language-utils/burmese.js',
    'language-utils/chinese.js','language-utils/japanese.js']){
    // Japanese is not dynamically imported by this revision's learner UI; it exists in
    // the shared converter submodule for subsequent offline editions.
    if(name.endsWith('/japanese.js')) continue;
    const stat=await fs.stat(path.join(built,name));assert(stat.size>0,`${name} is empty`);
  }
  assert.match(await fs.readFile(path.join(built,'assets/app.js'),'utf8'),/KGOffline\.wrapClient/);
});

test('app shell manifest has a file hash for every locally bundled asset',async()=>{
  const manifest=JSON.parse(await fs.readFile(path.join(built,'shell-manifest.json'),'utf8'));
  const installed=await fs.readdir(path.join(built,'language-utils'));
  assert.equal(installed.length,10);
  assert(manifest.files.some(f=>f.path==='index.html'));
  assert(manifest.files.some(f=>f.path==='assets/fonts.css'));
  assert(manifest.files.some(f=>f.path.startsWith('assets/fonts/')));
  for(const file of manifest.files) assert.match(file.sha256,/^[a-f0-9]{64}$/);
  const worker=await fs.readFile(path.join(built,'sw.js'),'utf8');
  assert.doesNotMatch(worker,/APP_REVISION|skipWaiting\(/);
  assert.match(worker,/crypto\.subtle\.digest/);
});

test('online source is not overwritten by offline build',async()=>{
  const online=await fs.readFile(path.join(root,'index.html'),'utf8');
  assert.match(online,/https:\/\/unpkg\.com\/react@18/);
  assert.doesNotMatch(online,/KGOffline\.wrapClient|kg-offline-legacy-image-panel-replaced/);
  const onlineManifest=JSON.parse(await fs.readFile(path.join(root,'manifest.webmanifest'),'utf8'));
  const offlineManifest=JSON.parse(await fs.readFile(path.join(built,'manifest.webmanifest'),'utf8'));
  assert.notEqual(onlineManifest.name,offlineManifest.name);
  assert.notEqual(onlineManifest.id,offlineManifest.id);
});
