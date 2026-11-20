import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

function assets() {
  const calls = [];
  return {calls, env:{ASSETS:{fetch:async request => { calls.push(request); return new Response('static asset'); }}}};
}

test('assignment APIs route to the portal while play receives the student session module', async () => {
  const {env}=assets();env.ASSIGNMENTS_ORIGIN='https://assignments.example';
  await withFetch(async (request, options) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/assignments') {
      assert.equal(url.origin,'https://assignments.example');
      assert.equal(request.headers.get('Authorization'),'Bearer example');
      assert.equal(options.redirect,'manual');
      return Response.json({id:'example'});
    }
    assert.equal(url.origin,'https://psat.seemaths.org');
    return new Response('<html><head><script type="module" src="/runtime/seemaths-player.js"></script></head><body><main id="app"><p role="status">Opening your activity…</p></main></body></html>', {headers:{'Content-Type':'text/html'}});
  }, async () => {
    const api = await worker.fetch(new Request('https://seemaths.org/api/assignments',{headers:{Authorization:'Bearer example'}}),env);
    assert.equal(api.headers.get('Cache-Control'),'no-store');
    const page = await worker.fetch(new Request('https://seemaths.org/play?mode=practice'),env);
    const html = await page.text();
    assert.match(html,/student-player\.js/);assert.match(html,/student-session\.css/);
    assert.match(html,/role="progressbar" aria-label="Loading activity"/);
    assert.doesNotMatch(html,/Opening your activity/);
  });
});

test('Arcade domain opens its player with relative assets on the same host', async () => {
  const {env,calls}=assets();
  await withFetch(async request => {
    assert.equal(new URL(request.url).pathname, '/arcade-player/');
    assert.equal(new URL(request.url).search, '?from=seemaths');
    return new Response('<html><head></head><body>Arcade</body></html>');
  }, async () => {
    const response=await worker.fetch(new Request('https://arcade.seemaths.org/?from=seemaths'),env);
    assert.match(await response.text(), /<base href="\/arcade-player\/">/);
  });
  assert.equal(calls.length,0);
});

async function withFetch(mock, action) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { await action(); } finally { globalThis.fetch = previous; }
}

test('homepage and non-application paths use static assets', async () => {
  const {calls,env} = assets();
  await withFetch(() => { throw new Error('Unexpected upstream call'); }, async () => {
    for (const path of ['/', '/styles.css', '/script.js', '/unknown', '/https://other.example/']) {
      assert.equal(await (await worker.fetch(new Request(`https://seemaths.org${path}`),env)).text(),'static asset');
    }
  });
  assert.equal(calls.length,5);
});

test('Math Space custom domain serves the independent player at its root', async () => {
  const {calls,env}=assets();
  const expected=new Map([
    ['/','/mathspace-player/'],
    ['/manifest.webmanifest','/mathspace-player/manifest.webmanifest'],
    ['/service-worker.js','/mathspace-player/service-worker.js'],
    ['/favicon.ico','/mathspace-player/assets/icon.svg'],
  ]);
  await withFetch(async request => {
    const incoming=new URL(request.url);
    assert.equal(incoming.origin,'https://psat.seemaths.org');
    assert.equal(incoming.pathname,expected.get(new URL(request.headers.get('X-Original-URL') || 'https://mathspace.seemaths.org/').pathname) || incoming.pathname);
    if (incoming.pathname === '/mathspace-player/') {
      return new Response('<link rel="manifest" href="/mathspace-player/manifest.webmanifest"><script data-app="mathspace" defer></script>',{headers:{'Content-Type':'text/html'}});
    }
    if (incoming.pathname.endsWith('/manifest.webmanifest')) {
      return Response.json({name:'Math Space',id:'/mathspace-player/',scope:'/mathspace-player/',start_url:'/mathspace-player/'});
    }
    if (incoming.pathname.endsWith('/service-worker.js')) {
      return new Response('worker',{headers:{'Service-Worker-Allowed':'/mathspace-player/'}});
    }
    return new Response('mathspace');
  },async () => {
    for (const [publicPath,upstreamPath] of expected) {
      const response=await worker.fetch(new Request(`https://mathspace.seemaths.org${publicPath}`,{headers:{'X-Original-URL':`https://mathspace.seemaths.org${publicPath}`}}),env);
      if (publicPath === '/') {
        const page=await response.text();
        assert.match(page,/href="\/manifest\.webmanifest"/);
        assert.match(page,/data-app="mathspace" data-scope="\/"/);
      } else if (publicPath === '/manifest.webmanifest') {
        const manifest=await response.json();
        assert.deepEqual([manifest.id,manifest.scope,manifest.start_url],['/','/','/']);
      } else if (publicPath === '/service-worker.js') {
        assert.equal(response.headers.get('Service-Worker-Allowed'),'/');
      } else {
        assert.equal(await response.text(),'mathspace');
      }
      assert.equal(upstreamPath,expected.get(publicPath));
    }
  });
  assert.equal(calls.length,0);
});

test('legacy domains redirect every path to canonical homepage without old parameters', async () => {
  const {calls,env} = assets();
  for (const host of ['seemaths.com','www.seemaths.com']) {
    const response=await worker.fetch(new Request(`https://${host}/old/game?level=3`),env);
    assert.equal(response.status,301);
    assert.equal(response.headers.get('Location'),'https://seemaths.org/');
  }
  assert.equal(calls.length,0);
});

