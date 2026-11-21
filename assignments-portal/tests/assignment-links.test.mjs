import test from 'node:test';
import assert from 'node:assert/strict';
import {studentAssignmentURL} from '../../public/assignment-links.js';
const item={id:'b276365e-0ed2-42f2-9dc7-445dbb9ed062',managementToken:'private-management-key',recipe:{topic:'number',mode:'practice',count:10,levelMin:1,levelMax:5,minutes:30,blueprint:'stable-paper',player:'standard'}};
test('student link retains the shared assignment and recipe without private credentials',()=>{
  const url=new URL(studentAssignmentURL(item,'http://127.0.0.1:8793'));
  assert.equal(url.origin,'http://127.0.0.1:8793');assert.equal(url.pathname,'/play');
  assert.equal(url.searchParams.get('assignment'),item.id);assert.equal(url.searchParams.get('blueprint'),'stable-paper');
  assert.equal(url.searchParams.get('count'),'10');assert.equal(url.searchParams.has('minutes'),false);
  assert.equal(url.hash,'');assert.equal(url.href.includes(item.managementToken),false);
});
test('exam time and Arcade launch choice survive copying without serialising stages',()=>{
  const exam=new URL(studentAssignmentURL({...item,recipe:{...item.recipe,mode:'exam',minutes:45}},'https://seemaths.org'));
  assert.equal(exam.searchParams.get('mode'),'exam');assert.equal(exam.searchParams.get('minutes'),'45');
  const arcade=new URL(studentAssignmentURL({...item,recipe:{...item.recipe,player:'arcade',stages:[{quode:'number-decimal_order'}]}},'https://seemaths.org'));
  assert.equal(arcade.searchParams.get('player'),'arcade');assert.equal(arcade.searchParams.has('stages'),false);
  assert.equal(arcade.searchParams.get('assignment'),item.id);
});

test('four-digit PIN links use the matching player host and contain no recipe or credentials',()=>{
  for (const player of ['standard','arcade']) {
    const url=new URL(studentAssignmentURL({...item,reference:'0012',recipe:{...item.recipe,player}},'https://seemaths.org'));
    assert.equal(url.hostname,player==='arcade'?'arcade.seemaths.org':'player.seemaths.org');
    assert.equal(url.pathname,'/0012');assert.equal(url.search,'');assert.equal(url.hash,'');
  }
});
