import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const b=await chromium.launch({headless:true,...(process.env.PROOF_CHROMIUM ? {executablePath:process.env.PROOF_CHROMIUM} : {})});
const origin=process.env.PROOF_ORIGIN||'http://127.0.0.1:8798',live=origin==='https://seemaths.org',results=[];
try{
for(const kind of (process.env.PROOF_PLAYERS||'mathspace,naplan,psat,arcade').split(',')){
const ctx=await b.newContext(),p=await ctx.newPage(),errors=[],generation=[];
p.on('pageerror',e=>errors.push(e.message));ctx.on('request',r=>{if(r.method()==='POST'&&(/\/api\/activities$|\/exercises$/.test(new URL(r.url()).pathname)))generation.push(r.url());});
const root=live&&['mathspace','arcade'].includes(kind)?`https://${kind}.seemaths.org/`:origin+`/${kind}-player/`;
await p.goto(root+(kind==='arcade'?'':'?mode=learn&localProof=1'));
if(kind==='arcade'){
 await p.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:45000});
 await p.locator('button').filter({hasText:'▶'}).first().click();await p.waitForSelector('.paper-question');
}else{await p.waitForSelector('.paper-question');await p.waitForFunction(()=>document.documentElement.dataset.quodeOffline==='ready',null,{timeout:45000});}
await ctx.setOffline(true);await p.reload();
if(kind==='arcade'){await p.locator('button').filter({hasText:'▶'}).first().click();await p.waitForSelector('.paper-question');}
else await p.waitForSelector('.paper-question');
assert.deepEqual(errors,[]);assert.equal(generation.length,0);
results.push({player:kind,origin:root,online:true,offlineReopened:true,questionVisibleOffline:true,generationNetworkRequests:generation.length,errors});
console.log(results.at(-1));await ctx.close();
}
await mkdir('artifacts/static-players',{recursive:true});await writeFile('artifacts/static-players/results.json',JSON.stringify(results,null,2));
}finally{await b.close();}
