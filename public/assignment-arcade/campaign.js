const levels = ['low', 'medium', 'verbose', 'high', 'challenge'];
const colors = ['#82efc5', '#b9a0ff', '#8dd8ff', '#ffb48e', '#ffd36b'];
let catalogRequest;
async function browserCatalog() {
  catalogRequest ??= fetch('/api/activities/js-catalog').then(async response=>{
    if(response.status===404)return null; // Older local Python previews.
    if(!response.ok)throw new Error('Could not load the question catalogue. Please try again.');
    const catalog=await response.json();
    if(!Array.isArray(catalog))throw new Error('The question catalogue is unavailable.');
    return catalog;
  }).catch(error=>{catalogRequest=undefined;throw error;});
  return catalogRequest;
}

export async function generateExercise(path,init) {
  if(await browserCatalog()) {
    const {fetchExercise}=await import('/runtime/exercise-generation.mjs');
    return fetchExercise(path,init);
  }
  return fetch(path,init);
}

// Reuse the activity planner, including its subject balance and blueprint seed.
// Production plans codes in the browser without generating throwaway questions.
export async function selectStages(recipe) {
  const {player, stages, ...activity} = recipe;
  const catalog=await browserCatalog();
  if(catalog) {
    const {planActivity}=await import('/runtime/activity-generation.mjs');
    return planActivity(catalog,activity).slots.map(slot=>({quode:slot.quode,title:slot.title || slot.quode}));
  }
  const response = await fetch('/api/activities', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({recipe:activity, offset:0, limit:1}),
  });
  const data = await response.json();
  if (!response.ok || data.slots?.length !== recipe.count) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not select Arcade questions. Please try again.');
  }
  return data.slots.map(slot => ({quode:slot.quode, title:slot.title || slot.quode}));
}

export function campaignFromRecipe(recipe, id) {
  if (recipe.player !== 'arcade' || recipe.mode !== 'practice' ||
      !Array.isArray(recipe.stages) || recipe.stages.length !== recipe.count ||
      recipe.count < 1 || recipe.count > 99 || !Number.isInteger(recipe.levelMin) ||
      !Number.isInteger(recipe.levelMax) || recipe.levelMin < 1 || recipe.levelMax > 5 || recipe.levelMin > recipe.levelMax) {
    throw new Error('This Arcade exercise has no valid question selection. Reopen the exercise link.');
  }
  return {
    id, title:'Arcade', levels:levels.slice(recipe.levelMin-1, recipe.levelMax),
    levelNumbers:Array.from({length:recipe.levelMax-recipe.levelMin+1}, (_,i)=>recipe.levelMin+i),
    exercises:recipe.stages.map((stage,i)=>({
      // Repeated codes are separate stages, with separate progress and rewards.
      id:`${stage.quode}:${i}`, quode:stage.quode, name:stage.title, skill:stage.title, color:colors[i%colors.length],
    })),
  };
}

export function progressAttempt(state, recipe) {
  const answers = state.exercises.map(exercise=>({
    value:exercise.stats.attempted ? 'stage' : '',
    checked:exercise.stats.correct+exercise.stats.wrong > 0,
    correct:exercise.cleared === state.levelCount,
  }));
  const tracking = Object.fromEntries(state.exercises.map((exercise,i)=>[i,{
    checks:Math.min(999,exercise.stats.correct+exercise.stats.wrong), helped:exercise.stats.helped > 0, skipped:false,
  }]));
  return {
    id:state.attemptId, recipe, createdAt:state.createdAt, tracking,
    state:{current:Math.max(0,state.exercises.findIndex(e=>e.cleared<state.levelCount)), answers},
    ...(state.bonus.done ? {result:{answers:answers.map((answer,i)=>({...answer,index:i+1})),completedAt:Date.now()}} : {}),
  };
}
