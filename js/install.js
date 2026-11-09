(() => {
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  let deferred;
  const button = document.createElement('button');
  button.textContent = 'Install KG Chart';
  button.hidden = true;
  button.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;padding:12px 18px;border:0;border-radius:14px;background:#00695c;color:white;font-weight:bold;box-shadow:0 3px 12px #0003;cursor:pointer';
  document.body.appendChild(button);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event; button.hidden = false; });
  button.addEventListener('click', async () => { if (!deferred) return; const prompt = deferred; deferred = null; button.hidden = true; await prompt.prompt(); await prompt.userChoice; });
  window.addEventListener('appinstalled', () => { deferred = null; button.hidden = true; });
})();
