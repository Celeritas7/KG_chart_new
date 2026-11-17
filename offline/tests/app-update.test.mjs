import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

const installSource=await fs.readFile(new URL('../install.js',import.meta.url),'utf8');
const runtimeSource=(await fs.readFile(new URL('../pictures.js',import.meta.url),'utf8'))+'\n'+(await fs.readFile(new URL('../runtime.js',import.meta.url),'utf8'));

async function installation({hasWaiting=true}={}) {
  const events=new Map();
  const messages=[];
  const notes=[];
  let offered, safe=true, reloads=0, checks=0;
  const listen=(store,name,handler)=>{
    if(!store.has(name)) store.set(name,new Set());
    store.get(name).add(handler);
  };
  const waitingWorker={postMessage:value=>messages.push(value)};
  const registration={waiting:hasWaiting?waitingWorker:null,installing:null,
    addEventListener:(name,fn)=>listen(events,'registration-'+name,fn),
    update:async()=>{checks++;}};
  const sw={controller:{},register:async()=>registration,ready:Promise.resolve(),
    addEventListener:(name,fn)=>listen(events,name,fn),
    removeEventListener:(name,fn)=>events.get(name)?.delete(fn)};
  const page={
    location:{reload(){reloads++;}},
    KGOffline:{offerShellUpdate:fn=>{offered=fn;},canApplyShellUpdate:()=>safe,
      tellWorker(){},notice:text=>notes.push(text)},
    addEventListener:(name,fn)=>listen(events,'window-'+name,fn),
  };
  const timers=new Map();let nextTimer=0;
  const context={window:page,navigator:{onLine:true,serviceWorker:sw},
    setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(installSource,context,{filename:'offline/install.js'});
  for(const fn of events.get('window-load')||[]) await fn();
  const emit=name=>{for(const fn of [...(events.get(name)||[])]) fn();};
  return {check:()=>page.KGCheckAppUpdate(),navigator:context.navigator,registration,waitingWorker,messages,notes,get offered(){return offered;},get reloads(){return reloads;},get checks(){return checks;},
    get timeouts(){return timers.size;},set safe(value){safe=value;},emit,
    triggerTimeout(){for(const fn of [...timers.values()]) fn();}};
}

test('waiting update is offered and applied only after user action, then reloads once',async()=>{
  const page=await installation();
  assert.equal(page.checks,1,'Connected startup checks for an update');
  assert.equal(page.messages.length,0,'No automatic activation for future releases');
  assert.equal(typeof page.offered,'function');
  const update=page.offered();
  assert.equal(page.messages.length,1);
  assert.equal(page.messages[0].type,'KG_OFFLINE_APPLY_UPDATE');
  assert.equal(page.reloads,0,'Do not reload until the new worker controls the page');
  page.emit('controllerchange');
  await update;
  assert.equal(page.reloads,1);
  assert.equal(page.timeouts,0,'Completed update cancels its timeout');
});

test('a busy quiz blocks activation; a quiz started during activation blocks reload',async()=>{
  const page=await installation();
  page.safe=false;
  await assert.rejects(page.offered(),/Finish the quiz/);
  assert.equal(page.messages.length,0);
  page.safe=true;
  const update=page.offered();
  assert.equal(page.messages.length,1);
  page.safe=false;
  page.emit('controllerchange');
  await update;
  assert.equal(page.reloads,0,'No reload interrupts a quiz');
  assert.match(page.notes.at(-1),/reopen when ready/);
});

test('an update installed after registration is offered, and activation timeout is retryable',async()=>{
  const page=await installation({hasWaiting:false});
  assert.equal(page.offered,undefined);
  let change;
  const installing={state:'installing',addEventListener:(name,fn)=>{if(name==='statechange')change=fn;}};
  page.registration.installing=installing;
  page.emit('registration-updatefound');
  page.registration.waiting=page.waitingWorker;
  installing.state='installed';change();
  assert.equal(typeof page.offered,'function');
  const update=page.offered();
  page.triggerTimeout();
  await assert.rejects(update,/Update could not be activated/);
  assert.equal(page.reloads,0,'A failed update does not reload or clear data');
  assert.equal(page.timeouts,0);
  const retry=page.offered();
  page.emit('controllerchange');
  await retry;
  assert.equal(page.reloads,1,'The same visible update action can be retried');
});

test('offline toolbar shows a visible update button and disables it while a quiz is open',async()=>{
  const panel={innerHTML:'',actions:new Map(),querySelector(selector){
    return {addEventListener:(name,handler)=>this.actions.set(selector+':'+name,handler)};
  }};
  const sw={controller:{postMessage(){}},addEventListener(){}};
  const context={window:{},document:{getElementById:id=>id==='kg-offline-panel'?panel:null,addEventListener(){},hidden:false},
    navigator:{onLine:false,serviceWorker:sw,connection:{addEventListener(){}}},
    location:{href:'https://kg-offline.example/'},addEventListener(){},indexedDB:new IDBFactory(),
    URL,Response,TextEncoder,fetch:async()=>({ok:false}),
    setTimeout:()=>0,clearTimeout,console};
  vm.runInNewContext(runtimeSource,context,{filename:'offline/runtime.js'});
  await context.window.KGOffline.ready;
  let approved=0;
  context.window.KGOffline.offerShellUpdate(async()=>{approved++;});
  assert.match(panel.innerHTML,/Check for app update/);
  assert.match(panel.innerHTML,/New app version downloaded/);
  assert.match(panel.innerHTML,/Update app now/);
  assert.equal(context.window.KGOffline.status().updateAvailable,true);

  context.window.KGOffline.setQuizBusy(true);
  assert.match(panel.innerHTML,/Open the Chart tab to enable the update/);
  assert.match(panel.innerHTML,/Switch to Chart to update/);
  assert.match(panel.innerHTML,/id="kg-shell-update" disabled/);
  context.window.KGOffline.setQuizBusy(false);
  assert.doesNotMatch(panel.innerHTML,/id="kg-shell-update" disabled/);
  assert.match(panel.innerHTML,/Update app now/);
  await panel.actions.get('#kg-shell-update:click')();
  assert.equal(approved,1,'The user-visible button delegates to the installer');
});


test('manual check reports results and never activates or reloads automatically',async()=>{
  const page=await installation({hasWaiting:false});
  await page.check();assert.equal(page.checks,2);
  assert.match(page.notes.at(-1),/No new app update/);
  page.registration.waiting=page.waitingWorker;
  await page.check();assert.match(page.notes.at(-1),/update is ready/);
  assert.equal(page.reloads,0);assert.equal(page.messages.length,0);
  page.navigator.onLine=false;
  const count=page.checks;await page.check();
  assert.equal(page.checks,count);assert.match(page.notes.at(-1),/Connect to the internet/);
  page.navigator.onLine=true;page.registration.update=async()=>{throw Error('Network failure');};
  await page.check();assert.match(page.notes.at(-1),/Could not check.*Network failure/);
});
