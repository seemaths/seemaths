import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

const origin=process.env.PROOF_ORIGIN || 'http://127.0.0.1:8798';
const output=path.resolve(process.env.PROOF_OUTPUT || 'artifacts/offline-downloads');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PROOF_CHROMIUM?{executablePath:process.env.PROOF_CHROMIUM}:{})});
const results=[];
try {
  for(const mobile of [false,true]) {
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
    const page=await context.newPage(), errors=[], generationRequests=[];
    // Exercise real static assets and service workers without adding test
    // participants or progress to the learner's production assignment.
    const assignment='00000000-0000-4000-8000-000000000001';
    let recipe;
    await context.route('**/api/assignments/**',route=>{
      const endpoint=new URL(route.request().url()).pathname;
      if(endpoint.endsWith('/resolve')) {
        recipe=route.request().postDataJSON();
        return route.fulfill({json:{id:assignment,recipe,expiresAt:new Date(Date.now()+86400000).toISOString()}});
      }
      if(endpoint.endsWith('/join'))return route.fulfill({json:{id:'00000000-0000-4000-8000-000000000002',number:9999}});
      return route.fulfill({json:{}});
    });
    page.on('pageerror',error=>errors.push(error.message));
    context.on('request',request=>{if(request.method()==='POST'&&/\/api\/activities$|\/exercises$/.test(new URL(request.url()).pathname))generationRequests.push(request.url());});
    // This Quode is later in the user's blueprint, beyond the first window.
    // Fail its download to verify that first paint is independent of readiness.
    let blocked=true, intercepted=0;
    await context.route('**/geometry-prism_surface_area/web/generator.mjs',route=>{
      if(blocked){intercepted++;return route.abort('failed');}
      return route.continue();
    });
    const url=origin+'/play?mode=practice&topic=geometry&count=99&levelMin=1&levelMax=5&blueprint=bd7r65-11sdn30&player=standard&minutes=30';
    await page.goto(url);
    await page.waitForSelector('#app .paper-question:not([hidden])');
    assert.notEqual(await page.evaluate(()=>document.documentElement.dataset.activityOffline),'ready');
    await page.waitForFunction(()=>document.documentElement.dataset.activityOffline==='paused',null,{timeout:60000});
    assert.ok(intercepted>0,'Must actually interrupt an unvisited Quode download');
    const panel=page.locator('.seemaths-downloads');await panel.waitFor({state:'visible'});
    const progress=await panel.evaluate(element=>({done:Number(element.dataset.completed),total:Number(element.dataset.total),box:element.getBoundingClientRect().toJSON(),footer:document.querySelector('.paper-footer').getBoundingClientRect().toJSON()}));
    assert.equal(progress.total,12);assert.ok(progress.done<progress.total);
    assert.ok(Math.abs(progress.footer.top-progress.box.bottom-12)<2,'Bar must sit 12px above question strip');
    assert.ok(progress.box.right<= (mobile?390:1280)-16,'Bar must leave a right-hand gap');
    await page.screenshot({path:path.join(output,mobile?'phone-progress.png':'desktop-progress.png'),fullPage:true});
    // Going offline must keep the unfinished bar visible and explain the pause.
    await context.setOffline(true);
    await page.waitForFunction(()=>document.querySelector('.seemaths-downloads').innerText.includes('Connect to finish'));
    assert.equal(await panel.isVisible(),true);
    blocked=false;await context.setOffline(false);
    await page.waitForFunction(()=>document.documentElement.dataset.activityOffline==='ready',null,{timeout:60000});
    assert.equal(await panel.isVisible(),false);
    assert.equal(await panel.getAttribute('data-completed'),'12');
    const representatives=await page.evaluate(async()=>{
      const {planActivity}=await import('/runtime/activity-generation.mjs');
      const {readRecipe}=await import('/runtime/seemaths-player.js');
      const catalog=await(await fetch('/api/activities/js-catalog')).json();
      const seen=new Set();
      return planActivity(catalog,readRecipe()).slots.filter(slot=>{if(seen.has(slot.quode))return false;seen.add(slot.quode);return true;}).map(slot=>({number:slot.index+1,quode:slot.quode}));
    });
    // No priming of other Quodes: immediately disconnect when the real bar hides.
    await context.setOffline(true);
    await page.getByRole('button',{name:'Go to question 99',exact:true}).click();
    await page.waitForFunction(async()=>{
      const {getAttempt}=await import('/runtime/seemaths-attempts.js');
      const attempt=await getAttempt(new URLSearchParams(location.search).get('attempt'));
      return attempt?.state?.current===98 && Boolean(attempt.questions[98]);
    },null,{timeout:30000});
    for(const {number,quode} of representatives) {
      await page.getByRole('button',{name:`Go to question ${number}`,exact:true}).click();
      await page.waitForFunction(async index=>{
        const {getAttempt}=await import('/runtime/seemaths-attempts.js');
        const attempt=await getAttempt(new URLSearchParams(location.search).get('attempt'));
        return attempt?.state?.current===index && Boolean(attempt.questions[index]);
      },number-1,{timeout:30000});
      await page.waitForFunction(id=>document.querySelector('#app .paper-question:not([hidden])')?.dataset.quode===id,quode,{timeout:30000});
    }
    const offline=await page.evaluate(async()=>{
      const {generateActivity}=await import('/runtime/activity-generation.mjs');
      const {readRecipe}=await import('/runtime/seemaths-player.js');
      const catalog=await(await fetch('/api/activities/js-catalog')).json();
      const result=await generateActivity(catalog,{recipe:readRecipe(),attemptId:crypto.randomUUID()});
      return {count:result.questions.length,warnings:result.warnings,online:navigator.onLine};
    });
    assert.equal(offline.count,99);assert.equal(offline.online,false);assert.deepEqual(offline.warnings,[]);
    // Later Help Me imports must be in storage too, without having opened them.
    const help=await page.evaluate(async()=>{
      const response=await fetch('/geometry-prism_surface_area/web/offline-assets.json');
      const files=await response.json();
      for(const asset of files.filter(file=>/teaching\.(?:js|css)$/.test(file))) {
        const result=await fetch(asset);if(!result.ok)throw Error('Offline Help Me file missing');
      }
      return true;
    });
    assert.ok(help);assert.equal(generationRequests.length,0);assert.deepEqual(errors,[]);
    results.push({viewport:mobile?'phone':'desktop',firstQuestionBeforeDownload:true,quodes:12,interruptedBarRemainedVisible:true,resumedAfterReconnect:true,barHiddenWhenReady:true,question99OpenedOffline:true,questionTypesOpenedOffline:representatives.length,offlineGenerated:offline.count,helpAssetsAvailable:true,generationNetworkRequests:0,errors});
    console.log(results.at(-1));await context.close();
  }
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
} finally {await browser.close();}
