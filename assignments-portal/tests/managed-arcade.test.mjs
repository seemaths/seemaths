import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignFromRecipe } from '../../public/assignment-arcade/campaign.js';
import { freshState, present, answer } from '../../public/assignment-arcade/engine.js';
import { createSitNStudyIntegration } from '../../public/assignment-arcade/sitnstudy.js';

const scope='a'.repeat(64);
const campaign=campaignFromRecipe({player:'arcade',mode:'practice',count:1,levelMin:3,levelMax:3,
  stages:[{quode:'number-decimal_order',title:'Decimal order'}]},'assignment-test');
const settings={version:1,rules:[{key:'assignment',min:5,max:10},{key:'bonus',min:10,max:20}]};

test('managed assignments use configured ranges and durable, retryable wallet events',async()=>{
  const state=freshState(campaign), delivered=[];
  let fail=true;
  const integration=createSitNStudyIntegration({getState:()=>state,campaign,save:async()=>{},onStatus:()=>{}});
  integration.connect({profileScope:scope,settings,reportingVersion:2,reportingSince:Date.now()-1000,
    emit:async event=>{
      if(event.type==='reward-earned'&&fail)throw Error('offline');
      delivered.push(event);
    }});
  assert.equal(integration.isReady(),true);
  for(let i=0;i<5;i++){present(state,0,{},String(i));answer(state,true,'1');}
  await integration.flush();
  const reward=state.events.find(event=>event.type==='reward-earned');
  assert.equal(reward.ruleKey,'assignment');assert.equal(reward.coins,5);
  assert.equal(reward.profileScope,scope);assert.equal(reward.managed,true);
  assert.equal(state.snsDeliveredIds?.includes(reward.id),false);
  fail=false;await integration.retry();await integration.flush();
  assert.equal(delivered.filter(event=>event.id===reward.id).length,1);
  assert.equal(state.snsDeliveredIds.includes(reward.id),true);
  const resumed=[];
  const next=createSitNStudyIntegration({getState:()=>state,campaign,save:async()=>{},onStatus:()=>{}});
  next.connect({profileScope:scope,settings,emit:async event=>resumed.push(event)});
  await next.flush();
  assert.equal(resumed.filter(event=>event.id===reward.id).length,0,'reopening does not redeliver an acknowledged reward');
});

test('assignments require parent ranges and reject a different child scope',async()=>{
  const state=freshState(campaign);
  const integration=createSitNStudyIntegration({getState:()=>state,campaign,save:async()=>{},onStatus:()=>{}});
  integration.connect({profileScope:scope,settings:{version:1,rules:[]},emit:async()=>{}});
  assert.equal(integration.isReady(),false);
  integration.connect({profileScope:scope,settings,emit:async()=>{}});
  assert.equal(integration.isReady(),true);await integration.flush();
  integration.connect({profileScope:'b'.repeat(64),settings,emit:async()=>{}});
  assert.equal(integration.isReady(),false);
});

test('lost runs remain in order before a winning five, including Help Me resets',async()=>{
  const {help}=await import('../../public/assignment-arcade/engine.js');
  const state=freshState(campaign);
  const check=correct=>{present(state,0,{},crypto.randomUUID());return answer(state,correct,'2');};
  for(let i=0;i<4;i++)check(true);check(false);
  assert.deepEqual(state.exercises[0].streakRuns,[4]);
  assert.deepEqual(state.events.at(-1).streakRuns,[4]);
  for(let i=0;i<3;i++)check(true);present(state,0,{},'help');help(state);
  assert.deepEqual(state.events.at(-1).streakRuns,[4,3]);
  assert.equal(state.events.at(-1).level,3);
  answer(state,true,'2'); // helped answer does not create another failed run
  for(let i=0;i<5;i++)check(true);
  assert.deepEqual(state.exercises[0].streakRuns,[4,3,5]);
  const completed=state.events.find(e=>e.type==='level-completed');
  assert.deepEqual(completed.streakRuns,[4,3,5]);assert.equal(completed.currentStreak,0);
});

test('old assignment saves recover lost streak history from their own answer events',async()=>{
  const {validateState}=await import('../../public/assignment-arcade/engine.js');
  const state=freshState(campaign);
  const check=correct=>{present(state,0,{},crypto.randomUUID());answer(state,correct,'2');};
  for(let i=0;i<4;i++)check(true);check(false);
  for(let i=0;i<2;i++)check(true);check(false);
  for(let i=0;i<5;i++)check(true);
  delete state.exercises[0].streakRuns;delete state.bonus.streakRuns;
  for(const event of state.events)delete event.streakRuns;
  validateState(state,campaign);assert.deepEqual(state.exercises[0].streakRuns,[4,2,5]);
  validateState(state,campaign);assert.deepEqual(state.exercises[0].streakRuns,[4,2,5]);
});

test('a new level starts its own report history without dropping the preceding level failures',()=>{
  const stages={...campaign,levels:['low','medium'],levelNumbers:[2,4]};const state=freshState(stages);
  const check=correct=>{present(state,0,{},crypto.randomUUID());answer(state,correct,'2');};
  check(true);check(false);for(let i=0;i<5;i++)check(true);
  assert.deepEqual(state.events.find(e=>e.type==='level-completed').streakRuns,[1,5]);
  present(state,0,{},crypto.randomUUID());assert.deepEqual(state.events.at(-1).streakRuns,[]);assert.equal(state.events.at(-1).level,4);
  answer(state,true,'2');present(state,0,{},crypto.randomUUID());answer(state,false,'2');
  assert.deepEqual(state.events.at(-1).streakRuns,[1]);assert.deepEqual(state.exercises[0].streakRuns,[1,5,1]);
});

test('Sit-N-Study receives every failed run followed by the winning five',async()=>{
  const state=freshState(campaign),delivered=[];
  const integration=createSitNStudyIntegration({getState:()=>state,campaign,save:async()=>{},onStatus:()=>{}});
  integration.connect({profileScope:scope,settings,reportingVersion:2,reportingSince:0,emit:async event=>delivered.push(event)});
  await integration.flush();
  const check=correct=>{present(state,0,{},crypto.randomUUID());answer(state,correct,'2');};
  for(let i=0;i<4;i++)check(true);check(false);await integration.flush();
  assert.deepEqual(delivered.filter(e=>e.type==='question-answered').at(-1).streakRuns,[4]);
  for(let i=0;i<4;i++)check(true);check(false);for(let i=0;i<5;i++)check(true);await integration.flush();
  assert.deepEqual(delivered.find(e=>e.type==='level-completed').streakRuns,[4,4,5]);
  assert.equal(delivered.filter(e=>e.type==='reward-earned').length,1);
});
