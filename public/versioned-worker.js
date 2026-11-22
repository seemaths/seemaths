/* Only resources requested by an exercise enter persistent storage. */
const RELEASE = '__RELEASE__';
const BLOBS = 'seemaths-browser-assets-v1', META = 'seemaths-browser-registry-v1';
const key = value => new URL('/_offline/'+value, self.location.origin).href;
const manifests=new Map(), saving=new Map();
const blocked = name => /(?:^|\/)(?:variations?(?:[./-]|$)|variation-(?:showcase|screenshots)(?:[./-]|$)|screenshots?(?:[./-]|$))|\.(?:md|map|csv)$|\/(?:psat-icon|app-icon)-original\.(?:png|svg|webp)$/i.test(name);
let mutations=Promise.resolve();
function transaction(task) {const job=mutations.catch(()=>{}).then(task);mutations=job;return job;}
async function registry(release=RELEASE) {
  if(!manifests.has(release)) manifests.set(release,(async()=>{
    const meta=await caches.open(META);
    let response=await meta.match(key(release+'.json'));
    if(!response) {
      response=await fetch(key(release+'.json'),{cache:'no-store'});
      if(!response.ok) throw Error('Registry unavailable');
      const manifest=await response.json();
      if(manifest.schema!==1||manifest.release!==release) throw Error('Registry release mismatch');
      await meta.put(key(release+'.json'),Response.json(manifest));return manifest;
    }
    return response.json();
  })().catch(error=>{manifests.delete(release);throw error;}));
  return manifests.get(release);
}
async function rootsFor(release) {
  const meta=await caches.open(META), prefix='/_offline/used/'+release+'/';
  const legacy=await meta.match(key('used/'+release+'.json'));
  const roots=legacy?await legacy.json():[];
  for(const request of await meta.keys()) {
    const pathname=new URL(request.url).pathname;
    if(pathname.startsWith(prefix)) roots.push(decodeURIComponent(pathname.slice(prefix.length)));
  }
  return [...new Set(roots)];
}
function rememberRoots(manifest,urls) {
  // Separate idempotent records avoid rewriting a growing library-sized JSON
  // value and remain safe while root and legacy scoped workers overlap.
  return transaction(async()=>{
    const meta=await caches.open(META);
    await Promise.all([...new Set(urls)].map(async name=>{
      const url=key('used/'+manifest.release+'/'+encodeURIComponent(name));
      if(!await meta.match(url)) await meta.put(url,new Response('1'));
    }));
  });
}
async function storeBlob(asset) {
  if(saving.has(asset.hash)) return saving.get(asset.hash);
  const task=(async()=>{
    const cache=await caches.open(BLOBS), url=key(asset.hash);
    if(await cache.match(url)) return;
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok) throw Error('Download failed: '+response.status);
    const body=await response.arrayBuffer();
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(digest!==asset.hash||body.byteLength!==asset.bytes) throw Error('Package integrity mismatch');
    await cache.put(url,new Response(body));
  })().finally(()=>saving.delete(asset.hash));
  saving.set(asset.hash,task);return task;
}
function assetPath(url,manifest) {
  let name=url.pathname;
  if(name==='/api/quode') name='/api/quodes/'+url.searchParams.get('quode');
  if(name==='/favicon.ico') name='/favicon.svg';
  if(name==='/'&&self.location.hostname==='mathspace.seemaths.org') name='/mathspace-player/';
  if((name==='/'||/^\/[0-9]{4}\/?$/.test(name))&&['player.seemaths.org','arcade.seemaths.org'].includes(self.location.hostname)) name='/exercise-player.html';
  if(blocked(name)) return null;
  return manifest.assets[name]?name:manifest.assets[name+'/']?name+'/':null;
}
function closure(manifest,roots) {
  const pending=[...roots], found=new Set();
  for(let i=0;i<pending.length;i++) {
    const name=pending[i],asset=manifest.assets[name];
    if(!asset||blocked(name)||found.has(name)) continue;
    found.add(name);pending.push(...asset.dependencies||[]);
    const id=/^\/([^/]+)\/web\/(?:generator\.mjs|generator-data\.json)$/.exec(name)?.[1];
    if(id) pending.push(...manifest.quodes.find(q=>q.id===id)?.runtimeAssets||[]);
  }
  return [...found];
}
async function saveResources(manifest,roots) {
  await rememberRoots(manifest,roots);
  const pending=closure(manifest,roots), missing=[];
  await Promise.all(Array.from({length:8},async()=>{
    while(pending.length) {const name=pending.shift();try{await storeBlob(manifest.assets[name]);}catch{missing.push(name);}}
  }));
  return missing;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const manifest=await registry();
  const meta=await caches.open(META), previous=await meta.match(key('current'));
  await meta.put(key('installing'),new Response(RELEASE));
  // Refresh only the user's accumulated working set. Merely learning about a
  // new Quode in the registry must never download its source or assets.
  const roots=previous?await rootsFor(await previous.text()):[];
  const missing=await saveResources(manifest,roots.filter(url=>manifest.assets[url]));
  if(missing.length) throw Error('Update incomplete: '+missing.join(', '));
  await self.skipWaiting();
})()));
async function pin(clientId,release) {
  if(clientId) await (await caches.open(META)).put(key('client/'+clientId),new Response(release));
}
async function clientRelease(clientId) {
  return clientId?(await (await caches.open(META)).match(key('client/'+clientId)))?.text():null;
}
async function manifestFor(clientId) {return registry(await clientRelease(clientId)||RELEASE);}
function prune() {
  return transaction(async()=>{
    const meta=await caches.open(META), retained=new Set([RELEASE]);
    for(const name of ['current','installing']) {const saved=await meta.match(key(name));if(saved) retained.add(await saved.text());}
    const clients=await self.clients.matchAll({includeUncontrolled:true,type:'window'}), live=new Set(clients.map(c=>c.id));
    for(const client of clients) retained.add(await clientRelease(client.id)||RELEASE);
    const hashes=new Set();
    for(const release of retained) {
      const saved=await meta.match(key(release+'.json'));if(!saved) continue;
      const manifest=await saved.json(), roots=await rootsFor(release);
      // A still-open page from the former bulk-cache release has no working-set
      // ledger. Keep its runtime files until that page closes, never review data.
      const names=manifest.cachePolicy!=='opportunistic'&&release!==RELEASE?Object.keys(manifest.assets):closure(manifest,roots);
      for(const name of names) if(!blocked(name)) hashes.add(manifest.assets[name].hash);
    }
    for(const request of await meta.keys()) {
      const name=new URL(request.url).pathname;
      if(name.includes('/client/')&&!live.has(name.split('/client/')[1])) await meta.delete(request);
      const match=/\/_offline\/(?:used\/)?([a-f0-9]{16})(?:\.json$|\/)/.exec(name);
      if(match&&!retained.has(match[1])) {await meta.delete(request);manifests.delete(match[1]);}
    }
    const blobs=await caches.open(BLOBS);
    for(const request of await blobs.keys()) if(!hashes.has(new URL(request.url).pathname.split('/').pop())) await blobs.delete(request);
  });
}
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const meta=await caches.open(META), previous=await meta.match(key('current'));
  const old=previous?await previous.text():RELEASE;
  for(const client of await self.clients.matchAll({includeUncontrolled:true,type:'window'})) if(!await clientRelease(client.id)) await pin(client.id,old);
  await meta.put(key('current'),new Response(RELEASE));
  const installing=await meta.match(key('installing'));
  if(installing&&await installing.text()===RELEASE) await meta.delete(key('installing'));
  await prune();await self.clients.claim();
  for(const name of await caches.keys()) if(/^(seemaths-static-|seemaths-shell-|quode-offline-|quode-arcade-)/.test(name)) await caches.delete(name);
})()));
async function serve(request,manifest) {
  const url=new URL(request.url);
  if(url.pathname==='/browser-registry.json') return Response.json(manifest);
  if(url.pathname==='/static-release.json') return Response.json({release:manifest.release,player:manifest.player,generators:manifest.quodes.length});
  const name=assetPath(url,manifest);if(!name) return fetch(request);
  await rememberRoots(manifest,[name]);
  const asset=manifest.assets[name];await storeBlob(asset);
  const saved=await (await caches.open(BLOBS)).match(key(asset.hash));
  return new Response(saved.body,{headers:{'Content-Type':asset.type,'X-SeeMaths-Release':manifest.release,'X-SeeMaths-Asset':asset.hash}});
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/_offline/')||/\/(?:sw|service-worker|versioned-worker)\.js$/.test(url.pathname)) return;
  if(url.pathname.startsWith('/api/')&&!/^\/api\/(?:quodes(?:\/[^/]+)?|quode|activities\/js-catalog)\/?$/.test(url.pathname)) return;
  const manifestPromise=event.request.mode==='navigate'?registry().then(async manifest=>{await pin(event.resultingClientId,RELEASE);return manifest;}):manifestFor(event.clientId);
  event.respondWith(manifestPromise.then(manifest=>serve(event.request,manifest)));
  // Help/data dependencies belong to the Quode actually requested, not every
  // slot in the recipe or every generator advertised by the registry.
  if(/\/web\/generator-data\.json$/.test(url.pathname)) event.waitUntil(manifestPromise.then(manifest=>saveResources(manifest,[url.pathname])));
});
self.addEventListener('message',event=>{
  const type=event.data?.type;
  if(type==='browser-registry-release') {event.ports[0]?.postMessage({activeRelease:RELEASE});return;}
  if(type==='activate-offline-update') {event.waitUntil(self.skipWaiting());return;}
  if(!['cache-page-resources','browser-registry-status','browser-registry-repair'].includes(type)) return;
  event.waitUntil((async()=>{
    try {
      const manifest=await manifestFor(event.source?.id);
      let roots=await rootsFor(manifest.release), missing=[];
      if(type==='cache-page-resources') roots=(event.data.urls||[]).flatMap(value=>{
        try{const url=new URL(value,self.location.origin);const name=url.origin===self.location.origin?assetPath(url,manifest):null;return name?[name]:[];}catch{return [];}
      });
      if(type!=='browser-registry-status') missing=await saveResources(manifest,roots);
      else {const cache=await caches.open(BLOBS);for(const name of closure(manifest,roots)) if(!await cache.match(key(manifest.assets[name].hash))) missing.push(name);}
      const used=await rootsFor(manifest.release), names=closure(manifest,used);
      event.ports[0]?.postMessage({activityDownloads:1,activeRelease:RELEASE,release:manifest.release,player:manifest.player,quodes:manifest.quodes.filter(q=>names.includes('/'+q.id+'/web/generator.mjs')).map(({id,version,browserVersion,revision})=>({id,version,browserVersion,revision})),missing});
      if(type==='cache-page-resources') await prune();
    }catch(error){event.ports[0]?.postMessage({activityDownloads:1,missing:event.data.urls||['registry'],error:error.message});}
  })());
});
