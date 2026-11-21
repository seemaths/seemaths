import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const artifacts=path.resolve(process.env.PROOF_OUTPUT || 'artifacts/local-execution');
await mkdir(artifacts,{recursive:true});
const base=process.env.PROOF_ORIGIN||'http://127.0.0.1:8798';
const browser=await chromium.launch({headless:true,...(process.env.PROOF_CHROMIUM ? {executablePath:process.env.PROOF_CHROMIUM} : {})});
const context=await browser.newContext();let page=await context.newPage();
const requests=[],errors=[];
context.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('pageerror',e=>errors.push(e.message));
try {
await page.goto(base+'/play?mode=practice&topic=number&count=3&levelMin=1&levelMax=1&blueprint=proof&localProof=1');
await page.waitForSelector('.paper-question input[type=radio]');
await page.waitForFunction(()=>document.documentElement.dataset.quodeOffline==='ready',null,{timeout:60000});
const catalog=await page.evaluate(async()=>await(await fetch('/api/activities/js-catalog')).json());
const deployment=await page.evaluate(async()=>await(await fetch('/static-release.json')).json());
// Exercise every installed generator, using real browser imports and data.
const online=await page.evaluate(async catalog=>{
const {fetchExercise}=await import('/runtime/exercise-generation.mjs');const results=[];
for(const meta of catalog){const response=await fetchExercise('/api/quodes/'+meta.id+'/exercises',{method:'POST',body:JSON.stringify({options:{'--count':1,'--difficulty':'low','--seed':'112233'}})});const data=await response.json();results.push({id:meta.id,status:response.status,count:data.questions?.length,error:data.detail});}
return results;
},catalog);
assert.equal(online.filter(r=>r.status!==200||r.count!==1).length,0,JSON.stringify(online.filter(r=>r.status!==200||r.count!==1)));
await page.waitForFunction(()=>document.documentElement.dataset.quodeOffline==='ready',null,{timeout:60000});
await context.setOffline(true);
const boundary=requests.length;
const offline=await page.evaluate(async catalog=>{
const {fetchExercise}=await import('/runtime/exercise-generation.mjs');const results=[];
for(const meta of catalog)for(const level of ['low','medium','verbose','high','challenge']){
const response=await fetchExercise('/api/quodes/'+meta.id+'/exercises',{method:'POST',body:JSON.stringify({options:{'--count':1,'--difficulty':level,'--seed':String(crypto.getRandomValues(new Uint32Array(1))[0])}})});const data=await response.json();results.push({id:meta.id,level,status:response.status,count:data.questions?.length,error:data.detail});}
return results;
},catalog);
assert.equal(offline.filter(r=>r.status!==200||r.count!==1).length,0,JSON.stringify(offline.filter(r=>r.status!==200||r.count!==1)));
const getQuestion=()=>page.evaluate(async()=>{const {getAttempt}=await import('/runtime/seemaths-attempts.js');const a=await getAttempt(new URLSearchParams(location.search).get('attempt'));return a.questions[a.state?.current||0];});
let question=await getQuestion();
const right=question.correctChoice??question.choices.indexOf(question.answer);
await page.locator('.paper-question input[type=radio]').nth((right+1)%question.choices.length).check();
await page.getByRole('button',{name:'Check answer',exact:true}).click();
await page.waitForTimeout(150);
assert.ok(!await page.getByRole('button',{name:'Next Question',exact:true}).count());
await page.getByRole('button',{name:'Help Me',exact:true}).click();
await page.getByRole('button',{name:/Check step/}).waitFor();
await page.screenshot({path:path.join(artifacts,'offline-help.png'),fullPage:true});
assert.ok(await page.getByRole('button',{name:/Check step/}).count(),'Help Me must render its interactive step offline');
const close=page.getByRole('button',{name:/Close help/});if(await close.count())await close.click();
await page.locator('.paper-question input[type=radio]').nth(right).check();
await page.getByRole('button',{name:'Check answer',exact:true}).click();
await page.getByRole('button',{name:'Next Question',exact:true}).waitFor();
const traceBefore=await page.evaluate(()=>window.__quodeExecution.at(-1));
await page.getByRole('button',{name:'Try another',exact:true}).click();
await page.waitForFunction(previous=>JSON.stringify(window.__quodeExecution.at(-1))!==JSON.stringify(previous),traceBefore,{timeout:10000});
assert.ok((await page.evaluate(()=>window.__quodeExecution.at(-1))).offline);

question=await getQuestion();
const savedURL=page.url();
const reopeningURL=page.url();await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(reopeningURL);await page.waitForSelector('.paper-question input[type=radio]');
const reopenedGeneration=await page.evaluate(async()=>{
  const {fetchActivity}=await import('/runtime/activity-generation.mjs');
  const {getAttempt}=await import('/runtime/seemaths-attempts.js');
  const attempt=await getAttempt(new URLSearchParams(location.search).get('attempt'));
  const response=await fetchActivity('/api/activities',{method:'POST',body:JSON.stringify({recipe:attempt.recipe,attemptId:crypto.randomUUID(),offset:0,limit:1})});
  return {status:response.status,count:(await response.json()).questions?.length,trace:window.__quodeExecution?.at(-1)};
});
assert.equal(reopenedGeneration.status,200);assert.equal(reopenedGeneration.count,1);assert.equal(reopenedGeneration.trace.offline,true);
await page.screenshot({path:path.join(artifacts,'offline-reopened.png'),fullPage:true});
const proofs=await page.evaluate(()=>({online:navigator.onLine,offlineReady:document.documentElement.dataset.quodeOffline,attempt:new URLSearchParams(location.search).get('attempt')}));
assert.equal(proofs.online,false);
const generationRequests=requests.filter(r=>r.method==='POST'&&(/\/api\/activities$|\/exercises$/.test(new URL(r.url).pathname)));
assert.equal(generationRequests.length,0);
assert.deepEqual(errors,[]);
const result={origin:base,deployment,onlineGenerators:online.length,offlineGenerated:offline.length,levels:5,generationNetworkRequests:generationRequests.length,ui:{incorrectAnswer:true,correctAnswer:true,helpOpenedOffline:true,tryAnotherOffline:true,reloadedOffline:true},reopenedGeneration,proofs,errors,offlineRequests:requests.slice(boundary),savedURL};
await writeFile(path.join(artifacts,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,offlineRequests:result.offlineRequests.length},null,2));
} finally {await browser.close();}
