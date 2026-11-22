// Use the local Quode JavaScript host so this exercises the production renderer.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const origin=process.env.QUODE_BROWSER_HOST||'http://127.0.0.1:1989';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const viewport of [{width:1280,height:1000},{width:390,height:844}]){
  const page=await browser.newPage({viewport});const errors=[],missing=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('response',response=>{if(response.status()>=400&&/\/(?:arcade-player|assignment-arcade)\//.test(new URL(response.url()).pathname))missing.push(response.url());});
  await page.route('**/assignment-arcade/*',async route=>{
   const name=new URL(route.request().url()).pathname.split('/').at(-1);
   if(!/^[a-z-]+\.(js|css)$/.test(name))return route.abort();
   await route.fulfill({body:await readFile(new URL('../public/assignment-arcade/'+name,import.meta.url)),contentType:name.endsWith('.js')?'application/javascript':'text/css'});
  });
  await page.goto(origin+'/arcade-player/animations.html?character=chun-li');
  await page.setContent('<link rel="stylesheet" href="/arcade-player/style.css"><link rel="stylesheet" href="/assignment-arcade/style.css"><body class="assignment-arcade"><div id="game"></div></body>');
  await page.evaluate(async()=>{
   const {campaignFromRecipe}=await import('/assignment-arcade/campaign.js');
   globalThis.quodeArcadeCampaign=campaignFromRecipe({player:'arcade',mode:'practice',count:1,levelMin:1,levelMax:1,stages:[{quode:'arithmetic-percentage_changes',title:'Power Shift'}]},'character-assignment-test');
   await import('/assignment-arcade/app.js');
  });
  const picker=page.getByRole('button',{name:'Choose character',exact:true});await picker.waitFor();assert.equal(await picker.getAttribute('data-character'),'chun-li');
  const before=await page.evaluate(()=>localStorage.getItem('quode-arcade:character-assignment-test'));
  await picker.click();assert.equal(await page.locator('.home-fight-banner .character-thumbnail').count(),51);await page.getByRole('button',{name:'Cammy',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('quode-arcade:character-assignment-test')),before);
  await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
  assert.equal(await page.locator('.home-fight-banner').evaluate(node=>node.style.backgroundImage),'none');
  assert((await page.locator('.level-glove').first().getAttribute('src')).includes('cammy-'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/tmp/quode-arcade-review/assignment-characters-${viewport.width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Enter stage',exact:true}).click();await page.locator('.paper-question').waitFor({timeout:30000});
  assert((await page.locator('.streak-portrait').first().getAttribute('src')).includes('cammy-'));
  assert.equal(await page.locator('.fighter-gif').count(),0);
  await page.getByRole('button',{name:/^Help me$/i}).click();await page.locator('.paper-teaching').waitFor({timeout:15000});
  assert.equal(await page.locator('.fighter-gif').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  await page.close();
 }
 console.log('PASS assignment Arcade desktop/phone picker, progress preservation, character markers/streaks, real question/Help Me and no missing artwork');
}finally{await browser.close();}
