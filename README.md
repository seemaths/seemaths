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

The portal is not connected to the live player yet. Its local tests use a
fixture; real player integration, production PostgreSQL validation and routing
must pass before publishing the assignment feature on the live website.

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
