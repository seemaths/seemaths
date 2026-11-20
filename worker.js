/** Keep public See Maths routes on one origin while forwarding activity requests. */
const UPSTREAM_ORIGIN = 'https://psat.seemaths.org';
const LEGACY_HOSTS = new Set(['seemaths.com', 'www.seemaths.com']);
const MATHSPACE_HOST = 'mathspace.seemaths.org';
const ARCADE_HOST = 'arcade.seemaths.org';
const GENERATOR_ASSET = /^\/(?:algebra|arithmetic|geometry|measurement|number|statistics)-[a-z0-9_]+\/(?:web|player)\/.+/;

const GENERATOR_ACTIVITY = /^\/(?:algebra|arithmetic|geometry|measurement|number|statistics)-[a-z0-9_]+\/(?:practice|exam|print)\/?$/;

function isProxyPath(pathname) {
  // Never pass encoded path separators or traversal to the upstream application.
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  if (decoded.includes('\\') || decoded.split('/').some(part => part === '.' || part === '..')) return false;
  if (decoded !== pathname && /%2f|%5c|%25/i.test(pathname)) return false;
  return pathname === '/play' || pathname === '/play/'
    || ['/api/', '/runtime/', '/seemaths-assets/'].some(prefix => pathname.startsWith(prefix))
    || pathname === '/mathspace-player' || pathname.startsWith('/mathspace-player/')
    || pathname === '/arcade-player' || pathname.startsWith('/arcade-player/')
    || GENERATOR_ASSET.test(pathname) || GENERATOR_ACTIVITY.test(pathname);
}

function mathspaceRootPath(pathname) {
  return ({
    '/': '/mathspace-player/',
    '/manifest.webmanifest': '/mathspace-player/manifest.webmanifest',
    '/service-worker.js': '/mathspace-player/service-worker.js',
    '/favicon.ico': '/mathspace-player/assets/icon.svg',
  })[pathname] || pathname;
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const publicPath = incoming.pathname;
    if (LEGACY_HOSTS.has(incoming.hostname)) {
      return Response.redirect('https://seemaths.org/', 301);
    }
    const mathspaceHost = incoming.hostname === MATHSPACE_HOST;
    const arcadeHost = incoming.hostname === ARCADE_HOST;
    if (arcadeHost && incoming.pathname === '/') incoming.pathname = '/arcade-player/';
    if (mathspaceHost) incoming.pathname = mathspaceRootPath(incoming.pathname);
    if (!isProxyPath(incoming.pathname)) return env.ASSETS.fetch(request);

    const backendOrigin = new URL(env.BACKEND_ORIGIN || UPSTREAM_ORIGIN).origin;
    const upstream = new URL(incoming.pathname + incoming.search, backendOrigin);
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('X-Seemaths-Proxy', '1');
    headers.set('X-Forwarded-Host', incoming.host);
    headers.set('X-Forwarded-Proto', incoming.protocol.slice(0, -1));
    const forwarded = new Request(upstream.href, new Request(request, { headers }));
    const dynamic = incoming.pathname.startsWith('/api/') || GENERATOR_ACTIVITY.test(incoming.pathname);
    let response;
    try {
      response = await fetch(forwarded, {
        redirect: 'manual',
        ...(dynamic ? { cf: { cacheTtl: 0, cacheEverything: false } } : {}),
      });
    } catch {
      return Response.json({detail: 'The activity service is temporarily unavailable. Please try again.'}, {status: 502, headers: {'Cache-Control': 'no-store'}});
    }
    const responseHeaders = new Headers(response.headers);
    if (dynamic) {
      responseHeaders.set('Cache-Control', 'no-store');
      responseHeaders.delete('CDN-Cache-Control');
      responseHeaders.delete('Cloudflare-CDN-Cache-Control');
    }
    // A backend canonical-path redirect must stay on the public See Maths origin.
    const location = responseHeaders.get('Location');
    if (location) {
      const target = new URL(location, upstream);
      if (target.origin === backendOrigin) {
        target.host = incoming.host;
        target.protocol = incoming.protocol;
        responseHeaders.set('Location', target.href);
      }
    }
    let body = response.body;
    if (arcadeHost && response.ok && publicPath === '/') {
      body = (await response.text()).replace('<head>', '<head><base href="/arcade-player/">');
      responseHeaders.delete('Content-Length');
    } else if (mathspaceHost && response.ok && publicPath === '/') {
      body = (await response.text())
        .replace('href="/mathspace-player/manifest.webmanifest"', 'href="/manifest.webmanifest"')
        .replace('data-app="mathspace" defer', 'data-app="mathspace" data-scope="/" defer');
      responseHeaders.delete('Content-Length');
    } else if (mathspaceHost && response.ok && publicPath === '/manifest.webmanifest') {
      const manifest = await response.json();
      Object.assign(manifest, {id: '/', scope: '/', start_url: '/'});
      body = JSON.stringify(manifest);
      responseHeaders.delete('Content-Length');
    } else if (mathspaceHost && publicPath === '/service-worker.js') {
      responseHeaders.set('Service-Worker-Allowed', '/');
    }
    return new Response(body, {status: response.status, statusText: response.statusText, headers: responseHeaders});
  },
};
