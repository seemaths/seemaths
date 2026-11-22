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
