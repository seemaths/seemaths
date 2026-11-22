// Download the activity's complete module set after its first question paints.
// Questions themselves remain lazy: future variations are generated locally.
export function downloadActivity({readRecipe, planActivity}) {
  if (!('serviceWorker' in navigator)) return;
  const panel = document.createElement('aside');
  panel.className = 'seemaths-downloads';
  panel.hidden = true;
  const row = document.createElement('div');
  const label = document.createElement('span');
  label.textContent = 'Downloading questions…';
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const retry = document.createElement('button');
  retry.type = 'button'; retry.textContent = 'Retry'; retry.hidden = true;
  const bar = document.createElement('progress');
  bar.setAttribute('aria-label', 'Question downloads');
  row.append(label, retry); panel.append(row, bar);
  document.body.append(panel);
  let total = 0, finished = new Set(), running = false, complete = false, stopped = false;
  let ids, roots, observedFooter, resize, show, started = false, generation = 0, workerUpgrades = 0;
  const state = document.documentElement.dataset;
  state.activityOffline = 'downloading';
  function position() {
    const footer = document.querySelector('.paper-footer');
    const box = footer?.getBoundingClientRect();
    panel.style.bottom = `${box?.height ? Math.max(0, innerHeight - box.top) + 12 : 18}px`;
    if (footer && observedFooter !== footer) {
      observedFooter = footer; resize?.disconnect();
      resize = new ResizeObserver(position); resize.observe(footer);
    }
  }
  function update(failed = false) {
    const count = `${finished.size}/${total}`;
    label.textContent = !navigator.onLine ? `Connect to finish · ${count}`
      : failed ? `Download paused · ${count}` : `Downloading ${count}`;
    bar.max = Math.max(1, total); bar.value = finished.size;
    retry.hidden = !failed || !navigator.onLine;
    panel.dataset.completed = String(finished.size); panel.dataset.total = String(total);
    position();
  }
  let registrationPromise;
  async function offlineRegistration() {
    if (!registrationPromise) {
      registrationPromise = (async () => {
        let timer;
        try {
          return await Promise.race([
            navigator.serviceWorker.register('/sw.js', {scope:'/', updateViaCache:'none'})
              .then(() => navigator.serviceWorker.ready),
            new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Offline storage did not start. Please retry.')), 30000);}),
          ]);
        } finally {clearTimeout(timer);}
      })().catch(error => {registrationPromise = null; throw error;});
    }
    return registrationPromise;
  }
  async function cache(urls) {
    const registration = await offlineRegistration();
    const worker = navigator.serviceWorker.controller || registration.active;
    if (!worker) throw Error('Offline storage is not ready.');
    if (registration.waiting) {
      const error = Error('An offline update is waiting.');
      error.code = 'worker-update-required'; throw error;
    }
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {channel.port1.close(); reject(Error('Download timed out.'));}, 45000);
      channel.port1.onmessage = ({data}) => {
        clearTimeout(timer); channel.port1.close();
        if (data?.activityDownloads !== 1) {
          const error = Error('The offline worker needs updating.');
          error.code = 'worker-update-required'; reject(error);
        } else if (!Array.isArray(data?.missing)) reject(Error('Offline download could not be verified.'));
        else if (data.missing.length) {
          const error = Error('Some files are still missing.');
          error.missing = data.missing.map(url => new URL(url, location.origin).pathname);
          reject(error);
        }
        else resolve();
      };
      worker.postMessage({type:'cache-page-resources', urls}, [channel.port2]);
    });
  }
  async function upgradeWorker() {
    const registration = await offlineRegistration();
    const previous = navigator.serviceWorker.controller;
    state.activityOffline = 'updating'; label.textContent = 'Updating downloads…';
    return new Promise((resolve, reject) => {
      let settled = false, installing;
      const activate = () => registration.waiting?.postMessage({type:'activate-offline-update'});
      const watch = () => {
        activate();
        if (installing !== registration.installing) {
          installing?.removeEventListener('statechange', activate);
          installing = registration.installing;
          installing?.addEventListener('statechange', activate);
        }
      };
      const done = error => {
        if (settled) return; settled = true;
        clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed);
        registration.removeEventListener('updatefound', watch);
        installing?.removeEventListener('statechange', activate);
        error ? reject(error) : resolve();
      };
      const changed = () => {if (navigator.serviceWorker.controller !== previous) done();};
      const timer = setTimeout(() => done(Error('The offline update has not activated yet.')), 30000);
      navigator.serviceWorker.addEventListener('controllerchange', changed);
      registration.addEventListener('updatefound', watch);
      // A waiting worker may predate the download protocol. Fetch the current
      // script, including its imports, instead of trusting that waiting copy.
      registration.update().then(() => {
        watch();
        changed();
      }).catch(done);
    });
  }
  async function run() {
    if (running || complete || stopped) return;
    const currentGeneration = generation;
    running = true; retry.hidden = true;
    delete panel.dataset.error;
    state.activityOffline = 'downloading';
    try {
      if (!ids) {
        const response = await fetch('/api/activities/js-catalog');
        if (!response.ok) throw Error('Catalogue unavailable.');
        const {getAttempt} = await import('/runtime/seemaths-attempts.js');
        const attemptId = new URLSearchParams(location.search).get('attempt');
        const attempt = attemptId ? await getAttempt(attemptId) : null;
        const plan = planActivity(await response.json(), attempt?.recipe || readRecipe());
        ids = [...new Set(plan.slots.map(slot => slot.quode))]; total = ids.length;
        roots = [location.href, '/play/', '/api/activities/js-catalog',
          '/offline-downloads.js', '/runtime/questionnaire.js',
          ...performance.getEntriesByType('resource').map(entry => entry.name)]
          .map(value => new URL(value, location.href).pathname === '/favicon.ico' ? '/favicon.svg?v=division' : value);
      }
      update();
      // Shared rendering, styles and the saved-attempt loader must also be ready.
      await cache(roots);
      if (generation !== currentGeneration) return;
      const pending = ids.filter(id => !finished.has(id));
      const consume = async () => {
        while (pending.length && !stopped) {
          const id = pending.shift();
          await cache([`/${id}/web/generator.mjs`, `/${id}/web/generator-data.json`, `/api/quodes/${id}`]);
          if (generation !== currentGeneration) return;
          finished.add(id); update();
        }
      };
      // Keep bandwidth available for answering the current question.
      const results = await Promise.allSettled([consume(), consume()]);
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      if (!stopped && generation === currentGeneration && finished.size === total) {
        complete = true; clearTimeout(show); panel.hidden = true;
        state.activityOffline = 'ready';
        window.dispatchEvent(new CustomEvent('seemaths:offline-ready', {detail:{quodes:total}}));
      }
    } catch (error) {
      if (error.code === 'worker-update-required' && navigator.onLine && workerUpgrades < 1) {
        workerUpgrades++;
        try { await upgradeWorker(); }
        catch (updateError) { error = updateError; }
      }
      if (generation === currentGeneration) {
        state.activityOffline = navigator.onLine ? 'paused' : 'offline';
        panel.dataset.error = error.message;
        panel.dataset.missing = JSON.stringify(error.missing || []);
        console.warn('[See Maths offline downloads]', error.message, error.missing || []);
        update(true);
      }
    } finally {
      running = false;
      if (generation !== currentGeneration && !stopped) run();
    }
  }
  const online = () => { workerUpgrades = 0; if (!complete) run(); };
  const offline = () => { if (!complete) update(); };
  const changedWorker = () => {
    generation++; finished.clear(); complete = false;
    if (started && !stopped) {
      state.activityOffline = 'downloading'; panel.hidden = false; update(); run();
    }
  };
  retry.onclick = () => {workerUpgrades = 0; run();};
  window.addEventListener('online', online); window.addEventListener('offline', offline);
  window.addEventListener('resize', position);
  navigator.serviceWorker.addEventListener('controllerchange', changedWorker);
  window.addEventListener('pagehide', () => {
    stopped = true; clearTimeout(show); resize?.disconnect();
    window.removeEventListener('online', online); window.removeEventListener('offline', offline);
    window.removeEventListener('resize', position);
    navigator.serviceWorker.removeEventListener('controllerchange', changedWorker);
  }, {once:true});
  function start() {
    if (!document.querySelector('#app .paper-question')) return false;
    started = true;
    show = setTimeout(() => { if (!complete && !stopped) { panel.hidden = false; position(); } }, 350);
    // Let the first question paint before starting any extra downloads.
    requestAnimationFrame(() => requestAnimationFrame(run));
    return true;
  }
  if (!start()) {
    const observer = new MutationObserver(() => {if (start()) observer.disconnect();});
    observer.observe(document.querySelector('#app'), {childList:true, subtree:true});
    window.addEventListener('pagehide', () => observer.disconnect(), {once:true});
  }
}

