// One student URL format for creation, list copying and dashboard sharing.
export function studentAssignmentURL(assignment, origin = location.origin) {
  const recipe=assignment.recipe;
  const base = new URL(origin);
  if (/^[0-9]{4}$/.test(String(assignment.reference))) {
    if (base.hostname === 'seemaths.org' || base.hostname.endsWith('.seemaths.org')) {
      base.hostname = recipe.player === 'arcade' ? 'arcade.seemaths.org' : 'player.seemaths.org';
    }
    const url = new URL('/' + assignment.reference, base);
    if (!base.hostname.endsWith('.seemaths.org')) url.searchParams.set('player', recipe.player || 'standard');
    return url.href;
  }
  const parameters=new URLSearchParams({topic:recipe.topic,mode:recipe.mode,count:String(recipe.count),levelMin:String(recipe.levelMin),levelMax:String(recipe.levelMax)});
  if(recipe.blueprint) parameters.set('blueprint',recipe.blueprint);
  parameters.set('player',recipe.player || 'standard');
  if(recipe.mode==='exam') parameters.set('minutes',String(recipe.minutes));
  parameters.set('assignment',assignment.id);
  const url=new URL('/play',origin);url.search=parameters.toString();return url.href;
}
