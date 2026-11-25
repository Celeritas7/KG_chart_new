// KG Chart - Phase 9: native audio player (pre-generated Azure clips in Supabase Storage).
// Plain JS, no build step. Loaded by index.html before the app script. Exposes window.KGAudio.
// File names must match tools/gen_kg_audio.py: FNV-1a 32-bit over UTF-8 of the normalised text.
(function () {
  const BASE = 'https://ulgrfumbwjovbjzjiems.supabase.co/storage/v1/object/public/vocabulary-assets/audio';
  const PREFS_KEY = 'kg_chart_audio_prefs';
  const SLOW_RATE = 0.7;

  const norm = (t) => (t || '').normalize('NFC').trim().split(/\s+/).filter(Boolean).join(' ');
  const enc = new TextEncoder();
  function hash(text) {
    let h = 0x811c9dc5;
    for (const b of enc.encode(norm(text))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  const listeners = new Set();
  let version = 0;
  const emit = () => { version++; listeners.forEach(fn => fn()); };

  // ---- prefs: voice m/f + mute (account row, localStorage mirror for first paint) ----
  let prefs = { voice: 'f', muted: false };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch (e) {}
  let sb = null, userId = null;

  // U3C2B1: installed sources remain legacy until the separate U3D/U4
  // production gate is deliberately enabled. Unknown policy = no public
  // media under that gate; restricted requests must carry a real source ID.
  let mediaGate = false, verifiedMediaAccess = null, protectedAttempt = 0;
  let protectedPlayback = null;
  let offlineLease = null;
  function canUsePublicMedia() {
    return !mediaGate || verifiedMediaAccess?.policy?.state === 'legacy';
  }
  function isProtectedMedia() {
    return mediaGate && verifiedMediaAccess?.policy?.state === 'restricted';
  }
  function requireVerifiedMediaPolicy(enabled) {
    mediaGate = enabled === true;
    verifiedMediaAccess = null;
    stop();
  }
  function setVerifiedMediaPolicy(access) {
    stop(); // Cancel in-flight signer and playback on account/policy change.
    verifiedMediaAccess = null;
    if (!mediaGate || !access || !access.ownerId || !access.supabase ||
        !access.projectUrl || !['legacy','restricted'].includes(access.policy?.state))
      return;
    // This is a UX snapshot, not authority; each source is rechecked by SQL
    // and Edge. Never write signed URLs or access data to localStorage.
    verifiedMediaAccess = { ...access };
    emit();
  }

  async function initPrefs(client, uid) {
    if (userId && userId !== uid) { verifiedMediaAccess = null; stop(); }
    sb = client; userId = uid;
    if (!sb || !uid) return;
    const { data, error } = await sb.from('kg_chart_user_prefs').select('audio_voice, audio_muted').eq('user_id', uid).maybeSingle();
    if (error) { console.warn('KGAudio: prefs table not available, using this device only.', error.message); return; }
    if (data) setPrefsLocal({ voice: data.audio_voice === 'm' ? 'm' : 'f', muted: !!data.audio_muted });
  }
  function setPrefsLocal(p) {
    prefs = { ...prefs, ...p };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
    emit();
  }
  async function setPrefs(p) {
    setPrefsLocal(p);
    if (!sb || !userId) return;
    const { error } = await sb.from('kg_chart_user_prefs').upsert({
      user_id: userId, audio_voice: prefs.voice, audio_muted: prefs.muted, updated_at: new Date().toISOString(),
    });
    if (error) console.warn('KGAudio: could not save prefs to account.', error.message);
  }

  // ---- manifests: audio/<lang>/clips.json -> { m: [hash], f: [hash] } ----
  const manifests = {};   // lang -> { m:Set, f:Set } | null (no audio) | 'loading'
  function loadManifest(lang) {
    if (!canUsePublicMedia() || !lang || manifests[lang] !== undefined) return;
    manifests[lang] = 'loading';
    fetch(`${BASE}/${lang}/clips.json`, { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { manifests[lang] = j ? { m: new Set(j.m || []), f: new Set(j.f || []) } : null; emit(); })
      .catch(() => { manifests[lang] = null; emit(); });
  }

  // Which clip to play: the asked-for voice (conversations: A and B), else the preferred voice, else the other one, else none.
  function resolve(text, lang, voice) {
    const m = manifests[lang];
    if (!m || m === 'loading' || !norm(text)) return null;
    const h = hash(text);
    const first = voice === 'm' || voice === 'f' ? voice : prefs.voice;
    const order = first === 'm' ? ['m', 'f'] : ['f', 'm'];
    const g = order.find(v => m[v].has(h));
    return g ? `${BASE}/${lang}/${g}/${h}.mp3` : null;
  }
  // 'loading' while the manifest is on its way, true/false after
  function has(text, lang, resource) {
    if (!canUsePublicMedia()) {
      // No public hash-manifest lookup under a restricted/unknown policy.
      // Client-side filtering improves UX only; the live signer and database
      // always reauthorize the actual source before delivering bytes.
      if (!isProtectedMedia() || !norm(text) || resource?.language !== lang)
        return false;
      const p = verifiedMediaAccess.policy;
      if (!p?.languages?.includes(lang)) return false;
      if (resource.type === 'word_audio' || resource.type === 'topic_audio') {
        if (!p.topics?.includes(lang + '|' + resource.topicId)) return false;
        if (resource.type === 'word_audio' &&
            !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(resource.id || '')))
          return false;
        return true;
      }
      if (resource.type === 'sentence_audio') {
        return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(resource.id || '')) &&
          verifiedMediaAccess.sentenceScope?.state === 'restricted' &&
          verifiedMediaAccess.sentenceScope.serverEnforced === true &&
          verifiedMediaAccess.sentenceScope.groups?.includes(resource.groupName);
      }
      if (resource.type === 'colour_audio') {
        return p.features?.includes('quiz.colours') &&
          /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(resource.id || ''));
      }
      return false;
    }
    const m = manifests[lang];
    if (m === undefined || m === 'loading') return 'loading';
    return !!resolve(text, lang);
  }

  // ---- playback: one shared <audio>, so a new tap stops the previous clip ----
  const audio = new Audio();
  audio.preload = 'auto';
  let current = null;     // { key, state: 'loading' | 'playing' }
  const keyOf = (text, lang, slow, resource) => {
    const base = `${lang}|${norm(text)}|${slow ? 's' : 'n'}`;
    return isProtectedMedia() ? base + '|' + JSON.stringify([
      resource?.type, resource?.language, resource?.id || null,
      resource?.topicId || null, resource?.groupName || null,
      resource?.voice || null,
    ]) : base;
  };
  const setCurrent = (c) => { current = c; emit(); };
  audio.addEventListener('playing', () => { if (current) setCurrent({ ...current, state: 'playing' }); });
  audio.addEventListener('ended', () => { if (isProtectedMedia()) stop(); else setCurrent(null); });
  audio.addEventListener('pause', () => { if (current && current.state === 'playing') setCurrent(null); });
  audio.addEventListener('error', () => {
    if (!current) return;
    const p = protectedPlayback;
    if (isProtectedMedia() && p && p.key === current.key && p.retries === 0 &&
        !(typeof navigator !== 'undefined' && navigator.onLine === false) &&
        !offlineLease) {
      // Audio elements may perform a later byte-range request after a 30 s
      // signed token expires. Reauthorize this exact source ONE time only.
      p.retries = 1;
      const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      setCurrent({ key: p.key, state: 'loading' });
      startProtectedPlayback(p, position);
      return;
    }
    if (isProtectedMedia()) { stop(); toast('Protected audio unavailable. Tap to try again.'); }
    else { setCurrent(null); toast("Couldn't play this clip"); }
  });

  function startProtectedPlayback(context, resumeAt = 0) {
    const { attempt, key, resource, access, slow, silent } = context;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    // Private offline media is never requested through a URL to the worker.
    // It comes from the account-verified CacheStorage reader as a blob lease.
    async function locate() {
      if (attempt !== protectedAttempt || current?.key !== key) return null;
      if (offline) {
        const read = window.KGOffline?.readPrivateMedia;
        if (typeof read !== 'function') return null; // NO public fallback
        const lease = await read(resource);
        if (attempt !== protectedAttempt || current?.key !== key) {
          lease?.release?.();return null;
        }
        if (!lease || lease.contentType !== 'audio/mpeg' ||
            typeof lease.url !== 'string' || !lease.url.startsWith('blob:')) {
          lease?.release?.();return null;
        }
        offlineLease = lease;
        return lease.url;
      }
      const { acquireProtectedMedia } = await import('./kg-protected-player.mjs');
      if (attempt !== protectedAttempt || current?.key !== key) return null;
      return acquireProtectedMedia({
        kind: 'audio', resource, policy: access.policy,
        sentenceScope: access.sentenceScope, supabase: access.supabase,
        projectUrl: access.projectUrl,
      });
    }
    Promise.resolve().then(locate)
      .then(url => {
        if (attempt !== protectedAttempt || current?.key !== key) return;
        if (!url) {
          stop();
          if (!silent) toast('Protected audio unavailable');
          return;
        }
        audio.src = url;
        audio.playbackRate = slow ? SLOW_RATE : 1;
        audio.defaultPlaybackRate = audio.playbackRate;
        if ('preservesPitch' in audio) audio.preservesPitch = true;
        try { audio.currentTime = resumeAt; } catch (_) {}
        const playback = audio.play();
        if (playback?.catch) playback.catch(error => {
          if (attempt !== protectedAttempt || error?.name === 'AbortError') return;
          stop();
          if (error?.name === 'NotAllowedError')
            toast('Tap 🔊 again to start protected audio');
          else if (!silent) toast("Couldn't play protected audio");
        });
      })
      .catch(() => {
        if (attempt !== protectedAttempt) return;
        stop();
        if (!silent) toast('Protected audio unavailable');
      });
  }

  function play(text, lang, opts) {
    const slow = !!(opts && opts.slow);
    if (!canUsePublicMedia()) {
      const access = verifiedMediaAccess;
      if (!isProtectedMedia() || !opts?.resource ||
          opts.resource.language !== lang || !norm(text)) {
        if (!opts?.silent) toast('Protected audio unavailable');
        return false;
      }
      const voice = ['m','f'].includes(opts.voice) ? opts.voice : prefs.voice;
      const resource = { ...opts.resource, voice };
      const key = keyOf(text, lang, slow, resource);
      if (current?.key === key) { stop(); return true; }
      stop();
      const attempt = ++protectedAttempt;
      setCurrent({ key, state: 'loading' });
      // Signed URLs are never cached. A late or revoked request cannot resume
      // playback after switching language, identity or access revision.
      protectedPlayback = { attempt, key, resource, access, slow,
        silent: !!opts?.silent, retries: 0 };
      startProtectedPlayback(protectedPlayback);
      return true;
    }
    const url = resolve(text, lang, opts && opts.voice);
    if (!url) { if (!(opts && opts.silent)) toast('No audio for this yet'); return false; }
    const key = keyOf(text, lang, slow);
    if (current && current.key === key) { audio.pause(); audio.currentTime = 0; setCurrent(null); return true; }
    audio.pause();
    setCurrent({ key, state: 'loading' });
    if (audio.src !== url) audio.src = url;
    audio.currentTime = 0;
    audio.playbackRate = slow ? SLOW_RATE : 1;
    audio.defaultPlaybackRate = audio.playbackRate;
    if ('preservesPitch' in audio) audio.preservesPitch = true;
    const p = audio.play();
    if (p && p.catch) p.catch(err => { if (err && err.name !== 'AbortError') { setCurrent(null); toast("Couldn't play audio"); } });
    return true;
  }
  // Used after answering: respects mute, never shows a toast
  function autoPlay(text, lang, voice, resource) {
    if (!prefs.muted) play(text, lang, { silent: true, voice, resource });
  }
  function stop() {
    ++protectedAttempt;
    protectedPlayback = null;
    audio.pause();
    if (mediaGate && (audio.src?.startsWith('blob:') ||
        audio.src?.includes('/object/sign/kg-chart-private-media/'))) {
      audio.removeAttribute('src');
      audio.load();
    }
    offlineLease?.release?.();
    offlineLease = null;
    setCurrent(null);
  }
  function stateOf(text, lang, slow, resource) {
    return current && current.key === keyOf(text, lang, slow, resource) ? current.state : null;
  }

  // ---- tiny toast ----
  let toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1f2937;color:#fff;padding:10px 18px;border-radius:999px;font:500 14px "DM Sans",sans-serif;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.25);transition:opacity .2s;pointer-events:none';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 1800);
  }

  window.KGAudio = {
    hash, norm, loadManifest, has, play, autoPlay, stop, stateOf, initPrefs, setPrefs, toast,
    requireVerifiedMediaPolicy, setVerifiedMediaPolicy,
    canUsePublicMedia, isProtectedMedia,
    get prefs() { return prefs; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getVersion() { return version; },
  };
})();
