(() => {
  'use strict';
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)) {
    document.querySelectorAll('[data-local-player]').forEach(link => {
      link.href = link.dataset.localPlayer;
    });
  }
  document.querySelectorAll('[data-local-player]').forEach(link => {
    const destination = new URL(link.href);
    destination.searchParams.set('from', 'seemaths');
    link.href = destination.href;
  });
  const $ = id => document.getElementById(id);
  const form = $('activity-form');
  // Small inline vectors and text only: no images, network requests, or animation loop.
  const doodleShapes = [
    '<path d="M12 66 38 12 70 66Z M29 66v-9h9"/>',
    '<path d="M12 60V12M8 60h62M18 48Q36 14 64 24"/>',
    '<path d="M10 40h62M40 72V8M16 16Q40 94 64 16"/>',
    '<circle cx="40" cy="40" r="27"/><path d="M40 40 60 22M40 40h27"/>',
    '<path d="m16 28 26-14 25 14v28L42 70 16 56ZM16 28l26 15 25-15M42 43v27"/>',
    '<path d="M8 42Q24 8 40 42T72 42M8 62h64"/>',
    '<path d="M12 65V15M12 65h56M22 57V43h9v14M39 57V31h9v26M56 57V20h9v37"/>',
    '<path d="M13 61 40 14l27 47ZM40 14v47M36 61v-5h4"/>'
  ];
  const doodleFormulas = ['∫ f(x) dx', 'dy/dx', 'a² + b² = c²', 'πr²', '∑ xᵢ', '√(x + y)', 'f′(x)', 'e⁰ = 1', 'sin θ', 'y = mx + b'];
  const shuffled = values => {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i],result[j]] = [result[j],result[i]];
    }
    return result;
  };
  const shapes = shuffled(doodleShapes), formulas = shuffled(doodleFormulas);
  document.querySelectorAll('.math-margin').forEach((rail,side) => {
    const count = 2 + Math.floor(Math.random() * 2);
    for (let index = 0; index < count; index++) {
      const doodle = document.createElement('span');
      doodle.className = 'margin-doodle';
      doodle.style.top = `${8 + index * (76 / count) + Math.random() * (55 / count)}%`;
      doodle.style.setProperty('--x', `${Math.round(8 + Math.random() * 84)}%`);
      doodle.style.setProperty('--size', `${Math.round(85 + Math.random() * 65)}px`);
      doodle.style.setProperty('--tilt', `${Math.round(Math.random() * 46 - 23)}deg`);
      doodle.style.color = ['#b7cbdc','#b6d6cc','#c9bfdf'][(index + side) % 3];
      const slot = Math.floor(index / 2) + side * 3;
      if ((index + side) % 2 === 0) doodle.innerHTML = `<svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${shapes[slot]}</svg>`;
      else {
        const formula = document.createElement('span');
        formula.textContent = formulas[slot];
        doodle.append(formula);
        doodle.classList.add('margin-formula');
        doodle.style.setProperty('--formula-scale', Math.min(0.47, 1.7 / formulas[slot].length));
      }
      rail.append(doodle);
    }
  });

  let previewCurrent = 0, previewHeight = 360, previewHelp = false;
  let followPreview = false, previewScrollTimer;
  function refreshPreview(topics) {
    const frame = $('question-preview');
    previewCurrent = 0;
    previewHelp = false;
    followPreview = false;
    clearTimeout(previewScrollTimer);
    frame.classList.remove('preview-help');
    const params = new URLSearchParams();
    if (topics && topics !== 'random') params.set('topics', topics);
    frame.src = '/runtime/home-preview.html' + (params.size ? '?' + params : '');
  }

  const questionFrameHeight = () => Math.min(previewHeight, Math.max(240, innerHeight - 48));
  function scrollPreview(force = false) {
    if (previewHelp && !force) return;
    const frame = $('question-preview');
    const bounds = frame.getBoundingClientRect();
    // Follow questions down the page without pulling the reader back up.
    if (bounds.top <= 24) return;
    if (!force && bounds.top >= 24 && bounds.bottom <= innerHeight - 24) return;
    window.scrollTo({top:scrollY + bounds.top - 24, behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }
  function previewStep(step) {
    const index = previewCurrent + step;
    if (index < 0 || index >= 10) return;
    previewHelp = false;
    followPreview = true;
    $('question-preview').classList.remove('preview-help');
    $('question-preview').style.height = `${questionFrameHeight()}px`;
    $('question-preview').contentWindow.postMessage({type:'preview-question',index},location.origin);
  }
  window.addEventListener('resize', () => {
    const frame = $('question-preview');
    frame.style.height = `${previewHelp ? Math.max(240, innerHeight - 48) : questionFrameHeight()}px`;
    if (previewHelp) scrollPreview(true);
  });
  document.querySelectorAll('[data-preview-step]').forEach(button => button.addEventListener('click', () => previewStep(Number(button.dataset.previewStep))));
  window.addEventListener('message', event => {
    const frame = $('question-preview');
    if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'preview-current') {
      previewCurrent = event.data.index;
      document.querySelectorAll('[data-preview-step]').forEach(button => {
        button.disabled = previewCurrent + Number(button.dataset.previewStep) < 0 || previewCurrent + Number(button.dataset.previewStep) >= 10;
      });

    }
    if (event.data?.type === 'preview-step' && !previewHelp && [-1,1].includes(event.data.step)) previewStep(event.data.step);
    if (event.data?.type === 'preview-resume') {
      previewHelp = false;
      frame.classList.remove('preview-help');
      frame.style.height = `${questionFrameHeight()}px`;
    }
    if (event.data?.type === 'preview-help') {
      clearTimeout(previewScrollTimer);
      followPreview = false;
      previewHelp = true;
      frame.classList.add('preview-help');
      frame.style.height = `${Math.max(240, window.innerHeight - 48)}px`;
      scrollPreview(true);
      requestAnimationFrame(() => requestAnimationFrame(() => frame.contentWindow.postMessage({type:'preview-help-ready'},location.origin)));
    }
    if (event.data?.type === 'preview-height' && Number.isFinite(event.data.height)) {
      const height = Math.max(160, Math.min(1800, event.data.height));
      previewHeight = height;
      if (!previewHelp) {
        frame.style.height = `${questionFrameHeight()}px`;
        if (followPreview) {
          clearTimeout(previewScrollTimer);
          previewScrollTimer = setTimeout(scrollPreview, 420);
        }
      }

    }
  });
  const showcase = document.querySelector('.question-showcase');
  let previousFormHeight = form.getBoundingClientRect().height;
  let showcaseMotion;
  new ResizeObserver(() => {
    const height = form.getBoundingClientRect().height;
    const delta = previousFormHeight - height;
    previousFormHeight = height;
    if (Math.abs(delta) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const offset = showcaseMotion?.playState === 'running' ? new DOMMatrix(getComputedStyle(showcase).transform).m42 : 0;
    showcaseMotion?.cancel();
    showcaseMotion = showcase.animate([{transform:`translateY(${delta + offset}px)`},{transform:'translateY(0)'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'});
  }).observe(form);
  let topic = null;
  const selectedTopics = new Set();
  const subjectOrder = ['algebra','arithmetic','geometry','measurement','number','statistics'];
  let mode = null;
  const sharedAssignments = new Map();
  function updateCopyLabel() {
    const assignment = topic && mode ? sharedAssignments.get(activityUrl()) : null;
    $('copy-link-label').textContent = assignment ? `Exercise ${assignment.reference}` : 'Create Exercise';
    updateSharing(assignment);
  }
  let sharedURL = '', sharedTitle = '';
  function updateSharing(assignment) {
    sharedURL = assignment?.studentURL || '';
    sharedTitle = assignment ? `See Maths · Exercise ${assignment.reference}` : '';
    $('exercise-share').hidden = !sharedURL;
    $('share-feedback').textContent = '';
    $('share-copy').classList.remove('is-copied');
    $('share-copy').setAttribute('aria-label', 'Copy link');
    $('share-copy').title = 'Copy link';
    if (!sharedURL) return;
    const display = new URL(sharedURL);
    $('exercise-share-url').href = sharedURL;
    $('exercise-share-url').textContent = display.host + display.pathname;
    $('share-native').hidden = typeof navigator.share !== 'function';
    const message = `${sharedTitle}\n${sharedURL}`;
    $('share-whatsapp').href = 'https://wa.me/?' + new URLSearchParams({text:message});
    $('share-email').href = 'mailto:?' + new URLSearchParams({subject:sharedTitle,body:message}).toString().replaceAll('+','%20');
    $('share-gmail').href = 'https://mail.google.com/mail/?' + new URLSearchParams({view:'cm',fs:'1',su:sharedTitle,body:message});
    $('share-facebook').href = 'https://www.facebook.com/sharer/sharer.php?' + new URLSearchParams({u:sharedURL});
    $('share-linkedin').href = 'https://www.linkedin.com/sharing/share-offsite/?' + new URLSearchParams({url:sharedURL});
  }
  // This identifies the shared question blueprint, never a student's generated values.
  const random = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(random);
  else { random[0] = Date.now() >>> 0; random[1] = Math.floor(Math.random() * 0xffffffff); }
  let blueprint = [...random].map(n => n.toString(36)).join('-');
  function freshHome(event) {
    if (event?.persisted) refreshPreview(null);
    cancelAnimationFrame(scrollFrame);
    form.reset();
    $('question-count').value = '20';
    topic = null;
    mode = null;
    selectedTopics.clear();
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(random);
    else { random[0] = Date.now() >>> 0; random[1] = Math.floor(Math.random() * 0xffffffff); }
    blueprint = [...random].map(n => n.toString(36)).join('-');
    document.querySelectorAll('[data-topic],[data-mode]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    for (const id of ['mode-step','settings-step','finish-step','duration-setting','activity-link']) {
      $(id).hidden = true;
      $(id).classList.remove('revealed');
    }
    $('open-activity').disabled = true;
    $('copy-link').disabled = true;
    $('copy-link-label').textContent = 'Create Exercise';
    updateSharing(null);
    $('open-activity-label').textContent = 'Self Study';
    $('activity-link').value = '';
    $('activity-summary').textContent = '';
    $('status').textContent = '';
    $('count-value').textContent = '20 questions';
    $('difficulty-value').textContent = '1–5';
    const slider = document.querySelector('.difficulty-slider');
    slider.style.setProperty('--low', '0%');
    slider.style.setProperty('--high', '100%');
    $('level-min').style.zIndex = '1';
    document.querySelectorAll('[data-minutes]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.minutes === '30')));
    try { sessionStorage.clear(); } catch {}
    // Clear papers only on the homepage; an exercise refresh still restores its attempt.
    if (globalThis.indexedDB) {
      const request = indexedDB.open('seemaths-attempts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('attempts', {keyPath:'id'});
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('attempts', 'readwrite');
        tx.objectStore('attempts').clear();
        tx.oncomplete = tx.onabort = tx.onerror = () => db.close();
      };
    }
    window.scrollTo({top:0, behavior:'instant'});
  }
  // pageshow also runs when Back restores this page from the browser's cache.
  window.addEventListener('pageshow', freshHome);

  const topics = {algebra:'Algebra', arithmetic:'Arithmetic', geometry:'Geometry', measurement:'Measurement', statistics:'Statistics', random:'Mixed'};
  function reveal(id) {
    const section = $(id);
    if (!section.hidden) return;
    section.hidden = false;
    section.classList.add('revealed');
  }
  let scrollFrame = 0;
  function followSelection(selected, next = selected) {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = requestAnimationFrame(() => {
        if (!selected?.isConnected || selected.closest('[hidden]')) return;
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop || 0, height = viewport?.height || innerHeight;
        const margin = 24, current = selected.getBoundingClientRect();
        const following = next && !next.closest('[hidden]') ? next.getBoundingClientRect() : current;
        const first = Math.min(current.top, following.top), last = Math.max(current.bottom, following.bottom);
        let delta = 0;
        if (last - first <= height - margin * 2) {
          if (first < top + margin) delta = first - top - margin;
          else if (last > top + height - margin) delta = last - top - height + margin;
        } else {
          // Keep the current choice visible when the next section is taller
          // than the viewport; never jump past the field being edited.
          if (current.top < top + margin || last > top + height - margin) delta = current.top - top - margin;
        }
        if (Math.abs(delta) > 2) window.scrollTo({top:Math.max(0, scrollY + delta),
          behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
      });
    });
  }
  const nextAfterDifficulty = () => mode === 'exam' ? $('duration-setting') : document.querySelector('.actions');
  form.addEventListener('focusin', event => {
    if (event.target.matches('input,select')) followSelection(event.target);
  });
  const keepFocusedVisible = () => {
    if (form.contains(document.activeElement) && document.activeElement.matches('input,select')) followSelection(document.activeElement);
  };
  window.visualViewport?.addEventListener('resize', keepFocusedVisible);
  window.addEventListener('resize', keepFocusedVisible);
  const cancelFollow = () => cancelAnimationFrame(scrollFrame);
  window.addEventListener('wheel', cancelFollow, {passive:true});
  window.addEventListener('touchstart', cancelFollow, {passive:true});
  function bounded(input, fallback) {
    const value = Number(input.value);
    return Number.isInteger(value) && value >= Number(input.min) && value <= Number(input.max) ? value : fallback;
  }
  function validate(show = false) {
    for (const input of [$('question-count'), ...(mode === 'exam' ? [$('exam-minutes')] : [])]) {
      if (!input.checkValidity() || !input.value) {
        if (show) { input.reportValidity(); input.focus(); }
        return false;
      }
    }
    return !!topic && !!mode;
  }
  function activityUrl() {
    const params = new URLSearchParams({topic, mode, count:String(bounded($('question-count'),20)), levelMin:$('level-min').value, levelMax:$('level-max').value, blueprint});
    params.set('player', mode === 'practice' ? form.elements.player.value : 'standard');
    if (mode === 'exam') params.set('minutes', String(bounded($('exam-minutes'),30)));
    const url = new URL('/play', location.origin);
    url.search = params.toString();
    return url.href;
  }
  function update() {
    $('copy-feedback').hidden = true;
    updateCopyLabel();
    if (!topic || !mode) return;
    $('duration-setting').hidden = mode !== 'exam';
    $('player-setting').hidden = mode !== 'practice';
    $('open-activity-label').textContent = 'Self Study';
    $('activity-link').value = activityUrl();
    const count = bounded($('question-count'),20);
    const min = $('level-min').value, max = $('level-max').value;
    $('count-value').textContent = `${count} ${count === 1 ? 'question' : 'questions'}`;
    $('difficulty-value').textContent = min === max ? min : `${min}–${max}`;
    document.querySelector('.difficulty-slider').style.setProperty('--low', `${(Number(min)-1)*25}%`);
    document.querySelector('.difficulty-slider').style.setProperty('--high', `${(Number(max)-1)*25}%`);
    $('level-min').style.zIndex = min === '5' || max === '1' ? '3' : '1';
    const level = min === max ? `level ${min}` : `levels ${min}–${max}`;
    const duration = mode === 'exam' ? ` · ${bounded($('exam-minutes'),30)} minutes` : '';
    $('activity-summary').textContent = `${topic.split(',').map(t => topics[t]).join(', ')} · ${count} ${count === 1 ? 'question' : 'questions'} · ${level}${duration}`;
    $('status').textContent = '';
    document.querySelectorAll('[data-minutes]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.minutes) === Number($('exam-minutes').value))));
  }
  document.querySelectorAll('[data-topic]').forEach(button => button.addEventListener('click', () => {
    const chosen = button.dataset.topic;
    if (chosen === 'random') {
      selectedTopics.clear(); subjectOrder.forEach(t => selectedTopics.add(t));
    } else if (selectedTopics.has(chosen)) selectedTopics.delete(chosen);
    else selectedTopics.add(chosen);
    topic = selectedTopics.size === subjectOrder.length ? 'random' : subjectOrder.filter(t => selectedTopics.has(t)).join(',') || null;
    document.querySelectorAll('[data-topic]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.topic === 'random' ? topic === 'random' : selectedTopics.has(item.dataset.topic))));
    refreshPreview(topic);
    $('open-activity').disabled = !topic;
    $('copy-link').disabled = !topic;
    if (!topic) { $('activity-summary').textContent = ''; $('activity-link').value = ''; }
    reveal('mode-step'); update(); followSelection(button, $('mode-step'));
  }));
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    reveal('settings-step'); reveal('finish-step'); update(); followSelection(button, document.querySelector('.question-setting'));
  }));
  $('question-count').addEventListener('input', () => {
    if ($('question-count').checkValidity() && $('question-count').value) $('count-range').value = $('question-count').value;
    update();
  });
  $('question-count').addEventListener('change', () => { if (!$('question-count').checkValidity()) $('question-count').reportValidity(); else followSelection($('question-count'), document.querySelector('.difficulty-setting')); });
  $('count-range').addEventListener('input', () => { $('question-count').value = $('count-range').value; update(); });
  $('count-range').addEventListener('change', () => followSelection($('count-range'), document.querySelector('.difficulty-setting')));
  $('level-min').addEventListener('input', () => {
    if (Number($('level-min').value) > Number($('level-max').value)) $('level-max').value = $('level-min').value;
    update();
  });
  $('level-max').addEventListener('input', () => {
    if (Number($('level-max').value) < Number($('level-min').value)) $('level-min').value = $('level-max').value;
    update();
  });
  $('level-min').addEventListener('change', () => {
    if (Number($('level-min').value) > Number($('level-max').value)) $('level-max').value = $('level-min').value;
    update(); followSelection($('level-min'), $('level-max'));
  });
  $('level-max').addEventListener('change', () => {
    if (Number($('level-max').value) < Number($('level-min').value)) $('level-min').value = $('level-max').value;
    update(); followSelection($('level-max'), nextAfterDifficulty());
  });
  $('exam-minutes').addEventListener('input', update);
  form.querySelectorAll('[name="player"]').forEach(input => input.addEventListener('change', update));
  $('exam-minutes').addEventListener('change', () => followSelection($('exam-minutes'), document.querySelector('.actions')));
  document.querySelectorAll('[data-minutes]').forEach(button => button.addEventListener('click', () => { $('exam-minutes').value = button.dataset.minutes; update(); followSelection(button, document.querySelector('.actions')); }));
  $('activity-link').addEventListener('click', event => event.target.select());
  async function assignmentLink() {
    const exercise = activityUrl();
    if (!['practice', 'exam'].includes(mode)) return exercise;
    let assignment = sharedAssignments.get(exercise);
    if (!assignment) {
      const params = new URL(exercise).searchParams;
      const recipe = Object.fromEntries(params);
      for (const key of ['count','levelMin','levelMax','minutes']) if (key in recipe) recipe[key] = Number(recipe[key]);
      if (recipe.player === 'arcade') {
        const {selectStages} = await import('/assignment-arcade/campaign.js');
        recipe.stages = await selectStages(recipe);
      }
      const response = await fetch('/api/assignments', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(recipe)});
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not create the exercise.');
      assignment = data;
      const storageKey = 'seemaths.assignments.managed.v1';
      let existing = [];
      try { existing = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch {}
      localStorage.setItem(storageKey, JSON.stringify([{id:data.id,key:data.managementToken,reference:data.reference,recipe:data.recipe,createdAt:data.createdAt,expiresAt:data.expiresAt}, ...existing.filter(a => a.id !== data.id)]));
      sharedAssignments.set(exercise, assignment);
    }
    const {studentAssignmentURL}=await import('/assignment-links.js?v=2');
    assignment.studentURL = studentAssignmentURL(assignment);
    updateCopyLabel();
    return assignment.studentURL;
  }
  $('share-copy').addEventListener('click', async () => {
    if (!sharedURL) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(sharedURL);
      $('share-copy').classList.add('is-copied');
      $('share-copy').setAttribute('aria-label', 'Link copied'); $('share-copy').title = 'Link copied';
      $('share-feedback').textContent = 'Link copied';
    } catch {
      $('activity-link').value = sharedURL; $('activity-link').hidden = false;
      $('activity-link').focus(); $('activity-link').select(); $('status').textContent = 'Copy the selected link.';
    }
  });
  $('share-native').addEventListener('click', async () => {
    if (!sharedURL || !navigator.share) return;
    try {await navigator.share({title:sharedTitle,text:sharedTitle,url:sharedURL});}
    catch (error) {if (error.name !== 'AbortError') $('status').textContent = 'Use Copy or choose another sharing option.';}
  });
  $('copy-link').addEventListener('click', async () => {
    if (!validate(true)) return;
    const button = $('copy-link'); button.disabled = true;
    $('status').textContent = ''; $('copy-feedback').hidden = true;
    let url;
    try { url = await assignmentLink(); }
    catch (error) { $('status').textContent = error.message; button.disabled = false; return; }
    button.disabled = false;
    $('activity-link').value = url;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      $('activity-link').hidden = true;
      $('status').textContent = '';
      $('copy-feedback').hidden = false;
    } catch {
      $('activity-link').hidden = false; $('activity-link').focus(); $('activity-link').select();
      $('status').textContent = 'Copy the selected link.';
      followSelection($('activity-link'));
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!validate(true)) return;
    location.assign(activityUrl());
  });
})();
