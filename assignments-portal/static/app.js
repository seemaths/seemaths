const root = document.querySelector("#app");
const topics = {
  random: "Mixed maths",
  algebra: "Algebra",
  arithmetic: "Arithmetic",
  geometry: "Geometry",
  measurement: "Measurement",
  number: "Number",
  statistics: "Statistics",
};
const topicLabel = value => value.split(",").map(topic => topics[topic] || topic).join(", ");
const mineKey = "seemaths.assignments.managed.v1";
const studentKey = (id) => `seemaths.assignments.student.v1.${id}`;
let config,
  poll,
  toastTimer,
  storageFailed = false;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const ref = (value) => `${value.slice(0, 4)}-${value.slice(4)}`;
const date = (timestamp) =>
  new Date(timestamp * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const expiryDate = (timestamp) =>
  new Date(timestamp * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
const ago = (timestamp) => {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  return seconds < 60
    ? "Just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} min ago`
      : `${Math.floor(seconds / 3600)} hr ago`;
};
const studentNumber = (number) => String(number).padStart(4, "0");
const recipeSummary = (recipe) =>
  `${recipe.count} questions · ${recipe.mode === "exam" ? "Exam" : "Practice"} · Levels ${recipe.levelMin}–${recipe.levelMax}`;
const privateURL = (id, key) =>
  `${location.origin}/manage/${id}#key=${encodeURIComponent(key)}`;
const studentURL = (id) => `${location.origin}/a/${id}`;

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function purgeExpiredSessions() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("seemaths.assignments.student.v1.")) continue;
      const session = read(key, null);
      if (session?.expiresAt && session.expiresAt <= Date.now() / 1000)
        localStorage.removeItem(key);
    }
    write(mineKey, savedAssignments());
  } catch {
    storageFailed = true;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    storageFailed = true;
    return false;
  }
}
function storageAvailable() {
  try {
    localStorage.setItem("seemaths.storage-check", "1");
    localStorage.removeItem("seemaths.storage-check");
    return true;
  } catch {
    return false;
  }
}
function savedAssignments() {
  const entries = read(mineKey, []);
  return Array.isArray(entries)
    ? entries.filter(
        (e) =>
          e &&
          /^[a-f0-9-]{36}$/.test(e.id) &&
          typeof e.key === "string" &&
          e.expiresAt > Date.now() / 1000,
      )
    : [];
}
function remember(assignment, key) {
  return write(mineKey, [
    {
      id: assignment.id,
      key,
      reference: assignment.reference,
      recipe: assignment.recipe,
      expiresAt: assignment.expiresAt,
    },
    ...savedAssignments().filter((a) => a.id !== assignment.id),
  ]);
}
function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (element.hidden = true), 4000);
}
async function copy(text, message = "Link copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    const dialog = document.createElement("dialog");
    dialog.innerHTML =
      '<h2>Copy this link</h2><p class="muted small">Select and copy the complete link.</p><input class="search-input" readonly aria-label="Link to copy"><div class="actions"><button class="secondary">Done</button></div>';
    dialog.querySelector("input").value = text;
    document.body.append(dialog);
    dialog.querySelector("button").onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
    dialog.querySelector("input").select();
  }
}
function download(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function confirmAction(title, description, label = "Delete") {
  const dialog = document.querySelector("#confirm-dialog");
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-description").textContent = description;
  document.querySelector("#confirm-button").textContent = label;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true },
    ),
  );
}
async function api(path, { method = "GET", body, key } = {}) {
  const response = await fetch(path, {
    signal: AbortSignal.timeout(15000),
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : "Check the assignment settings and try again.";
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return data;
}
function errorPage(error) {
  clearInterval(poll);
  root.innerHTML = `<section class="error-page"><p class="eyebrow">See Maths assignments</p><h1>${error.status === 410 ? "Assignment expired" : error.status === 403 ? "Private link needed" : "Could not open this page"}</h1><p class="muted">${escape(error.message)}</p><div class="actions"><a class="primary" href="/assignments">My assignments</a><button class="secondary" id="retry">Try again</button></div></section>`;
  document.querySelector("#retry").onclick = () => location.reload();
}
function listItem(item, managed = false) {
  return `<a class="assignment-item" href="${managed ? `/manage/${item.id}` : `/a/${item.id}`}"><div class="item-top"><h3>${escape(topicLabel(item.recipe.topic))}</h3><span class="pill ${item.closed ? "closed" : ""}">${item.closed ? "Closed" : item.recipe.mode === "exam" ? "Exam" : "Practice"}</span></div><p class="reference">${ref(item.reference)}</p><p>${item.recipe.count} questions · Levels ${item.recipe.levelMin}–${item.recipe.levelMax}</p><p class="small">Expires ${date(item.expiresAt)}</p></a>`;
}
function setNav(name) {
  document
    .querySelector("#nav-mine")
    .classList.toggle("active", name === "mine");
  document
    .querySelector("#nav-discover")
    .classList.toggle("active", name === "discover");
}

function home() {
  setNav("mine");
  const saved = savedAssignments();
  root.innerHTML = `<div class="page-heading"><div><h1>Assignments</h1><p class="muted">Share an exercise and follow your students’ progress.</p></div></div>
    ${!storageAvailable() ? '<p class="notice warning storage-warning">Enable browser storage to create and remember assignments on this device.</p>' : ""}
    <div class="layout"><section class="panel"><div class="section-label"><h2>New assignment</h2><span class="muted">Lasts 7 days</span></div><form id="create-form">
    <fieldset><legend>Topic</legend><div class="topic-grid">${Object.entries(
      topics,
    )
      .map(
        ([value, label]) =>
          `<label class="topic-choice"><input type="radio" name="topic" value="${value}" ${value === "random" ? "checked" : ""}><span>${label}</span></label>`,
      )
      .join("")}</div></fieldset>
    <fieldset><legend>Activity</legend><div class="mode-grid"><label class="mode-choice"><input name="mode" type="radio" value="practice" checked><span>Practice</span></label><label class="mode-choice"><input name="mode" type="radio" value="exam"><span>Exam</span></label></div></fieldset>
    <div class="form-grid"><div class="field"><label for="count">Questions</label><input id="count" name="count" type="number" min="1" max="99" value="10" required></div><div class="field"><label>Difficulty</label><div class="level-fields"><label>From<select name="levelMin" aria-label="Minimum difficulty">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">Level ${n}</option>`).join("")}</select></label><label>To<select name="levelMax" aria-label="Maximum difficulty">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === 5 ? "selected" : ""}>Level ${n}</option>`).join("")}</select></label></div></div><div class="field" id="minutes-field" hidden><label for="minutes">Time limit (minutes)</label><input id="minutes" name="minutes" type="number" min="1" max="180" value="30" required></div></div>
    <div class="divider"></div><p id="create-error" class="error-text" role="alert"></p><div class="form-footer"><span class="expiry-note">No names. No emails.</span><button class="primary" type="submit">Create assignment</button></div></form></section>
    <section class="panel"><div class="section-label"><h2>Saved on this browser</h2><span class="muted">${saved.length}</span></div>${saved.length ? `<div class="assignment-list">${saved.map((a) => listItem(a, true)).join("")}</div><p class="private-note">Your private management links stay in this browser.</p>` : '<div class="empty"><div class="empty-mark" aria-hidden="true">÷</div><h3>Your next assignment starts here.</h3><p>Create an assignment, share the student link and return here to see progress.</p></div>'}</section></div>`;
  const form = document.querySelector("#create-form");
  // A homepage can prefill this builder with the same recipe fields used by /play.
  const query = new URLSearchParams(location.search);
  for (const name of [
    "topic",
    "mode",
    "count",
    "levelMin",
    "levelMax",
    "minutes",
  ])
    if (query.has(name)) {
      const field = form.elements.namedItem(name);
      if (field) field.value = query.get(name);
    }
  const updateMode = () =>
    (document.querySelector("#minutes-field").hidden =
      form.elements.mode.value !== "exam");
  form.addEventListener("change", updateMode);
  updateMode();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]"),
      error = document.querySelector("#create-error");
    error.textContent = "";
    if (!storageAvailable()) {
      error.textContent =
        "Enable browser storage before creating an assignment.";
      return;
    }
    const data = new FormData(form),
      recipe = Object.fromEntries(data);
    for (const name of ["count", "levelMin", "levelMax", "minutes"])
      recipe[name] = Number(recipe[name]);
    if (recipe.levelMin > recipe.levelMax) {
      error.textContent =
        "Minimum difficulty must not exceed maximum difficulty.";
      return;
    }
    button.disabled = true;
    button.textContent = "Creating…";
    try {
      const assignment = await api("/api/assignments", {
        method: "POST",
        body: recipe,
      });
      remember(assignment, assignment.managementToken);
      location.assign(
        `${privateURL(assignment.id, assignment.managementToken)}&new=1`,
      );
    } catch (e) {
      error.textContent = e.message;
      button.disabled = false;
      button.textContent = "Create assignment";
    }
  };
}

