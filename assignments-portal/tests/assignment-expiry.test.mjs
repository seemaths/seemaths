import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const id='00000000-0000-4000-8000-000000000001';
const source=(await readFile(new URL('../../public/student-session.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replaceAll('export function','function').replaceAll('export async function','async function');
function session({saved,status=410,offline=false,mode='practice'}={}) {
  let requests=0;
  const storage={getItem:()=>saved?JSON.stringify(saved):null,setItem(){},removeItem(){}};
  const element=()=>({append(){},setAttribute(){},remove(){}});
  const context=vm.createContext({URLSearchParams,Date,JSON,Math,Object,String,Number,Boolean,AbortSignal,
    location:{search:`?mode=${mode}&assignment=${id}`},localStorage:storage,sessionStorage:storage,
    document:{createElement:element,querySelector:()=>null,body:{}},window:{addEventListener(){}},
    MutationObserver:class{observe(){}disconnect(){}},setTimeout:()=>0,clearTimeout(){},
    fetch:async()=>{requests++;if(offline)throw Error('Network unavailable');return {ok:false,status,json:async()=>({detail:'This assignment has expired.'})};}
  });
  vm.runInContext(source,context);
  return {run:()=>vm.runInContext('prepareStudent()',context),requests:()=>requests};
}
for(const status of [404,410,409])test(`authoritative ${status} never falls back to a cached assignment`,async()=>{
  const fixture=session({status,saved:{id:'child',number:1,key:'secret',expiresAt:Date.now()/1000+3600}});
  await assert.rejects(fixture.run(),error=>error.status===status);
});
for(const mode of ['practice','exam','workbook','solutions'])test(`known expiry blocks ${mode} even offline`,async()=>{
  const fixture=session({offline:true,mode,saved:{id:'child',number:1,key:'secret',expiresAt:Date.now()/1000-1}});
  await assert.rejects(fixture.run(),error=>error.status===410);assert.equal(fixture.requests(),0);
});
test('a saved unexpired assignment remains available during a network outage',async()=>{
  const fixture=session({offline:true,saved:{id:'child',number:1,key:'secret',expiresAt:Date.now()/1000+3600}});
  assert.equal((await fixture.run()).id,'child');
});
test('an unknown shared assignment requires a connection before opening',async()=>{
  await assert.rejects(session({offline:true}).run(),error=>error.status===503);
});
