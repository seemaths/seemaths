/** Keep public See Maths routes on one origin while forwarding activity requests. */
const UPSTREAM_ORIGIN = 'https://psat.seemaths.org';
const LEGACY_HOSTS = new Set(['seemaths.com', 'www.seemaths.com']);
const MATHSPACE_HOST = 'mathspace.seemaths.org';
const PLAYER_HOST = 'player.seemaths.org';
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

async function handleRequest(request, env) {
    const incoming = new URL(request.url);
    const publicPath = incoming.pathname;
    if (LEGACY_HOSTS.has(incoming.hostname)) {
      return Response.redirect('https://seemaths.org/', 301);
    }
    const mathspaceHost = incoming.hostname === MATHSPACE_HOST;
    const arcadeHost = incoming.hostname === ARCADE_HOST;
    const playerHost = incoming.hostname === PLAYER_HOST;
    if (!mathspaceHost && incoming.pathname === '/favicon.ico') {incoming.pathname = '/favicon.svg';incoming.searchParams.set('v','division');}
    if ((arcadeHost || playerHost) && (publicPath === '/' || /^\/[0-9]{4}\/?$/.test(publicPath))) {
      const shell = new URL('/exercise-player', incoming);
      const response = await env.ASSETS.fetch(new Request(shell, request));
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, {status:response.status, headers});
    }
    if (env.STATIC_QUODES === 'true' &&
        (/^\/(?:manage|a)(?:\/|$)/.test(incoming.pathname) || /^\/(?:assignments|exercises)\/?$/.test(incoming.pathname) || incoming.pathname.startsWith('/assets/'))) {
      // The portal shell contains no student data; live progress stays in its API.
      const asset = new URL(incoming);
      if (!incoming.pathname.startsWith('/assets/')) asset.pathname='/assignment-dashboard/';
      return env.ASSETS.fetch(new Request(asset,request));
    }
    const portalPath = /^\/api\/assignments(?:\/|$)/.test(incoming.pathname)
      || /^\/(?:manage|a)(?:\/|$)/.test(incoming.pathname)
      || incoming.pathname === '/assignments' || incoming.pathname === '/api/config'
      || incoming.pathname.startsWith('/assets/');
    if (env.ASSIGNMENTS_ORIGIN && portalPath) {
      const target = new URL(incoming.pathname + incoming.search, env.ASSIGNMENTS_ORIGIN);
      const response = await fetch(new Request(target, request), {redirect:'manual'});
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, {status:response.status, headers});
    }
    if (arcadeHost && incoming.pathname === '/') incoming.pathname = '/arcade-player/';
    if (mathspaceHost) incoming.pathname = mathspaceRootPath(incoming.pathname);
    if (env.STATIC_QUODES === 'true') {
      // Static deployments never forward maths generation or browser files to
      // the old application host. Only the assignment APIs above use a server.
      if (incoming.pathname === '/api/client-events') return new Response(null,{status:204});
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return Response.json({detail:'Question generation runs in the browser.'},{status:405,headers:{Allow:'GET, HEAD'}});
      }
      const asset = new URL(incoming);
      if (asset.pathname === '/api/quode') asset.pathname='/api/quodes/'+encodeURIComponent(asset.searchParams.get('quode') || '');
      let response=await env.ASSETS.fetch(new Request(asset,request));
      if (mathspaceHost && response.ok && publicPath === '/') {
        response=new Response((await response.text()).replace('href="/mathspace-player/manifest.webmanifest"','href="/manifest.webmanifest"').replace('data-app="mathspace" defer','data-app="mathspace" data-scope="/" defer'),response);
        response.headers.delete('Content-Length');
      } else if (mathspaceHost && response.ok && publicPath === '/manifest.webmanifest') {
        response=Response.json({...await response.json(),id:'/',scope:'/',start_url:'/'});
      } else if (mathspaceHost && publicPath === '/service-worker.js') {
        response=new Response(response.body,response);response.headers.set('Service-Worker-Allowed','/');
      } else if (arcadeHost && response.ok && publicPath === '/') {
        response=new Response((await response.text()).replace('<head>','<head><base href="/arcade-player/">').replace("register('./sw.js')","register('./sw.js', {scope:'/'})"),response);
        response.headers.delete('Content-Length');
      }
      return response;
    }
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
    if (response.ok && /^\/play\/?$/.test(publicPath) && response.headers.get('Content-Type')?.includes('text/html')) {
      body = (await response.text())
        .replace(/(<script\s+type="module"\s+src=")\/runtime\/seemaths-player\.js(\")/, env.ASSIGNMENTS_ORIGIN ? '$1/student-player.js?v=19$2' : '$&')
        .replace('<p role="status">Opening your activity…</p>', '<div class="seemaths-opening"><div class="paper-loading-progress"><div class="paper-progress-track paper-progress-indeterminate" role="progressbar" aria-label="Loading activity"><div class="paper-progress-fill"></div></div></div></div>')
        .replace('</head>', '<link rel="stylesheet" href="/student-session.css?v=13"><link rel="stylesheet" href="/seemaths-brand.css?v=1"></head>');
      responseHeaders.delete('Content-Length');
      responseHeaders.delete('Content-Encoding');
      responseHeaders.set('Cache-Control', 'no-store');
    } else if (env.ASSIGNMENTS_ORIGIN && response.ok && publicPath === '/runtime/seemaths-attempts.js') {
      body = (await response.text()).replace(
        "export const putAttempt = attempt => transaction('readwrite', store => store.put(cloneData({...attempt, updatedAt:Date.now()})));",
        "export const putAttempt = attempt => transaction('readwrite', store => store.put(cloneData({...attempt, updatedAt:Date.now()}))).then(value => { window.dispatchEvent(new CustomEvent('seemaths:attempt-saved', {detail:{id:attempt.id}})); return value; });"
      );
      responseHeaders.delete('Content-Length');
      responseHeaders.delete('Content-Encoding');
      responseHeaders.set('Cache-Control', 'no-store');
    } else if (arcadeHost && response.ok && publicPath === '/') {
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
}

export default {
  async fetch(request, env) {
    const response = await handleRequest(request, env);
    const result = new Response(response.body, response);
    // Direct static-asset responses bypass this code and do not carry this header.
    result.headers.set('X-SeeMaths-Routing', 'worker');
    return result;
  },
};
