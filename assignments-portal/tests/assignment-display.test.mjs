import test from 'node:test';
import assert from 'node:assert/strict';
import {assignmentDateLabel,assignmentProgressDot} from '../../public/assignment-display.js';
process.env.TZ='Australia/Sydney';
const seconds=date=>date.getTime()/1000;
test('creation uses local 12-hour time and expiry uses the browser calendar date',()=>{
  const created=new Date(2026,10,22,0,30),expires=new Date(2026,10,29,0,30);
  assert.equal(assignmentDateLabel(seconds(created),seconds(expires),new Date(2026,10,26,23,59)),'12:30 AM, 22 Nov (exp 3d)');
  assert.equal(assignmentDateLabel(seconds(created),seconds(expires),new Date(2026,10,27,0,0)),'12:30 AM, 22 Nov (exp 2d)');
  assert.equal(expires.getTime(),new Date(2026,10,29,0,30).getTime());
});
test('same-day and past expiry labels use the fixed expiry timestamp',()=>{
  const created=seconds(new Date(2026,10,22,12,30)),expires=seconds(new Date(2026,10,29,12,30));
  assert.equal(assignmentDateLabel(created,expires,new Date(2026,10,28,23,0)),'12:30 PM, 22 Nov (exp 1d)');
  assert.equal(assignmentDateLabel(created,expires,new Date(2026,10,29,0,0)),'12:30 PM, 22 Nov (exp 0d)');
  assert.equal(assignmentDateLabel(created,expires,new Date(2026,10,29,12,30)),'12:30 PM, 22 Nov (expired)');
});
test('daylight saving does not turn tomorrow into zero or two calendar days',()=>{
  const created=seconds(new Date(2026,9,3,15,0)),expires=seconds(new Date(2026,9,5,0,30));
  assert.equal(assignmentDateLabel(created,expires,new Date(2026,9,4,0,15)),'3:00 PM, 3 Oct (exp 1d)');
});

test('Arcade stage checks do not imply repeated attempts at one question',()=>{
  assert.deepEqual(assignmentProgressDot('arcade',{correct:true,checks:10,helped:false}),{state:'first',label:'Stage cleared'});
  assert.deepEqual(assignmentProgressDot('arcade',{correct:true,checks:10,helped:true}),{state:'helped',label:'Stage cleared with Help Me'});
  assert.deepEqual(assignmentProgressDot('standard',{correct:true,checks:2}),{state:'helped',label:'Correct after retry'});
});
