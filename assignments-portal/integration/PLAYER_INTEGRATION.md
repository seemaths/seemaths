# Connect the Quode player

The hosted player remains an external dependency. Its maintainer must copy `quode-assignment-bridge.js` into the
player's runtime directory alongside `seemaths-player.js`.

1. Import `assignmentBridge` from `./quode-assignment-bridge.js`.
2. Inside `run(root)`, instantiate it once:

   ```js
   const assignment = assignmentBridge({
     allowedPortalOrigins: ['https://seemaths.org', 'http://127.0.0.1:4180'],
   });
   ```

   Use only the deployed portal's actual origin in production. Do not allow arbitrary
   query-supplied origins or `*`. The local origin is for development only.

3. After each successful `putAttempt(snapshot)` in the existing `save()` chain,
   call `assignment.report(snapshot)`. For example, replace that chain's callback
   with `async () => { await putAttempt(snapshot); assignment.report(snapshot); }`.
   Keep existing local-save error handling.
4. On restored attempts, call `assignment.report(attempt)` after mounting the
   questionnaire. This is needed even if no new answer has been entered.
5. Preserve `assignment` and `portalOrigin` query parameters when constructing
   retry/reload URLs. The normal `currentURL()` already preserves query parameters.

The student portal embeds the existing `/play` route with recipe parameters and
these two public context parameters. No management or student credential is sent
to the iframe. The iframe reports only question numbers, correctness (or `null`
for an unchecked exam answer), completion and its random attempt UUID. It never
sends raw answers, question wording, names, or emails.

The portal validates both `event.origin` and `event.source`, the protocol string,
assignment ID and bounded payload. The student credential authorizes the actual
server update. Reports are browser-generated and are **not anti-cheating proof**.

## Creating assignments from the existing homepage

Link the homepage's Assign button to `/assignments?topic=geometry&count=10&mode=practice&levelMin=1&levelMax=5`.
The builder accepts these existing recipe fields as defaults. The first release
supports one topic or `random`, practice/exam, 1–99 questions, levels 1–5, and
1–180 minutes for exams. Workbook/solutions are intentionally excluded from scored
assignments. Existing arbitrary multi-topic/blueprint recipes need an explicit
bounded schema extension before integration.

## Local verification

The live player has **not** been modified by this project. Without the bridge,
the portal opens the exercise and explicitly reports that progress sharing is
waiting for a player connection. It does not invent progress. Automated browser
checks use a local fixture that runs the real bridge module against realistic
attempt snapshots. Connect and verify the real player before production release.