test('only player, API, shared runtime and recognised generator assets are proxied', async () => {
  const {calls,env} = assets();
  const received=[];
  await withFetch(async (request, options) => {
    received.push({request,options});
    return new Response('upstream');
  },async () => {
    for (const path of ['/play?count=20','/play/','/api/activities','/runtime/questionnaire.js','/seemaths-assets/player.css','/geometry-compass_directions/web/map.svg','/measurement-unit_conversion/player/teaching.js']) {
      assert.equal(await (await worker.fetch(new Request(`https://seemaths.org${path}`),env)).text(),'upstream');
    }
    for (const path of ['/other-product/web/source.js','/geometry-compass_directions/generator.py','/runtime/a%2F..%2Fsecret','/api/a%255c..','/api/%zz']) {
      assert.equal(await (await worker.fetch(new Request(`https://seemaths.org${path}`),env)).text(),'static asset');
    }
  });
  assert.equal(received.length,7);
  assert.equal(calls.length,5);
  assert.equal(received[0].request.url,'https://psat.seemaths.org/play?count=20');
  for (const {request,options} of received) {
    assert.equal(new URL(request.url).origin,'https://psat.seemaths.org');
    assert.equal(request.headers.get('X-Seemaths-Proxy'),'1');
    assert.equal(request.headers.get('X-Forwarded-Host'),'seemaths.org');
    assert.equal(options.redirect,'manual');
  }
});

test('API preserves POST JSON and query while disabling response caching', async () => {
  const {env}=assets();
  await withFetch(async (request,options) => {
    assert.equal(request.url,'https://psat.seemaths.org/api/activities?offset=3');
    assert.equal(request.method,'POST');
    assert.deepEqual(await request.json(),{recipe:{count:10}});
    assert.equal(request.headers.get('Content-Type'),'application/json');
    assert.equal(request.headers.get('Host'),null);
    assert.deepEqual(options.cf,{cacheTtl:0,cacheEverything:false});
    return new Response('{"questions":[]}',{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=300','CDN-Cache-Control':'max-age=300'}});
  },async () => {
    const response=await worker.fetch(new Request('https://seemaths.org/api/activities?offset=3',{method:'POST',headers:{'Content-Type':'application/json','Host':'seemaths.org'},body:JSON.stringify({recipe:{count:10}})}),env);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.equal(response.headers.get('CDN-Cache-Control'),null);
    assert.equal(response.headers.get('Content-Type'),'application/json');
  });
});

test('backend redirects remain on the public domain',async () => {
  const {env}=assets();
  await withFetch(async () => new Response(null,{status:307,headers:{Location:'https://psat.seemaths.org/play/?mode=exam'}}),async () => {
    const response=await worker.fetch(new Request('https://www.seemaths.org/play'),env);
    assert.equal(response.status,307);
    assert.equal(response.headers.get('Location'),'https://www.seemaths.org/play/?mode=exam');
  });
});

test('trusted backend configuration supports local preview', async () => {
  const {env}=assets();
  env.BACKEND_ORIGIN='http://127.0.0.1:1988';
  await withFetch(async request => {
    assert.equal(request.url,'http://127.0.0.1:1988/api/activities?limit=3');
    return new Response('{}');
  },async () => {
    assert.equal((await worker.fetch(new Request('http://localhost:8787/api/activities?limit=3'),env)).status,200);
  });
});

test('unavailable backend returns a retryable error without cached question data', async () => {
  const {env}=assets();
  await withFetch(async () => {throw new Error('network unavailable');},async () => {
    const response=await worker.fetch(new Request('https://seemaths.org/api/activities'),env);
    assert.equal(response.status,502);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.match((await response.json()).detail,/try again/);
  });
});


test('gallery practice and print links reach the backend for every question family', async () => {
  const {calls,env}=assets();
  const paths=['/number-decimal_order/practice?mode=learn','/geometry-vertices_edges/print','/algebra-function_values/exam'];
  await withFetch(async (request,options)=>{
    assert.ok(paths.includes(new URL(request.url).pathname+new URL(request.url).search));
    assert.deepEqual(options.cf,{cacheTtl:0,cacheEverything:false});
    return new Response('activity',{headers:{'Cache-Control':'public,max-age=300'}});
  },async()=>{
    for(const path of paths){
      const response=await worker.fetch(new Request('https://seemaths.org'+path),env);
      assert.equal(await response.text(),'activity');
      assert.equal(response.headers.get('Cache-Control'),'no-store');
    }
  });
  assert.equal(calls.length,0);
});

test('teacher lookup reaches the portal and local player saves emit an event',async()=>{
  const env={ASSIGNMENTS_ORIGIN:'https://portal.example',ASSETS:{fetch(){throw new Error('unexpected static fetch');}}};
  await withFetch(async request=>{
    if(new URL(request.url).pathname.startsWith('/api/teachers/')){
      assert.equal(new URL(request.url).origin,'https://portal.example');
      return Response.json({assignments:[]});
    }
    return new Response("export const putAttempt = attempt => transaction('readwrite', store => store.put(cloneData({...attempt, updatedAt:Date.now()})));",{headers:{'Content-Type':'text/javascript'}});
  },async()=>{
    assert.equal((await worker.fetch(new Request('https://seemaths.org/api/teachers/12345678'),env)).status,200);
    const response=await worker.fetch(new Request('https://seemaths.org/runtime/seemaths-attempts.js'),env);
    assert.match(await response.text(),/seemaths:attempt-saved/);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  });
});
