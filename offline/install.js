/* KG Chart Offline app-shell updates. Only the learner may approve a reload. */
(() => {
  if (!('serviceWorker' in navigator)) {
    window.KGOffline?.notice('This browser does not support offline installation (service workers).');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });

      const offerWaitingUpdate = () => {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        window.KGOffline?.offerShellUpdate(() => new Promise((resolve, reject) => {
          const waiting = registration.waiting;
          if (!waiting) { reject(Error('The update is no longer waiting. Reopen the app when ready.')); return; }
          if (window.KGOffline?.canApplyShellUpdate?.() === false) {
            reject(Error('Finish the quiz, download or sync before applying the update.'));
            return;
          }

          let timeout;
          const cleanup = () => {
            clearTimeout(timeout);
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
          };
          const onControllerChange = () => {
            cleanup();
            // A quiz could have opened during activation. Never reload it.
            if (window.KGOffline?.canApplyShellUpdate?.() === false)
              window.KGOffline?.notice('The app update is installed. Leave the quiz and reopen when ready.');
            else window.location.reload();
            resolve();
          };
          navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
          timeout = setTimeout(() => {
            cleanup();
            reject(Error('Update could not be activated. Your saved work is safe; retry when connected.'));
          }, 15000);
          try { waiting.postMessage({ type: 'KG_OFFLINE_APPLY_UPDATE' }); }
          catch (e) { cleanup(); reject(e); }
        }));
      };

      offerWaitingUpdate();
      const watched = new WeakSet();
      const watchInstalling = worker => {
        if (!worker || watched.has(worker)) return;
        watched.add(worker);
        const check = () => {
          if (worker.state === 'installed') offerWaitingUpdate();
        };
        worker.addEventListener('statechange', check);
        check();
      };
      registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
      watchInstalling(registration.installing); // May have started before register() returned.
      navigator.serviceWorker.ready.then(() => window.KGOffline?.tellWorker());

      // A connected visit should discover new builds without asking the user to
      // hard-refresh. Offline cold starts do not depend on this request.
      const checkForUpdates = () => {
        if (navigator.onLine) registration.update().catch(() => {});
      };
      checkForUpdates();
      window.addEventListener('online', checkForUpdates);
    } catch (e) { window.KGOffline?.notice('Offline installation failed: ' + e.message); }
  });
})();
