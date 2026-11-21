// Loading state is visual only; its purpose remains available to screen readers.
export function createLoadingProgress(label = 'Loading questions') {
  const wrapper = document.createElement('div');
  wrapper.className = 'paper-loading-progress';
  const track = document.createElement('div');
  track.className = 'paper-progress-track paper-progress-indeterminate';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', label);
  const fill = document.createElement('div');
  fill.className = 'paper-progress-fill';
  track.append(fill); wrapper.append(track);
  return wrapper;
}

export function setLoadingProgress(wrapper, completed, total) {
  const track = wrapper?.querySelector('[role="progressbar"]');
  if (!track) return;
  const measured = Number.isFinite(completed) && Number.isFinite(total) && total > 0;
  track.classList.toggle('paper-progress-indeterminate', !measured);
  if (!measured) {
    for (const name of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow']) track.removeAttribute(name);
    track.firstElementChild.style.removeProperty('width');
    return;
  }
  const value = Math.max(0, Math.min(completed, total));
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(total));
  track.setAttribute('aria-valuenow', String(value));
  track.firstElementChild.style.width = `${value / total * 100}%`;
}
