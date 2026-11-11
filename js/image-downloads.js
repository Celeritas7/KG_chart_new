(function () {
  const store = window.KGPictureStore;
  const META = 'kg-picture-download-settings-v1';
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(META) || '{}'); } catch (_) {}
  const persist = () => { try { localStorage.setItem(META, JSON.stringify(settings)); } catch (_) {} };
  const listeners = new Set();
  let state = { busy: false, done: 0, total: 0, failed: 0, message: '', lastSync: settings.lastSync || 0 };
  let controller;
  const emit = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); };
  const normalize = urls => [...new Set(urls.map(store.key).filter(Boolean))];
  async function stats(urls) {
    const cache = await caches.open(store.CACHE);
    let saved = 0, bytes = 0;
    for (const url of normalize(urls)) {
      const response = await cache.match(url);
      if (response) { saved++; bytes += Number(response.headers.get('X-KG-Bytes')) || (await response.blob()).size; }
    }
    return { saved, total: normalize(urls).length, bytes };
  }
  async function ready() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) throw new Error('Picture downloads need a secure browser connection.');
    await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    // Check the actual controlling worker, not merely registration success.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const worker = navigator.serviceWorker.controller;
      if (worker) {
        const ok = await new Promise(resolve => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 700);
          channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data === 'kg-pictures-v1'); };
          worker.postMessage({ type: 'KG_PICTURES_READY' }, [channel.port2]);
        });
        if (ok) return;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('The image update is still installing. Reopen the app and try again.');
  }
  async function download(urls, refresh = false) {
    if (state.busy) return;
    const list = normalize(urls);
    controller = new AbortController();
    emit({ busy: true, done: 0, total: list.length, failed: 0, message: 'Preparing picture storage…' });
    try {
      await ready();
      if (!list.length) { emit({ message: 'No downloadable Supabase pictures in this selection.' }); return; }
      await navigator.storage?.persist?.().catch(() => false);
      let cursor = 0, failed = 0, done = 0;
      emit({ message: refresh ? 'Checking saved pictures for updates…' : 'Downloading missing pictures…' });
      await Promise.all(Array.from({ length: Math.min(3, list.length) }, async () => {
        while (!controller.signal.aborted && cursor < list.length) {
          const url = list[cursor++];
          try { await store.save(url, controller.signal, refresh); }
          catch (error) {
            if (!controller.signal.aborted) failed++;
            if (error.name === 'QuotaExceededError') { controller.abort(); emit({ message: 'Device storage is full. Saved pictures are kept.' }); }
          }
          done++; emit({ done, failed });
        }
      }));
      if (controller.signal.aborted) {
        if (!state.message.includes('storage is full')) emit({ message: 'Paused. Download again to resume; saved pictures are kept.' });
      } else if (failed) emit({ message: failed + ' pictures could not update. Existing saved copies are kept; try again on Wi-Fi.' });
      else {
        settings.lastSync = Date.now(); persist();
        emit({ lastSync: settings.lastSync, message: 'Pictures ready on this device.' });
      }
    } catch (error) { emit({ message: error.message || 'Download failed. Try again.' }); }
    finally { emit({ busy: false }); }
  }
  window.KGImageDownloads = {
    stats, download, ready, normalize,
    pause: () => controller?.abort(),
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    autoEnabled: () => !!settings.auto,
    setAuto(value) { settings.auto = value; persist(); },
    async auto(urls) {
      const connection = navigator.connection;
      // Never infer Wi-Fi from effectiveType='4g'. Unknown/metered networks require a manual sync.
      if (!settings.auto || !navigator.onLine || document.hidden || state.busy || connection?.saveData || !['wifi','ethernet'].includes(connection?.type)) return;
      if (Date.now() - (settings.autoAttempt || 0) < 86400000) return;
      settings.autoAttempt = Date.now(); persist();
      await download(urls, true);
    }
  };
})();
