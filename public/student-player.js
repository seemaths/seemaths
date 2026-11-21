import {applyPlayerTheme} from './player-theme.js';
import { prepareStudent, watchProgress } from './student-session.js?v=16';
import { downloadActivity } from './offline-downloads.js?v=4';

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
  const {readRecipe} = await import('/runtime/seemaths-player.js');
  watchProgress(student);
  const {planActivity} = await import('/runtime/activity-generation.mjs');
  downloadActivity({readRecipe, planActivity});
}
}
await start();
