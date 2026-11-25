import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';

const helper=await fs.readFile(new URL('../../offline/device-acceptance.js',import.meta.url),'utf8');
const runtime=await fs.readFile(new URL('../../offline/runtime.js',import.meta.url),'utf8');
const build=await fs.readFile(new URL('../build-offline.mjs',import.meta.url),'utf8');
const device={};
vm.runInNewContext(helper,{window:device},{filename:'offline/device-acceptance.js'});
const API=device.KGDeviceAcceptance;
const initial=()=>Object.fromEntries(API.CASES.map(c=>[c.id,'not_tested']));
const allPass=()=>Object.fromEntries(API.CASES.map(c=>[c.id,'pass']));
const fixture={
 format:'kg-offline-readiness',version:1,origin:'https://private-app.example',
 edition:'unified',appVersion:'fb4907190a52',
 shell:{ok:true,revision:'fb4907190a52'},
 ready:true,pendingChanges:2,
 packs:[
  {language:'my',files:900,audioFiles:500,missingPictures:85,failures:[],ok:true},
  {language:'zh',files:120,audioFiles:4,missingPictures:0,failures:[],ok:true},
 ],
 ownerId:'11111111-1111-4111-8111-111111111111',
 email:'secret@example.invalid',
 mediaKey:'https://private.example.invalid/storage/token=secret',
 accessToken:'secret-token',
};
const create=(o={})=>API.createReport({
 platform:'android',observations:initial(),readiness:fixture,
 wasOffline:true,currentPending:2,edition:'unified',
 clock:()=>1795500000000,...o,
});
test('U4A checklist covers cold open, media, queued quiz, reconnect and recovery without auto-PASS',()=>{
 assert.equal(API.CASES.length,8);
 assert.deepEqual(JSON.parse(JSON.stringify(API.CASES.map(c=>c.id))),[
  'airplane_cold_open','saved_lessons','saved_pictures',
  'pronunciation_audio','offline_quiz','pending_after_reopen',
  'reconnect_sync','recovery_export',
 ]);
 const report=create();
 assert.equal(report.baselineVerdict,'incomplete');
 assert.equal(report.restrictedAccessVerdict,'not_tested_not_authorized');
 assert.equal(report.releaseVerdict,'NO_GO');
 assert.equal(report.totals.notTested,8);
 assert.equal(report.totals.passed,0);
 assert(report.checks.every(x=>x.status==='not_tested'));
});
test('Even a passing cryptographic file audit cannot pretend physical Airplane mode passed',()=>{
 const report=create({observations:initial(),wasOffline:true});
 assert.equal(report.readiness.ready,true);
 assert.equal(report.baselineVerdict,'incomplete');
 const manual=create({observations:allPass(),readiness:null});
 assert.equal(manual.baselineVerdict,'incomplete');
 const online=create({observations:allPass(),wasOffline:false});
 assert.equal(online.baselineVerdict,'incomplete');
 const workerMismatch=create({observations:allPass(),
  readiness:{...fixture,shell:{ok:true,revision:'different-worker'}}});
 assert.equal(workerMismatch.baselineVerdict,'incomplete');
 const noPlatform=create({platform:'anything',observations:allPass()});
 assert.equal(noPlatform.baselineVerdict,'incomplete');
});
test('User-observed baseline PASS is distinct from release permission and known placeholders',()=>{
 const withGaps=create({platform:'android',observations:allPass()});
 assert.equal(withGaps.baselineVerdict,'user_reported_pass_with_picture_gaps');
 assert.equal(withGaps.readiness.missingPictures,85);
 assert.equal(withGaps.restrictedAccessVerdict,'not_tested_not_authorized');
 assert.equal(withGaps.releaseVerdict,'NO_GO');
 const clean=create({platform:'ipad',observations:allPass(),edition:'separate-offline',
  readiness:{...fixture,packs:fixture.packs.map(x=>({...x,missingPictures:0}))}});
 assert.equal(clean.baselineVerdict,'user_reported_baseline_pass');
 assert.equal(clean.platform,'ipad');
 assert.equal(clean.edition,'separate-offline');
 assert.equal(clean.releaseVerdict,'NO_GO');
});
test('Any failed manual step or corrupt/missing cached file requires attention',()=>{
 const fail=create({observations:{...allPass(),pronunciation_audio:'fail'}});
 assert.equal(fail.baselineVerdict,'needs_attention');
 assert.equal(fail.totals.failed,1);
 const broken=create({observations:allPass(),readiness:{...fixture,ready:false}});
 assert.equal(broken.baselineVerdict,'needs_attention');
 const shellMissing=create({observations:allPass(),readiness:{
  ...fixture,shell:{ok:false,revision:'fb4907190a52'}}});
 assert.equal(shellMissing.baselineVerdict,'needs_attention');
});
test('Reports strictly strip personally identifiable and private file/source details',()=>{
 const toxic={
  ...fixture,
  packs:[{...fixture.packs[0],
   failures:['https://private.example.invalid/storage/object/sign?token=sensitive'],
   url:'https://private.example.invalid',name:'family-person-name',
   userId:'11111111-1111-4111-8111-111111111111'},
  {language:'xxx<script>',files:4,audioFiles:0,missingPictures:0,
    failures:['secret-filename'],ok:false}],
  extraCredentials:{token:'secret-token'},
 };
 const report=create({readiness:toxic,
  observations:{...allPass(),__proto__:'pass',unknown:'secret-answer'},
  clock:()=>1795500000000});
 const raw=JSON.stringify(report);
 for(const secret of ['secret@example.invalid','11111111-1111-4111-8111-111111111111',
  'storage/object','token=sensitive','family-person-name','secret-filename',
  'private-app.example','secret-token','secret-answer','xxx<script>'])
   assert(!raw.includes(secret),'report leaked '+secret);
 assert.equal(report.readiness.packs[1].language,'unknown');
 assert.equal(report.readiness.packs[0].failedFiles,1);
 assert.equal(report.readiness.pendingChanges,2);
 assert.deepEqual(Object.keys(report.checks[0]).sort(),['id','status']);
 assert.equal(report.platform,'android');
});
test('Unexpected checkbox payloads cannot inflate pass counts or inject private data',()=>{
 const list=API.normalizeObservations({
  airplane_cold_open:'PASS',
  saved_lessons:'pass',
  saved_pictures:'pass<script>',
  pronunciation_audio:{status:'pass'},
  offline_quiz:'fail',
  pending_after_reopen:null,
  reconnect_sync:'pass',
  recovery_export:'pass',
  unknown:'pass',
 });
 assert.equal(list.filter(x=>x.status==='pass').length,3);
 assert.equal(list.filter(x=>x.status==='fail').length,1);
 assert.equal(list.filter(x=>x.status==='not_tested').length,4);
 const report=create({observations:Object.fromEntries(list.map(x=>[x.id,x.status]))});
 assert.equal(report.releaseVerdict,'NO_GO');
 assert.equal(report.baselineVerdict,'needs_attention');
});
test('Unverified, oversized, or malformed file audit input cannot create a passing verdict',()=>{
 const report=create({readiness:{ready:true,shell:{ok:true,revision:'bad'},
  appVersion:'bad',packs:[{language:'my',files:999999999999,
   audioFiles:-1,missingPictures:NaN,ok:false}]}});
 assert.equal(report.baselineVerdict,'incomplete');
 assert.equal(report.readiness.packs[0].files,0);
 assert.equal(report.readiness.packs[0].audioFiles,0);
 assert.equal(report.readiness.packs[0].missingPictures,0);
 assert.equal(create({readiness:null}).readiness.checked,false);
 assert.equal(create({clock:()=>NaN}).recordedAt,null);
 assert.equal(create({platform:'iphone'}).platform,'not_selected');
});
test('U4A controls are opt-in, hidden until Settings opens, and do not change installed storage',async()=>{
 const panel={innerHTML:'',handlers:new Map(),querySelector(s){
  return {addEventListener:(event,callback)=>this.handlers.set(s+':'+event,callback)};
 }};
 const dialog={open:false,showModal(){this.open=true;}};
 const navigator={
  onLine:true,
  serviceWorker:{controller:{postMessage(){}},addEventListener(){}},
  connection:{addEventListener(){}},
 };
 const context={
  window:{KGDeviceAcceptance:API},
  document:{getElementById:id=>id==='kg-offline-panel'?panel:
    id==='kg-settings-dialog'?dialog:null,
   addEventListener(){},hidden:false},
  navigator,indexedDB:new IDBFactory(),fetch:async()=>({ok:false}),
  location:{href:'https://kg-offline.example/'},
  addEventListener(){},URL,Response,Headers,TextEncoder,
  setTimeout:()=>0,clearTimeout,console,
 };
 vm.runInNewContext(runtime,context,{filename:'offline/runtime.js'});
 const api=context.window.KGOffline;
 await api.ready;
 assert.equal(dialog.open,false,'no acceptance screen at cold startup');
 assert.equal(api.status().pending,0);
 assert.equal(api.status().readyLanguages.length,0);
 api.openSettings();
 assert.equal(dialog.open,true);
 assert.match(panel.innerHTML,/U4 device acceptance/);
 assert.match(panel.innerHTML,/id="kg-u4-device"/);
 assert.match(panel.innerHTML,/Verify saved files offline/);
 assert.match(panel.innerHTML,/Export U4 evidence \(counts only\)/);
 assert.match(panel.innerHTML,/Restricted sharing:<\/strong> NOT TESTED \/ NO-GO/);
 assert.match(panel.innerHTML,/id="kg-u4-check" disabled/);
 assert.equal(api.deviceAcceptanceReport().releaseVerdict,'NO_GO');
 assert.equal(api.deviceAcceptanceReport().baselineVerdict,'incomplete');
 const online=await api.verifyDeviceOffline();
 assert.equal(online,null,'connected check cannot fabricate Airplane evidence');
 assert.match(panel.innerHTML,/Disconnect Wi-Fi\/mobile data/);
 await assert.rejects(async()=>api.exportDeviceAcceptance(),/Sign in/);
});
test('Runtime acceptance methods never reset caches, uninstall workers or mutate quizzes',async()=>{
 const begin=runtime.indexOf('  function deviceAcceptanceReport() {');
 const end=runtime.indexOf('\n  function tellWorker() {',begin);
 assert(begin>0&&end>begin);
 const section=runtime.slice(begin,end);
 for(const forbidden of ['await put(','.deleteDatabase(','.unregister(','.signOut(',
   'caches.delete(', 'queueMutation(', 'syncEvent(', 'downloadPack(', 'transact('])
   assert(!section.includes(forbidden),forbidden);
 assert.match(section,/if\(navigator.onLine\)/);
 assert.match(section,/await verifyOffline\(\)/);
 assert.match(section,/deviceEvidenceWasOffline=true/);
 assert.match(section,/createReport\(\{/);
 assert.match(section,/JSON.stringify\(report,null,2\)/);
 assert.match(runtime,/deviceOfflineEvidence=null;deviceEvidenceWasOffline=false/);
 assert.match(runtime,/deviceAcceptanceReport,exportDeviceAcceptance/);
 assert(build.includes("'offline/device-acceptance.js', 'js/offline-device-acceptance.js'"));
 assert(build.includes('<script src="./js/offline-device-acceptance.js"></script><script src="./js/offline-runtime.js"></script>'));
 for(const flag of ['U3D1_OFFLINE_ACCESS_ENABLED','U3D2_SCOPED_PACK_PREVIEW_ENABLED',
  'U3D2B1_PRIVATE_MEDIA_STAGE_ENABLED','U3D2B2_PRIVATE_OFFLINE_PLAYBACK_ENABLED',
  'U3D3A_OUTBOX_HOLD_ENABLED','U3D3B_RESTRICTED_PACKS_ENABLED',
  'U3D3C_RESTRICTED_SYNC_ENABLED'])
  assert(runtime.includes('const '+flag+' = false;'),flag);
 const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
 assert(html.includes('const U3C1_SCOPED_UI_ENABLED = false;'));
});
