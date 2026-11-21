import {openAttempts} from '/runtime/seemaths-attempts.js';
// IndexedDB write transactions serialize first opens across tabs of this browser.
let opening;
function openIdentities() {
  if(!opening) opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open('seemaths-student-identities',1);
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore('identities',{keyPath:'assignmentId'});store.createIndex('expiry','expiresAt');};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{opening=null;reject(new Error('Enable browser storage to keep your Student Id.'));};
    request.onblocked=()=>reject(new Error('Close other See Maths tabs and reopen this activity.'));
  });
  return opening;
}
function credential() {return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
async function updateIdentity(assignmentId,change) {
  const db=await openIdentities();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('identities','readwrite'),store=tx.objectStore('identities');
    let value;
    const request=store.get(assignmentId);
    request.onsuccess=()=>{value=change(request.result,store);};
    tx.oncomplete=()=>resolve(value);
    tx.onerror=tx.onabort=()=>reject(new Error('Your Student Id could not be saved. Enable browser storage.'));
  });
}
export async function sharedStudentIdentity(assignmentId,{key,attemptId,expiresAt,replace=false}={}) {
  return updateIdentity(assignmentId,(existing,store)=>{
    const expired=store.index('expiry').openCursor(IDBKeyRange.upperBound(Date.now()/1000));
    expired.onsuccess=()=>{const cursor=expired.result;if(cursor){if(cursor.primaryKey!==assignmentId)cursor.delete();cursor.continue();}};
    if(existing && existing.expiresAt>Date.now()/1000 && !replace) return existing;
    const value={assignmentId,key:key || credential(),attemptId:attemptId || crypto.randomUUID(),expiresAt,revision:0};
    store.put(value);return value;
  });
}
export async function bindStudentAttempt(assignmentId,key,attemptId) {
  return updateIdentity(assignmentId,(existing,store)=>{if(existing?.key===key){store.put({...existing,attemptId});}return attemptId;});
}
export async function nextStudentRevision(assignmentId,key,floor=0,metadata={}) {
  return updateIdentity(assignmentId,(existing,store)=>{
    if(existing && existing.key!==key) throw new Error('Reopen this assignment to restore your Student Id.');
    const record=existing || {assignmentId,key,attemptId:metadata.attemptId,expiresAt:metadata.expiresAt};
    if(!record.expiresAt) throw new Error('Reopen this assignment to restore your Student Id.');
    const revision=Math.max(record.revision || 0,floor)+1;store.put({...record,revision});return revision;
  });
}
export async function ensureStudentAttempt(id,recipe) {
  const db=await openAttempts();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('attempts','readwrite'),store=tx.objectStore('attempts'),request=store.get(id);
    request.onsuccess=()=>{if(!request.result){
      const {topic,mode,count,minutes,levelMin,levelMax,blueprint}=recipe;
      store.add({id,recipe:{topic,mode,count,minutes,levelMin,levelMax,...(blueprint?{blueprint}:{})},questions:Array(count).fill(null),createdAt:Date.now(),updatedAt:Date.now()});
    }};
    tx.oncomplete=()=>resolve(id);tx.onerror=tx.onabort=()=>reject(new Error('Your shared activity could not be saved.'));
  });
}
