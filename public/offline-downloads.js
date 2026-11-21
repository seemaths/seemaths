// Download the activity's complete module set after its first question paints.
// Questions themselves remain lazy: future variations are generated locally.
export function downloadActivity({readRecipe, planActivity}) {
  if (!('serviceWorker' in navigator)) return;
  const panel = document.createElement('aside');
  panel.className = 'seemaths-downloads';
  panel.hidden = true;
  const row = document.createElement('div'); row.setAttribute('aria-hidden', 'true');
  const minimum = document.createElement('span');
  minimum.className = 'seemaths-download-min'; minimum.textContent = '0';
  const maximum = document.createElement('span');
  maximum.className = 'seemaths-download-max'; maximum.textContent = '0';
  const retry = document.createElement('button');
  retry.type = 'button'; retry.hidden = true;
  retry.setAttribute('aria-label', 'Retry downloads'); retry.title = 'Retry downloads';
  retry.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17"/></svg>';
  const bar = document.createElement('progress');
  bar.setAttribute('aria-label', 'Question code downloads');
  row.append(minimum, maximum); panel.append(row, bar, retry);
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
    maximum.textContent = String(total);
    bar.setAttribute('aria-valuetext', `${finished.size} of ${total} question codes downloaded${!navigator.onLine ? ', offline' : failed ? ', paused' : ''}`);
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
            new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Offline storage did not start. Please retry.')), 15000);}),
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
    state.activityOffline = 'updating'; bar.setAttribute('aria-valuetext', 'Updating offline files');
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
