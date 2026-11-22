import {createHash} from 'node:crypto';
import {readFile, readdir, mkdir, writeFile, stat} from 'node:fs/promises';
import path from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const excluded = url => /(?:^|\/)(?:variations?(?:[./-]|$)|variation-(?:showcase|screenshots)(?:[./-]|$)|screenshots?(?:[./-]|$))|\.(?:md|map|csv)$|\/(?:psat-icon|app-icon)-original\.(?:png|svg|webp)$/i.test(url);
const types = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.ico':'image/x-icon', '.ttf':'font/ttf', '.woff2':'font/woff2', '.woff':'font/woff', '.webmanifest':'application/manifest+json', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg'};
export async function buildBrowserRegistry(output, catalog, overrides = {}) {
  const defaults = JSON.parse(await readFile(new URL('./browser-releases.json', import.meta.url)));
  const versions = {...defaults, ...overrides, quodeRevisions:{...defaults.quodeRevisions,...overrides.quodeRevisions}};
  // All player entry points share one protocol and one content-addressed store.
  const register = await readFile(new URL('../public/pwa.js',import.meta.url),'utf8');
  const marker = '// Browser registry registration';
  await writeFile(path.join(output,'pwa.js'), register);
  const pwaFile = path.join(output,'runtime/pwa-register.js');
  const pwaSource = (await readFile(pwaFile,'utf8')).split(marker)[0].split('const appName =')[0];
  await writeFile(pwaFile,pwaSource+marker+'\n'+register);
  // Arcade previously registered a worker with its own cache and scope.
  const arcade = path.join(output,'arcade-player/index.html');
  await writeFile(arcade, (await readFile(arcade,'utf8')).replace("register('./sw.js')", "register('/sw.js', {scope:'/', updateViaCache:'none'})"));
  for(const name of ['arcade-player/app.js','runtime/arcade/app.js']) {
    const file=path.join(output,name);let source=await readFile(file,'utf8');
    const contract='campaign=await response.json();';
    if(!source.includes('prefetchQuodes(')) {
      if(!source.includes(contract)) throw Error('Arcade campaign loading contract changed');
      source="import {prefetchQuodes,arcadeAssetRoots} from '/offline-downloads.js';\n"+source.replace(contract,contract+"await prefetchQuodes(campaign.exercises.map(exercise=>exercise.quode||exercise.id),[location.href,...await arcadeAssetRoots(),...performance.getEntriesByType('resource').map(entry=>entry.name)]);");
      await writeFile(file,source);
    }
  }
  const assets = {};
  async function walk(dir) {
    for (const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (['_offline','_headers','_redirects'].includes(entry.name) || entry.name === 'static-release.json' || entry.name === 'browser-registry.json' || entry.name === 'versioned-worker.js' || entry.name === 'sw.js' || entry.name === 'service-worker.js') continue;
      const file = path.join(dir,entry.name);
      if(entry.isSymbolicLink()) throw Error('Symlinks cannot be published');
      if(entry.isDirectory()) { await walk(file); continue; }
      if(/\.(?:py|pyc|sqlite3|env)$/.test(entry.name)||entry.name.startsWith('.')) throw Error('Unexpected private/server file: '+file);
      if((await stat(file)).size>25*1024*1024) throw Error('Asset exceeds Cloudflare limit');
      const relative = path.relative(output,file), body = await readFile(file), digest = hash(body);
      const url = '/' + relative.replace(/index\.html$/, '');
      if(excluded(url)) continue;
      assets[url] = {hash:digest, bytes:body.length, type:relative.startsWith('api/')?'application/json':types[path.extname(file)]||'application/octet-stream'};
      const target=path.join(output,'_offline',digest);
      await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,body);
      if (relative.endsWith('index.html')) assets['/'+relative] = assets[url];
    }
  }
  await walk(output);
  // Resolve mandatory module/CSS dependencies at build time. Dynamic imports
  // of other Quodes are intentionally absent: those load only when requested.
  for(const [url,asset] of Object.entries(assets)) {
    const file=path.join(output,url.endsWith('/')?url+'index.html':url);
    if(!/\.(?:m?js|css|html)$/.test(file)) continue;
    let source=await readFile(file,'utf8'), references=[];
    if(/\.m?js$/.test(file) && !/\/(?:katex|mathlive)\/|\.min\.js$/.test(url)) {
      const imports=/(?:^|[;\n])[\t ]*(?:import[\t ]*(?:(?:[\w$*,\s]*\{[^}]*\}|[\w$*,\s]+)\s+from\s*)?|export\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s*)["']([./][^"'\n]+)["']/g;
      references.push(...[...source.matchAll(imports)].map(m=>m[1]));
      references.push(...[...source.matchAll(/new\s+URL\(\s*["']([./][^"']+)["']\s*,\s*import\.meta\.url/g)].map(m=>m[1]).filter(value=>/\.css(?:[?#]|$)/.test(value)||catalog.some(q=>url.startsWith('/'+q.id+'/'))));
      if(catalog.some(q=>url.startsWith('/'+q.id+'/'))) references.push(...[...source.matchAll(/import\s*\(\s*["']([./][^"']+)["']/g)].map(m=>m[1]));
    } else if(/\.css$/.test(file)) {
      source=source.replace(/src\s*:\s*([^;}]+)/gi,(declaration,src)=>{const preferred=[...src.matchAll(/url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/g)].find(([,name])=>/\.woff2(?:[?#]|$)/i.test(name));return preferred?'src:url("'+preferred[1]+'")':declaration;});
      references.push(...[...source.matchAll(/url\(\s*['"]?([^'"\)\s]+)['"]?\s*\)/g)].map(m=>m[1]));
    } else if(/\.html$/.test(file)) {
      references.push(...[...source.matchAll(/<(?:script|img)\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m=>m[1]));
      references.push(...[...source.matchAll(/<link\b[^>]*>/gi)].filter(([tag])=>/rel=["'](?:stylesheet|icon|apple-touch-icon|manifest)["']/i.test(tag)).flatMap(([tag])=>[...tag.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1])));
    }
    asset.dependencies=[...new Set(references.flatMap(value=>{try{const target=new URL(value,'https://offline.local'+url);return target.origin==='https://offline.local'&&assets[target.pathname]?[target.pathname]:[];}catch{return [];}}))];
  }
  const group = urls => hash(JSON.stringify(urls.map(url=>[url,assets[url].hash])));
  const quodes = catalog.map(meta => {
    const files=Object.keys(assets).filter(url=>url.startsWith('/'+meta.id+'/')||url==='/api/quodes/'+meta.id);
    const runtimeAssets=files.filter(url=>url.startsWith('/api/') || url.endsWith('/web/generator-data.json') || (url.includes('/web/') && !/\/(?:index\.html|player\.(?:js|css)|app\.js|adventure\.html|offline-assets\.json)$/.test(url)));
    return {id:meta.id, runtimeAssets, version:meta.version, browserVersion:meta.version+'+web.'+(versions.quodeRevisions[meta.id]||0), revision:group(files), files};
  });
  const playerFiles = Object.keys(assets).filter(url=>!quodes.some(q=>q.files.includes(url)));
  const registry = {schema:1, cachePolicy:'opportunistic', workerRevision:hash(await readFile(new URL('../public/versioned-worker.js',import.meta.url))), player:{version:versions.playerVersion, revision:group(playerFiles)}, quodes, assets};
  registry.release = hash(JSON.stringify(registry)).slice(0,16);
  const body=JSON.stringify(registry);
  await writeFile(path.join(output,'browser-registry.json'),body);
  await writeFile(path.join(output,'_offline',registry.release+'.json'),body);
  const worker=(await readFile(new URL('../public/versioned-worker.js',import.meta.url),'utf8')).replace('__RELEASE__',registry.release);
  for(const file of ['sw.js','runtime/service-worker.js','arcade-player/sw.js',...['mathspace','naplan','psat'].map(n=>`${n}-player/service-worker.js`)]) await writeFile(path.join(output,file),worker);
  const bytes = [...new Map(Object.values(assets).map(a=>[a.hash,a.bytes])).values()].reduce((a,b)=>a+b,0);
  await writeFile(path.join(output,'static-release.json'),JSON.stringify({release:registry.release,player:registry.player,generators:quodes.length,files:Object.keys(assets).length,bytes,execution:'browser',delivery:'cloudflare-static-assets'},null,2));
  console.log(JSON.stringify({browserRelease:registry.release,quodes:quodes.length,uniqueBytes:bytes}));
  return registry;
}
