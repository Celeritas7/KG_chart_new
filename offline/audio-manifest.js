  // Adapted from Burmese Study's retryable catalog pattern. Keep the original
  // player, voices, speed controls and filename hashing shared with online KG.
  const manifestRuns = {};
  async function loadManifest(lang, force = false) {
    // U3C2B1: never load legacy public audio catalogs for a restricted or
    // unverified account when the future source-controlled gate is enabled.
    if (!canUsePublicMedia() || !lang || (!force && manifests[lang])) return;
    const run = manifestRuns[lang] = (manifestRuns[lang] || 0) + 1;
    const previous = manifests[lang];
    manifests[lang] = 'loading';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const url = `${BASE}/${lang}/clips.json`;
      const response = await window.KGOffline.readMedia(url) || await fetch(url, {cache:'no-cache',signal:controller.signal});
      if (!response.ok) throw Error('Audio catalog unavailable');
      const json = await response.json();
      if (!Array.isArray(json.m) || !Array.isArray(json.f) || [...json.m,...json.f].some(x=>! /^[a-f0-9]{8}$/.test(x))) throw Error('Invalid audio catalog');
      if (manifestRuns[lang] === run) { manifests[lang] = {m:new Set(json.m),f:new Set(json.f)}; emit(); }
    } catch (_) {
      if (manifestRuns[lang] === run) { manifests[lang] = previous && previous !== 'loading' ? previous : null; emit(); }
    } finally { clearTimeout(timeout); }
  }
  const retryCatalogs = () => Object.keys(manifests).filter(lang=>!manifests[lang]).forEach(lang=>loadManifest(lang));
  window.addEventListener('online',retryCatalogs);
  navigator.serviceWorker?.addEventListener('controllerchange',retryCatalogs);
  window.addEventListener('kg-pack-ready',event=>loadManifest(event.detail.lang,true));
  window.addEventListener('kg-account-locked',()=>{
    stop();
    Object.keys(manifests).forEach(lang=>{manifestRuns[lang]=(manifestRuns[lang]||0)+1;delete manifests[lang];});
    emit();
  });
