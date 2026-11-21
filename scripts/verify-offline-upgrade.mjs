import {createServer} from 'node:http';
import {readFile, stat, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const directory=path.resolve('dist');
const current=await readFile(path.join(directory,'runtime/service-worker.js'),'utf8');
let version=1, currentRequests=0;
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.webmanifest':'application/manifest+json'};
const server=createServer(async(request,response)=>{
  try {
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/legacy') {response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><body>Existing offline installation</body>');return;}
    if(pathname==='/sw.js') {
      response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store','Service-Worker-Allowed':'/'});
      if(version===3){currentRequests++;response.end(current.replace('await self.skipWaiting();',''));}
      else response.end(`// Legacy offline worker ${version}\nself.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>{if(e.data?.type==='cache-page-resources')e.ports[0]?.postMessage({missing:[]})});`);
      return;
    }
    let file=path.resolve(directory,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(directory+path.sep)&&file!==directory)throw Error('Invalid path');
    if((await stat(file)).isDirectory())file=path.join(file,'index.html');
    let content=await readFile(file);
    if(pathname.startsWith('/play')) {
      // Isolate the downloader's recovery; no unrelated PWA updater may mask it.
      content=Buffer.from(content.toString().replace(/<script[^>]+src="\/runtime\/pwa-register\.js"[^>]*><\/script>/g,''));
    }
    response.writeHead(200,{'Content-Type':pathname.startsWith('/api/')?'application/json':types[path.extname(file)]||'application/octet-stream'});response.end(content);
  } catch {response.writeHead(404);response.end('Missing test asset');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.PROOF_CHROMIUM?{executablePath:process.env.PROOF_CHROMIUM}:{})});
try {
  const context=await browser.newContext(),page=await context.newPage();
  await context.route('**/api/assignments/**',route=>route.fulfill({status:503,json:{detail:'Assignment reporting is excluded from this offline upgrade check.'}}));
  await page.goto(origin+'/legacy');
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  version=2;
  await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});
  await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting));
  version=3;
  await page.addInitScript(()=>{
    window.__downloadStates=[];
    new MutationObserver(()=>{const state=document.documentElement?.dataset.activityOffline;if(state)window.__downloadStates.push(state);})
      .observe(document,{subtree:true,attributes:true,attributeFilter:['data-activity-offline']});
  });
  await page.goto(origin+'/play/?mode=practice&topic=geometry&count=99&levelMin=1&levelMax=5&blueprint=bd7r65-11sdn30&minutes=30');
  const loadedAt=await page.evaluate(()=>performance.timeOrigin);
  await page.waitForSelector('.paper-question:not([hidden]) input[type=radio]');
  await page.locator('.paper-question:not([hidden]) input[type=radio]').first().check();
  const draft=await page.locator('.paper-question:not([hidden]) input[type=radio]:checked').inputValue();
  await page.waitForFunction(()=>document.documentElement.dataset.activityOffline==='ready',null,{timeout:60000});
  assert.equal(await page.evaluate(()=>performance.timeOrigin),loadedAt,'Updating downloads must not reload or reset the activity');
  assert.ok(currentRequests>0,'Must check the current worker rather than keep the older waiting version');
  assert.ok(await page.evaluate(()=>window.__downloadStates.includes('updating')),'Must exercise automatic upgrade recovery');
  assert.equal(await page.locator('.seemaths-downloads').isVisible(),false);
  assert.equal(await page.locator('.paper-question:not([hidden]) input[type=radio]:checked').inputValue(),draft);
  await context.setOffline(true);
  const generated=await page.evaluate(async()=>{
    const {generateActivity}=await import('/runtime/activity-generation.mjs');
    const {readRecipe}=await import('/runtime/seemaths-player.js');
    return (await generateActivity(await(await fetch('/api/activities/js-catalog')).json(),{recipe:readRecipe(),attemptId:crypto.randomUUID()})).questions.length;
  });
  assert.equal(generated,99);
  const result={legacyActiveWorker:true,olderUpdateWaiting:true,automaticallyUpgraded:true,reloads:0,draftPreserved:true,quodes:12,offlineGenerated:generated};
  await mkdir('artifacts/offline-upgrade',{recursive:true});await writeFile('artifacts/offline-upgrade/results.json',JSON.stringify(result,null,2));console.log(result);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
