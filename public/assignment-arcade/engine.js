export const levelCount = state => state.levelCount || 5;
export const levelNumber = (state, index) => state.levelNumbers?.[index] ?? index+1;
export const uid = () => globalThis.crypto.randomUUID();
const stats = () => ({attempted:0, correct:0, wrong:0, helped:0});
export function rewardSettings(state){
  const settings=state.rewardSettings??={defaultsVersion:2,standard:state.exercises.map(()=>({min:5,max:10})),bonus:{min:10,max:20}};
  // Old saves had separate per-level settings. Keep the current level's range
  // when migrating to one range per exercise; earned coins are untouched.
  settings.standard=settings.standard.map((range,i)=>Array.isArray(range)?{...range[Math.min(state.exercises[i].cleared,levelCount(state)-1)]}:range);
  if((settings.defaultsVersion||1)<2){
    settings.standard=settings.standard.map(range=>range.min===10&&range.max===30?{min:5,max:10}:range);
    if(settings.bonus.min===30&&settings.bonus.max===90)settings.bonus={min:20,max:60};
    settings.defaultsVersion=2;
  }
  return settings;
}
export function rewardRange(state,type,level,bonus=false){const settings=rewardSettings(state);return bonus?settings.bonus:settings.standard[type];}
export function freshState(campaign) {
  return {schema:1,campaign:campaign.id,attemptId:uid(),createdAt:Date.now(),levelCount:campaign.levels.length,levelNumbers:campaign.levelNumbers,coins:0,rewards:[],events:[],seen:[],active:null,
    rewardSettings:{defaultsVersion:2,standard:campaign.exercises.map(()=>({min:5,max:10})),bonus:{min:10,max:20}},
    exercises:campaign.exercises.map(x=>({id:x.id,cleared:0,streak:0,counts:campaign.levels.map(()=>0),stats:stats()})),
    bonus:{done:false,streaks:campaign.exercises.map(()=>0),correct:0,stats:stats()}};
}
export function stageIndex(state) { return state.exercises.findIndex(x=>x.cleared<levelCount(state)); }
export function chooseType(state) {
  const stage=stageIndex(state);
  if(stage>=0)return stage;
  const open=state.bonus.streaks.map((n,i)=>n<5?i:-1).filter(i=>i>=0);
  const candidates=open.filter(i=>i!==state.lastType);
  const pool=candidates.length?candidates:open;
  return pool[Math.floor(Math.random()*pool.length)];
}
export function event(state,type,payload={}) {
  const entry={id:uid(),type,at:new Date().toISOString(),campaign:state.campaign,...(state.managedRewards?{managed:true,profileScope:state.managedRewardScope,runId:state.managedResetId||'initial'}:{}),...payload};
  state.events.push(entry); return entry;
}
export function present(state,type,question,fingerprint) {
  const bonus=stageIndex(state)<0;
  state.active={id:uid(),type,level:bonus?levelCount(state)-1:state.exercises[type].cleared,bonus,question,first:null,help:false,resolved:false};
  state.lastType=type;state.seen.push(fingerprint);
  state.exercises[type].stats.attempted++;
  if(bonus)state.bonus.stats.attempted++;
  return event(state,'question-presented',{questionId:state.active.id,module:state.exercises[type].id,level:levelNumber(state,state.active.level),bonus});
}
export function currentReportStreak(state, active=state.active) {
  return active.bonus ? Math.max(0,...state.bonus.streaks.filter(value=>value<5)) : state.exercises[active.type].streak;
}
export function help(state) {
  const a=state.active;if(!a||a.resolved||a.help)return null;
  a.help=true;state.exercises[a.type].stats.helped++;
  if(a.bonus){state.bonus.stats.helped++;state.bonus.streaks[a.type]=0;}
  else state.exercises[a.type].streak=0;
  return event(state,'help-entered',{questionId:a.id,module:state.exercises[a.type].id});
}
export function answer(state,correct,value) {
  const a=state.active;if(!a||a.resolved)return null;
  const exercise=state.exercises[a.type],independent=a.first===null&&!a.help;
  if(a.first===null)a.first=correct;
  if(independent){
    exercise.stats[correct?'correct':'wrong']++;
    if(a.bonus)state.bonus.stats[correct?'correct':'wrong']++;
    if(correct){
      if(a.bonus){state.bonus.correct++;state.bonus.streaks[a.type]++;}
      else {exercise.streak++;exercise.counts[a.level]++;}
    }else if(a.bonus)state.bonus.streaks[a.type]=0;else exercise.streak=0;
  }
  if(correct)a.resolved=true;
  const result={correct,independent,reward:0,cleared:false};
  if(correct&&independent){
    if(a.bonus&&state.bonus.streaks.every(n=>n===5)){
      state.bonus.done=true;result.cleared=true;
      const range=rewardRange(state,a.type,a.level,true);
      result.reward=Math.min(range.max,Math.round(range.min*state.bonus.correct/(5*state.exercises.length)));
    }else if(!a.bonus&&exercise.streak===5){
      exercise.cleared++;exercise.streak=0;result.cleared=true;
      const range=rewardRange(state,a.type,a.level);
      result.reward=Math.min(range.max,Math.round(range.min*exercise.counts[a.level]/5));
    }
    if(result.reward){
      const id=`${state.campaign}:${a.bonus?'bonus':`${exercise.id}:${a.level}`}${state.managedRewards ? `:run:${state.managedResetId || 'initial'}` : ''}`;
      if(!state.rewards.some(r=>r.id===id)){
        state.coins+=result.reward;state.rewards.push({id,coins:result.reward,at:new Date().toISOString()});
        event(state,'reward-earned',{rewardId:id,ruleKey:a.bonus?'bonus':(state.managedRuleKeys?.[a.type] || exercise.id),coins:result.reward,questionId:a.id});
      }
    }
  }
  event(state,'question-answered',{questionId:a.id,module:exercise.id,level:levelNumber(state,a.level),bonus:a.bonus,correct,independent,helped:a.help,currentStreak:currentReportStreak(state,a),value});
  if(result.cleared)event(state,'level-completed',{module:exercise.id,level:levelNumber(state,a.level),bonus:a.bonus,coins:result.reward});
  if(result.cleared&&(a.bonus||exercise.cleared===levelCount(state)))event(state,'exercise-ended',{module:a.bonus?'bonus':exercise.id,completed:true});
  return result;
}
export function localStore(key) {
  return {async load(){const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;},async save(state){localStorage.setItem(key,JSON.stringify(state));}};
}
export function validateState(state,campaign) {
  if(!state||state.schema!==1||state.campaign!==campaign.id||state.levelCount!==campaign.levels.length||state.exercises?.length!==campaign.exercises.length||!Array.isArray(state.events)||!Array.isArray(state.rewards)||!Array.isArray(state.seen)||!state.bonus)throw Error('This save is not compatible with this campaign. Your saved data has been preserved.');
  campaign.exercises.forEach((x,i)=>{const e=state.exercises[i];if(e.id!==x.id||!Number.isInteger(e.cleared)||e.cleared<0||e.cleared>campaign.levels.length||!Number.isInteger(e.streak)||e.streak<0||e.streak>4||e.counts?.length!==campaign.levels.length)throw Error('The saved progress is invalid. Your data has been preserved.');});
  if(state.rewardSettings){
    const settings=state.rewardSettings,valid=r=>r&&Number.isInteger(r.min)&&Number.isInteger(r.max)&&r.min>=1&&r.max>=r.min&&r.max<=9999;
    if(settings.standard?.length!==campaign.exercises.length||!settings.standard.every(range=>Array.isArray(range)?range.length===5&&range.every(valid):valid(range))||!valid(settings.bonus))throw Error('The saved coin settings are invalid. Your data has been preserved.');
  }
  return state;
}
