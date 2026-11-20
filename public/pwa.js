// Keep the current page in place when an updated worker takes control.
if ('serviceWorker' in navigator && window.top === window) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', {scope:'/', updateViaCache:'none'})
      .catch(error => console.warn('See Maths offline support unavailable', error));
  });
}
