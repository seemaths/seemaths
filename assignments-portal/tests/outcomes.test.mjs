import test from 'node:test';
import assert from 'node:assert/strict';
import { questionOutcomes, mergeQuestionOutcomes } from '../../public/progress-outcomes.js';

test('first try, helped, skipped and untried retain distinct outcomes',()=>{
  const attempt={recipe:{count:5},state:{answers:[{value:'2',checked:true,correct:true},{value:'3',checked:true,correct:true},{value:'',checked:false},{value:'',checked:false},{value:'4',checked:true,correct:true}]}};
  const outcomes=questionOutcomes(attempt,{0:{checks:1},1:{checks:1,helped:true},2:{skipped:true},4:{checks:2}});
  assert.equal(outcomes.length,4);
  assert.equal(outcomes[0].checks,1);assert.equal(outcomes[0].helped,false);
  assert.equal(outcomes[1].helped,true);assert.equal(outcomes[2].skipped,true);
  assert.equal(outcomes.some(a=>a.index===4),false);assert.equal(outcomes[3].checks,2);
  assert.equal(JSON.stringify(outcomes).includes('value'),false);
});
test('solving a skipped question clears the skipped outcome',()=>{
  const result=questionOutcomes({recipe:{count:1},state:{answers:[{value:'7',checked:true,correct:true}]}},{0:{skipped:true,helped:true,checks:2}});
  assert.equal(result[0].skipped,false);assert.equal(result[0].correct,true);assert.equal(result[0].helped,true);
});

test('stale tabs cannot erase shared correct, helped or skipped outcomes',()=>{
  const previous=[{index:1,correct:null,skipped:true,checks:0},{index:2,correct:true,helped:true,checks:2}];
  const stale=[{index:1,correct:null,checks:0},{index:2,correct:null,checks:0},{index:3,correct:true,checks:1}];
  const merged=mergeQuestionOutcomes(previous,stale);
  assert.equal(merged[0].skipped,true);assert.equal(merged[1].correct,true);assert.equal(merged[1].helped,true);assert.equal(merged[1].checks,2);assert.equal(merged[2].correct,true);
  assert.equal(mergeQuestionOutcomes(merged,[{index:1,correct:true,checks:1}])[0].skipped,false);
});
