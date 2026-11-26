# Review: P4 UI. Verdict: PASS

A strong phase. All five views, the grid with letter codes, a coverage strip driven by the engine, who's
working, an issues panel with one-click suggestions that go through the validated edit path, a delta before
saving, the what-if page with a version diff, and setup CRUD for all ten resources. Both P3 notes are done
properly: the carried-off warning plus a live preview of the issue it creates in the neighbouring roster, and
read-only foreign days. The browser walkthrough asserts what it sees rather than only taking pictures.

## Verified (independently)

- `lint`, `format:check`, `typecheck`, `test` **209/209** (14 files), and `build` (7 routes) all pass.
- **I ran `pnpm walkthrough:p4` myself.** Against `next dev`, it failed at the holidays step with Next.js's
  dev-only `InvariantError: Expected clientReferenceManifest to be defined` (a Next dev-server/HMR bug, a 500
  on a cold compile of `/setup/holidays`, not app code). Against a **production build** (`pnpm build && pnpm
start`) after a fresh seed, it gave `WALKTHROUGH OK`, `browser errors: 0`, and 0 server errors in the log.
  The production build is the one that matters, since that's what ships. I restored the committed screenshots
  my run overwrote.
- Read the screenshots: 01, 02 (Process CS), 03 (Coastal clean: strip 1/1 every day, ACC `–` on holidays
  per NO_PUBLIC_HOLIDAYS, CS staffed on the holiday), 08 (scenario 4: 5 → 13 errors, cascade naming Lumen and
  Verdant, 1 week re-planned), 11 (delta before saving, "Save anyway (2 new errors)"), and 12 (the 3 Jan
  carried-off warning and the December ERROR preview, exactly as asked).
- **My own screenshots at 1280×800 and 390×844:** the page itself never scrolls sideways at either width; the
  grid scrolls inside its card with the names column sticky. Usable on a laptop for the demo video.
- The coverage strip equals the validator (`p4.int.test.ts`, mutation-checked). The publish gate now runs inside
  a row-locked transaction (ASSUMPTIONS 46). Good catch from the security review.

## Notes (non-blocking; fold into P5/P6)

1. **`REASSIGN_FROM_POD` makes a permanent BACKUP assignment** (ASSUMPTIONS 50), so one click quietly changes
   future months. Make the confirm text say so ("adds Farhan as a permanent backup for Nimbus Gadgets / CS;
   remove it in Setup → Assignments") and put a note on the assignment row ("added from roster 2026-12 v1").
   Expiry is not needed.
2. **Issues counters disagree:** the tab says "Issues (17)" (ERROR + WARNING) while the filter says "33 of 33"
   (INFO included). Use one definition, or label it "17 to review, 16 info".
3. **"Regenerate" on a PUBLISHED roster** is enabled and creates a new draft. That's correct, but label it
   "Regenerate as new draft" with a one-line confirm, so the demo doesn't look like it overwrites a published
   roster.
4. Run the walkthrough against `pnpm build && pnpm start` in the script's docs (it's more reliable than `dev`),
   and add a single smoke run to P6's deploy check against the public URL, with writes locked (views load,
   writes refused).

Push `main` and confirm CI is green. Then P5, in the CLAUDE.md order: stop when time runs short. P6 (deploy,
passcode lock, docs, metrics) must not be squeezed.
