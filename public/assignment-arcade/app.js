import {createCharacterPicker} from '/arcade-player/character-picker.js';
import {freshState,stageIndex,chooseType,present,help,answer,event,localStore,validateState,rewardSettings} from './engine.js';
import {mountQuestionnaire} from '/runtime/questionnaire.js';
import {generateExercise} from './campaign.js';
import {createArcadeAudio} from '/arcade-player/audio.js';
import {createQuestionQueue} from './questions.js';
import {createFlowerCelebration} from '/runtime/flower-celebration.js';
import {animationImage,slots,fighterCelebration,clearFighterAnimation,preloadCelebrations,nextHomeBanner,stagePoses,frozenPose,bannerPoster,selectedCharacter} from '/arcade-player/animations.js';

const root=document.querySelector('#game');
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const btn=(text,action,cls='button')=>{const n=el('button',cls,text);n.type='button';n.onclick=action;return n;};
let state,campaign,store,questions,screen='map',busy=false,feedback,saveChain=Promise.resolve(),sent=new Set(),saved=true;
const audio=createArcadeAudio(selectedCharacter);
const celebration=createFlowerCelebration({isMuted:()=>audio.muted});
let closeActiveHelp,renderer;
const pose = index => stagePoses[index % stagePoses.length];
async function goHome(){await closeActiveHelp?.();showMap();}
function clearAnswerFeedback(){celebration.cancel();audio.duckMusic(false);}
document.addEventListener('click',e=>{const button=e.target.closest('button');if(button&&!button.disabled&&!button.classList.contains('speaker'))audio.click();},true);
// A host must install this adapter before importing app.js. There is no implicit iframe detection.
const host=globalThis.quodeArcadeHost;
const managedBySitNStudy = !document.dispatchEvent(new Event('quode-managed-host-check', {cancelable:true}));
async function persist(){
  const snapshot=structuredClone(state);saved=false;status();
  const job=saveChain.catch(()=>{}).then(async()=>{
    await store.save(snapshot);saved=true;status();
    for(const e of snapshot.events){if(sent.has(e.id))continue;console.info('[QuodeArcade]',JSON.stringify(e));try{await host?.emit?.(e);sent.add(e.id);}catch{ /* The saved event ledger allows host replay and deduplication. */ }}
  });saveChain=job;
  try{await job;return true;}catch(error){saved=false;status();message(`Progress could not be saved: ${error.message}. Keep this tab open and retry.`,true);return false;}
}
function status(){const n=document.querySelector('#save-error');if(n)n.hidden=saved;}
function message(text,error=false){if(feedback){feedback.textContent=text;feedback.className=error?'feedback error':'feedback';}}
function shell(){
  closeActiveHelp=null;
  clearFighterAnimation();
  clearAnswerFeedback();
  renderer?.destroy();renderer=null;root.replaceChildren();
  root.dataset.screen=screen;
  const header=el('header','topbar'),brand=btn('',()=>goHome(),'brand icon-button back-home');brand.setAttribute('aria-label','Journey');brand.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m6-6-6 6 6 6"/></svg>';
  const controls=el('div','top-controls');const coins=el('span','coin-total',`◈ ${state.coins}`);coins.setAttribute('aria-label',`${state.coins} coins`);
  const parent=btn(screen==='parent'?'↩':'⚙',async()=>{await closeActiveHelp?.();screen==='parent'?showMap():askParentPin();},'quiet icon-button');parent.setAttribute('aria-label',screen==='parent'?'Back to game':'Parent view');if(!managedBySitNStudy)controls.append(coins,parent);
  if(screen==='play'){
    header.classList.add('question-topbar');
    brand.title='Home';header.append(brand);
    if(state.active){const hud=el('section','hud streak-hud');renderHUD(hud);header.append(hud);}
  }else {header.classList.add('home-topbar');header.append(controls);}
  root.append(header);
  const main=el('main','main');root.append(main);
  const speaker=btn('',()=>{audio.toggle();if(audio.muted)celebration.silence();updateSpeaker(speaker);if(!audio.muted)audio.click();},'speaker icon-button');updateSpeaker(speaker);root.append(speaker);
  const save=btn('↻',()=>persist(),'save-error icon-button');save.id='save-error';save.setAttribute('aria-label','Save failed. Retry');save.hidden=saved;root.append(save);return main;
}
function updateSpeaker(button){button.setAttribute('aria-label',audio.muted?'Turn sound on':'Turn sound off');button.setAttribute('aria-pressed',String(!audio.muted));button.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/>${audio.muted?'<path d="m16 9 6 6m0-6-6 6"/>':'<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;}
function askParentPin(){
  if(managedBySitNStudy)return;
  const dialog=el('dialog','pin-dialog'),form=el('form','pin-form');form.method='dialog';
  const label=el('label','','Parent PIN');label.htmlFor='parent-pin';const input=el('input','pin-input');input.id='parent-pin';input.type='password';input.inputMode='numeric';input.pattern='[0-9]{4}';input.maxLength=4;input.autocomplete='off';input.required=true;
  const cancel=btn('×',()=>dialog.close(),'icon-button pin-cancel');cancel.setAttribute('aria-label','Cancel');
  const submit=el('button','button primary','→');submit.type='submit';submit.setAttribute('aria-label','Unlock parent view');
  form.append(label,input,submit,cancel);form.onsubmit=e=>{e.preventDefault();if(input.value==='1978'){dialog.close();parents();}else{input.value='';input.setAttribute('aria-invalid','true');input.setAttribute('aria-label','Incorrect PIN. Try again');input.focus();}};
  dialog.append(form);root.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();input.focus();
}
function homeBanner(){const id=nextHomeBanner(),box=el('div','arena home-fight-banner'),image=animationImage(id);box.style.backgroundImage=`url("${bannerPoster(id)}")`;box.style.backgroundSize='contain';box.style.backgroundPosition='center';box.style.backgroundRepeat='no-repeat';image.fetchPriority='high';image.loading='eager';image.addEventListener('load',()=>{box.style.backgroundImage='none';},{once:true});box.append(image);return createCharacterPicker(showMap,box);}
function rewardBadge(module){if(managedBySitNStudy)return null;const prefix=`${campaign.id}:${module}${module==='bonus'?'':':'}`,award=state.rewards.filter(r=>module==='bonus'?r.id===prefix:r.id.startsWith(prefix)).at(-1);if(!award)return null;const badge=el('span','stage-earned',`+${award.coins} ◈`);badge.setAttribute('aria-label',`Last level reward: ${award.coins} coins`);return badge;}
function glove(){const image=frozenPose(slots.cleared);image.className='level-glove';return image;}
function showMap(){screen='map';audio.setCharacter(selectedCharacter);audio.setScene('arena');root.dataset.music=audio.scene;const main=shell();
  main.append(el('h1','sr-only',campaign.title),homeBanner());
  const current=stageIndex(state),journey=el('section','journey');journey.setAttribute('aria-label','Exercise journey');
  campaign.exercises.forEach((x,i)=>{const e=state.exercises[i],locked=current>=0&&i>current,card=el('article',`stage ${locked?'locked':''} ${e.cleared===campaign.levels.length?'complete':''}`);card.style.setProperty('--accent',x.color);
    const rune=animationImage(pose(i),'stage-fighter');rune.setAttribute('aria-hidden','true');card.title=x.skill;
    card.append(rune,el('h2','',x.name));const earned=rewardBadge(x.id);if(earned)card.append(earned);
    const path=el('div','level-path');for(let j=0;j<campaign.levels.length;j++){const dot=el('span',j<e.cleared?'cleared':'');dot.append(glove());dot.setAttribute('aria-label',`Level ${campaign.levelNumbers[j]}${j<e.cleared?' cleared':''}`);path.append(dot);}card.append(path);
    if(i===current){const start=btn('▶',()=>play(),'button primary stage-play');start.setAttribute('aria-label',state.active?'Continue':'Enter stage');card.append(start);}
    else {const mark=el('span','stage-state',locked?'🔒':'✓');mark.setAttribute('aria-label',locked?'Locked':'Stage complete');card.append(mark);}journey.append(card);
  });
  const bonus=el('article',`stage bonus ${current>=0?'locked':''}`);bonus.append(animationImage(pose(campaign.exercises.length),'bonus-fighter'),el('h2','','Final showdown'));
  const bonusEarned=rewardBadge('bonus');if(bonusEarned)bonus.append(bonusEarned);
  if(current<0&&!state.bonus.done){const start=btn('▶',()=>play(),'button primary');start.setAttribute('aria-label','Enter bonus');bonus.append(start);}else{const mark=el('span','stage-state',state.bonus.done?'🏆':'🔒');mark.setAttribute('aria-label',state.bonus.done?'Champion · bonus cleared':'Locked');bonus.append(mark);}journey.append(bonus);main.append(journey);
  feedback=el('p','feedback');feedback.setAttribute('role','status');main.append(feedback);
}
async function fetchBatch(type,level,count){
  const module=campaign.exercises[type].quode;
    const response=await generateExercise(`/api/quodes/${encodeURIComponent(module)}/exercises`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({options:{'--count':count,'--difficulty':campaign.levels[level]}})});
    const data=await response.json();if(!response.ok||!data.questions?.length)throw Error(data.detail||'Question generation failed.');
    if(data.sessionId)fetch(`/api/exercises/${encodeURIComponent(data.sessionId)}`,{method:'DELETE'}).catch(()=>{});
    return data.questions;
}
function warmQuestions(){
  const stage=stageIndex(state);if(state.bonus.done)return;
  if(stage<0){state.bonus.streaks.forEach((n,i)=>{if(n<5)questions.warm(i,campaign.levels.length-1);});return;}
  const level=state.exercises[stage].cleared;questions.warm(stage,level);
  if(level<campaign.levels.length-1)questions.warm(stage,level+1);
  else if(stage<campaign.exercises.length-1)questions.warm(stage+1,0);
}
async function play(){
  if(busy||state.bonus.done)return;busy=true;screen='play';
  try{
    if(state.active?.resolved)state.active=null;
    if(!state.active){
      const type=chooseType(state),level=stageIndex(state)<0?campaign.levels.length-1:state.exercises[type].cleared;
      if(!questions.available(type,level)){const main=shell();const loader=el('div','loading-spinner');loader.setAttribute('role','progressbar');loader.setAttribute('aria-label','Loading question');main.append(loader);}
      const result=await questions.take(type,level);
      const entryId=`${campaign.exercises[type].id}:${level}:${stageIndex(state)<0}`;
      if((level>0||type>0||stageIndex(state)<0)&&!state.events.some(e=>e.type==='level-entered'&&e.entryId===entryId)){
        const introduction=fighterCelebration('nextLevel',{duration:1400});
        if(!await introduction.finished)return;
        event(state,'level-entered',{entryId});
      }
      const exercise=state.exercises[type];
      if(!state.events.some(e=>e.type==='exercise-started'&&e.module===(stageIndex(state)<0?'bonus':exercise.id)))event(state,'exercise-started',{module:stageIndex(state)<0?'bonus':exercise.id});
      present(state,type,result.question,result.fingerprint);await persist();
    }renderPlay();warmQuestions();
  }catch(error){const main=shell();main.append(el('h1','','The arena is taking a breather'),el('p','',error.message),btn('Try again',()=>play()));}finally{busy=false;}
}
function renderHUD(container){
  container.replaceChildren();const a=state.active,count=a.bonus?state.bonus.streaks[a.type]:a.resolved&&state.exercises[a.type].cleared>a.level?5:state.exercises[a.type].streak;
  container.setAttribute('role','img');container.setAttribute('aria-label',`Streak: ${count} of 5`);
  for(let i=0;i<5;i++){const figure=el('span',`streak-figure ${i<count?'filled':'shadow'}`);figure.append(frozenPose(pose(a.type)));container.append(figure);}
}
function renderPlay(){
  preloadCelebrations();audio.setScene('piano');root.dataset.music=audio.scene;
  const main=shell(),a=state.active,x=campaign.exercises[a.type],hud=root.querySelector('.streak-hud');
  main.classList.add('play-main');main.append(el('h1','sr-only',x.name));
  const questionHost=el('section','arcade-question');main.append(questionHost);
  let lastChecked=Boolean(a.answerState?.answers?.[0]?.checked);
  const finish=async result=>{
    if(!result.correct)return;
    renderer?.setLocked(true);questionHost.classList.add('arcade-answer-resolved');busy=true;audio.duckMusic(true);
    const fight=fighterCelebration('correct',{duration:3000});
    if(!await fight.finished){busy=false;return;}
    audio.duckMusic(false);
    if(result.cleared){
      const finish=fighterCelebration('streak',{duration:2400});
      if(!await finish.finished){busy=false;return;}
      state.active=null;await persist();busy=false;showMap();
    }else{state.active=null;await persist();busy=false;await play();}
  };
  questionHost.addEventListener('click',event=>{
    const button=event.target.closest('button[data-teaching-launch]');
    if(button&&!button.disabled&&!a.resolved){help(state);renderHUD(hud);persist();}
  },true);
  renderer=mountQuestionnaire(questionHost,{
    title:x.name,questions:[a.question],layoutControls:true,search:'?mode=learn&layout=single',manageURL:false,
    initialState:a.answerState,branding:{name:'See Maths',home:'/'},
    onStateChange:snapshot=>{
      if(state.active!==a||a.resolved)return;
      a.answerState=snapshot;
      const checked=Boolean(snapshot.answers[0]?.checked),freshCheck=checked&&!lastChecked;
      lastChecked=checked;
      let result;
      if(freshCheck){result=answer(state,Boolean(snapshot.answers[0].correct),snapshot.answers[0].value);renderHUD(hud);}
      persist().then(ok=>{if(ok&&result)finish(result);});
    },
  });
  // Arcade owns advancement; the shared renderer owns answers and Help Me.
  feedback=el('p','feedback');feedback.setAttribute('role','status');main.append(feedback);
}
function parents(){screen='parent';const main=shell();main.append(el('p','eyebrow','PARENT VIEW'),el('h1','','The whole journey'),el('p','subhead',`${state.coins} coins earned · ${state.rewards.length} levels rewarded`));
  const wrap=el('div','report-wrap'),table=el('table','report');const head=el('tr');['Exercise','Fresh questions','Independent correct','Independent wrong','Using help','Accuracy','Current level','Cleared','Streak'].forEach(t=>head.append(el('th','',t)));const thead=el('thead');thead.append(head);table.append(thead);const tbody=el('tbody');
  function reportRow(name,s,current,cleared,streak){const tr=el('tr'),den=s.correct+s.wrong;[name,s.attempted,s.correct,s.wrong,s.helped,den?`${Math.round(s.correct/den*100)}%`:'—',current,cleared,streak].forEach((t,i)=>tr.append(el(i?'td':'th','',String(t))));tbody.append(tr);}
  state.exercises.forEach((e,i)=>reportRow(campaign.exercises[i].skill,e.stats,e.cleared===campaign.levels.length?'Complete':campaign.levelNumbers[e.cleared],`${e.cleared}/${campaign.levels.length}`,`${e.streak}/5`));reportRow('Bonus showdown',state.bonus.stats,state.bonus.done?'Complete':`${campaign.levelNumbers.at(-1)} only`,state.bonus.done?'Complete':`${state.bonus.streaks.filter(n=>n===5).length}/${campaign.exercises.length} types`,state.bonus.streaks.map(n=>`${n}/5`).join(' · '));table.append(tbody);wrap.append(table);main.append(wrap);
  main.append(rewardEditor());
  feedback=el('p','feedback');feedback.setAttribute('role','status');main.append(feedback);
}
function rewardEditor(){
  const section=el('section','reward-editor');section.append(el('h2','','Coins'));
  const form=el('form','reward-form'),settings=rewardSettings(state),fields=[];
  function row(label,range,type){
    const line=el('div','reward-slider-row'),track=el('div','dual-range'),low=el('output','range-value'),high=el('output','range-value');line.setAttribute('role','group');line.setAttribute('aria-label',label);line.append(el('span','range-title',label),low,track,high);
    const inputs=['min','max'].map(bound=>{
      const output=bound==='min'?low:high,input=el('input');output.value=String(range[bound]);
      input.type='range';input.min='1';input.max=String(Math.max(20,range.max));input.step='1';input.value=range[bound];input.setAttribute('aria-label',`${label} ${bound==='min'?'minimum':'maximum'} coins`);
      input.oninput=()=>{output.value=input.value;const other=inputs[bound==='min'?1:0];if(bound==='min'&&Number(input.value)>Number(other.value)||bound==='max'&&Number(input.value)<Number(other.value)){other.value=input.value;other.dispatchEvent(new Event('input'));}paint();};
      track.append(input);return input;
    });
    function paint(){const limit=Number(inputs[0].max)-1;track.style.setProperty('--low',`${(Number(inputs[0].value)-1)/limit*100}%`);track.style.setProperty('--high',`${(Number(inputs[1].value)-1)/limit*100}%`);}
    let dragging;
    function valueAt(e){const box=track.getBoundingClientRect();return Math.round(1+Math.max(0,Math.min(1,(e.clientX-box.left-9)/Math.max(1,box.width-18)))*(Number(inputs[0].max)-1));}
    function move(e){if(!dragging)return;dragging.value=String(valueAt(e));dragging.dispatchEvent(new Event('input',{bubbles:true}));}
    track.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();const value=valueAt(e),a=Number(inputs[0].value),b=Number(inputs[1].value);dragging=inputs[Math.abs(value-a)<Math.abs(value-b)||a===b&&value<a?0:1];dragging.focus({preventScroll:true});track.setPointerCapture(e.pointerId);move(e);};
    track.onpointermove=move;track.onpointerup=track.onpointercancel=()=>{dragging=null;};paint();
    form.append(line);fields.push({type,inputs});
  }
  campaign.exercises.forEach((x,i)=>row(x.name,settings.standard[i],i));row('Final bonus',settings.bonus,-1);
  const save=el('button','button primary','Save');save.type='submit';const actions=el('div','reward-actions');actions.append(save);form.append(actions);
  form.onsubmit=async e=>{e.preventDefault();const replacement=structuredClone(settings);for(const field of fields){const [min,max]=field.inputs.map(input=>Number(input.value));const range={min,max};if(field.type<0)replacement.bonus=range;else replacement.standard[field.type]=range;}
    state.rewardSettings=replacement;if(await persist()){save.textContent='✓';setTimeout(()=>{if(save.isConnected)save.textContent='Save';},1200);}
  };section.append(form);return section;
}
try{
  campaign=globalThis.quodeArcadeCampaign;
  if(!campaign?.exercises.length||!campaign.levels.length)throw Error('Open Arcade from an exercise link.');
  if(host&&(!host.load||!host.save))throw Error('Sit-and-Study must supply load() and save() before starting the game.');
  store=host||localStore(`quode-arcade:${campaign.id}`);
  const loaded=await store.load();state=loaded?validateState(loaded,campaign):freshState(campaign);
  questions=createQuestionQueue({getState:()=>state,campaign,fetchBatch,save:persist});
  // Events retained in the save can be redelivered by a host; stable IDs make delivery idempotent.
  if(!host)sent=new Set(state.events.map(e=>e.id));
  showMap();await persist();
}catch(error){root.replaceChildren(el('main','fatal',error.message));}
