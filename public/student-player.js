import {applyPlayerTheme} from './player-theme.js';
import { prepareStudent, watchProgress } from './student-session.js?v=16';
import { downloadActivity } from './offline-downloads.js?v=5';

// Apply the See Maths header to every render, including restored attempts.
function installStandardHeading() {
  const root = document.querySelector('#app');
  function update() {
    const heading = root.querySelector('.paper-heading-with-layout');
    const home = heading?.querySelector('.paper-home-link');
    if (!home || heading.dataset.seemathsBrand === 'home') return;
    heading.classList.add('seemaths-standard-branding');
    home.classList.add('seemaths-brand');
    home.href = 'https://seemaths.org/'; home.title = 'See Maths home';
    home.setAttribute('aria-label', 'See Maths home');
    const logo = home.querySelector('.paper-brand-icon');
    if (logo) {logo.src = '/seemaths-logo.svg'; logo.alt = '';}
    if (!home.querySelector('.seemaths-wordmark')) {
      const wordmark = document.createElement('span');
      wordmark.className = 'seemaths-wordmark'; wordmark.textContent = 'See Maths'; home.append(wordmark);
    }
    const title = heading.querySelector('.paper-brand > h1');
    if (title) title.hidden = true;
    heading.dataset.seemathsBrand = 'home';
  }
  const observer = new MutationObserver(update);
  observer.observe(root, {childList:true,subtree:true}); update();
  window.addEventListener('pagehide', () => observer.disconnect(), {once:true});
}

// Resolve the participant before the player creates/restores its browser attempt.
// A temporary reporting outage must never stop the child opening their maths.
async function start() {
applyPlayerTheme(document.documentElement, new URLSearchParams(globalThis.seemathsExerciseSearch || location.search).get('assignment') || location.pathname);
let student;
try { student = await prepareStudent(); }
catch (error) {
  const root = document.querySelector('#app');
  const heading = document.createElement('h1');
  heading.textContent = error.status === 410 ? 'Exercise expired' : error.status === 404 ? 'Exercise unavailable' : error.status === 409 ? 'Exercise closed' : 'Connect to open this exercise';
  const message = document.createElement('p');
  message.textContent = error.status === 404 ? 'This exercise has expired or been deleted. Ask for a new exercise link.' : error.message;
  const home = document.createElement('a');home.href='/';home.textContent='See Maths';
  root.classList.add('seemaths-assignment-unavailable');root.replaceChildren(heading,message,home);
  return;
}
if (globalThis.seemathsExercisePath) {
  globalThis.seemathsExerciseSearch = location.search;
  history.replaceState(null, '', globalThis.seemathsExercisePath);
}
if ((student?.recipe?.player || new URLSearchParams(location.search).get('player')) === 'arcade') {
  const {startArcade} = await import('/assignment-arcade/bootstrap.js');
  await startArcade(student);
} else {
  installStandardHeading();
  const {readRecipe} = await import('/runtime/seemaths-player.js');
  watchProgress(student);
  const {planActivity} = await import('/runtime/activity-generation.mjs');
  downloadActivity({readRecipe, planActivity});
}
}
await start();
