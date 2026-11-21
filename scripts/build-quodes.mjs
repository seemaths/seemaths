// Export the existing read-only JavaScript host at build time. No generators run
// here: only browser source, metadata, templates and HTML shells are published.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {applyPlayerLoadingUI} from './player-loading-ui.mjs';

export async function buildQuodes(output) {
  const root = path.resolve(process.env.QUODE_SOURCE || '/Users/amarshanand/quode-mathspace-js-trial');
  const {serveQuodes} = await import(pathToFileURL(path.join(root,'scripts/run-js-local.mjs')));
  const server = createServer(serveQuodes);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const write = async (name, body) => {const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,body);};
  const exportRoute = async (route,name=route.slice(1)) => {
    const response=await fetch(origin+route,{headers:{'X-Forwarded-Host':'seemaths.org'}});
    if(!response.ok)throw Error(`Static export ${route}: ${response.status}`);
    await write(name,Buffer.from(await response.arrayBuffer()));
  };
  try {
    const players=path.join(root,'quode-players');
    await cp(path.join(players,'psat-player/psat_player/web'),path.join(output,'runtime'),{recursive:true});
    await cp(path.join(players,'quode-player/quode_player/web'),path.join(output,'runtime'),{recursive:true});
    await cp(path.join(players,'quode-player/quode_player/web/arcade'),path.join(output,'arcade-player'),{recursive:true});
    for(const name of ['mathspace','naplan','psat']) {
      const source=path.join(players,`${name}-player/${name}_player/web`);
      await cp(source,path.join(output,`${name}-player/assets`),{recursive:true});
      await exportRoute(`/${name}-player/`,`${name}-player/index.html`);
      await exportRoute(`/${name}-player/manifest.webmanifest`);
      await exportRoute(`/${name}-player/service-worker.js`);
    }
    const response=await fetch(origin+'/api/activities/js-catalog');
    if(!response.ok)throw Error('Could not export catalogue');
    const catalog=await response.json();
    await write('api/activities/js-catalog',JSON.stringify(catalog));
    await exportRoute('/api/quodes','api/quodes/index.html');
    const allowed=JSON.parse(await readFile(path.join(root,'scripts/quode-runtime-assets.json'),'utf8'));
    for(const meta of catalog) {
      const {id}=meta;
      if(!/^[a-z0-9][a-z0-9_-]*$/.test(id))throw Error('Unsafe Quode ID');
      await exportRoute(`/api/quodes/${id}`);
      const files=await (await fetch(origin+`/${id}/web/offline-assets.json`)).json();
      for(const asset of files) {
        if(!allowed.some(name=>asset===`/${id}/${name}`))throw Error('Unexpected browser asset');
        await exportRoute(asset);
      }
      await exportRoute(`/${id}/web/generator-data.json`);
      await exportRoute(`/${id}/web/offline-assets.json`);
      for(const route of ['', 'practice','print'])await exportRoute(`/${id}/${route}`,`${id}/${route?route+'/':''}index.html`);
    }
    await exportRoute('/play/','play/index.html');
    let shell=await readFile(path.join(output,'play/index.html'),'utf8');
    shell=shell.replace('/runtime/seemaths-player.js','/student-player.js?v=16')
      .replace('</head>','<link rel="stylesheet" href="/student-session.css?v=4"></head>');
    await write('play/index.html',shell);
    let player = await readFile(path.join(output,'runtime/seemaths-player.js'),'utf8');
    player = player.replace('readRecipe(search = location.search)', 'readRecipe(search = globalThis.seemathsExerciseSearch || location.search)')
      .replace('new URLSearchParams(location.search), id=', 'new URLSearchParams(globalThis.seemathsExerciseSearch || location.search), id=')
      .replace('const currentURL=()=>{', 'const currentURL=()=>{if(globalThis.seemathsExercisePath)return;')
      .replace("new URLSearchParams(location.search).has('mode')", "new URLSearchParams(globalThis.seemathsExerciseSearch || location.search).has('mode')");
    await write('runtime/seemaths-player.js', player);
    await mkdir(path.join(output,'seemaths-assets'),{recursive:true});
    for(const name of ['favicon.svg','apple-touch-icon.png'])await cp(path.join(output,name),path.join(output,'seemaths-assets',name));

    let attempts=await readFile(path.join(output,'runtime/seemaths-attempts.js'),'utf8');
    const put="export const putAttempt = attempt => transaction('readwrite', store => store.put(cloneData({...attempt, updatedAt:Date.now()})));";
    if(!attempts.includes(put))throw Error('Attempt persistence contract changed');
    await write('runtime/seemaths-attempts.js',attempts.replace(put,put.slice(0,-1)+".then(value => { window.dispatchEvent(new CustomEvent('seemaths:attempt-saved', {detail:{id:attempt.id}})); return value; });"));

    let exercise=await readFile(path.join(output,'runtime/exercise-generation.mjs'),'utf8');
    const generate='const questions = await browser.generate(options, browser.data);';
    if(!exercise.includes(generate))throw Error('Browser generation contract changed');
    exercise=exercise.replace(generate,`const started = performance.now();\n    ${generate}\n    if (new URLSearchParams(location.search).get('localProof') === '1') {\n      const event = {quode:id, count:questions.length, environment:typeof window === 'object' ? 'browser' : 'other', offline:!navigator.onLine, milliseconds:Math.round(performance.now()-started)};\n      (globalThis.__quodeExecution ??= []).push(event);\n      globalThis.__quodeExecution = globalThis.__quodeExecution.slice(-100);\n      console.info('[Quode browser execution]', event);\n    }`);
    await write('runtime/exercise-generation.mjs',exercise);
    // These live reward-slider fixes were deployed after the source snapshot.
    // Preserve them explicitly rather than rolling them back during migration.
    execFileSync('patch',['--batch','-p1','-d',output],{input:await readFile(new URL('./preserve-live-arcade.patch',import.meta.url))});

    await applyPlayerLoadingUI(output);

    // Cache names identify the complete deployment. A waiting service worker
    // activates after old tabs close, keeping their module versions together.
    const digest=createHash('sha256').update(await readFile(new URL(import.meta.url)));
    let files=0,bytes=0;
    async function inventory(dir) {
      for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
        const filename=path.join(dir,entry.name);
        if(entry.isSymbolicLink())throw Error('Symlinks cannot be published');
        if(entry.isDirectory()){await inventory(filename);continue;}
        if(/\.(?:py|pyc|sqlite3|env)$/.test(entry.name)||entry.name.startsWith('.'))throw Error('Unexpected private/server file: '+filename);
        const size=(await stat(filename)).size;if(size>25*1024*1024)throw Error('Asset exceeds Cloudflare limit');
        digest.update(path.relative(output,filename));digest.update(await readFile(filename));files++;bytes+=size;
      }
    }
    await inventory(output);
    const release=digest.digest('hex').slice(0,16);
    let arcadeSW=await readFile(path.join(output,'arcade-player/sw.js'),'utf8');
    arcadeSW=arcadeSW.replace(/quode-arcade-v\d+/,`quode-arcade-${release}`).replace('.then(()=>self.skipWaiting())','')
      .replace("seeds.push('/runtime/seemaths-return.js');", "if (new URL(self.registration.scope).pathname === '/') seeds.push('/');\n  seeds.push('/runtime/seemaths-return.js');")
      .replace('return ["teaching.js", "generator.mjs", "generator-data.json"].map(file => tree(assets + file));',
        'return [tree(`/api/quodes/${id}`), ...["teaching.js", "generator.mjs", "generator-data.json"].map(file => tree(assets + file))];');
    // Metadata is public, immutable within this deployment and safe offline.
    arcadeSW=arcadeSW.replace("url.pathname.startsWith('/api/')||", "(url.pathname.startsWith('/api/')&&!/^\\/api\\/quodes\\/[a-z0-9_-]+$/.test(url.pathname))||")
      .replace("try{const response=await fetch(request);", "try{const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);");
    await write('arcade-player/sw.js',arcadeSW);
    let sw=await readFile(path.join(output,'runtime/service-worker.js'),'utf8');
    for (const contract of ['async function moduleDependencies(url, response) {',
      'return seeMathsShell?.has(url.pathname)',
      'event.ports[0]?.postMessage({ missing: [...new Set(missing)] });']) {
      if (!sw.includes(contract)) throw Error('Offline download contract changed: '+contract);
    }
    // Help Me styles can reference fonts/images not used by the first question.
    // Include those CSS dependencies in the same verified download graph.
    sw=sw.replace('async function moduleDependencies(url, response) {', 'async function moduleDependencies(url, response) {' + String.raw`
  if (url.pathname.endsWith('.css')) {
    let css = await response.text();
    // The browser distribution ships WOFF2 fonts; legacy WOFF/TTF fallback
    // URLs in vendor stylesheets are alternatives, not extra dependencies.
    css = css.replace(/src\s*:\s*([^;}]+)/gi, (declaration, sources) => {
      const preferred = [...sources.matchAll(/url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/g)]
        .find(([, asset]) => /\.woff2(?:[?#]|$)/i.test(asset));
      return preferred ? 'src:url("' + preferred[1] + '")' : declaration;
    });
    return [...css.matchAll(/url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/g)]
      .map(([, asset]) => localURL(asset, url)).filter(Boolean);
  }
`);
    sw=sw.replace('quode-offline-v1',`seemaths-static-${release}`)
      .replace('event.ports[0]?.postMessage({ missing: [...new Set(missing)] });', 'event.ports[0]?.postMessage({ activityDownloads: 1, missing: [...new Set(missing)] });')
      .replace(' || url.pathname.startsWith("/arcade-player/")','')
      .replace('(?:runtime|seemaths-assets|','(?:assignment-arcade|runtime|seemaths-assets|arcade-player|')
      .replace('return seeMathsShell?.has(url.pathname)', 'return /^\\/(?:offline-downloads|student-player|student-session|student-identity|player-theme|exercise-entry|progress-outcomes)\\.(?:js|css)$/.test(url.pathname) || seeMathsShell?.has(url.pathname)')
      .replace('const response = await fetch(request);\n      await remember', 'const stored = await cache.match(request);\n      if (stored) return stored;\n      const response = await fetch(request);\n      await remember');
    sw += `\nself.addEventListener('message', event => {\n  if (event.data?.type === 'activate-offline-update') event.waitUntil(self.skipWaiting());\n});\n`;
    // Root pages are cached during installation, including a plain /play/ shell
    // so another recipe can open offline after the first exercise download.
    sw += `\nself.addEventListener('install', event => event.waitUntil((async () => {\n  const cache=await caches.open(CACHE);\n  await cache.addAll(['/','/play/','/offline.html','/api/activities/js-catalog']);\n})()));\n`;
    sw += `\nself.addEventListener('message', event => {\n  if (event.data?.type === 'activate-offline-update') event.waitUntil(self.skipWaiting());\n});\n`;
    await write('runtime/service-worker.js',sw);
    for(const name of ['mathspace','naplan','psat'])await write(`${name}-player/service-worker.js`,sw);
    await write('static-release.json',JSON.stringify({release,generators:catalog.length,files,bytes,execution:'browser',delivery:'cloudflare-static-assets'},null,2));
    await write('_headers','/*\n  X-Content-Type-Options: nosniff\n  X-SeeMaths-Delivery: static\n  Cache-Control: public, max-age=0, must-revalidate\n/api/*\n  Content-Type: application/json; charset=utf-8\n/arcade-player/sw.js\n  Service-Worker-Allowed: /\n');
    await write('_redirects','/:id/player/* /:id/web/:splat 200\n');
    console.log(JSON.stringify({release,generators:catalog.length,files,bytes}));
  } finally {await new Promise(resolve=>server.close(resolve));}
}
