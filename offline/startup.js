/* Runs before React: a broken dependency must not leave a blank screen. */
(() => {
  let timer;
  const report = message => {
    const root=document.getElementById('root');
    if (window.KG_BOOT_COMPLETE || root?.dataset.kgMounted==='true') return;
    const host=root || document.documentElement;
    if(root) root.replaceChildren();
    document.getElementById('kg-startup-recovery')?.remove();
    const box=document.createElement('section');box.id='kg-startup-recovery';box.style.cssText='max-width:34rem;margin:4rem auto;padding:1rem;font:16px sans-serif;line-height:1.5';
    const heading=document.createElement('h1');heading.textContent='KG Chart could not finish opening';
    const text=document.createElement('p');text.textContent=message+' Your packs and progress have not been cleared.';
    const retry=document.createElement('button');retry.textContent='Retry opening';retry.onclick=()=>location.reload();
    const repair=document.createElement('button');repair.textContent='Repair app files';repair.onclick=()=>window.KGRepairShell().catch(e=>{text.textContent=e.message;});
    box.append(heading,text,retry,repair);host.append(box);
  };
  window.KGRepairShell=async()=>{
    if(window.KGOffline?.canApplyShellUpdate?.()===false) throw Error('Finish the quiz, pause downloads and wait for sync before repairing.');
    if(!navigator.onLine) throw Error('Reconnect to repair app files. Existing data is kept.');
    const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    await registration.update();
    const worker=navigator.serviceWorker.controller;
    if(!worker) throw Error('App installation has started. Keep this page open, then retry opening.');
    await new Promise((resolve,reject)=>{
      const channel=new MessageChannel();
      const timeout=setTimeout(()=>{channel.port1.close();reject(Error('Repair is still waiting. Retry when the connection improves.'));},45000);
      channel.port1.onmessage=e=>{clearTimeout(timeout);channel.port1.close();e.data?.ok?resolve():reject(Error(e.data?.error||'Repair could not complete.'));};
      worker.postMessage({type:'KG_OFFLINE_REPAIR_SHELL'},[channel.port2]);
    });
    if(window.KGOffline?.canApplyShellUpdate?.()===false) return;
    location.reload();
  };
  window.KGStartupComplete=()=>{window.KG_BOOT_COMPLETE=true;document.getElementById('kg-startup-recovery')?.remove();clearTimeout(timer);const root=document.getElementById('root');if(root)root.dataset.kgMounted='true';};
  timer=setTimeout(()=>report('Opening took too long. Close other KG Chart tabs and retry, or reconnect to repair app files.'),20000);
  addEventListener('error',e=>{if(e.target?.tagName==='SCRIPT')report('A required app script did not load.');},true);
})();
