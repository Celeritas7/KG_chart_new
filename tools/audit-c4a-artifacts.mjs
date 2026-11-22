/** Stage C4A release-artifact contract audit.
 * READ-ONLY: inspects already built dist-offline/ and dist-unified/ outputs.
 * Never reads browser profiles, accesses cloud services, writes files, or deploys.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const outputs=['dist-offline','dist-unified'];
const read=(folder,file)=>fs.readFile(path.join(process.cwd(),folder,file));
const utf=async(folder,file)=>(await read(folder,file)).toString('utf8');
const json=async(folder,file)=>JSON.parse(await utf(folder,file));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const requiredFiles=['index.html','sw.js','manifest.webmanifest','js/offline-runtime.js',
 'js/offline-install.js','js/offline-pictures.js','assets/app.js'];
const reports=[];

for(const directory of outputs){
 const edition=directory==='dist-unified'?'unified':'separate-offline';
 const [build,manifest,shell,worker,html,runtime,app]=await Promise.all([
  json(directory,'offline-build.json'),json(directory,'manifest.webmanifest'),
  json(directory,'shell-manifest.json'),utf(directory,'sw.js'),
  utf(directory,'index.html'),utf(directory,'js/offline-runtime.js'),
  utf(directory,'assets/app.js')
 ]);
 const suffix=edition==='unified'?'-unified':'';
 assert.match(build.appVersion,/^[a-f0-9]{12}(?:-unified)?$/);
 assert.equal(build.appVersion.endsWith('-unified'),edition==='unified');
 assert.equal(build.edition,edition);
 assert.equal(build.schemaVersion,1);
 assert.equal(build.source,'index.html');
 assert.equal(manifest.id,'/kg-chart-offline');
 assert.equal(manifest.start_url,'./');
 assert.equal(manifest.scope,'./');
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.version,build.appVersion);
 assert.equal(shell.version,build.appVersion);
 assert.match(runtime,/kg-chart-offline-v1/,'IndexedDB identity must be unchanged');
 assert.match(runtime,/createObjectStore\('kv'\)/);
 assert.match(runtime,/createObjectStore\('outbox'/);
 assert.match(runtime,/active-caches:/);
 assert.match(app,/kg-chart-offline-auth/,'Auth storage key must remain compatible');
 assert.match(worker,/kg-offline-pictures-v1-/,'Worker must read shared picture byte cache');
 assert.match(worker,/X-KG-Picture-Hash/,'Worker must include shared picture resolver');
 assert.match(worker,/KG_OFFLINE_APPLY_UPDATE/);
 assert.match(worker,/kg-offline-shell-/);
 assert.match(worker,new RegExp(build.appVersion.replace('-','\\-')));
 assert.match(html,edition==='unified'?/window\.KG_UNIFIED=true/:/window\.KG_UNIFIED=false/);
 assert(Array.isArray(shell.files) && shell.files.length>0);
 const entries=new Map();
 for(const entry of shell.files){
  assert.equal(typeof entry.path,'string');
  assert(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
  assert.match(entry.sha256,/^[a-f0-9]{64}$/);
  assert(!entries.has(entry.path),'Duplicate shell manifest path '+entry.path);
  entries.set(entry.path,entry.sha256);
  const actual=sha256(await read(directory,entry.path));
  assert.equal(actual,entry.sha256,edition+': '+entry.path);
 }
 for(const file of requiredFiles)assert(entries.has(file),'Missing release file '+directory+'/'+file);
 reports.push({directory,edition,revision:build.appVersion,
  shellFiles:shell.files.length,sha256OfManifest:sha256(await read(directory,'shell-manifest.json'))});
}
const [rollback,unified]=reports;
assert.equal(unified.revision,rollback.revision+'-unified',
 'Rollback and unified artifacts must come from the SAME source SHA');
const [oldManifest,newManifest]=await Promise.all(outputs.map(e=>json(e,'manifest.webmanifest')));
for(const key of ['id','start_url','scope','display'])
 assert.deepEqual(newManifest[key],oldManifest[key],'PWA '+key+' must not change');
const normaliseRevision=(contents,version)=>contents.replaceAll(version,'<REVISION>');
for(const file of ['sw.js','js/offline-runtime.js','js/offline-pictures.js','js/offline-install.js']){
 const [oldBytes,newBytes]=await Promise.all(outputs.map(dir=>utf(dir,file)));
 assert.equal(normaliseRevision(oldBytes,rollback.revision),
  normaliseRevision(newBytes,unified.revision),
  'Rollback compatibility mismatch in '+file);
}
console.log(JSON.stringify({
 result:'C4A_ARTIFACT_CONTRACT_PASS',
 artifacts:reports,
 releaseAuthorized:false,
 unverified:['Cloudflare live build settings','Supabase Auth URL allowlist',
  'real Android baseline','physical device acceptance','release/rollback approval']
},null,2));
