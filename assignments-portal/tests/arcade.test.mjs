import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignFromRecipe, progressAttempt} from '../../public/assignment-arcade/campaign.js';
import {freshState, stageIndex, chooseType, present, answer, help, validateState} from '../../public/assignment-arcade/engine.js';

const recipe = (count,min,max) => ({player:'arcade',mode:'practice',count,levelMin:min,levelMax:max,
  stages:Array.from({length:count},()=>({quode:'number-decimal_order',title:'Decimal order'}))});

for (const [count,min,max] of [[1,3,3],[5,1,3],[8,2,4]]) {
  test(`${count} stages progress through exactly difficulties ${min}–${max}, then bonus`,()=>{
    const r=recipe(count,min,max), campaign=campaignFromRecipe(r,'test'),state=freshState(campaign);
    const clear=type=>{for(let n=0;n<5;n++){present(state,type,{answer:'1'},`${state.events.length}`);answer(state,true,'1');}};
    assert.equal(new Set(campaign.exercises.map(e=>e.id)).size,count);
    for(let stage=0;stage<count;stage++){
      assert.equal(stageIndex(state),stage);
      for(let level=0;level<=max-min;level++){
        clear(stage);
        const last=state.events.filter(e=>e.type==='level-completed').at(-1);
        assert.equal(last.level,min+level);
        assert.equal(state.exercises[stage].cleared,level+1);
      }
    }
    assert.equal(stageIndex(state),-1);
    assert.equal(progressAttempt(state,r).result,undefined,'bonus still needs completing');
    for(let i=0;i<count;i++)clear(chooseType(state));
    assert.equal(state.bonus.done,true);
    assert.equal(progressAttempt(state,r).result.answers.length,count);
    assert.equal(validateState(structuredClone(state),campaign).levelCount,max-min+1);
  });
}

test('Help resets the streak and progress reports help without raw answers',()=>{
  const r=recipe(1,2,4),state=freshState(campaignFromRecipe(r,'help'));
  present(state,0,{answer:'secret'},'first');answer(state,true,'secret');
  present(state,0,{answer:'secret'},'second');help(state);answer(state,true,'secret');
  assert.equal(state.exercises[0].streak,0);
  const snapshot=progressAttempt(state,r);
  assert.equal(snapshot.tracking[0].helped,true);
  assert.equal(JSON.stringify(snapshot).includes('secret'),false);
});

test('visual variations with the same wording remain distinct, and finite banks can repeat', async()=>{
  const {createQuestionQueue}=await import('../../public/assignment-arcade/questions.js');
  const campaign=campaignFromRecipe(recipe(1,1,1),'finite'),state=freshState(campaign);
  const variations=[1,2,3].map(value=>({question:'Read this diagram.',answer:String(value),portableQuestion:{quode:'number-decimal_order',data:{value}}}));
  const queue=createQuestionQueue({getState:()=>state,campaign,fetchBatch:async()=>variations,save:async()=>{}});
  const fingerprints=new Set();
  for(let i=0;i<4;i++){
    const item=await queue.take(0,0);fingerprints.add(item.fingerprint);state.seen.push(item.fingerprint);
  }
  assert.equal(fingerprints.size,3);
});
