// A late-attach bridge lets the separately shipped injection own wallet access.
// Standalone Arcade never uses this bridge or changes its parent settings.
import {freshState,currentReportStreak,levelNumber} from './engine.js';

export function resetManagedState(state,campaign,resetId){
  const done=new Set(state.snsDeliveredIds||[]),next=freshState(campaign);
  next.events=state.events.filter(event=>event.managed&&event.type==='reward-earned'&&!done.has(event.id));
  next.managedRewardScope=state.managedRewardScope;
  next.managedResetId=resetId;
  return next;
}

export function createSitNStudyIntegration({getState,campaign,save,onStatus,onReset}){
  let adapter=null,flushing=false,ready=false,error='Waiting for coin settings from the Parent Portal.';
  let flushTask=Promise.resolve(),resetTask=null,queued=null,resumePending=false;
  const delivered=()=>new Set(getState().snsDeliveredIds||[]);
  const notify=()=>onStatus({ready,error});
  function flush(){
    if(flushing)return flushTask;
    flushTask=deliver();return flushTask;
  }
  async function deliver(){
    if(!adapter||flushing)return;
    flushing=true;
    const failures=[];
    try{
      const state=getState(),done=delivered();
      if(resumePending&&adapter.reportingVersion===2){
        resumePending=false;
        const active=state.active;
        if(active&&!active.resolved){
          const exercise=campaign.exercises[active.type];
          const progress=active.bonus?state.bonus:state.exercises[active.type];
          const history=progress.streakRuns||[];
          const streakRuns=active.bonus?history:history.slice(history.lastIndexOf(5)+1);
          const currentStreak=currentReportStreak(state,active);
          await adapter.emit({id:`${active.id}:resume`,type:'question-presented',
            campaign:state.campaign,module:exercise.id,level:levelNumber(state,active.level),
            bonus:active.bonus,questionId:active.id,helped:active.help,streakRuns,currentStreak,
            runId:state.managedResetId||'initial',at:new Date().toISOString(),
            title:active.bonus?'Final bonus':exercise.name});
        }
      }
      for(const event of [...state.events]){
        if(!event.managed||done.has(event.id))continue;
        const supplemental=['question-presented','help-entered','level-completed'].includes(event.type);
        if(!['reward-earned','exercise-started','question-answered','exercise-ended'].includes(event.type)&&!supplemental)continue;
        if(supplemental){
          if(adapter.reportingVersion!==2)continue;
          // Old ledgers contain these events but the previous adapter did not
          // report them. Do not award past levels again on a protocol upgrade.
          if(Date.parse(event.at)<adapter.reportingSince){
            done.add(event.id);state.snsDeliveredIds=[...done];await save(false);continue;
          }
        }
        try{
          const title=event.bonus||event.module==='bonus'?'Final bonus':campaign.exercises.find(exercise=>exercise.id===event.module)?.displayTitle;
          await adapter.emit({...event,title:title||event.title});
          done.add(event.id);state.snsDeliveredIds=[...done];
          await save(false);
        }catch(failure){failures.push(failure.message);}
      }
      if(ready)error=failures.length?`Coins are pending: ${failures[0]}`:'';
    }finally{flushing=false;notify();}
  }
  function connect(next){
    if(resetTask){queued=next;return resetTask;}
    const state=getState();
    if(!/^[a-f0-9]{64}$/.test(next.profileScope||'')||(state.managedRewardScope&&state.managedRewardScope!==next.profileScope)){
      ready=false;error='The child profile changed. Reopen Arcade to continue.';notify();return;
    }
    adapter=next;
    const settings=next.settings;
    const rules=Array.isArray(settings?.rules)?settings.rules:[];
    const ranges=[...campaign.exercises.map(stage=>rules.find(rule=>rule.key===stage.quode) || rules.find(rule=>rule.key==='assignment')),rules.find(rule=>rule.key==='bonus')];
    ready=settings?.version===1&&ranges.every(range=>range&&Number.isInteger(range.min)&&Number.isInteger(range.max)&&range.min>=1&&range.max>=range.min&&range.max<=9999);
    if(ready){
      const resetId=settings.resetId||state.managedResetId||'initial';
      if(resetId!==(state.managedResetId||'initial')){
        ready=false;error='Resetting Arcade progress…';notify();
        resetTask=(async()=>{
          await flushTask;
          if(!onReset)throw Error('Update Arcade to reset its progress.');
          await onReset(resetId);
          configure(next,ranges);
        })().catch(failure=>{error=`Arcade reset is pending: ${failure.message}`;notify();})
          .finally(()=>{resetTask=null;const latest=queued;queued=null;if(latest)connect(latest);});
        return resetTask;
      }
      configure(next,ranges);
    }else{error='Set Arcade coin ranges in the Parent Portal to start playing.';}
    notify();
  }
  function configure(next,ranges){
    const state=getState();
    state.managedResetId=next.settings.resetId||state.managedResetId||'initial';
    state.managedRewards=true;state.managedRewardScope=next.profileScope;
    state.managedRuleKeys=ranges.slice(0,-1).map(range=>range.key);
    state.rewardSettings={defaultsVersion:2,standard:ranges.slice(0,-1).map(({min,max})=>({min,max})),bonus:{min:ranges.at(-1).min,max:ranges.at(-1).max}};
    ready=true;error='';resumePending=true;notify();void save(false).then(flush);
  }
  return {connect,flush,retry:()=>!ready&&adapter?connect(adapter):flush(),isReady:()=>ready,status:notify};
}
