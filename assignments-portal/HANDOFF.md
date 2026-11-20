# Live assignment integration

The assignment service is deployed to the separate SeeMaths Vercel project
`seemaths/seemaths-assignments`, public alias `https://seemaths-assignments.vercel.app`.
Its server-only credentials connect to the dedicated SeeMaths Supabase database.
The function region is Sydney. The original Sit-N-Study CLI login was preserved;
SeeMaths uses an isolated CLI configuration at `~/.config/seemaths/vercel`.

Cloudflare's `ASSIGNMENTS_ORIGIN` routes assignment APIs, `/assignments`, `/manage/*`,
`/a/*` and portal assets to that backend. `/api/activities` and runtime resources
continue using Quode. Students open `/play` directly; `/a/:id` redirects straight
to the questions. There is no separate student screen.

The Worker adds the existing PSAT-style centred loading bar to the activity shell,
and selects the local `public/student-player.js` wrapper when assignment reporting
is configured. That module resolves/joins the assignment before importing the hosted
player. A fixed-toolbar four-digit Student Id button copies the number. Browser
storage remembers the participant credential and original attempt for the assignment.
`student-session.js` polls the locally saved attempt every two seconds while visible,
coalesces progress in browser storage, and retries unsent snapshots. It sends no raw
answer text or question papers to the assignment database.

Homepage **Copy link** creates a tracked practice/exam assignment, remembers the
private management key locally and reveals **Manage assignment**. Workbook and
solution links remain ordinary document links. Legacy recipe links resolve to a
consistent assignment without disclosing any management key. Expired explicit
assignment UUID links remain expired; anonymous legacy recipe links can create a
fresh activity after the old assignment has been physically purged.

## Verified on the public site

Created a one-question Number assignment on `https://seemaths.org`, opened its
student link, received Student Id 0001, answered a real generated number-line
question correctly, and confirmed the private dashboard reported Completed and
1/1 correct. Reopening retained both the same ID and checked answer. Copying the
ID produced a visible confirmation. Existing API and worker/bridge checks pass.
The dedicated Supabase schema and cron cleanup were provisioned in the setup chat.
The app's server role deliberately has no cron-administration privileges.

No private Quode source or desktop registry was changed. These deployment actions
do not move the question backend, change package downloads, or publish Quode.
The implementation is tracked through the SeeMaths pull-request workflow.

## Compact classroom progress (21 November local session)

Student rows now show only the four-digit ID, one unlabelled dot per question and
active foreground time. Green is correct first try; amber records Help Me (or a
correct retry), red means left/skipped without a correct answer, grey means not yet
completed/tried. Accessible hover labels retain the question number and outcome.
Help opens, check clicks and navigation are captured in the browser; no raw answers
are added to the server payload. `active_seconds` is monotonic and bounded to the
assignment lifetime; migration 003 was applied to the dedicated database.

A ten-question Algebra example was exercised through the real public player with
four participants. Student 0001: five correct (one with the full Help Me flow), one
skipped; 0002: three correct (one after opening Help Me), two skipped; 0003: two
correct, one skipped; 0004: untried. Remaining questions are grey. The private
example credentials live only in ignored `artifacts/classroom-test.json`.
