// Every player uses the same local registry. Check once per page launch and on
// reconnect; an open document stays pinned while new documents use the update.
if ('serviceWorker' in navigator && window.top === window) {
  let registration, observed;
  const state = document.documentElement.dataset;
  const ready = () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = ({data}) => {
      channel.port1.close();
      if (data.activityDownloads === 1 && data.missing?.length === 0) {
        state.quodeOffline = 'ready'; state.browserPackages = 'ready';
      }
    };
    worker.postMessage({type:'cache-page-resources',urls:[location.href,...performance.getEntriesByType('resource').map(r=>r.name)]},[channel.port2]);
  };
  navigator.serviceWorker.addEventListener('controllerchange', ready);
  const watch = worker => {
    if (!worker) return;
    state.browserPackages = 'downloading';
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') worker.postMessage({type:'activate-offline-update'});
      if (worker.state === 'redundant') state.browserPackages = 'paused';
      if (worker.state === 'activated') state.browserPackages = 'ready';
    });
  };
  const update = async () => {
    try {
      registration ||= await navigator.serviceWorker.register('/sw.js', {scope:'/', updateViaCache:'none'});
      if (observed !== registration) {
        registration.addEventListener('updatefound', () => watch(registration.installing));
        observed = registration;
      }
      watch(registration.installing);
      if (!registration.installing && registration.active) state.browserPackages = 'ready';
      await registration.update();
      registration.waiting?.postMessage({type:'activate-offline-update'});
      await navigator.serviceWorker.ready;
      ready();
      // Remove obsolete player scopes so future visits cannot revive them.
      for (const other of await navigator.serviceWorker.getRegistrations()) {
        if (other.scope !== registration.scope && /\/(?:mathspace|naplan|psat|arcade)-player\/$/.test(new URL(other.scope).pathname)) await other.unregister();
      }
    } catch (error) {
      state.browserPackages = 'paused';
      console.warn('See Maths downloads paused; reconnect to retry.', error);
    }
  };
  window.addEventListener('load', update, {once:true});
  window.addEventListener('online', update);
  // Persistent storage is requested in response to an ordinary user gesture.
  // Browsers decide whether to grant it; downloads also work without the grant.
  window.addEventListener('pointerdown', () => navigator.storage?.persist?.().catch(() => {}), {once:true});
}