async function discover() {
  setNav("discover");
  root.innerHTML =
    '<div class="page-heading"><div><p class="eyebrow">Open exercises</p><h1>Find an assignment.</h1><p class="muted">Search by reference number or maths topic.</p></div></div><form id="search-form" class="search-row"><input class="search-input" id="query" type="search" maxlength="40" placeholder="e.g. 4827-1639 or geometry" aria-label="Search assignments"><button class="primary">Search</button></form><div class="search-results" id="results"></div><div class="actions" id="pagination"></div>';
  let offset = 0;
  const input = document.querySelector("#query");
  const search = async () => {
    try {
      const result = await api(
        `/api/assignments?q=${encodeURIComponent(input.value)}&offset=${offset}`,
      );
      document.querySelector("#results").innerHTML = result.assignments.length
        ? result.assignments.map((a) => listItem(a)).join("")
        : '<p class="muted">No active assignments found.</p>';
      document.querySelector("#pagination").innerHTML =
        `${offset ? '<button class="secondary" id="previous-page">Previous</button>' : ""}${result.assignments.length === 25 ? '<button class="secondary" id="next-page">More assignments</button>' : ""}`;
      document
        .querySelector("#previous-page")
        ?.addEventListener("click", () => {
          offset -= 25;
          search();
        });
      document.querySelector("#next-page")?.addEventListener("click", () => {
        offset += 25;
        search();
      });
    } catch (e) {
      toast(e.message);
    }
  };
  document.querySelector("#search-form").onsubmit = (e) => {
    e.preventDefault();
    offset = 0;
    search();
  };
  await search();
}

