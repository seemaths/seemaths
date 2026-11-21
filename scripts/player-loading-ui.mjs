import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

// Keep the standalone distribution's loading UI reproducible when importing
// the shared player source. Fail visibly if the source contract changes.
export async function applyPlayerLoadingUI(output) {
  const edit = async (name, replacements) => {
    const file = path.join(output, name);
    let source = await readFile(file, 'utf8');
    for (const [before, after] of replacements) {
      if (!source.includes(before)) throw Error(`Loading UI contract changed: ${name}: ${before.slice(0, 80)}`);
      source = source.replace(before, after);
    }
    await writeFile(file, source);
  };
  const imports = "import {createLoadingProgress, setLoadingProgress} from './loading-progress.js';\n";
  await edit('runtime/questionnaire.js', [
    ['import { fetchExercise }', imports + 'import { fetchExercise }'],
    ["const message = node('p', 'paper-question-pending-message', 'Preparing this question…');\n    message.setAttribute('role', 'status');",
      "const message = createLoadingProgress('Loading question');\n    message.classList.add('paper-question-pending-message');"],
    ["    brand.append(homeLink, titleNode); heading.prepend(brand);",
      "    if (branding.name === 'See Maths') {\n      homeLink.href = 'https://seemaths.org/';\n      homeLink.setAttribute('aria-label', 'See Maths home'); homeLink.title = 'See Maths home';\n      logo.src = '/seemaths-logo.svg';\n      homeLink.append(node('span', 'seemaths-wordmark', 'See Maths'));\n      titleNode.hidden = true;\n    }\n    brand.append(homeLink, titleNode); heading.prepend(brand);"],
    ["state.card.removeAttribute('aria-busy');", "state.card.removeAttribute('aria-busy');\n      state.card.querySelector('.paper-question-pending-message').setAttribute('role', 'alert');"],
  ]);
  await edit('runtime/questionnaire.css', [[
    '.paper-loading-label {', '.paper-loading-label { display:none;'
  ]]);
  await writeFile(path.join(output, 'runtime/questionnaire.css'), (await readFile(path.join(output, 'runtime/questionnaire.css'), 'utf8')) + `
/* Pending questions use the same viewport-centred bar as a loading paper. */
.paper-question-pending[aria-busy="true"] > .paper-band { display:none; }
.paper-question-pending[aria-busy="true"] .paper-question-pending-message {
  position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
  width:min(280px,75vw); margin:0; pointer-events:none;
}
.paper-question-pending[hidden] { display:none!important; }
`);

  await edit('runtime/exam-player.js', [
    ['import { fetchExercise }', imports + 'import { fetchExercise }'],
    ["    const questions = progressive ? Array(items.length).fill(null) : [];",
      "    const plannedQuestions = progressive ? 1 : items.reduce((sum, item) => sum + Number(item.options?.['--count'] ?? 1), 0);\n    let preparedQuestions = 0;\n    setLoadingProgress(loading, 0, plannedQuestions);\n    const questions = progressive ? Array(items.length).fill(null) : [];"],
    ["      if (exercise.sessionId) sessions.add(exercise.sessionId);\n      return {item, questions:",
      "      if (exercise.sessionId) sessions.add(exercise.sessionId);\n      preparedQuestions += exercise.questions.length;\n      setLoadingProgress(loading, preparedQuestions, plannedQuestions);\n      return {item, questions:"],
  ]);
  await edit('runtime/activity-generation.mjs', [
    ['    completed += requested;', '    completed += requested;\n    window.reportProgress?.(requested);'],
    ['export async function generateActivity(catalog, request) {', 'export async function generateActivity(catalog, request, onProgress) {'],
    ['  const window = { blueprint: recipe.blueprint, attemptId, offset, limit };',
      '  let prepared = 0;\n  onProgress?.(0, limit);\n  const window = { blueprint: recipe.blueprint, attemptId, offset, limit,\n    reportProgress(count) { prepared += count; onProgress?.(prepared, limit); } };'],
    ['generateActivity(catalog, JSON.parse(init.body))', 'generateActivity(catalog, JSON.parse(init.body), init.onProgress)'],
  ]);
  await edit('runtime/seemaths-player.js', [
    ['import { fetchActivity }', imports + 'import { fetchActivity }'],
    ["body:JSON.stringify({recipe:attempt.recipe,attemptId:attempt.id,offset,limit})", "body:JSON.stringify({recipe:attempt.recipe,attemptId:attempt.id,offset,limit}),onProgress:(done,total)=>{const loader=root.querySelector('.paper-question-pending:not([hidden]) .paper-loading-progress, .paper-loading .paper-loading-progress');setLoadingProgress(loader,done,total);}"],
    ["    message.textContent='Preparing your questions…';",
      "    message.textContent='';\n    if (!root.querySelector('.paper-loading-progress')) {\n      const opening=element('div','questionnaire paper-loading');\n      opening.append(createLoadingProgress('Loading activity'));root.replaceChildren(opening);\n    }"],
  ]);
  const opening = '<div class="questionnaire paper-loading"><div class="paper-loading-progress"><div class="paper-progress-track paper-progress-indeterminate" role="progressbar" aria-label="Loading activity"><div class="paper-progress-fill"></div></div></div></div>';
  for (const file of ['play/index.html', 'runtime/seemaths.html']) {
    await edit(file, [['<p role="status">Opening your activity…</p>', opening]]);
  }
  for (const file of ['arcade-player/index.html', 'runtime/arcade/index.html']) {
    await edit(file, [['class="loading-spinner" role="status"', 'class="loading-spinner" role="progressbar"']]);
  }
  for (const file of ['arcade-player/app.js', 'runtime/arcade/app.js']) {
    await edit(file, [["loader.setAttribute('role','status')", "loader.setAttribute('role','progressbar')"]]);
  }
  const arcadeLoading = `
/* Match the other players: a centred bar without a loading caption. */
.loading-spinner { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(280px,75vw); height:6px; margin:0; border:0; border-radius:999px; overflow:hidden; background:#ffffff24; animation:none; }
.loading-spinner::after { content:''; display:block; width:35%; height:100%; border-radius:inherit; background:var(--mint); animation:paper-loading-bar 1s ease-in-out infinite; }
@keyframes paper-loading-bar { from { transform:translateX(-120%); } to { transform:translateX(385%); } }
@media(prefers-reduced-motion:reduce) { .loading-spinner::after { animation:none; transform:translateX(95%); } }
`;
  for (const file of ['arcade-player/style.css', 'runtime/arcade/style.css']) {
    const name = path.join(output, file);
    await writeFile(name, await readFile(name, 'utf8') + arcadeLoading);
  }
}
