import {createLoadingProgress} from '/runtime/loading-progress.js';
const root = document.querySelector('#app');
const arcade = location.hostname === 'arcade.seemaths.org' || new URLSearchParams(location.search).get('player') === 'arcade';
const pin = /^\/([0-9]{4})\/?$/.exec(location.pathname)?.[1];
document.title = arcade ? 'Arcade · See Maths' : 'See Maths';

function entry(message = '') {
  root.className = 'exercise-entry';
  root.replaceChildren();
  const heading = document.createElement('h1');
  const home = document.createElement('a'); home.className = 'exercise-home-logo';
  home.href = 'https://seemaths.org/'; home.setAttribute('aria-label','See Maths home');
  const mark = document.createElement('img'); mark.src = '/seemaths-logo.svg'; mark.alt = '';
  const wordmark = document.createElement('span'); wordmark.textContent = 'See Maths';
  home.append(mark, wordmark); heading.append(home); root.append(heading);
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
  }
  const form = document.createElement('form');
  const label = document.createElement('p'); label.id = 'exercise-pin-label'; label.textContent = 'Enter your exercise PIN';
  const boxes = document.createElement('div'); boxes.className = 'exercise-pin-boxes';
  boxes.setAttribute('role', 'group'); boxes.setAttribute('aria-labelledby', label.id);
  const error = document.createElement('p'); error.id = 'exercise-entry-error'; error.setAttribute('role','alert'); error.textContent = message;
  let checking = false;
  const inputs = Array.from({length:4}, (_, index) => {
    const input = document.createElement('input');
    Object.assign(input, {id:`exercise-pin-${index + 1}`, className:'exercise-pin', type:'text', inputMode:'numeric', maxLength:1, pattern:'[0-9]', autocomplete:'off'});
    input.setAttribute('aria-label', `PIN digit ${index + 1}`);
    input.setAttribute('aria-describedby', error.id);
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9]/g, '').slice(-1);
      error.textContent = '';
      if (input.value && index < 3) inputs[index + 1].focus();
      void checkPIN();
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => {
      if (event.key === 'Backspace' && !input.value && index > 0) {
        event.preventDefault(); inputs[index - 1].value = ''; inputs[index - 1].focus(); error.textContent = '';
      } else if (event.key === 'ArrowLeft' && index > 0) {event.preventDefault(); inputs[index - 1].focus();}
      else if (event.key === 'ArrowRight' && index < 3) {event.preventDefault(); inputs[index + 1].focus();}
    });
    input.addEventListener('paste', event => {
      event.preventDefault();
      const digits = (event.clipboardData?.getData('text') || '').replace(/[^0-9]/g, '').slice(0,4);
      if (!digits) return;
      const start = digits.length === 4 ? 0 : index;
      for (let offset = 0; offset < digits.length && start + offset < 4; offset++) inputs[start + offset].value = digits[offset];
      error.textContent = ''; inputs[Math.min(start + digits.length, 3)].focus(); void checkPIN();
    });
    boxes.append(input); return input;
  });
  async function checkPIN() {
    if (checking || inputs.some(input => !/^[0-9]$/.test(input.value))) return;
    checking = true; form.setAttribute('aria-busy','true'); inputs.forEach(input => input.disabled = true);
    const code = inputs.map(input => input.value).join('');
    try {
      const response = await fetch(`/api/assignments/${code}`, {cache:'no-store', signal:AbortSignal.timeout(12000)});
      if (!response.ok) {
        error.textContent = [404,410].includes(response.status) ? 'Exercise Not Found' : 'Could not check the PIN. Try again.';
        return;
      }
      const target = new URL('/' + code, location.origin);
      if (!location.hostname.endsWith('.seemaths.org')) target.searchParams.set('player', arcade ? 'arcade' : 'standard');
      location.assign(target);
    } catch {
      error.textContent = 'Connect to the internet and try again.';
    } finally {
      checking = false; form.removeAttribute('aria-busy');
      inputs.forEach(input => {input.disabled = false; input.value = '';}); inputs[0].focus();
    }
  }
  form.append(label,boxes,error); root.append(form);
  form.addEventListener('submit', event => {event.preventDefault(); void checkPIN();});
  inputs[0].focus();
}

async function openExercise() {
  root.className = 'questionnaire paper-loading'; root.replaceChildren(createLoadingProgress('Loading exercise'));
  root.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`/api/assignments/${pin}`, {cache:'no-store', signal:AbortSignal.timeout(12000)});
    const exercise = await response.json();
    if (!response.ok) throw new Error([404,410].includes(response.status) ? 'Exercise Not Found' : 'Could not open this exercise. Please try again.');
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
    await import('/student-player.js?v=17');
  } catch (error) {
    entry(error.name === 'TimeoutError' || error instanceof TypeError ? 'Connect to the internet and try again.' : error.message);
  } finally {root.removeAttribute('aria-busy');}
}
if (pin) await openExercise(); else entry();
