# SeeMaths

Source for [seemaths.org](https://seemaths.org): the maths activity builder,
Cloudflare routing worker, and account-free assignment portal.

## Run the website

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Wrangler builds `public/` plus the Quode browser distribution into `dist/`.
Cloudflare serves player JavaScript, CSS, artwork, generator modules, generator
data and public catalogues directly as static assets. Question generation,
answer checking, Help Me and document rendering run in the browser. Generation
POST requests return 405; the static deployment never falls back to the old
maths application server. Assignment and teacher APIs still use the assignment
portal, with private responses marked `no-store`.

The build reads the JavaScript Quode checkout selected by `QUODE_SOURCE`
(default on this Mac: `/Users/amarshanand/quode-mathspace-js-trial`). It starts
that checkout's read-only file server on loopback **during the build only** to
export the existing metadata and HTML contracts. It never invokes a question
generator. Missing source or a changed integration contract fails the full build. Public CI
uses `npm run build -- --site-only` to validate the website and portal packaging
without access to the separate private engine checkout; production publishing
requires the full build.
Only the approved browser asset list is exported for each Quode; credentials,
Python sources, tests and student data are excluded. Generated files stay out of
Git. `scripts/preserve-live-arcade.patch` preserves the later deployed reward
slider fixes against that source snapshot and fails if they no longer apply.

The service-worker cache identifies the complete release. Previously downloaded
exercise assets are served from browser storage; a new release installs a new
cache. Exercises must finish loading online before offline use, and browsers may
evict stored data. Static metadata
is cacheable; assignment records and progress API responses are never cached.

The Standard activity player paints its first question before starting background
downloads. `public/offline-downloads.js` uses the same activity planner to find
every distinct Quode selected by the recipe, including slots not yet visited.
Two background jobs save each generator, data, metadata, Help Me assets and their
module/CSS/font dependencies through the service worker. A small counter above
the question strip disappears only after the complete set is verified in storage.
Connection failures leave the counter visible; reconnecting or Retry continues
the unfinished downloads. A change of service worker restarts verification so
files in an obsolete cache cannot produce a false ready state. This saves code
and assets without eagerly generating all question variations.

If an existing browser has an older offline worker or a waiting update, the
downloader checks the latest worker and activates it before retrying. The page
stays open and its draft answer is retained. `npm run verify:offline-upgrade`
reproduces an old active worker plus an older waiting update, verifies automatic
replacement without a page reload, and generates the 99-question recipe offline.

`npm run verify:downloads` tests the 99-question geometry blueprint on desktop
and phone: an unvisited Quode download is interrupted, first-question rendering
continues, the bar remains visible, reconnection completes it, then all 12 types
are opened and 99 fresh questions are generated offline. `PROOF_ORIGIN` and
`PROOF_CHROMIUM` select the site and browser as in the execution checks below.

## Player selection

Practice offers **Standard** (the existing PSAT-style player, selected by default)
and **Arcade** below the difficulty controls. The top navigation keeps NAPLAN and
PSAT. Exams, workbooks and solutions use Standard.

Creating an Arcade assignment uses the existing browser activity planner once and
stores its ordered question codes in the assignment recipe. Each selected slot
becomes a stage, including repeated codes when the requested count exceeds the
catalogue. The chosen difficulty range defines the stages' levels exactly: 2–4
means three levels at difficulties 2, 3 and 4. Five independent correct answers in
a row clear a level. The final bonus uses the highest selected difficulty and
requires five independent correct answers per stage.

The shared question renderer supplies the original answer controls and Help Me.
Browser progress is scoped to the assignment and participant. Teacher dots
represent stages; each becomes correct when all selected levels are cleared,
with help/check counts and active time retained. Completion includes the bonus.
Progress sends on activity events, visibility changes and reconnect, with no
periodic polling. Existing standalone Arcade and Sit-N-Study remain independent.

## Assignment portal

The independent FastAPI application lives in `assignments-portal/`. See its
[setup instructions](assignments-portal/README.md) and
[player integration contract](assignments-portal/integration/PLAYER_INTEGRATION.md).
It uses SQLite locally and a dedicated SeeMaths Supabase PostgreSQL project in
production. It does not use Sit-N-Study's database or Supabase Auth.

Assignments are live on the public site. Copying a practice/exam link creates an
assignment and reveals the private **Manage assignment** link. Students open the
questions directly; a four-digit, click-to-copy Student Id appears in the fixed
See Maths toolbar. No separate student page or login is required.

The assignment backend runs at `https://seemaths-assignments.vercel.app` in the
separate `seemaths` Vercel account (Sydney function region), backed by the dedicated
SeeMaths Supabase project. Cloudflare serves the assignment interface as static HTML/CSS/JavaScript and
routes assignment APIs to it. Generator assets and the shared runtime are deployed to Cloudflare static hosting.
Production generates questions in the browser through its existing JavaScript
generator modules; older local Python previews are also supported. Database
credentials are server-only deployment secrets.

`public/student-player.js` resolves the participant before importing the hosted
player. `public/student-session.js` reads the player's saved IndexedDB attempt
through its existing `getAttempt` export, then sends compact progress snapshots.
This is a version-sensitive integration contract; preserve the runtime module and
attempt-state shape when updating the maths engine. The build publishes browser generator modules and their required templates to the
static deployment; those generated files are excluded from this repository.

To run the complete local website against a local assignment API:

```sh
assignments-portal/.venv/bin/python scripts/preview_assignments.py
npm run dev -- --ip 127.0.0.1 --port 8793 --infer-origin-from-routes=false --var ASSIGNMENTS_ORIGIN:http://127.0.0.1:4184
```

The API uses SQLite by default. To use an existing database, export its server
settings or pass `--env-file /absolute/path/to/private.env` to the preview script.
Never commit that file. Use a separate terminal for each process.

## Validate

```sh
npm run check
npm test
npm run build
cd assignments-portal
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

## Prove local execution

Start `npm run dev -- --port 8798`. In another terminal, run:

```sh
npx playwright install chromium
npm run verify:execution
npm run verify:players
```

`PROOF_ORIGIN=https://seemaths.org npm run verify:execution` tests production.
`PROOF_CHROMIUM` optionally selects an existing Chromium executable, and
`PROOF_OUTPUT` selects the evidence directory (default `artifacts/local-execution`).
The test generates questions from all 69 installed Quodes online, disconnects the
browser, then generates fresh questions at all five levels (345 generations).
It checks incorrect/correct answers and interactive Help Me, uses Try another,
and closes/reopens the player offline. It asserts zero question-generation
network POSTs and saves JSON evidence plus screenshots. This verifies execution
and delivery, not every mathematical variation or every Help Me branch.

For an inspectable browser trace, add `localProof=1` to a player URL. The console
logs `[Quode browser execution]`; `window.__quodeExecution` holds the latest 100
records with Quode ID, question count, execution environment, offline state and
duration. It records no answers or student details and is disabled by default.
`/static-release.json` identifies the deployed release. Static responses carry
`X-SeeMaths-Delivery: static`.

## Deploy

`wrangler.jsonc` identifies the existing `seemaths-home` Worker and its custom
domains. An authorized maintainer can deploy with `npm run deploy` after tests.
This uses the current Cloudflare account; contributors deploy their own copy by
changing the Worker name, domains and backend origin. Publishing this source
does not give contributors deployment credentials.

Deploy `assignments-portal/` separately using its `vercel.json` or another ASGI
host. Store its PostgreSQL URL and random application secrets in that host's
secret settings. Never put deployment credentials or database contents in Git.

## Contribute and license

Anyone may fork the repository and open a pull request. Only the maintainer's
GitHub account, `sitnstudy`, is authorized to merge into `main`.
See [CONTRIBUTING.md](CONTRIBUTING.md).

Original software is licensed under [MIT](LICENSE). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the bundled font and external
content. Contact: `amarsh@seemaths.org`.

The progress dashboard keeps its assignment number and topic, with Copy link beside
the topic and an icon-only manual refresh. Expired or deleted assignment links
stop before importing either player; a saved unexpired session can still reopen
offline. `npm run verify:dashboard` checks the desktop/phone layout, copy, refresh,
CSV export and expiry gates without writing production student records.
