// Adds Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy to every response the page loads, so that a page served WITHOUT those headers becomes
// cross-origin isolated (SharedArrayBuffer, the multi-core rigidDNA2 WebAssembly build). Registered on request by rd2EnableIsolation() in ts/editing/rigiddna2_ui.ts
// (the page reloads once). Same idea as the coi-serviceworker project (MIT); written for this viewer. Uses credentialless COEP, so the CDN scripts of
// index.html keep loading; browsers without it (Safari) stay on the single-thread build.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  e.respondWith(fetch(r).then((res) => {
    if (res.status === 0) return res;
    const h = new Headers(res.headers);
    h.set('Cross-Origin-Embedder-Policy', 'credentialless');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }).catch((err) => { console.error(err); return Response.error(); }));
});
