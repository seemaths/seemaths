# Assignment portal integration

The portal is maintained in the standalone SeeMaths repository. Production
player integration and deployment remain separate steps.

## Connect these pieces

1. Add the existing homepage's **Assign** button, passing its bounded recipe to
   `/assignments?...` (supported fields in `integration/PLAYER_INTEGRATION.md`).
2. Integrate `integration/quode-assignment-bridge.js` with the player's local-save
   callback and initial restore. It does not receive assignment credentials.
3. Route this portal and the generator APIs deliberately. Both currently use
   `/api`; keep `/api/activities` pointed at Quode. The portal uses
   `/api/assignments`, `/api/config`, `/api/maintenance/cleanup`, `/assets`,
   `/assignments`, `/a/:id` and `/manage/:id`. Prefix the portal's `/assets` if it
   clashes with the main website. Do not replace the website's root route with this
   module's local preview root accidentally.
4. Create the dedicated Supabase project and run both SQL migrations. Set its
   PostgreSQL pooler URL and other secrets on the SeeMaths backend, not the browser.
5. Set PORTAL_ORIGIN and PLAYER_ORIGIN to final origins. Preserve HTTPS, no-referrer
   policy, and strict iframe origin allowlists. If proxying through Cloudflare,
   configure the trusted client-address boundary for rate limiting; never blindly
   accept arbitrary forwarded-IP headers from clients.
6. Verify PostgreSQL, actual player, route composition and scheduled cleanup in
   staging before production. Production guardrails require HTTPS/PostgreSQL and
   two separate 32+ character secrets. Review grants for the chosen server DB role.

This module is covered by the SeeMaths repository MIT license. No third-party
exam source materials are bundled with it.

## Verified locally

API tests cover authorization boundaries, concurrent numbering and retry safety,
progress revisions and completion, cross-device paper protection, strict payloads,
close/delete, expiry/cleanup, limits, search and headers. Bridge unit tests cover
origin allowlisting, data minimisation and completion. Desktop browser exercise:
create assignment → student number → first answer on teacher dashboard → offline
answer queued → reconnect/sync → complete → reopen with completion preserved.
The real bridge ran against a clearly labelled local test-player fixture, not the
live player. Mobile builder/dashboard widths were checked at 390 CSS px, with no
document overflow. Screenshots are local ignored artifacts.

The dedicated SeeMaths Supabase project is provisioned, both migrations are
installed, and real PostgreSQL API checks passed with a dedicated server role.
The live player has not been connected and this module has not been deployed.
Exact question/working restoration across devices remains outside the
browser-only storage model.
