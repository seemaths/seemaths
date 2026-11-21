import {sharedStudentIdentity,bindStudentAttempt,ensureStudentAttempt,nextStudentRevision} from './student-identity.js?v=1';
import { getAttempt } from '/runtime/seemaths-attempts.js';
import { questionOutcomes, mergeQuestionOutcomes } from './progress-outcomes.js?v=2';

const parameters = new URLSearchParams(location.search);
const prefix = 'seemaths.assignments.student.v1.';
const uuid = /^[a-f0-9-]{36}$/i;
const displayNumber = n => String(n).padStart(4, '0');
let badge, messageTimer, pendingMessage;
function notice(text) {
  let message = document.querySelector('.seemaths-student-message');
  if (!message) { message = document.createElement('p'); message.className = 'seemaths-student-message'; message.setAttribute('role', 'status'); document.body.append(message); }
  message.textContent = text; message.hidden = false;
  clearTimeout(messageTimer); messageTimer = setTimeout(() => message.hidden = true, 4500);
}
function read(id) { try { return JSON.parse(localStorage.getItem(prefix + id) || sessionStorage.getItem(prefix + id)); } catch { return null; } }
function save(session) {
  try {
    const previous=JSON.parse(localStorage.getItem(prefix+session.assignmentId) || 'null');
    if(previous?.key===session.key){
      const tracking=session.tracking ||= {};
      for(const [index,old] of Object.entries(previous.tracking || {})){
        const detail=tracking[index] ||= {};
        detail.checks=Math.max(detail.checks || 0,old.checks || 0);
        detail.helped=Boolean(detail.helped || old.helped);detail.skipped=Boolean(detail.skipped || old.skipped);
      }
      session.answers=mergeQuestionOutcomes(previous.answers || previous.pending?.answers,session.answers || session.pending?.answers);
      session.trackedSeconds=Math.max(session.trackedSeconds || 0,previous.trackedSeconds || 0);
      session.activeSeconds=Math.max(session.activeSeconds || 0,previous.activeSeconds || 0);
    }
    const value=JSON.stringify(session);localStorage.setItem(prefix+session.assignmentId,value);sessionStorage.setItem(prefix+session.assignmentId,value);return true;
  } catch { return false; }
}

