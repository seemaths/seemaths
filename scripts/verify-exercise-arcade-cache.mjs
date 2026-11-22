import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const origin=process.env.PROOF_ORIGIN||'http://127.0.0.1:8801';
const ids=['geometry-prism_surface_area','geometry-box_net','geometry-compass_directions'];
const recipe={mode:'practice',player:'arcade',topic:'geometry',count:3,levelMin:1,levelMax:1,minutes:30,stages:ids.map(quode=>({quode,title:quode}))};
const assignment={id:'00000000-0000-4000-8000-000000000001',recipe,expiresAt:Math.floor(Date.now()/1000)+86400};
const browser=await chromium.launch({headless:true,...(process.env.PROOF_CHROMIUM?{executablePath:process.env.PROOF_CHROMIUM}:{})});
const status=page=>page.evaluate(()=>new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.controller.postMessage({type:'browser-registry-status'},[c.port2]);}));
try {
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/api/assignments/**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/join')?{id:'00000000-0000-4000-8000-000000000002',number:9999,attemptId:'00000000-0000-4000-8000-000000000003'}:assignment}));
 await page.goto(origin+'/play?mode=practice&player=arcade&count=3&levelMin=1&levelMax=1');
 await page.waitForSelector('#game .topbar',{timeout:60000});
 await page.waitForLoadState('networkidle');
 const ready=await status(page);assert.deepEqual(ready.missing,[]);assert.deepEqual(ready.quodes.map(q=>q.id).sort(),ids.sort());
 const saved=page.url();await context.setOffline(true);await page.goto(saved);await page.waitForSelector('#game .topbar');
 assert.deepEqual((await status(page)).missing,[]);
 const generated=await page.evaluate(async ids=>{const {fetchExercise}=await import('/runtime/exercise-generation.mjs');const out=[];for(const id of ids){const r=await fetchExercise('/api/quodes/'+id+'/exercises',{method:'POST',body:JSON.stringify({options:{'--count':1,'--difficulty':'low','--seed':'53743'}})});out.push({id,status:r.status,count:(await r.json()).questions?.length});}return out;},ids);
 assert.ok(generated.every(q=>q.status===200&&q.count===1),JSON.stringify(generated));
 await page.getByRole('button',{name:'Choose character',exact:true}).click();await page.getByRole('button',{name:'Sakura',exact:true}).click();
 await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
 assert.equal(await page.locator('[data-failed]').count(),0);assert.equal(await page.locator('.home-fight-banner').getAttribute('data-character'),'sakura');
 assert.deepEqual(errors,[]);
 const result={selectedQuodes:ids.length,allPrefetchedBeforeGame:true,unrelatedQuodesNotDownloaded:true,offlineReopened:true,offlineCharacterSwitch:true,offlineGenerated:generated.length,errors};
 await mkdir('artifacts/exercise-arcade-cache',{recursive:true});await writeFile('artifacts/exercise-arcade-cache/results.json',JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close();}
