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

      const safeToReload = () => window.KGOffline?.canApplyShellUpdate?.() !== false;
      const offerReload = () => {
        window.KGOffline?.offerShellUpdate(async () => {
          if (!safeToReload()) throw Error('Finish the quiz, download or sync before reloading.');
          window.location.reload();
        });
        window.KGOffline?.notice('The new app version is active. Use Update app now to finish loading it.');
      };
      const requestVersion = () => {
        navigator.serviceWorker.controller?.postMessage({ type: 'KG_OFFLINE_GET_VERSION' });
      };
      const refreshOffer = () => {
        if (registration.waiting) offerWaitingUpdate();
        else if (activeRevision && window.KG_APP_VERSION && activeRevision !== window.KG_APP_VERSION) offerReload();
      };
      let activeRevision = null;
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.source !== navigator.serviceWorker.controller) return;
        if (!['KG_OFFLINE_VERSION', 'KG_OFFLINE_SHELL_READY'].includes(event.data?.type)) return;
        activeRevision = event.data.revision;
        refreshOffer();
        if (!registration.waiting && !registration.installing && activeRevision === window.KG_APP_VERSION)
          window.KGOffline?.notice('App update applied · ' + activeRevision);
      });

      const offerWaitingUpdate = () => {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        window.KGOffline?.offerShellUpdate(() => new Promise((resolve, reject) => {
          const waiting = registration.waiting;
          if (!waiting) { reject(Error('The update is no longer waiting. Check for an app update again.')); return; }
          if (!safeToReload()) {
            reject(Error('Finish the quiz, download or sync before applying the update.'));
            return;
          }

          const channel = new MessageChannel();
          let timeout;
          const cleanup = () => {
            clearTimeout(timeout);
            channel.port1.close();
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
          };
          const onControllerChange = () => {
            // Another release or tab may change the controller. Only this worker
            // completing activation satisfies the apply request.
            if (navigator.serviceWorker.controller !== waiting) return;
            cleanup();
            if (safeToReload()) window.location.reload();
            else offerReload();
            resolve();
          };
          channel.port1.onmessage = event => {
            if (event.data?.ok === false) {
              cleanup();
              reject(Error(event.data.error || 'The saved app update could not be activated.'));
            }
          };
          navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
          timeout = setTimeout(() => {
            cleanup();
            reject(Error('Update could not be activated. Close all KG Chart tabs and the installed app, then reopen while connected. Saved packs are kept.'));
          }, 60000);
          try { waiting.postMessage({ type: 'KG_OFFLINE_APPLY_UPDATE' }, [channel.port2]); }
          catch (e) { cleanup(); reject(e); }
        }));
      };

      manualCheck = async () => {
        await registration.update();
        if (registration.waiting) {
          offerWaitingUpdate();
          window.KGOffline?.notice('An app update is ready. See the update banner above Study offline for the next step.');
        } else if (registration.installing) {
          window.KGOffline?.notice('Downloading app update. Keep the app open; Update app now will appear when ready.');
        } else if (activeRevision && window.KG_APP_VERSION && activeRevision !== window.KG_APP_VERSION) {
          offerReload();
        } else {
          requestVersion();
          window.KGOffline?.notice('No new download was found. Checking the active app version…');
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
      navigator.serviceWorker.ready.then(() => { window.KGOffline?.tellWorker(); requestVersion(); });
      navigator.serviceWorker.addEventListener('controllerchange', () => { requestVersion(); refreshOffer(); });

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
