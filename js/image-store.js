/* Public vocabulary pictures only. No auth tokens, lesson records or user progress. */
(function (root) {
  const CACHE = 'kg-chart-pictures-v1'; // Stable across app/service-worker upgrades.
  const PREFIX = 'https://ulgrfumbwjovbjzjiems.supabase.co/storage/v1/object/public/vocabulary-assets/';
  function key(value) {
    try {
      const url = new URL(value);
      if (!url.href.startsWith(PREFIX)) return null;
      url.searchParams.delete('kg_retry');
      url.searchParams.delete('kg_sync');
      return url.href;
    } catch (_) { return null; }
  }
  async function save(url, signal, refresh) {
    const cache = await caches.open(CACHE);
    const canonical = key(url);
    if (!canonical) throw new Error('Unsupported picture source');
    const old = await cache.match(canonical);
    if (old && !refresh) return true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 30000);
    try {
      // Revalidate unchanged URLs against the server, including replaced images.
      const response = await fetch(canonical, { mode: 'cors', credentials: 'omit', cache: 'no-cache', signal: controller.signal });
      if (!response.ok) throw new Error('Picture request failed (' + response.status + ')');
      const blob = await response.blob();
      if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Invalid picture');
      // Never replace a working copy with an undecodable upload or error page.
      const bitmap = await createImageBitmap(blob); bitmap.close();
      if (signal?.aborted) throw new Error('Download paused');
      const headers = new Headers(response.headers);
      headers.set('Content-Type', blob.type);
      headers.set('X-KG-Saved-At', String(Date.now()));
      headers.set('X-KG-Bytes', String(blob.size));
      headers.delete('Content-Encoding'); headers.delete('Content-Length');
      await cache.put(canonical, new Response(blob, { status: 200, headers }));
      return true;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  }
  root.KGPictureStore = { CACHE, PREFIX, key, save };
})(typeof self !== 'undefined' ? self : window);
