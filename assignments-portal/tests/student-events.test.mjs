import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {questionOutcomes,mergeQuestionOutcomes} from '../../public/progress-outcomes.js';

test('student saves on local question events, never on an idle timer or unchanged local save',async()=>{
  const events=new Map(), documentEvents=new Map(), writes=[];
  let elapsed=0, reads=0;
  const attempt={id:'attempt',recipe:{count:3,mode:'practice'},state:{answers:{},current:0}};
  const storage={getItem:()=>null,setItem(){},removeItem(){}};
  const context=vm.createContext({
    URLSearchParams, location:{search:'?attempt=attempt'},crypto:{},
    performance:{now:()=>elapsed},Date,JSON,Math,Object,String,Number,Boolean,AbortSignal,
    localStorage:storage,sessionStorage:storage,navigator:{onLine:true},
    document:{hidden:false,addEventListener:(n,f)=>documentEvents.set(n,f),removeEventListener(){},querySelector:()=>null},
    window:{addEventListener:(n,f)=>events.set(n,f),removeEventListener(){}},
    setInterval:()=>{throw new Error('Polling is forbidden');},
    setTimeout:()=>{throw new Error('Timed syncing is forbidden');},clearTimeout(){},queueMicrotask,
    getAttempt:async()=>{reads++;return attempt;},questionOutcomes,mergeQuestionOutcomes,nextStudentRevision:async(id,key,floor)=>floor+1,
    fetch:async(_,options)=>{writes.push(JSON.parse(options.body));return {ok:true,json:async()=>({updatedAt:1,activeSeconds:writes.at(-1).activeSeconds})};}
  });
  const source=(await readFile(new URL('../../public/student-session.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export function','function').replaceAll('export async function','async function');
  vm.runInContext(source+'\nwatchProgress({id:"child",assignmentId:"assignment",key:"secret",expiresAt:9999999999});',context);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();assert.equal(writes.length,1);
  elapsed=60000;await flush();assert.equal(reads,1);assert.equal(writes.length,1);
  await events.get('seemaths:attempt-saved')();await flush();assert.equal(writes.length,1);
  attempt.state.answers[0]={value:"2",checked:true,correct:true};
  await events.get('seemaths:attempt-saved')();await flush();
  assert.equal(writes.length,2);assert.equal(writes[1].answers[0].correct,true);assert.equal(writes[1].activeSeconds,60);
  await events.get('seemaths:attempt-saved')();await flush();assert.equal(writes.length,2);
});

for (const status of [404,410]) test(`active exercise ${status} blocks play and returns to PIN after ten seconds without polling`,async()=>{
  const events=new Map(), documentEvents=new Map(), writes=[], timers=[], redirects=[], removed=[];
  let clock=0, deleted=false;
  const attempt={id:'attempt',recipe:{count:3,mode:'practice',player:'arcade'},state:{answers:{},current:0}};
  const game={inert:false};
  const element=()=>({children:[],textContent:'',setAttribute(){},append(...nodes){this.children.push(...nodes);},focus(){}});
  const body=element();body.children.push(game);
  const storage={getItem:()=>null,setItem(){},removeItem:key=>removed.push(key)};
  class ClockDate extends Date {static now(){return clock;}}
  const context=vm.createContext({
    URLSearchParams,location:{search:'?attempt=attempt&player=arcade',hostname:'127.0.0.1',replace:value=>redirects.push(value)},
    performance:{now:()=>clock},Date:ClockDate,JSON,Math,Object,String,Number,Boolean,AbortSignal,
    localStorage:storage,sessionStorage:storage,navigator:{onLine:true},
    document:{hidden:false,body,documentElement:{dataset:{exerciseBase:'/arcade-player/'}},createElement:element,querySelector:()=>null,addEventListener:(n,f)=>documentEvents.set(n,f),removeEventListener(){}},
    window:{addEventListener:(n,f)=>events.set(n,f),removeEventListener(){}},
    setInterval:()=>{throw Error('Polling is forbidden');},setTimeout:(fn,delay)=>timers.push({fn,at:clock+delay}),clearTimeout(){},queueMicrotask,
    getAttempt:async()=>attempt,questionOutcomes,mergeQuestionOutcomes,nextStudentRevision:async(id,key,floor)=>floor+1,
    fetch:async(_,options)=>{writes.push(JSON.parse(options.body));return {ok:!deleted,status:deleted?status:200,json:async()=>deleted?{detail:'Exercise unavailable'}:{updatedAt:1,activeSeconds:0}};}
  });
  const source=(await readFile(new URL('../../public/student-session.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export function','function').replaceAll('export async function','async function');
  vm.runInContext(source+'\nwatchProgress({id:"child",assignmentId:"assignment",key:"secret",expiresAt:9999999999,recipe:{player:"arcade"}});',context);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();assert.equal(writes.length,1);assert.equal(timers.length,0);
  deleted=true;await flush();assert.equal(writes.length,1); // deletion alone causes no requests
  attempt.state.answers[0]={value:'2',checked:true,correct:true};events.get('seemaths:attempt-saved')();await flush();
  assert.equal(writes.length,2);assert.equal(game.inert,true);assert.equal(body.children.length,2);
  const overlay=body.children[1];assert.match(overlay.children[0].textContent,status===410?/expired/:/deleted/);
  assert.match(overlay.children[1].textContent,/10 seconds/);assert.equal(removed.length,2);
  events.get('seemaths:attempt-saved')();documentEvents.get('visibilitychange')();await flush();assert.equal(writes.length,2);
  clock=9999;timers.shift().fn();assert.match(overlay.children[1].textContent,/1 second/);assert.equal(redirects.length,0);
  clock=10000;timers.shift().fn();assert.deepEqual(redirects,['/arcade-player/']);assert.equal(timers.length,0);
});
