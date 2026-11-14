(() => {
  if (!('serviceWorker' in navigator)) {
    window.KGOffline?.notice('This browser does not support offline installation (service workers).');
    return;
  }
  // Updates are NOT force-activated; the user chooses when to reload, after leaving a quiz.
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      if (registration.waiting) window.KGOffline?.notice('A new app version is ready. Finish your quiz before updating.');
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller)
            window.KGOffline?.notice('App update downloaded. Reopen the app after finishing your quiz to apply it.');
        });
      });
      navigator.serviceWorker.ready.then(() => window.KGOffline?.tellWorker());
    } catch (e) { window.KGOffline?.notice('Offline installation failed: ' + e.message); }
  });
})();
