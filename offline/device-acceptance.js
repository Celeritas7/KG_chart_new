/* KG Chart U4A — read-only physical-device acceptance report contract.
 *
 * Only the human using the installed Android/iPad app can judge actual
 * Airplane-mode cold launch, decoded pictures, audible output, quiz behavior
 * and reconnect. This helper NEVER infers manual PASS from synthetic tests,
 * contacts a server, reads private content or writes application storage.
 *
 * Reports are aggregate only: no email, user ID, source IDs, quiz answers,
 * HTTP URLs, public/private media keys, raw readiness failure filenames,
 * access tokens, device fingerprint or browser user-agent.
 */
(function(root) {
  'use strict';
  const CASES=Object.freeze([
    Object.freeze({id:'airplane_cold_open',label:'Airplane-mode cold reopen',
      instruction:'With the pack downloaded, disconnect Wi-Fi and mobile data. Close the Home Screen app fully and reopen it without internet.'}),
    Object.freeze({id:'saved_lessons',label:'Saved topics and progress',
      instruction:'Open a downloaded language. Confirm Food remains complete and Vegetables stays unlocked if those were saved on this device.'}),
    Object.freeze({id:'saved_pictures',label:'Saved vocabulary pictures',
      instruction:'Open saved vocabulary and check actual pictures. Note any published missing-picture placeholders separately.'}),
    Object.freeze({id:'pronunciation_audio',label:'Offline pronunciation audio',
      instruction:'Tap several saved pronunciation clips in Airplane mode and listen for audio through the device speaker or headphones.'}),
    Object.freeze({id:'offline_quiz',label:'Quiz records offline',
      instruction:'Finish a small quiz while disconnected. Observe that unsent changes are queued without a network error.'}),
    Object.freeze({id:'pending_after_reopen',label:'Pending changes survive reopen',
      instruction:'Close and reopen while still offline; confirm the queued-change count and completed quiz results remain.'}),
    Object.freeze({id:'reconnect_sync',label:'Reconnect and synchronize',
      instruction:'Reconnect. Use Sync now, confirm server acknowledgment, and inspect the online app for the same completion or progress.'}),
    Object.freeze({id:'recovery_export',label:'Recovery backup remains available',
      instruction:'Export your private unsent-work recovery JSON and keep it on your own device. Do not attach that private backup to this report.'}),
  ]);
  const PLATFORMS=new Set(['android','ipad']);
  const STATES=new Set(['not_tested','pass','fail']);
  const safeVersion=x=>typeof x==='string'&&/^[a-zA-Z0-9._-]{1,90}$/.test(x)?x:'unverified';
  const number=x=>Number.isSafeInteger(x)&&x>=0&&x<=100000000?x:0;
  const safeLang=x=>typeof x==='string'&&/^[a-z]{2,3}$/.test(x)?x:'unknown';
  const toISOString=clock=>{
    const value=typeof clock==='function'?clock():Date.now();
    return Number.isFinite(value)&&value>=0
      ? new Date(value).toISOString() : null;
  };
  function normalizeObservations(value){
    const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return CASES.map(item=>({id:item.id,
      status:STATES.has(source[item.id])?source[item.id]:'not_tested'}));
  }
  function safeReadiness(readiness,wasOffline){
    if(!readiness||typeof readiness!=='object'||Array.isArray(readiness))
      return {checked:false,wasOffline:false,ready:false,shellVerified:false,
        appVersion:'unverified',workerVersion:'unverified',packs:[],
        pendingChanges:null,missingPictures:0};
    const packs=Array.isArray(readiness.packs)
      ? readiness.packs.slice(0,20).map(p=>({
        language:safeLang(p?.language),
        files:number(p?.files),audioFiles:number(p?.audioFiles),
        missingPictures:number(p?.missingPictures),
        failedFiles:Array.isArray(p?.failures)?number(p.failures.length):0,
        verified:p?.ok===true,
      })) : [];
    return {
      checked:true,wasOffline:wasOffline===true,
      ready:readiness.ready===true,
      shellVerified:readiness.shell?.ok===true,
      appVersion:safeVersion(readiness.appVersion),
      workerVersion:safeVersion(readiness.shell?.revision),
      packs,pendingChanges:number(readiness.pendingChanges),
      missingPictures:packs.reduce((sum,p)=>sum+p.missingPictures,0),
    };
  }
  function createReport({platform,observations,readiness,wasOffline,
    currentPending,clock=Date.now,edition}={}){
    const checks=normalizeObservations(observations);
    const evidence=safeReadiness(readiness,wasOffline);
    const totals={
      passed:checks.filter(x=>x.status==='pass').length,
      failed:checks.filter(x=>x.status==='fail').length,
      notTested:checks.filter(x=>x.status==='not_tested').length,
    };
    const validPlatform=PLATFORMS.has(platform);
    const matchedWorker=evidence.appVersion!=='unverified'&&
      evidence.workerVersion===evidence.appVersion;
    const offlineVerified=evidence.checked&&evidence.wasOffline&&evidence.ready&&
      evidence.shellVerified&&evidence.packs.length>0&&
      evidence.packs.every(p=>p.verified)&&matchedWorker;
    const allManualPass=totals.passed===CASES.length;
    const fail=totals.failed>0||
      (evidence.checked&&(!evidence.ready||!evidence.shellVerified));
    const baselineVerdict=fail?'needs_attention':
      validPlatform&&offlineVerified&&allManualPass
        ? evidence.missingPictures>0?'user_reported_pass_with_picture_gaps':'user_reported_baseline_pass'
        :'incomplete';
    return {
      format:'kg-chart-u4a-device-acceptance',version:1,
      recordedAt:toISOString(clock),
      platform:validPlatform?platform:'not_selected',
      edition:['unified','separate-offline'].includes(edition)?edition:'unverified',
      baselineVerdict,
      restrictedAccessVerdict:'not_tested_not_authorized',
      releaseVerdict:'NO_GO',
      readiness:evidence,
      pendingAtExport:Number.isSafeInteger(currentPending)&&currentPending>=0
        ? number(currentPending):null,
      checks,totals,
      disclaimer:'Manual PASS is user-observed, not independently verified by automated tests. Restricted user access is disabled pending backend security review and explicit release approval.',
    };
  }
  root.KGDeviceAcceptance={CASES,normalizeObservations,safeReadiness,createReport};
})(typeof window!=='undefined'?window:globalThis);
