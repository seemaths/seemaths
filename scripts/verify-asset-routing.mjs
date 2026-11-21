// Exercise Cloudflare's actual asset router (Wrangler dev or production), not
// just worker.fetch(): a direct asset must never execute the routing Worker.
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
const origin=process.env.PROOF_ORIGIN || 'http://127.0.0.1:8803';
const live=new URL(origin).hostname==='seemaths.org';
async function request(path,{host='seemaths.org',...options}={}) {
  const url=new URL(path,origin);
  if(live)url.hostname=host;
  if(live)return fetch(url,{...options,signal:AbortSignal.timeout(15000)});
  // Node's fetch rewrites Host; use HTTP directly to exercise all local domains.
  return new Promise((resolve,reject)=>{
    const req=httpRequest(url,{method:options.method || 'GET',headers:{Host:host,...options.headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve(new Response([204,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
      res.on('error',reject);
    });
    req.on('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('Routing probe timed out')));
    req.end(options.body);
  });
}
const assets=['/script.js','/styles.css','/nunito-brand.ttf','/favicon.svg',
  '/runtime/questionnaire.js','/runtime/service-worker.js','/student-player.js',
  '/assignment-arcade/app.js','/arcade-player/style.css','/assets/app.js',
  '/api/activities/js-catalog','/api/quodes/number-decimal_order',
  '/number-decimal_order/web/generator.mjs','/play/',
  '/mathspace-player/','/naplan-player/','/psat-player/'];
for(const path of assets){
  const response=await request(path);
  assert.equal(response.status,200,path);
  assert.equal(response.headers.get('X-SeeMaths-Routing'),null,`${path} invoked the Worker`);
  await response.body?.cancel();
}
for(const host of ['player.seemaths.org','arcade.seemaths.org']){
  for(const path of ['/','/0012']){
    const response=await request(path,{host,headers:{'Sec-Fetch-Mode':'navigate',Accept:'text/html'}});
    assert.equal(response.status,200,host+path);
    assert.equal(response.headers.get('X-SeeMaths-Routing'),'worker');
    assert.ok((await response.text()).includes('/exercise-entry.js'));
  }
}
for(const path of ['/','/exercises','/manage/example','/a/example']){
  const response=await request(path,{headers:{'Sec-Fetch-Mode':'navigate',Accept:'text/html'}});
  assert.equal(response.status,200,path);
  assert.equal(response.headers.get('X-SeeMaths-Routing'),'worker',path);
  await response.body?.cancel();
}
for(const path of ['/api/config','/api/assignments/0000']){
  const response=await request(path);
  assert.ok([200,404,410].includes(response.status),`${path}: ${response.status}`);
  assert.equal(response.headers.get('X-SeeMaths-Routing'),'worker');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  await response.body?.cancel();
}
const manifest=await request('/manifest.webmanifest',{host:'mathspace.seemaths.org'});
assert.equal(manifest.headers.get('X-SeeMaths-Routing'),'worker');
assert.equal((await manifest.json()).scope,'/');
const sw=await request('/service-worker.js',{host:'mathspace.seemaths.org'});
assert.equal(sw.status,200);assert.equal(sw.headers.get('Service-Worker-Allowed'),'/');await sw.body?.cancel();
const generation=await request('/api/activities',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
assert.equal(generation.status,405);assert.match((await generation.json()).detail,/browser/);
console.log(`PASS: ${assets.length} representative static URLs bypass the Worker; PIN navigations, dashboards, API privacy and Math Space aliases work.`);
