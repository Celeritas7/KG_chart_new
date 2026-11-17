/* KG Chart Offline app-shell updates. Only the learner may approve a reload. */
(() => {
  if (!('serviceWorker' in navigator)) {
    window.KGOffline?.notice('This browser does not support offline installation (service workers).');
    return;
  }

  let manualCheck = null, checking = false;
  window.KGCheckAppUpdate = async () => {
    const notice = text => window.KGOffline?.notice(text);
    if (!navigator.onLine) return notice('Connect to the internet to check for an app update.');
    if (!manualCheck) return notice('App updater is not ready. Reopen while connected and try again.');
    if (checking) return notice('Already checking for an app update…');
    checking = true;
    notice('Checking for an app update…');
    let timer;
    try {
      await Promise.race([manualCheck(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Update check timed out. Try again while connected.')), 20000);
      })]);
    } catch(e) { notice('Could not check for an app update: ' + e.message); }
    finally { clearTimeout(timer); checking = false; }
  };

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

      manualCheck = async () => {
        await registration.update();
        if (registration.waiting) {
          offerWaitingUpdate();
          window.KGOffline?.notice('An app update is ready. Use Update app now when you have finished studying.');
        } else if (registration.installing) {
          window.KGOffline?.notice('Downloading app update. Keep the app open; Update app now will appear when ready.');
        } else {
          window.KGOffline?.notice('No new app update was found.');
        }
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