async function dashboard(id) {
  const fragment = new URLSearchParams(location.hash.slice(1)),
    stored = savedAssignments().find((a) => a.id === id),
    key = fragment.get("key") || stored?.key;
  if (!key)
    throw Object.assign(
      new Error(
        "Use the private management link saved when this assignment was created.",
      ),
      { status: 403 },
    );
  const assignment = await api(`/api/assignments/${id}/manage`, { key });
  const newlyCreated = fragment.get("new") === "1";
  if (remember(assignment, key))
    history.replaceState(null, "", location.pathname);
  else
    toast("Browser storage is unavailable. Save your private management link.");
  setNav("mine");
  root.innerHTML = `<a class="back-link" href="/assignments">My assignments</a><div class="dashboard-heading"><p class="eyebrow">Assignment <span class="reference">${ref(assignment.reference)}</span></p><h1>${topicLabel(assignment.recipe.topic)}</h1><div class="heading-meta"><span>${assignment.recipe.count} questions</span><span>${assignment.recipe.mode === "exam" ? "Exam" : "Practice"}</span><span>Levels ${assignment.recipe.levelMin}–${assignment.recipe.levelMax}</span><span>Expires ${expiryDate(assignment.expiresAt)}</span></div></div>
  ${newlyCreated ? '<p class="notice" id="created-notice">Your assignment is ready. Share the student link, and save your private management link to return from another browser.</p><div class="divider"></div>' : ""}
  <section class="share-panel"><div><h2>Share this assignment</h2><p>Students tell you their number. Their names stay with you.</p></div><div class="actions"><button class="primary" id="copy-student">Copy student link</button><button class="secondary" id="copy-management">Copy management link</button><button class="secondary" id="save-link" aria-label="Download private management link">Save link</button></div></section>
  <section class="panel students-panel"><div class="students-toolbar"><h2>Student progress</h2><div class="actions"><span class="muted" id="last-sync">Updating…</span><button class="quiet" id="refresh">Refresh</button></div></div><div id="students"></div></section>
  <div class="dashboard-footer"><p>Progress and assignments expire together after 7 days.</p><div class="actions"><button class="secondary" id="export-results">Download results</button><button class="secondary" id="close-assignment">Close joining</button><button class="danger" id="delete-assignment">Delete</button></div></div><p class="error-text" id="dashboard-error" role="alert"></p>`;
  let latest = assignment,
    busy = false;
  function render(data) {
    latest = data;
    document.querySelector("#close-assignment").textContent = data.closed
      ? "Reopen joining"
      : "Close joining";
    document.querySelector("#students").innerHTML = data.students.length
      ? `<div class="student-progress-list">${data.students.map(s => {
          const minutes = Math.floor((s.activeSeconds || 0) / 60);
          const duration = minutes ? `${minutes} ${minutes === 1 ? 'min' : 'mins'}` : s.activeSeconds ? '<1 min' : '0 mins';
          return `<div class="student-progress-row"><span class="student-number">${studentNumber(s.number)}</span><div class="student-progress-dots" aria-label="Question progress">${Array.from({length:data.recipe.count},(_,index) => {
            const answer=s.answers.find(a=>a.index===index+1);
            const state=answer?.correct===true ? (answer.helped || answer.checks>1 ? 'helped' : 'first') : answer?.skipped ? 'skipped' : 'untried';
            const label=state==='first'?'Correct first try':state==='helped'?(answer.helped?'Correct with Help Me':'Correct after retry'):state==='skipped'?'Skipped':answer?'In progress':'Not tried';
            return `<span class="progress-dot ${state}" role="img" aria-label="Question ${index+1}: ${label}" title="Question ${index+1}: ${label}"></span>`;
          }).join('')}</div><span class="student-time" aria-label="Time spent">${escape(duration)}</span></div>`;
        }).join('')}</div>`
      : `<div class="empty"><div class="empty-mark" aria-hidden="true">÷</div><h3>No students have started yet.</h3><p>${data.closed ? "Joining is closed. Reopen it to let students start." : "Share the student link. Progress will appear here as students work."}</p></div>`;
    document.querySelector("#last-sync").textContent = "Updated just now";
    document.querySelector("#dashboard-error").textContent = "";
  }
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      render(await api(`/api/assignments/${id}/manage`, { key }));
    } catch (e) {
      if ([404, 410, 403].includes(e.status)) {
        errorPage(e);
        return;
      }
      document.querySelector("#last-sync").textContent = "Could not refresh";
      document.querySelector("#dashboard-error").textContent =
        "Showing the last saved progress. " + e.message;
    } finally {
      busy = false;
    }
  }
  render(assignment);
  poll = setInterval(refresh, 20000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  document.querySelector("#refresh").onclick = refresh;
  document.querySelector("#copy-student").onclick = () => copy(studentURL(id));
  document.querySelector("#copy-management").onclick = () =>
    copy(privateURL(id, key), "Private management link copied");
  document.querySelector("#save-link").onclick = () =>
    download(
      `seemaths-${ref(assignment.reference)}-private-link.txt`,
      `See Maths ${ref(assignment.reference)}\nPrivate management link — keep this to yourself.\n${privateURL(id, key)}\nExpires ${expiryDate(assignment.expiresAt)}\n`,
    );
  document.querySelector("#export-results").onclick = () => {
    const rows = [
      [
        "Student number",
        "Answered",
        "Questions",
        "Correct",
        "Checked",
        "Completed",
      ],
      ...latest.students.map((s) => [
        s.number,
        s.answered,
        latest.recipe.count,
        s.correct,
        s.answers.filter((a) => typeof a.correct === "boolean").length,
        s.completedAt ? "Yes" : "No",
      ]),
    ];
    download(
      `seemaths-${ref(latest.reference)}-results.csv`,
      rows.map((r) => r.join(",")).join("\n"),
      "text/csv",
    );
  };
  document.querySelector("#close-assignment").onclick = async () => {
    try {
      await api(`/api/assignments/${id}/manage`, {
        method: "PATCH",
        key,
        body: { closed: !latest.closed },
      });
      await refresh();
      toast(
        latest.closed
          ? "Closed to new students. Existing students can continue."
          : "Joining reopened",
      );
    } catch (e) {
      toast(e.message);
    }
  };
  document.querySelector("#delete-assignment").onclick = async () => {
    if (
      !(await confirmAction(
        "Delete this assignment?",
        "This permanently deletes the assignment and every student’s stored progress. Student links will stop working.",
      ))
    )
      return;
    try {
      await api(`/api/assignments/${id}/manage`, { method: "DELETE", key });
      write(
        mineKey,
        savedAssignments().filter((a) => a.id !== id),
      );
      location.assign("/assignments");
    } catch (e) {
      toast(e.message);
    }
  };
}

