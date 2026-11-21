import {createLoadingProgress} from '/runtime/loading-progress.js';
const root = document.querySelector('#app');
const arcade = location.hostname === 'arcade.seemaths.org' || new URLSearchParams(location.search).get('player') === 'arcade';
const pin = /^\/([0-9]{4})\/?$/.exec(location.pathname)?.[1];
document.title = `${arcade ? 'Arcade' : 'Standard player'} · See Maths`;

function entry(message = '', value = '') {
  root.className = 'exercise-entry';
  root.replaceChildren();
  const heading = document.createElement('h1');
  heading.textContent = arcade ? 'See Maths Arcade' : 'See Maths';
  root.append(heading);
  if (arcade) {
    const hero = document.createElement('img');
    hero.className = 'exercise-hero'; hero.alt = 'See Maths Arcade';
    // Use the same hero artwork as the Arcade journey.
    import('/arcade-player/animations.js').then(({nextHomeBanner, animationImage}) => {
      const image = animationImage(nextHomeBanner());
      image.className = 'exercise-hero'; image.alt = 'See Maths Arcade';
      hero.replaceWith(image);
    }).catch(() => hero.remove());
    root.append(hero);
  } else {
    const subtitle = document.createElement('p'); subtitle.textContent = 'Standard player'; root.append(subtitle);
  }
  const form = document.createElement('form');
  const label = document.createElement('label'); label.htmlFor = 'exercise-pin'; label.textContent = 'Enter your exercise PIN';
  const input = document.createElement('input');
  Object.assign(input, {id:'exercise-pin', className:'exercise-pin', type:'text', inputMode:'numeric', maxLength:4, pattern:'[0-9]{4}', required:true, autocomplete:'off', value});
  input.setAttribute('aria-describedby', 'exercise-entry-error');
  input.addEventListener('input', () => {input.value = input.value.replace(/[^0-9]/g, '').slice(0,4);});
  const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Open exercise';
  const error = document.createElement('p'); error.id = 'exercise-entry-error'; error.setAttribute('role','alert'); error.textContent = message;
  form.append(label,input,button,error); root.append(form);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const target = new URL('/' + input.value, location.origin);
    if (!location.hostname.endsWith('.seemaths.org')) target.searchParams.set('player', arcade ? 'arcade' : 'standard');
    location.assign(target);
  });
  input.focus();
}

async function openExercise() {
  root.className = 'questionnaire paper-loading'; root.replaceChildren(createLoadingProgress('Loading exercise'));
  root.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`/api/assignments/${pin}`, {cache:'no-store', signal:AbortSignal.timeout(12000)});
    const exercise = await response.json();
    if (!response.ok) throw new Error([404,410].includes(response.status) ? 'This exercise has expired or is unavailable. Check the PIN or ask for a new exercise.' : 'Could not open this exercise. Please try again.');
    const expected = exercise.recipe.player === 'arcade' ? 'arcade.seemaths.org' : 'player.seemaths.org';
    if (location.hostname.endsWith('.seemaths.org') && location.hostname !== expected) {
      location.replace(`https://${expected}/${pin}${location.hash}`); return;
    }
    const url = new URL(location.href);
    for (const [key,value] of Object.entries(exercise.recipe)) if (key !== 'stages' && value != null) url.searchParams.set(key,value);
    url.searchParams.set('assignment', exercise.id);
    globalThis.seemathsExercisePath = '/' + pin;
    history.replaceState(null, '', url);
    root.className = ''; root.textContent = '';
    await import('/student-player.js?v=16');
  } catch (error) {
    entry(error.name === 'TimeoutError' || error instanceof TypeError ? 'Connect to the internet and try again.' : error.message, pin);
  } finally {root.removeAttribute('aria-busy');}
}
if (pin) await openExercise(); else entry();
