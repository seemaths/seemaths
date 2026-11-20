import '/teacher.js?v=1';
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
  `${location.origin}/manage/${id}${window.seemathsTeacher.number() ? `?teacher=${window.seemathsTeacher.number()}` : ""}#key=${encodeURIComponent(key)}`;
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
      teacherNumber: assignment.teacherNumber,
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
  root.innerHTML = `<section class="error-page"><p class="eyebrow">See Maths assignments</p><h1>${error.status === 410 ? "Assignment expired" : error.status === 403 ? "Private link needed" : "Could not open this page"}</h1><p class="muted">${escape(error.message)}</p><div class="actions"><a class="primary" href="/assignments">My assignments</a><button class="secondary" id="retry">Try again</button></div></section>`;
  document.querySelector("#retry").onclick = () => location.reload();
}
function listItem(item, managed = false) {
  return `<a class="assignment-item" href="${managed ? `/manage/${item.id}?teacher=${item.teacherNumber || ""}` : `/a/${item.id}`}"><div class="item-top"><h3>${escape(topicLabel(item.recipe.topic))}</h3><span class="pill ${item.closed ? "closed" : ""}">${item.closed ? "Closed" : item.recipe.mode === "exam" ? "Exam" : "Practice"}</span></div><p class="reference">${ref(item.reference)}</p>${item.teacherNumber ? `<p class="small">Teacher Id ${escape(item.teacherNumber)}</p>` : ""}<p>${item.recipe.count} questions · Levels ${item.recipe.levelMin}–${item.recipe.levelMax}</p><p class="small">Expires ${date(item.expiresAt)}</p></a>`;
}
function setNav(name) {
  document
    .querySelector("#nav-mine")
    .classList.toggle("active", name === "mine");
  document
    .querySelector("#nav-discover")
    .classList.toggle("active", name === "discover");
}

async function home() {
  setNav('mine');
  const assignments=await window.seemathsTeacherReady;
  const number=window.seemathsTeacher.number();
  if(number) history.replaceState(null,'',`/assignments?teacher=${number}`);
  root.innerHTML=`<div class="page-heading"><div><h1>Assignments</h1><p class="muted">${number ? `Teacher Id ${escape(number)}` : 'Recover your assignments with your Teacher Id.'}</p></div><a class="primary" href="/">Create Assignment</a></div>
    <form class="teacher-lookup" id="teacher-lookup"><label for="teacher-number">Teacher Id</label><input id="teacher-number" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" minlength="8" placeholder="8-digit number" required><button class="secondary">Find assignments</button></form>
    <section class="panel"><div class="section-label"><h2>${assignments.length} Assignments</h2><button class="quiet" id="refresh-list">Refresh</button></div><div class="assignment-list">${assignments.length ? assignments.map(a=>listItem(a,true)).join('') : '<p class="muted">No active assignments. Assignments and progress expire after seven days.</p>'}</div></section>`;
  document.querySelector('#teacher-lookup').onsubmit=e=>{e.preventDefault();location.assign(`/assignments?teacher=${document.querySelector('#teacher-number').value}`);};
  document.querySelector('#refresh-list').onclick=()=>location.reload();
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
  const teacherNumber = new URLSearchParams(location.search).get("teacher");
  if (!key && !teacherNumber)
    throw Object.assign(
      new Error(
        "Use the private management link saved when this assignment was created.",
      ),
      { status: 403 },
    );
  const progressPath=`/api/assignments/${id}/manage${teacherNumber ? `?teacher=${teacherNumber}` : ""}`;
  const assignment = await api(progressPath, { key });
  const newlyCreated = fragment.get("new") === "1";
  if (key && remember(assignment, key))
    history.replaceState(null, "", `${location.pathname}${assignment.teacherNumber ? `?teacher=${assignment.teacherNumber}` : ""}`);
  else if(key)
    toast("Browser storage is unavailable. Save your private management link.");
  setNav("mine");
  root.innerHTML = `<a class="back-link" href="/assignments${assignment.teacherNumber ? `?teacher=${assignment.teacherNumber}` : ""}">My assignments</a><div class="dashboard-heading"><p class="eyebrow">Assignment <span class="reference">${ref(assignment.reference)}</span></p><h1>${topicLabel(assignment.recipe.topic)}</h1><div class="heading-meta"><span>${assignment.recipe.count} questions</span><span>${assignment.recipe.mode === "exam" ? "Exam" : "Practice"}</span><span>Levels ${assignment.recipe.levelMin}–${assignment.recipe.levelMax}</span><span>Expires ${expiryDate(assignment.expiresAt)}</span></div></div>
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
      render(await api(progressPath, { key }));
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
  if(!key) for(const selector of ['#copy-management','#save-link','#close-assignment','#delete-assignment']) document.querySelector(selector).hidden=true;

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


try {
  purgeExpiredSessions();
  await window.seemathsTeacherReady;
  config = await api("/api/config");
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] === "manage" && parts[1]) await dashboard(parts[1]);
  else if (parts[0] === "a" && parts[1]) location.replace(studentURL(parts[1]));
  else if (new URLSearchParams(location.search).get("view") === "discover")
    await discover();
  else await home();
} catch (error) {
  errorPage(error);
}
