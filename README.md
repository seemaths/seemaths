# SeeMaths

Source for [seemaths.org](https://seemaths.org): the maths activity builder,
Cloudflare routing worker, and account-free assignment portal.

## Run the website

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Wrangler builds `public/` into `dist/` and serves the website locally. The
worker forwards recognised player, runtime and activity API routes to
`BACKEND_ORIGIN`, currently `https://psat.seemaths.org`. Local previews therefore
need internet access for maths activities. The question generators and players
are still hosted by the existing Quode backend; their source and exam materials
are not included in this public repository.

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
SeeMaths Supabase project. Cloudflare routes assignment APIs and teacher dashboards
to it, while question generation remains on the existing Quode backend. Database
credentials are server-only deployment secrets.

`public/student-player.js` resolves the participant before importing the hosted
player. `public/student-session.js` reads the player's saved IndexedDB attempt
through its existing `getAttempt` export, then sends compact progress snapshots.
This is a version-sensitive integration contract; preserve the runtime module and
attempt-state shape when updating the maths engine. No private generator files or
exam materials are copied into this repository.

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