// Arcade also prepares its whole selected campaign before entering the game.
// This only downloads the supplied IDs, never the complete catalogue.
export async function prefetchQuodes(ids, roots = []) {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.register('/sw.js', {scope:'/', updateViaCache:'none'});
  if (navigator.onLine) await registration.update();
  const pending = registration.installing || registration.waiting;
  if (pending && !['activated','redundant'].includes(pending.state)) await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{pending.removeEventListener('statechange',changed);reject(Error('Exercise downloads are paused. Please retry.'));},60000);
    const changed=()=>{
      if(pending.state==='installed')pending.postMessage({type:'activate-offline-update'});
      if(['activated','redundant'].includes(pending.state)){clearTimeout(timer);pending.removeEventListener('statechange',changed);(pending.state==='activated'||registration.active)?resolve():reject(Error('Exercise downloads are paused. Please retry.'));}
    };
    pending.addEventListener('statechange',changed);changed();
  });
  await navigator.serviceWorker.ready;
  const worker=navigator.serviceWorker.controller || registration.active;
  const urls=[...roots,...[...new Set(ids)].flatMap(id=>{
    if(!/^[a-z0-9][a-z0-9_-]*$/.test(id))throw Error('Invalid exercise question code');
    return [`/${id}/web/generator.mjs`,`/${id}/web/generator-data.json`,`/api/quodes/${id}`];
  })];
  await new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    const timer=setTimeout(()=>{channel.port1.close();reject(Error('Exercise downloads are paused. Please retry.'));},60000);
    channel.port1.onmessage=({data})=>{clearTimeout(timer);channel.port1.close();
      data?.activityDownloads===1&&Array.isArray(data.missing)&&!data.missing.length?resolve():reject(Error('Connect to finish downloading this exercise.'));
    };
    worker.postMessage({type:'cache-page-resources',urls},[channel.port2]);
  });
}

export async function arcadeAssetRoots() {
  const base=new URL('/arcade-player/',location.origin);
  const response=await fetch(new URL('assets/manifest.json',base));
  if(!response.ok)throw Error('Connect to finish downloading the Arcade characters.');
  const artwork=await response.json();
  return ['/arcade-player/icon.svg','/arcade-player/assets/manifest.json',...Object.entries(artwork).flatMap(([id,asset])=>asset.bytesAfter
    ? [`assets/banners/${id}.webp`,`assets/banners/${id}-poster.webp`]
    : [`assets/sprites/${id}.gif`,`assets/poses/${id}.png`]).map(path=>new URL(path,base).href)];
}
