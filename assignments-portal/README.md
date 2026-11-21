# See Maths assignment portal

Account-free assignments and numbered progress in the standalone SeeMaths
repository, separate from Quode and Sit-N-Study deployments. No teacher/student names, email fields, free-text titles or login
providers are part of the data model.

## Run locally

```sh
cd assignments-portal
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 4180 --no-access-log
```

Open `http://127.0.0.1:4180/assignments`. Local state is in
`data/portal.sqlite3`, ignored by Git. The frontend uses native JavaScript and CSS;
there is no Node build or CDN dependency. Python 3.9+ is supported locally;
use a supported Python 3.12+ runtime for deployment. Environment files are examples,
not automatically loaded: export variables or use the host's environment settings.

## Implemented

- Teacher builder: one topic/mixed, practice or exam, 1–99 questions, difficulty
  levels 1–5, 1–180 exam minutes.
- UUID assignment identity and a separate eight-digit public reference.
- Student link, secret management link and downloadable management-link backup.
- Recent management links saved in this browser, without a teacher identity.
- Public discovery by generated reference/topic. No student progress in public APIs.
- Atomic student-number allocation, max 100 per assignment; idempotent join retries.
- Private student credential and resume link; no credential sent to the maths iframe.
- Dashboard: answered/checked/correct, per-question cells, completion, last sync,
  manual refresh and numeric CSV export; no dashboard polling.
- Close/reopen joining without interrupting existing participants; permanent deletion
  cascades to all associated progress.
- One current progress snapshot per student. Revision checks handle retries and
  out-of-order requests. Completed submissions are immutable.
- Local offline queue, reconnect retries, origin/source validation for player messages.
- Fixed expiry 168 hours after creation, enforced by every assignment/progress API.
- Compact schema, strict request allowlists, no raw answers or question papers uploaded.
- Per-client/participant rate limits plus global creation and active-record caps.

Browser storage is not a cross-device account. Save the management link to return
elsewhere. A student's private resume link restores access to their number, but
the actual generated paper and working remain in the original player's browser
storage. A different paper cannot silently replace an existing in-progress attempt;
continue on the original browser or start a new student session. Shared browsers
must use **Start as another student**. Lost links/storage have no email recovery.

## Player integration is still required

The current live Quode player has deliberately **not** been modified.
See [integration/PLAYER_INTEGRATION.md](integration/PLAYER_INTEGRATION.md) and
`integration/quode-assignment-bridge.js` for the small save-chain hook. Until that
hook is installed, the portal opens `/play` and visibly waits for a player connection;
it does not claim that live progress is working. The bridge shares only question
indices, correctness/null for unchecked answers, completion and an attempt UUID.

Browser-generated scores are useful for practice monitoring, not proof of identity
or an anti-cheating system. The same public exercise link can be forwarded.

## Dedicated Supabase deployment

1. Create the separate SeeMaths Supabase project. Do not reuse Sit-N-Study's database.
2. Run migrations in order from `supabase/migrations/`. Enable Cron/pg_cron for
   migration 002. These migrations do not run automatically on app startup.
3. Set `DATABASE_URL` to the project's PostgreSQL transaction-pooler connection
   string with `sslmode=require`, stored only as a server secret. The driver disables
   prepared statements for pooler compatibility. This app uses PostgreSQL directly,
   not browser access to Supabase REST or Auth.
4. Set `PORTAL_ENV=production`, `PORTAL_ORIGIN` to the actual HTTPS portal origin,
   and `PLAYER_ORIGIN` to the independent SeeMaths player origin.
5. Set separate random `PORTAL_RATE_SECRET` and `PORTAL_CRON_SECRET` values, at least
   32 characters each. The cron secret protects the alternative HTTP cleanup endpoint;
   native Supabase Cron runs directly inside PostgreSQL without it.
6. Deploy this folder as its own FastAPI project, or incorporate its routes into the
   new SeeMaths backend. `vercel.json` selects FastAPI. Configure the proxy to preserve
   `/assignments`, `/a/*`, `/manage/*`, `/assets/*` and this module's `/api/*` routes.
   If sharing `/api` with the generator, prefix these routes (and frontend requests)
   consistently; the generator's `/api/activities` must still route to Quode.
7. Test creation, joining, live player updates, closed joins, expiry and cleanup
   against PostgreSQL before exposing production traffic.

