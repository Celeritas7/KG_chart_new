/* Phase 1 shell gate. No offline-user authorization or lesson packs yet:
   never show cached login state as if it were authorized offline access. */
(function () {
  const status = document.getElementById('kg-boot-status');
  const retry = document.getElementById('kg-boot-retry');
  const root = document.getElementById('root');
  let loading = false;

  function show(title, detail, allowRetry = true) {
    status.hidden = false;
    status.querySelector('h1').textContent = title;
    status.querySelector('p').textContent = detail;
    retry.hidden = !allowRetry;
  }

  function loadApp() {
    if (loading) return;
    if (!navigator.onLine) {
      show('Connect to finish setup',
        'This development edition has a locally installed app shell, but does not yet have verified offline lessons, quizzes or account-bound progress. Existing saved data is untouched.');
      return;
    }
    loading = true;
    show('Opening KG Chart Offline', 'Signing in and learning still need an internet connection in this phase.', false);
    const observer = new MutationObserver(() => {
      if (root.firstElementChild) { status.hidden = true; observer.disconnect(); }
    });
    observer.observe(root, { childList: true });
    const app = document.createElement('script');
    app.src = './app.js';
    app.onerror = () => {
      observer.disconnect();
      loading = false;
      show('App could not start', 'The app code could not load from this device. Reconnect, then retry.');
    };
    document.body.appendChild(app);
  }

  retry.addEventListener('click', loadApp);
  window.addEventListener('online', loadApp);
  window.addEventListener('error', event => {
    if (!root.firstElementChild) {
      show('Startup error', 'The local app failed to start: ' + (event.message || 'unknown error') + '. Try again when connected.');
    }
  });
  if ('serviceWorker' in navigator) {
    // Register asynchronously. A stalled update check must not block startup.
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .catch(error => console.warn('Offline shell installation failed:', error));
  }
  loadApp();
})();
