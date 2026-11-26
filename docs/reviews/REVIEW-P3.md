# Review: P3 Persistence & server actions. Verdict: PASS (round 2)

Very solid phase. The services are well layered: Zod everywhere, typed errors, audit in the same
transaction, latest-version and draft-only guards, an atomic apply with a rollback test, and the publish
gate tested 0/5, 4/5, 5/5, withdrawn, and new-error. The mutation table is exactly the kind of evidence I
want. The gate run is real. One class of bug is left, and it's at the month boundary, the same seam P1 and
P2 had to rule on.

## Findings

1. [MAJOR] `src/server/services/roster.ts` `manualEdit` / `generateMonth`: **the two rosters that share a
   boundary week can silently disagree.** Each month stores its own copy of the cells in the boundary week
   (Jan's window starts 2026-12-28), but the service lets either roster edit them and never reconciles them.
   I reproduced it on the test DB (seed, generate Dec v1, then generate Jan v1):
   - The **January** roster accepted a committed edit of Aarav on **2026-12-29** (a December-owned week),
     with no refusal and no issue.
   - The **December** roster accepted Aarav → WORK on 2027-01-03 (his carried weekly off). Jan's stored copy
     still says `WEEKLY_OFF` on 01-03, and Jan's issue list shows nothing.
   - After regenerating December (v2), the two months disagree on 2 cells
     (`aarav 2026-12-29 jan=WEEKLY_OFF dec=WORK`, `aarav 2027-01-03 jan=WEEKLY_OFF dec=WORK`).
     December v2 raises `WEEKLY_OFF_NOT_GRANTED` for Aarav, while January shows him off that week.
     Two rosters a manager could publish, contradicting each other on whether someone works on 3 Jan, is the
     "silently invalid" class this project can't ship.
     → **Fix:**
   - A cell belongs to the roster that **owns its week** (the P1 ruling, ASSUMPTIONS 18). `manualEdit` refuses
     a cell owned by the neighbour month with `CONFLICT`: "This day belongs to the December 2026 roster's week
     of 28 Dec. Edit it there."
   - Neighbour-owned cells are **not authoritative** in the roster that only displays them. On read
     (`loadDraft`/`getRoster`), and before `publishRoster`, overlay them from the neighbour's latest version.
     Alternatively, keep the stored copy but have the validator raise an ERROR, e.g. a `WEEKLY_OFF_NOT_GRANTED`
     with "boundary week out of date, regenerate", whenever the stored copy differs from the neighbour. Pick
     one, say which in ASSUMPTIONS, and keep the engine pure: the overlay happens in the server layer through
     `neighbourRosters`, which the loader already reads.
   - **Tests** (integration): (a) editing a neighbour-owned cell is refused and writes nothing; (b) after an
     owned boundary cell changes in Dec (edit and regenerate), the Jan view shows Dec's value, or Jan has a
     blocking issue. Never a silent mismatch. (c) Jan cannot publish while its boundary copy is stale, if you
     choose the issue route.

2. [MAJOR] `applyRosterChange` on a change whose dates fall in the **neighbour month's** week: it reports
   success and re-plans nothing. Repro: on the **January** roster, apply `ADD_LEAVE` for Divya
   2026-12-30..31 (approved). The result is `replannedWeeks: ["2026-12-28"]`, `changedCells: 0`, the leave is
   saved, and a new January version is created. **December's latest version still has Divya on WORK on
   12-30.** December's validator does flag `WORK_WHILE_UNAVAILABLE` on read, so it isn't completely silent.
   But the manager was told the change was applied, while the roster that owns those days was never
   re-planned.
   → Either re-plan the owning month too (a new version of each affected month, in the same transaction), or
   refuse with a clear message when the change only touches days that belong to another month's roster, and
   return `affectedMonths` in the simulation so the UI can say "this also changes December". Refusing is
   simpler and fine for the demo. Test it either way.

3. [MINOR] `carryAcknowledgements` keys on issue id only. The id is a hash of code + entity + date, so a
   `COVERAGE_GAP` acknowledged at "has 1 of 2" stays acknowledged if it worsens to "has 0 of 2". Store the
   acknowledged message (or its required/covering numbers) on the ack. Carry it only if the message is
   unchanged, otherwise show it as "acknowledged earlier, changed since" and count it as a blocker. Add one
   test.

4. [MINOR] `publishRoster` creates comp-off credits deduped on (employee, earnedOn), but never retracts them.
   If v2 is published after v1 and no longer has that person working the holiday, the credit from v1 remains.
   Either delete AUTO credits for that month that are no longer earned (keep any already `usedOn`), or
   document it in ASSUMPTIONS as a known limit. Documenting it is acceptable.

## Owner decision (security, raised by the Executor)

**Owner ruling: option (c), a shared passcode. The site must be secure.** Build it in **P6** (before deploy),
not in this round. Spec:

- **Viewing stays public** (the PDF requires a testable public URL). Every mutation needs an unlocked
  session: master-data CRUD, generate, commit edit, apply, acknowledge, publish. Previews (edit preview,
  simulate) write nothing, so they may stay public.
- **The check is server-side, in the services or a single guard every action calls**, never only in the UI.
  One test per mutating action: refused with `UNAUTHORIZED` and nothing written when locked.
- `/unlock` takes the passcode **and a display name**. The audit `actor` comes from the session, not from the
  client. This also closes the spoofable-actor gap the Executor flagged.
- Passcode in env `DEMO_PASSCODE` (never committed, a placeholder in `.env.example`), compared with
  `crypto.timingSafeEqual` on hashes. On success, set an **HMAC-signed** cookie (`SESSION_SECRET`):
  `httpOnly`, `Secure` in production, `SameSite=Lax`, expiry 12 h. Add a "Lock" button that clears it.
- **Brute-force limit that works on serverless:** failed attempts recorded in Postgres (a small
  `UnlockAttempt` table keyed by IP hash), e.g. 5 per 15 min, then `429`. In-memory counters don't survive
  Vercel instances.
- If `DEMO_PASSCODE` is unset in production, **all writes are refused** (fail closed), not open.
- Security headers in `next.config` (CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-Content-Type-Options`).
- Keep `pnpm db:reset-demo` (re-seed) for recovery.
- The passcode goes to the evaluators in the submission email only. README Q&A states the model honestly:
  public read, shared-secret write, no per-user accounts.

## Verified

- Re-ran: `lint`, `format:check`, `typecheck`, `test` **176/176** (12 files, real Postgres via
  `TEST_DATABASE_URL`), `build`. All pass.
- Read `services/roster.ts` in full, plus the action wrappers, `loadEngineInput`, and the engine diff
  (`compOffEarnedFor` only, so the engine is still pure).
- Probed the boundary with my own throwaway integration test against the test DB (deleted afterwards; it
  produced findings 1 and 2).
- Carried P2 notes: the byte-identical-outside-weeks test exists, and the publish gate is tested on Ananya's
  5 December errors. Done.
- Accepted deviations: actions not tested directly (they are thin wrappers); master data audited too; `vite` as
  a direct dev dependency; the ack carry-over design (with the #3 refinement).
- CI: new Postgres service steps. Prove them green on the first push after PASS.

Fix 1 and 2 (and 3, 4), answer each in `REQUEST-P3.md`, and re-request. Nothing to push until PASS.

---

# Round 2: PASS

## Verified (independently)

- `lint`, `format:check`, `typecheck`, `test` **186/186** (12 files, real Postgres), and `build` all pass. The
  engine is untouched (`git diff src/engine` is empty). The schema only gains `IssueAck.message` and
  `CompOffCredit.publishedByRosterId`.
- Re-ran my round-1 boundary probe (throwaway, deleted) against the fixed code:

  | Probe                                                | Round 1                | Round 2                                                         |
  | ---------------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
  | Jan roster edits Aarav on 2026-12-29                 | committed silently     | **refused**, names the 2026-12 roster                           |
  | Dec roster edits Aarav on 2027-01-03 once Jan exists | committed, Jan unaware | **refused**, names the 2027-01 roster                           |
  | Dec edits a provisional Jan day before Jan exists    | allowed                | allowed (correct)                                               |
  | Divya leave 30–31 Dec applied from the Jan roster    | "success", 0 cells     | **refused**, nothing saved                                      |
  | Jan works Aarav on his carried off (01-03)           | n/a                    | Dec view shows WORK and raises `WEEKLY_OFF_NOT_GRANTED` for him |
  | Shared-cell mismatches between the Dec and Jan views | 2                      | **0**                                                           |
  | Dec publish after that                               | n/a                    | `BLOCKED`                                                       |

## Rulings

- **#1, the date-owner deviation: accepted.** The S18 deadlock argument is right. Week-ownership would force
  December to change a day a _published_ January displays. Date-ownership plus the overlay on read gives one
  authoritative value per cell, and the weekly-off requirement stays with the week's owner, which turns any
  conflict into a blocking ERROR there. Nothing can be silent, which was the point of the finding.
- **#2:** refusing a change that falls entirely in another month's days, plus `affectedMonths` for one that
  straddles two months, is what I allowed. Confirmed.
- **#3 and #4:** fixed rather than documented, with tests. The mutation check found two weak tests and Sonnet
  strengthened them (the race test, and the hand-entered credit). Good practice.

## Notes for P4 (no action now)

- The known limit in ASSUMPTIONS 44 (an edit's response doesn't preview the neighbour's issues) must be covered
  in the UI. When a cell holds a carried weekly off owed to the other month (Aarav, 3 Jan), the edit dialog
  shows a warning before saving: "This is Aarav's weekly off for December's week of 28 Dec. Changing it puts an
  ERROR on the December roster." Show `foreignDates` cells as read-only, with a link to the owning month.
- The grid's coverage strip must use the same overlaid draft as the validator. Assert this in one test or check
  it in the P4 screenshots.

Push `main` and confirm CI is green, including the new Postgres steps, which have never run. Then begin P4.