async function request(path, {method = 'GET', body, key} = {}) {
  const response = await fetch(path, {method, keepalive:method==='PUT', cache:'no-store', signal:AbortSignal.timeout(12000), headers:{...(body ? {'Content-Type':'application/json'} : {}),...(key ? {Authorization:`Bearer ${key}`} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
  const value = await response.json();
  if (!response.ok) { const error = new Error(typeof value.detail === 'string' ? value.detail : 'Progress sharing is unavailable.'); error.status = response.status; throw error; }
  return value;
}
function installBadge(session) {
  if (badge) badge.remove();
  badge = document.createElement('button'); badge.type = 'button'; badge.className = 'seemaths-student-id';
  const label = document.createElement('span'); label.textContent = 'Student Id';
  const number = document.createElement('strong'); number.textContent = session?.number ? displayNumber(session.number) : '—';
  badge.append(label, number); badge.title = session?.number ? 'Copy Student Id' : 'Student Id is unavailable';
  badge.setAttribute('aria-label', session?.number ? `Student Id ${displayNumber(session.number)}. Click to copy.` : 'Student Id unavailable');
  badge.onclick = async () => {
    if (!session?.number) { notice(pendingMessage || 'Connect to the internet to get your Student Id.'); return; }
    const text = displayNumber(session.number);
    try { await navigator.clipboard.writeText(text); notice(`Student Id ${text} copied`); }
    catch {
      const field = document.createElement('textarea'); field.value = text; field.setAttribute('aria-label','Student Id to copy'); document.body.append(field); field.select();
      const copied = document.execCommand('copy'); field.remove(); notice(copied ? `Student Id ${text} copied` : `Your Student Id is ${text}`);
    }
  };
  function mount() { const header = document.querySelector('.paper-heading-with-layout'); if (header && !header.contains(badge)) header.append(badge); }
  mount(); const observer = new MutationObserver(mount); observer.observe(document.body, {childList:true,subtree:true});
  window.addEventListener('pagehide', () => observer.disconnect(), {once:true});
}
function recipeFromURL() {
  return {topic:parameters.get('topic') || 'random', mode:parameters.get('mode') || 'practice', count:Number(parameters.get('count') || 10),levelMin:Number(parameters.get('levelMin') || 1),levelMax:Number(parameters.get('levelMax') || 5),minutes:Number(parameters.get('minutes') || 30), ...(parameters.has('blueprint') ? {blueprint:parameters.get('blueprint')} : {})};
}
export async function prepareStudent() {
  if (!['practice','exam'].includes(parameters.get('mode') || 'practice')) return null;
  let session, assignmentId = parameters.get('assignment');
  try {
    const assignment = assignmentId && uuid.test(assignmentId)
      ? await request(`/api/assignments/${assignmentId}`)
      : await request('/api/assignments/resolve', {method:'POST',body:recipeFromURL()});
    assignmentId = assignment.id;
    // Explicit assignment settings are authoritative; students cannot alter a shared recipe.
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(assignment.recipe)) if (value != null) url.searchParams.set(key, value);
    url.searchParams.set('assignment', assignmentId);
    url.searchParams.delete('teacher');
    session = read(assignmentId);
    const fragment = new URLSearchParams(location.hash.slice(1));
    let restoring=false;
    if (uuid.test(fragment.get('student') || '') && /^[A-Za-z0-9_-]{43,86}$/.test(fragment.get('key') || '')) {
      const restored = await request(`/api/assignments/${assignmentId}/students/${fragment.get('student')}`, {key:fragment.get('key')});
      session = {...restored, key:fragment.get('key'), assignmentId};
      url.hash = '';restoring=true;
    }
    const identity=await sharedStudentIdentity(assignmentId,{key:session?.key,attemptId:session?.attemptId || session?.sharedAttemptId,expiresAt:assignment.expiresAt,replace:restoring});
    if(session?.key!==identity.key) session={assignmentId,key:identity.key};
    session={...session,assignmentId,key:identity.key};
    if(!save(session)) throw new Error('Enable browser storage to keep your Student Id.');
    const joined = await request(`/api/assignments/${assignmentId}/join`, {method:'POST',body:{credential:session.key}});
    session = {...session,...joined,assignmentId,expiresAt:assignment.expiresAt};
    // Reserve one local attempt before either tab starts generating questions.
    session.sharedAttemptId=joined.attemptId || identity.attemptId;
    await bindStudentAttempt(assignmentId,session.key,session.sharedAttemptId);
    if(assignment.recipe.player!=='arcade') await ensureStudentAttempt(session.sharedAttemptId,assignment.recipe);
    url.searchParams.set('attempt',session.sharedAttemptId);
    history.replaceState(null,'',url);
    if (!save(session)) notice('Keep this browser open: your Student Id could not be saved.');
    installBadge(session);
    return session;
  } catch (error) {
    session = assignmentId ? read(assignmentId) : null;
    pendingMessage = error.message;
    installBadge(session);
    // Keep previously allocated numbers visible offline; do not invent numbers.
    if (!session?.number) setTimeout(() => notice(error.message), 1200);
    return session?.id ? session : null;
  }
}
export function watchProgress(session) {
  if (!session?.id) return;
  let rerun = false;
  let busy = false, signature = '', stopped = false, lastAttempt;
  let lastTick = performance.now(), wasVisible = !document.hidden;
  let activeSeconds = Math.max(session.activeSeconds || 0, session.trackedSeconds || 0);
  const tracking = session.tracking || Object.fromEntries((session.answers || []).map(a => [a.index-1,{helped:a.helped,checks:a.checks || 0,skipped:a.skipped}]));
  function accrue() {
    const now=performance.now();
    if (wasVisible && !session.completedAt) activeSeconds+=Math.max(0,(now-lastTick)/1000);
    lastTick=now;wasVisible=!document.hidden;
    session.trackedSeconds=activeSeconds;session.tracking=tracking;
  }
  function currentIndex(target) {
    const card=target?.closest?.('.paper-question');
    const cards=[...document.querySelectorAll('#app .paper-grid > .paper-question, #app .paper-grid > .paper-question-pending')];
    if(card && cards.includes(card)) return cards.indexOf(card);
    const dot=document.querySelector('.paper-dot[aria-current="step"]');
    return dot ? Math.max(0,Number(dot.textContent)-1) : (lastAttempt?.state?.current || 0);
  }
  function interaction(event) {
    if (session.completedAt) return;
    const button=event.target.closest?.('button');
    if(!button || button.disabled) return;
    const label=(button.getAttribute('aria-label') || button.textContent).trim();
    if(!/^Help Me$|^Check answer$|^(?:Next|Previous)(?: Question)?$|^Go to question [0-9]+$|^Submit(?: exam)?$/i.test(label)) return;
    const index=currentIndex(event.target), detail=tracking[index] ||= {};
    if (/^Help Me$/i.test(label)) detail.helped=true;
    if (/^Check answer$/i.test(label)) {detail.checks=Math.min(999,(detail.checks || 0)+1);detail.skipped=false;}
    if (/^(?:Next|Previous)(?: Question)?$|^Go to question [0-9]+$/i.test(label)) {
      const destination=/^Go to question ([0-9]+)$/i.exec(label);
      if (!destination || Number(destination[1])-1!==index) {
        const answer=lastAttempt?.state?.answers?.[index];
        if (!answer?.correct) detail.skipped=true;
      }
    }
    accrue();save(session);
    if(!/^Check answer$|^Submit(?: exam)?$/i.test(label)) queueMicrotask(()=>sync(true));
  }
  async function sync(forceTime=false) {
    accrue();
    if (stopped) return;
    if (busy) { rerun=true; return; }
    if (Date.now()/1000 >= session.expiresAt) { stopped=true;localStorage.removeItem(prefix+session.assignmentId);sessionStorage.removeItem(prefix+session.assignmentId);notice('This assignment has expired.');return; }
    busy=true;
    try {
      const attemptId=new URLSearchParams(location.search).get('attempt');
      const attempt=attemptId && await getAttempt(attemptId);
      if(attempt) {
        lastAttempt=attempt;
        let answers=mergeQuestionOutcomes(read(session.assignmentId)?.answers,questionOutcomes(attempt,tracking));
        const completed=Boolean(attempt.result) || (attempt.recipe.mode==='practice' && answers.length===attempt.recipe.count && answers.every(a => a.correct===true || a.skipped));
        const snapshot={answers,completed,attemptId:attempt.id,activeSeconds:Math.min(604800,Math.floor(activeSeconds))};
        const next=JSON.stringify({answers,completed,attemptId:attempt.id});
        if((next!==signature || forceTime) && !session.completedAt) {
          session.revision=await nextStudentRevision(session.assignmentId,session.key,Math.max(session.revision || 0,session.pending?.revision || 0),{expiresAt:session.expiresAt,attemptId:attempt.id});signature=next;
          answers=mergeQuestionOutcomes(read(session.assignmentId)?.answers,answers);
          session.answers=answers;session.pending={...snapshot,answers,revision:session.revision};save(session);
        }
      }
      if(session.pending && navigator.onLine) {
        const result=await request(`/api/assignments/${session.assignmentId}/students/${session.id}`,{method:'PUT',key:session.key,body:session.pending});
        session.pending=null;session.answers=mergeQuestionOutcomes(session.answers,result.answers);session.revision=Math.max(session.revision || 0,result.revision || 0);session.updatedAt=result.updatedAt;session.completedAt=result.completedAt;session.activeSeconds=result.activeSeconds;save(session);
      }
    } catch(error) {
      if([403,404,409,410].includes(error.status)){stopped=true;notice(error.message);}
    } finally {busy=false;if(rerun){rerun=false;queueMicrotask(sync);}}
  }
  document.addEventListener('click',interaction,true);
  const onSaved=()=>sync();
  const onOnline=()=>sync();
  window.addEventListener('seemaths:attempt-saved',onSaved);
  window.addEventListener('online',onOnline);
  document.addEventListener('visibilitychange',()=>{accrue();save(session);if(document.hidden)sync(true);});
  window.addEventListener('pagehide',()=>{accrue();save(session);sync(true);window.removeEventListener('seemaths:attempt-saved',onSaved);window.removeEventListener('online',onOnline);document.removeEventListener('click',interaction,true);},{once:true});
  sync();
}