The schema is `assignments_portal`, separate from `public`, with browser roles
revoked and RLS enabled without public policies. Connect using the database owner
or a dedicated server role that can access this schema and bypass RLS as intended;
never expose that database credential to JavaScript. The migration does not create
or distribute a new login role/password. Keep this schema outside exposed PostgREST
schemas. No Supabase anonymous-auth users are created, so they cannot accumulate.

## Expiry and storage bounds

Expired assignments disappear immediately from discovery and reject reads/writes.
Native cron physically deletes them and their cascading progress every 15 minutes.
Therefore physical database retention is at most seven days plus the cleanup
interval while the service is running. Cron execution history is also pruned.
Configure monitoring for failed cleanup; a paused Supabase project cannot execute
jobs until resumed. Logs/backups have their own provider retention policies.

Local/non-Supabase deployments must schedule `python cleanup.py` every 15 minutes,
or POST `/api/maintenance/cleanup` with the cron secret as a Bearer credential.
Browser-only cleanup is not the retention mechanism. Expired local session queues
are removed when the app next opens or detects expiry; we cannot erase storage on
devices that never return, nor exported/downloaded files.

Initial limits: 30 assignment creations/client/hour, 200 globally/hour, 1,000 live
assignments, 100 students/assignment, 10,000 stored student sessions globally,
300 joins/client/hour, 60 progress writes/student/minute, 25 search results/page,
16 KB request bodies. Request limits are enforced on the server in shared database
buckets. Buckets hold keyed hashes, not raw IPs, and expire with their window.
PostgreSQL advisory locks protect quota checks between instances; SQLite uses write
transactions. These are operational ceilings, not a guarantee against distributed
abuse or exhausting monthly bandwidth. Add edge rate limits/monitoring for public
launch; retain enough burst capacity for a school sharing a single public IP.

Do not blindly trust client-supplied forwarding headers. Configure Uvicorn's
trusted proxies for the actual deployment; otherwise clients behind the same
proxy may share a rate bucket. Disable access logs or minimise/redact provider
logs. IPs and pseudonymous results still deserve privacy controls even without
names or emails. Tokens stay in URL fragments until saved locally, are omitted
from Referer, and are stored only as hashes server-side. Everyone holding a
management link can read/delete that assignment; everyone holding a student
credential can operate that student session.

## Verification

```sh
.venv/bin/python -m pytest -q
node --check static/app.js
node --check integration/quode-assignment-bridge.js
node --test tests/bridge.test.mjs
```

API tests use disposable SQLite databases. They cover private access, scope,
concurrent numbering, join retries, bounded schemas, revision/completion handling,
closure/deletion, exact expiry and scheduled cleanup, limits and response headers.
The dedicated SeeMaths Supabase project has both migrations installed. A real
PostgreSQL check passed creation, joining, progress updates, private teacher
access, closed joins and deletion using a dedicated application role. Hosted
routing and the live player bridge remain to be verified.

For an isolated browser check of the real bridge module:

```sh
.venv/bin/python tests/player_fixture.py
PORTAL_ORIGIN=http://127.0.0.1:4182 PLAYER_ORIGIN=http://127.0.0.1:4181 DATABASE_URL=artifacts/browser.sqlite3 .venv/bin/uvicorn app:app --host 127.0.0.1 --port 4182 --no-access-log
```

Create a three-question assignment at port 4182. The separate port 4181 fixture
reports synthetic answers through the real bridge. It is only a test fixture,
not a substitute for the Quode questions and not part of production routing.

## License and deployment status

This module is part of the MIT-licensed SeeMaths repository. See the repository
README for ownership and contribution instructions. Provisioning the database
is separate from deploying this application and connecting the live player.

The assignment UUID identifies each progress dashboard. `/assignments` lists active assignments and accepts an assignment link, UUID, numeric reference or topic. A My Assignments filter appears only when this browser has saved created assignments. No teacher identity is stored. Viewing progress is public by assignment ID; editing and deleting still require the creator’s private management key.

Student progress is sent on local question-save events, Help Me, navigation, and leaving the activity. There is no timer-based sync or realtime subscription. Identical question snapshots are suppressed; elapsed time is included with events. Offline pending snapshots retry when connectivity returns or on the next activity event.