async function student(id) {
  const assignment = await api(`/api/assignments/${id}`);
  setNav("");
  const hash = new URLSearchParams(location.hash.slice(1));
  let session = read(studentKey(id), null);
  if (hash.has("key") && hash.has("student")) {
    session = { key: hash.get("key"), id: hash.get("student") };
    if (write(studentKey(id), session))
      history.replaceState(null, "", location.pathname);
  }
  const introduction = () => {
    root.innerHTML = `<section class="student-intro"><p class="eyebrow">Assignment ${ref(assignment.reference)}</p><h1>${topicLabel(assignment.recipe.topic)}</h1><p class="muted">Your work has a number. You don’t need an account.</p><section class="panel"><div class="exercise-summary"><div><strong>${assignment.recipe.count}</strong><span>Questions</span></div><div><strong>${assignment.recipe.mode === "exam" ? "Exam" : "Practice"}</strong><span>${assignment.recipe.mode === "exam" ? assignment.recipe.minutes + " minutes" : "At your pace"}</span></div><div><strong>${assignment.recipe.levelMin}–${assignment.recipe.levelMax}</strong><span>Difficulty levels</span></div></div><p class="notice">When you start, tell your teacher your student number. Your progress is shared with whoever has the private management link.</p><div class="divider"></div><button class="primary" id="start" ${assignment.closed ? "disabled" : ""}>${assignment.closed ? "Closed to new students" : "Start assignment"}</button><p class="error-text" id="join-error" role="alert"></p><p class="private-note">Expires ${expiryDate(assignment.expiresAt)}. No names or emails are collected.</p></section></section>`;
    document.querySelector("#start").onclick = async () => {
      const button = document.querySelector("#start");
      button.disabled = true;
      button.textContent = "Getting your number…";
      try {
        if (!storageAvailable())
          throw new Error(
            "Enable browser storage to save your student number and progress.",
          );
        // Save the join secret before sending: network retries never create duplicate students.
        session = read(studentKey(id), null) || { key: randomKey() };
        if (!write(studentKey(id), session))
          throw new Error("Your browser could not save this student session.");
        const joined = await api(`/api/assignments/${id}/join`, {
          method: "POST",
          body: { credential: session.key },
        });
        session = {
          ...session,
          id: joined.id,
          number: joined.number,
          expiresAt: assignment.expiresAt,
        };
        write(studentKey(id), session);
        await openPlayer(joined);
      } catch (e) {
        document.querySelector("#join-error").textContent = e.message;
        button.disabled = false;
        button.textContent = "Start assignment";
      }
    };
  };
  async function openPlayer(initial) {
    let latest = initial,
      queue = session.pending || null,
      sending = false,
      connected = false,
      terminal = false;
    // A stored unsent revision must remain ahead of the server on reload.
    let revision = Math.max(initial.revision, queue?.revision || 0),
      lastSignature = "",
      lastAck = initial.updatedAt;
    if (initial.completedAt) queue = null;
    document.body.classList.add("student-view");
    const badge = document.createElement("div");
    badge.className = "student-id";
    badge.setAttribute("aria-label", `Student Id ${studentNumber(initial.number)}`);
    badge.innerHTML = `<span>Student Id</span><strong>${studentNumber(initial.number)}</strong>`;
    document.querySelector(".masthead .student-id")?.remove();
    document.querySelector(".masthead").append(badge);
    root.innerHTML = `<p class="eyebrow">Assignment ${ref(assignment.reference)} · ${topicLabel(assignment.recipe.topic)}</p><div class="player-toolbar"><span class="sync-status" id="sync-status">${initial.completedAt ? "Assignment completed" : "Connecting to exercise…"}</span><div class="actions"><button class="quiet" id="copy-resume">Copy resume link</button><button class="quiet" id="retry-sync">Retry sync</button><button class="quiet" id="switch-student">Start as another student</button></div></div><p id="player-notice" class="notice warning" hidden></p><iframe id="exercise" title="${escape(topicLabel(assignment.recipe.topic))} assignment" referrerpolicy="no-referrer" allow="fullscreen"></iframe>`;
    const frame = document.querySelector("#exercise"),
      status = document.querySelector("#sync-status"),
      notice = document.querySelector("#player-notice");
    const target = new URL("/play", config.playerOrigin);
    for (const [name, value] of Object.entries(assignment.recipe))
      target.searchParams.set(name, value);
    target.searchParams.set("assignment", id);
    target.searchParams.set("portalOrigin", location.origin);
    if (initial.attemptId || queue?.attemptId)
      target.searchParams.set("attempt", initial.attemptId || queue.attemptId);
    function persist() {
      session = {
        ...session,
        id: initial.id,
        number: initial.number,
        expiresAt: assignment.expiresAt,
        pending: queue,
      };
      if (!write(studentKey(id), session)) {
        notice.hidden = false;
        notice.textContent =
          "Browser storage is unavailable. Keep this page open and copy your resume link.";
      }
    }
    function syncText() {
      if (terminal) return;
      if (queue)
        status.textContent = navigator.onLine
          ? "Progress saved on this device · waiting to sync"
          : "Offline · progress saved on this device";
      else if (initial.completedAt || latest.completedAt)
        status.textContent = "Completed · progress synced";
      else
        status.textContent = connected
          ? `Progress synced · ${ago(lastAck)}`
          : "Connecting to exercise…";
    }
    async function flush() {
      if (!queue || sending || terminal || !navigator.onLine) return;
      sending = true;
      const snapshot = queue;
      try {
        const result = await api(
          `/api/assignments/${id}/students/${initial.id}`,
          { method: "PUT", key: session.key, body: snapshot },
        );
        latest = result;
        lastAck = result.updatedAt;
        if (queue?.revision === snapshot.revision) queue = null;
        persist();
      } catch (e) {
        if ([404, 410, 403, 409].includes(e.status)) {
          terminal = true;
          queue = null;
          persist();
          notice.hidden = false;
          notice.textContent = e.message;
          status.textContent = "Progress sharing stopped";
        } else {
          status.textContent =
            "Progress saved on this device · sync will retry";
        }
      } finally {
        sending = false;
        syncText();
      }
    }
    function onMessage(event) {
      if (
        event.origin !== config.playerOrigin ||
        event.source !== frame.contentWindow
      )
        return;
      const message = event.data;
      if (
        !message ||
        message.assignmentId !== id ||
        message.protocol !== "seemaths.assignments.v1"
      )
        return;
      if (message.type === "ready") {
        connected = true;
        notice.hidden = true;
        syncText();
        return;
      }
      if (
        message.type !== "progress" ||
        !Array.isArray(message.answers) ||
        message.answers.length > assignment.recipe.count ||
        terminal ||
        latest.completedAt
      )
        return;
      const answers = message.answers
        .filter(
          (a) =>
            a &&
            Number.isInteger(a.index) &&
            a.index >= 1 &&
            a.index <= assignment.recipe.count &&
            (typeof a.correct === "boolean" || a.correct === null),
        )
        .map((a) => ({ index: a.index, correct: a.correct }));
      if (
        answers.length !== message.answers.length ||
        new Set(answers.map((a) => a.index)).size !== answers.length
      )
        return;
      const attemptId =
        typeof message.attemptId === "string" &&
        /^[0-9a-f-]{36}$/i.test(message.attemptId)
          ? message.attemptId
          : null;
      const snapshot = {
        answers,
        completed: message.completed === true,
        ...(attemptId ? { attemptId } : {}),
      };
      const signature = JSON.stringify(snapshot);
      if (signature === lastSignature) return;
      lastSignature = signature;
      connected = true;
      notice.hidden = true;
      queue = { ...snapshot, revision: ++revision };
      persist();
      syncText();
      flush();
    }
    window.addEventListener("message", onMessage);
    frame.src = target.href;
    const handshake = setTimeout(() => {
      if (!connected && !initial.completedAt) {
        notice.hidden = false;
        notice.textContent =
          "The exercise has not connected to progress sharing yet. Your teacher will see updates once the player connection is available.";
        status.textContent = "Waiting for exercise connection";
      }
    }, 12000);
    const retry = setInterval(() => {
      if (Date.now() / 1000 >= assignment.expiresAt) {
        terminal = true;
        queue = null;
        localStorage.removeItem(studentKey(id));
        notice.hidden = false;
        notice.textContent =
          "This assignment has expired. Progress sharing has stopped.";
        status.textContent = "Assignment expired";
        frame.hidden = true;
        return;
      }
      flush();
      if (connected) syncText();
    }, 10000);
    window.addEventListener("online", flush);
    document.querySelector("#retry-sync").onclick = () => {
      if (queue) flush();
      else
        toast(
          connected
            ? "Your progress is up to date."
            : "Waiting for the exercise to connect.",
        );
    };
    document.querySelector("#copy-resume").onclick = () =>
      copy(
        `${studentURL(id)}#student=${initial.id}&key=${encodeURIComponent(session.key)}`,
        "Private resume link copied",
      );
    document.querySelector("#switch-student").onclick = async () => {
      if (
        !(await confirmAction(
          "Start as another student?",
          "Copy your resume link first if you want to return to this student number. The next student will receive a different number.",
          "Continue",
        ))
      )
        return;
      localStorage.removeItem(studentKey(id));
      location.assign(studentURL(id));
    };
    window.addEventListener(
      "pagehide",
      () => {
        persist();
        clearInterval(retry);
        clearTimeout(handshake);
        window.removeEventListener("message", onMessage);
        window.removeEventListener("online", flush);
      },
      { once: true },
    );
    await flush();
  }
  if (session?.id) {
    try {
      await openPlayer(
        await api(`/api/assignments/${id}/students/${session.id}`, {
          key: session.key,
        }),
      );
    } catch (e) {
      if (e.status === 404) {
        localStorage.removeItem(studentKey(id));
        session = null;
        introduction();
      } else throw e;
    }
  } else introduction();
}
function randomKey() {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

try {
  purgeExpiredSessions();
  config = await api("/api/config");
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] === "manage" && parts[1]) await dashboard(parts[1]);
  else if (parts[0] === "a" && parts[1]) await student(parts[1]);
  else if (new URLSearchParams(location.search).get("view") === "discover")
    await discover();
  else home();
} catch (error) {
  errorPage(error);
}
