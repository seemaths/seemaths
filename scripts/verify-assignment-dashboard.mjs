import {createServer} from 'node:http';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const output=path.resolve('artifacts/assignment-dashboard');await mkdir(output,{recursive:true});
const id='00000000-0000-4000-8000-000000000001';let reads=0;
const assignment={id,reference:'1122',createdAt:Date.now()/1000,expiresAt:Date.now()/1000+604800,closed:false,recipe:{topic:'algebra',mode:'practice',player:'standard',count:10,levelMin:1,levelMax:5,minutes:30,blueprint:'dashboard-test'},students:[{id:'child',number:1,activeSeconds:180,answered:1,correct:1,answers:[{index:1,correct:true,checks:1}],completedAt:null}]};
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.ttf':'font/ttf','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/api/config'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({lifetimeDays:7}));return;}
 if(pathname===`/api/assignments/${id}/manage`){reads++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(assignment));return;}
 const base=path.resolve(pathname.startsWith('/assets/')||/^\/(?:manage|a)\//.test(pathname)?'assignments-portal/static':'dist');
 let relative=/^\/(?:manage|a)\//.test(pathname)?'index.html':pathname.startsWith('/assets/')?pathname.slice(8):pathname.slice(1);
 let file=path.resolve(base,relative||'index.html');if(!file.startsWith(base+path.sep)&&file!==base)throw Error('Invalid path');if((await stat(file)).isDirectory())file=path.join(file,'index.html');
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(await readFile(file));
}catch{res.writeHead(404);res.end('Missing fixture');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=process.env.PROOF_ORIGIN || `http://127.0.0.1:${server.address().port}`;
const b=await chromium.launch({headless:true,...(process.env.PROOF_CHROMIUM?{executablePath:process.env.PROOF_CHROMIUM}:{})});const results=[];
try{
 for(const mobile of [false,true]){
  const ctx=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},acceptDownloads:true});const p=await ctx.newPage();const errors=[];await ctx.route('**/api/config',route=>route.fulfill({json:{lifetimeDays:7}}));await ctx.route('**/api/assignments/'+id+'/manage',route=>{reads++;return route.fulfill({json:assignment});});p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copiedLink=text;}}});});
  await p.goto(origin+`/manage/${id}#key=fixture-management-key`);await p.getByRole('heading',{name:'Algebra',exact:true}).waitFor();
  assert.equal(await p.locator('.share-panel,.back-link,#last-sync,#close-assignment').count(),0);
  assert.equal(await p.getByRole('heading',{name:'Student progress',exact:true}).count(),0);
  assert.equal(await p.getByRole('button',{name:'Refresh progress',exact:true}).innerText(),'');
  assert.equal(await p.getByRole('button',{name:'Copy link',exact:true}).isVisible(),true);
  assert.equal(await p.locator('.student-number').innerText(),'01');
  await p.screenshot({path:path.join(output,mobile?'phone.png':'desktop.png'),fullPage:true});
  if(!mobile)await p.locator('#app').screenshot({path:path.join(output,'dashboard.png')});
  await p.getByRole('button',{name:'Copy link',exact:true}).click();const copied=new URL(await p.evaluate(()=>window.__copiedLink));assert.equal(copied.pathname,'/play');assert.equal(copied.searchParams.get('assignment'),id);assert.equal(copied.hash,'');assert.ok(!copied.href.includes('fixture-management-key'));
  const before=reads;assignment.students[0].activeSeconds=240;
  await p.getByRole('button',{name:'Refresh progress',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.student-time')?.textContent==='4 mins');assert.equal(reads,before+1);
  const downloaded=p.waitForEvent('download');await p.getByRole('button',{name:'Download results',exact:true}).click();const file=await downloaded;assert.match(file.suggestedFilename(),/results\.csv$/);await file.saveAs(path.join(output,mobile?'phone-results.csv':'desktop-results.csv'));
  assert.deepEqual(errors,[]);results.push({viewport:mobile?'phone':'desktop',copyBesideTopic:true,removedExtraSections:true,refreshIconWorks:true,csvWorks:true});await ctx.close();
 }
 for(const player of ['standard','arcade'])for(const status of [410,404]){
  const ctx=await b.newContext(),p=await ctx.newPage();const generators=[];
  ctx.on('request',r=>{if(/\/runtime\/seemaths-player\.js|\/assignment-arcade\/bootstrap\.js|\/web\/generator\.mjs/.test(r.url()))generators.push(r.url());});
  await ctx.addInitScript(({id})=>localStorage.setItem('seemaths.assignments.student.v1.'+id,JSON.stringify({id:'saved-child',number:1,key:'saved-key',expiresAt:Date.now()/1000+3600})),{id});
  await ctx.route('**/api/assignments/**',route=>route.fulfill({status,json:{detail:'This assignment has expired.'}}));
  await p.goto(origin+`/play/?mode=practice&player=${player}&assignment=${id}`);
  await p.getByRole('heading',{name:status===410?'Assignment expired':'Assignment unavailable',exact:true}).waitFor();
  assert.equal(await p.locator('.paper-question').count(),0);assert.equal(generators.length,0);
  if(status===410&&player==='standard')await p.screenshot({path:path.join(output,'expired.png'),fullPage:true});
  results.push({player,status,blockedBeforePlayerLoaded:true,cachedSessionDidNotBypassExpiry:true});await ctx.close();
 }
 for(const status of [410,404]) {
  const ctx=await b.newContext(),p=await ctx.newPage();
  await ctx.route('**/api/assignments/**',route=>route.fulfill({status,json:{detail:'Assignment not found or expired.'}}));
  await p.goto(origin+`/a/${id}`);
  await p.getByRole('heading',{name:status===410?'Assignment expired':'Assignment unavailable',exact:true}).waitFor();
  assert.equal(new URL(p.url()).pathname,`/a/${id}`);
  assert.equal(await p.locator('.paper-question').count(),0);
  results.push({shortLink:true,status,expiryMessageWithoutOpeningPlayer:true});await ctx.close();
 }
 await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(results);
}finally{await b.close();await new Promise(resolve=>server.close(resolve));}
