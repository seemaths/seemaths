import test from 'node:test';
import assert from 'node:assert/strict';
import {assignmentDateLabel} from '../../public/assignment-display.js';
process.env.TZ='Australia/Sydney';
const seconds=date=>date.getTime()/1000;
test('creation uses local 12-hour time and expiry uses the browser calendar date',()=>{
  const created=new Date(2026,10,22,0,30),expires=new Date(2026,10,29,0,30);
  assert.equal(assignmentDateLabel(seconds(created),seconds(expires),new Date(2026,10,26,23,59)),'12:30 AM 22 Nov (expires in 3 days)');
  assert.equal(assignmentDateLabel(seconds(created),seconds(expires),new Date(2026,10,27,0,0)),'12:30 AM 22 Nov (expires in 2 days)');
  assert.equal(expires.getTime(),new Date(2026,10,29,0,30).getTime());
});
test('same-day and past expiry labels use the fixed expiry timestamp',()=>{
  const created=seconds(new Date(2026,10,22,12,30)),expires=seconds(new Date(2026,10,29,12,30));
  assert.equal(assignmentDateLabel(created,expires,new Date(2026,10,28,23,0)),'12:30 PM 22 Nov (expires in 1 day)');
  assert.equal(assignmentDateLabel(created,expires,new Date(2026,10,29,0,0)),'12:30 PM 22 Nov (expires today)');
  assert.equal(assignmentDateLabel(created,expires,new Date(2026,10,29,12,30)),'12:30 PM 22 Nov (expired)');
});
test('daylight saving does not turn tomorrow into zero or two calendar days',()=>{
  const created=seconds(new Date(2026,9,3,15,0)),expires=seconds(new Date(2026,9,5,0,30));
  assert.equal(assignmentDateLabel(created,expires,new Date(2026,9,4,0,15)),'3:00 PM 3 Oct (expires in 1 day)');
});
