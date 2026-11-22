import {prefetchQuodes,arcadeAssetRoots} from '/offline-downloads.js';
import {campaignFromRecipe, progressAttempt} from './campaign.js';
import {putAttempt} from '/runtime/seemaths-attempts.js';
import {watchProgress} from '/student-session.js?v=17';

function stylesheet(href) {
  return new Promise((resolve,reject)=>{
    const link=document.createElement('link');link.rel='stylesheet';link.href=href;
    link.onload=resolve;link.onerror=()=>reject(new Error('Arcade could not load. Please reload.'));document.head.append(link);
  });
}

export async function startArcade(student) {
  const root=document.querySelector('#app');
  try {
    if (!student?.recipe) throw new Error('Connect to the internet to open this Arcade exercise.');
    const campaign=campaignFromRecipe(student.recipe, `assignment-${student.assignmentId}`);
    const storageKey=()=>`seemaths.arcade:${student.assignmentId}:${student.id}${globalThis.quodeArcadeManagedScope ? `:${globalThis.quodeArcadeManagedScope}` : ''}`;
    // Keep the existing Arcade artwork/runtime assets and its standalone game intact.
    await stylesheet('/arcade-player/style.css');
    await stylesheet('/assignment-arcade/style.css');
    document.body.classList.add('assignment-arcade');
    root.id='game';root.removeAttribute('aria-label');
    document.title='Arcade · See Maths';
    globalThis.quodeArcadeCampaign=campaign;
    globalThis.quodeArcadeHost={
      async load(){return JSON.parse(localStorage.getItem(storageKey()) || 'null');},
      async save(state){
        if(student.sharedAttemptId) state.attemptId=student.sharedAttemptId;
        localStorage.setItem(storageKey(),JSON.stringify(state));
        if (!globalThis.seemathsExerciseSearch) {const url=new URL(location.href);url.searchParams.set('attempt',state.attemptId);history.replaceState(null,'',url);}
        await putAttempt(progressAttempt(state,student.recipe));
      },
    };
    watchProgress(student);
    await import('./app.js');
    globalThis.quodeArcadeDownloads=prefetchQuodes(campaign.exercises.map(exercise=>exercise.quode||exercise.id),[location.href,'/assignment-arcade/bootstrap.js','/assignment-arcade/app.js',...await arcadeAssetRoots(),...performance.getEntriesByType('resource').map(entry=>entry.name)]).then(()=>true).catch(error=>{console.warn('Arcade downloads paused; reconnect to retry.',error);return false;});
  } catch(error) {
    const message=document.createElement('p');message.textContent=error.message;
    const retry=document.createElement('button');retry.textContent='Try again';retry.onclick=()=>location.reload();
    root.replaceChildren(message,retry);
  }
}
