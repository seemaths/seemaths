// Reserve generated variations without counting them as presented attempts.
function fingerprint(code,question) {
  const value=JSON.stringify(question.portableQuestion || [question.question,question.answer,question.choices]);
  let first=2166136261,second=5381;
  for(let i=0;i<value.length;i++){first=Math.imul(first^value.charCodeAt(i),16777619);second=Math.imul(second,33)^value.charCodeAt(i);}
  return `${code}:${(first>>>0).toString(36)}:${(second>>>0).toString(36)}`;
}
export function createQuestionQueue({getState,campaign,fetchBatch,save}) {
  const jobs=new Map();
  const key=(type,level)=>`${campaign.exercises[type].id}:${level}`;
  const queue=(state,type,level)=>{state.questionCache??={};return state.questionCache[key(type,level)]??=[];};
  async function fill(type,level) {
    const state=getState(),id=key(type,level);
    if(queue(state,type,level).length>=3)return;
    if(jobs.has(id))return jobs.get(id);
    const job=(async()=>{
      let candidates=[];
      for(let attempt=0;attempt<3&&queue(state,type,level).length<3;attempt++) {
        const questions=await fetchBatch(type,level,3);
        if(state!==getState())return;
        candidates=questions.map(question=>({question,fingerprint:fingerprint(campaign.exercises[type].quode,question)}));
        const reserved=new Set([...state.seen,...Object.values(state.questionCache).flat().map(x=>x.fingerprint)]);
        for(const item of candidates)if(!reserved.has(item.fingerprint)){queue(state,type,level).push(item);reserved.add(item.fingerprint);}
      }
      // Some visual questions have a finite variation bank. Start another cycle
      // once it is exhausted, rather than making a five-answer streak impossible.
      if(!queue(state,type,level).length&&candidates.length) {
        const alternatives=candidates.filter(x=>x.fingerprint!==state.seen.at(-1));
        const item=(alternatives.length?alternatives:candidates)[0];
        state.seen=state.seen.filter(value=>value!==item.fingerprint);
        queue(state,type,level).push(item);
      }
      if(state===getState())await save();
    })().finally(()=>jobs.delete(id));
    jobs.set(id,job);return job;
  }
  return {
    warm(type,level){fill(type,level).catch(()=>{});},
    available(type,level){return queue(getState(),type,level).length;},
    async take(type,level){
      const state=getState();
      if(!queue(state,type,level).length)await fill(type,level);
      const result=queue(state,type,level).shift();
      if(!result)throw new Error('Reconnect to load questions.');
      return result;
    },
  };
}
