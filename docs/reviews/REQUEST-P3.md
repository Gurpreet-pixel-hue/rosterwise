# Review request: P3 Persistence & server actions

## Done

- **`src/server/services/master.ts`**: create, update, delete, list, get for all ten master-data resources
  (pod, employee, brand, process, brand-process, assignment, holiday, leave, comp-off credit, coverage override),
  from one typed registry so every resource gets the same guarantees: Zod on the input; an update merges the patch
  into the stored row and re-validates the whole row (so cross-field rules always hold); cross-row rules (a pod
  lead belongs to the pod, references exist); Prisma constraint errors turned into readable `CONFLICT` /
  `VALIDATION` / `NOT_FOUND`; an `AuditLog` row with before and after in the same transaction. Employees are
  deactivated, not deleted, once they appear in a roster.
- **`src/server/services/roster.ts`**: `generateMonth`, `getRoster`, `listRosterVersions`, `previewManualEdit` /
  `saveManualEdit` (validate first, return the issue delta, commit on request), `simulateRosterChange`,
  `applyRosterChange` (new version, atomic), `acknowledgeIssue` / `removeAcknowledgement`, `publishRoster`
  (blocked on unacknowledged ERRORs).
- **`src/server/schemas.ts`**: Zod schemas for every input. `errors.ts`: `ServiceError` with codes `VALIDATION`,
  `NOT_FOUND`, `CONFLICT`, `BLOCKED`, `parse()`, and `toResult()` (expected failures become plain data; unexpected
  ones are logged and hidden from the caller). `audit.ts`, `db.ts`.
- **`src/server/actions/{master,roster}.ts`**: thin `"use server"` wrappers (parse, call the service,
  `revalidatePath`, return a serialisable result). All rules live in the services, which the tests drive directly.
- **Engine:** `compOffEarnedFor(input, draft)` (credits for a persisted roster).
- **Tests:** 70 new tests in 4 files (`master.int.test.ts`, `roster.int.test.ts`, `apply.atomic.int.test.ts`,
  `schemas.test.ts`), 61 of them integration tests against a real Postgres. 176 tests in total.
- **Test infrastructure:** `TEST_DATABASE_URL` points at a separate database (guarded: the name must contain
  "test" and differ from `DATABASE_URL`, because the tests wipe it); a vitest global setup pushes the schema;
  files run one after another. Without it the integration tests are skipped with a loud notice.
  `prisma/seed-lib.ts` (`seedDatabase`) is the seed made reusable.
- **CI:** a Postgres service container, plus `db:push && db:seed && verify:seed` and the integration tests against
  it, so the P1 and P3 gates run in CI too (they never ran there before).
- Carried-over review notes: tested that a change outside a week leaves everything outside it byte-identical, and
  the publish gate against Ananya's 5 December errors. 6 commits, none with Claude attribution. **Nothing pushed.**

## How to verify

```
createdb rosterwise_test                       # once; put TEST_DATABASE_URL in .env (see .env.example)
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm vitest run src/server                     # the integration tests alone
```

## Verification output

`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` exit 0.

```
 Test Files  12 passed (12)
      Tests  176 passed (176)
```

Also from a fresh clone with **no `.env` file**, only environment variables (as CI has them): 12 files, 176 tests,
build OK. With no test database configured: `9 passed | 3 skipped (12)`, `115 passed | 61 skipped`, exit 0, and the
warning `[vitest] TEST_DATABASE_URL is not set: integration tests will be SKIPPED.` And locally the new CI steps:
`db:push` in sync, `db:seed` seeded, `verify:seed` 27/27.

### The scripted gate run: generate -> edit -> simulate -> apply -> acknowledge -> publish

Printed by the test `the scripted gate run ... works end to end, and every step is in the audit log`, against the
real database:

```
GATE RUN
  generate: v1 DRAFT, 5 errors
  edit preview: +2 issues, nothing saved
  edit committed + fixed: 2 gaps resolved, 5 errors
  simulate: errors 5 -> 13, 7 cells, weeks 2026-12-28
  apply: v2 DRAFT, parent v1, 0 acks carried
  publish (unacknowledged): BLOCKED
  acknowledge: 13 errors, each with a note
  publish: v2 PUBLISHED, 16 comp-off credits
```

The test then asserts the audit log holds `GENERATE`, `MANUAL_EDIT`, `APPLY_CHANGE`, `ACK_ISSUE` and `PUBLISH`, every
row with an actor and an entity, and that the published roster is version 2, parent version 1.

<details><summary>All 70 new test names</summary>

```
roster.int.test.ts > roster workflow (integration, real Postgres) > generate > persists a DRAFT version: one entry per employee per window date, an audit row, and exactly Ananya's errors
roster.int.test.ts > roster workflow (integration, real Postgres) > generate > stores exactly what the engine produced (nothing lost or invented in the database round trip)
roster.int.test.ts > roster workflow (integration, real Postgres) > generate > generating again creates version 2 (parent = version 1), keeps locked entries, and leaves version 1 untouched
roster.int.test.ts > roster workflow (integration, real Postgres) > generate > rejects a malformed request and saves nothing
roster.int.test.ts > roster workflow (integration, real Postgres) > manual edit: validate first, commit on request > previewing returns the issue delta, with suggestions, and writes nothing
roster.int.test.ts > roster workflow (integration, real Postgres) > manual edit: validate first, commit on request > committing saves the cell locked and manual, audits before and after, and the roster now shows the gaps
roster.int.test.ts > roster workflow (integration, real Postgres) > manual edit: validate first, commit on request > a follow-up edit that covers the gaps resolves them (the delta reports it)
roster.int.test.ts > roster workflow (integration, real Postgres) > manual edit: validate first, commit on request > refuses bad edits with the right code and saves nothing
roster.int.test.ts > roster workflow (integration, real Postgres) > manual edit: validate first, commit on request > refuses to edit a PUBLISHED roster in place, and a version that is no longer the latest
roster.int.test.ts > roster workflow (integration, real Postgres) > simulate and apply a change > simulating writes NOTHING and reports the cascade (scenario 4)
roster.int.test.ts > roster workflow (integration, real Postgres) > simulate and apply a change > refuses a change that refers to nothing real, or is malformed, and saves nothing
roster.int.test.ts > roster workflow (integration, real Postgres) > simulate and apply a change > applying saves the leave AND a new DRAFT version (parent = the old one) atomically, matching the simulation
roster.int.test.ts > roster workflow (integration, real Postgres) > simulate and apply a change > a change outside a week leaves that week's offs and everything else byte-identical
roster.int.test.ts > roster workflow (integration, real Postgres) > simulate and apply a change > applying on a version that is no longer the latest is a CONFLICT and changes nothing
roster.int.test.ts > roster workflow (integration, real Postgres) > acknowledge and publish > publishing is BLOCKED while Ananya's 5 December errors are unacknowledged, and nothing changes
roster.int.test.ts > roster workflow (integration, real Postgres) > acknowledge and publish > only a current ERROR can be acknowledged, and only with a real note
roster.int.test.ts > roster workflow (integration, real Postgres) > acknowledge and publish > 4 of 5 acknowledged is still blocked, naming the one left; acknowledging all 5 lets it publish
roster.int.test.ts > roster workflow (integration, real Postgres) > acknowledge and publish > an acknowledgement can be withdrawn, which blocks publishing again
roster.int.test.ts > roster workflow (integration, real Postgres) > acknowledge and publish > a NEW error appearing after acknowledgement blocks publishing until it is acknowledged too
roster.int.test.ts > roster workflow (integration, real Postgres) > acknowledge and publish > a published roster is final: publishing again, acknowledging and editing are all refused
roster.int.test.ts > roster workflow (integration, real Postgres) > acknowledge and publish > changing a published roster creates a new DRAFT that carries the acknowledgements still in force
roster.int.test.ts > roster workflow (integration, real Postgres) > the scripted gate run: generate -> edit -> simulate -> apply -> acknowledge -> publish > works end to end, and every step is in the audit log
roster.int.test.ts > roster workflow (integration, real Postgres) > master data and rosters > a master-data change shows up in the existing roster through the same validator
master.int.test.ts > master data CRUD (integration, real Postgres) > create, update and delete every resource, each audited > process
master.int.test.ts > master data CRUD (integration, real Postgres) > create, update and delete every resource, each audited > pod, with a lead who belongs to it
master.int.test.ts > master data CRUD (integration, real Postgres) > create, update and delete every resource, each audited > employee: defaults are applied, weekdays de-duplicated, deactivate and reactivate
master.int.test.ts > master data CRUD (integration, real Postgres) > create, update and delete every resource, each audited > brand, brand-process (rule, weekday minimums, shift), assignment, override
master.int.test.ts > master data CRUD (integration, real Postgres) > create, update and delete every resource, each audited > holiday, leave, comp-off credit
master.int.test.ts > master data CRUD (integration, real Postgres) > create, update and delete every resource, each audited > every audit row carries who, what, and the before and after
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > employee {"name":"","podId":"pod-alpha"} is refused (name)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > employee {"name":"X","podId":"pod-alpha","weeklyOffsPerWeek":9} is refused (weeklyOffsPerWeek)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > employee {"name":"X","podId":"pod-alpha","fixedOffDays":["FUNDAY"]} is refused (fixedOffDays)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > employee {"name":"X","podId":"pod-alpha","maxDailyHours":0} is refused (maxDailyHours)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > employee {"name":"X","podId":"pod-alpha","maxConsecutiveDays":1.5} is refused (maxConsecutiveDays)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > process {"code":"qa","name":"Quality"} is refused (code)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > process {"code":"","name":"Quality"} is refused (code)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > brandProcess {"brandId":"brand-pixel-pets","processId":"proc-ret","operatingRule":"CUSTOM"} is refused (customWeekdays)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > brandProcess {"brandId":"brand-pixel-pets","processId":"proc-ret","operatingRule":"ALL_DAYS","shiftStart":"18:00","shiftEnd":"09:00"} is refused (shiftEnd)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > brandProcess {"brandId":"brand-pixel-pets","processId":"proc-ret","operatingRule":"ALL_DAYS","shiftStart":"9am"} is refused (shiftStart)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > brandProcess {"brandId":"brand-pixel-pets","processId":"proc-ret","operatingRule":"ALL_DAYS","defaultMinStaff":-1} is refused (defaultMinStaff)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > brandProcess {"brandId":"brand-pixel-pets","processId":"proc-ret","operatingRule":"ALL_DAYS","weekdayMinStaff":{"FUNDAY":2}} is refused (weekdayMinStaff)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > assignment {"employeeId":"emp-aarav-sharma","brandProcessId":"bp-pixel-pets-cs","role":"PRIMARY","allocationPct":0} is refused (allocationPct)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > assignment {"employeeId":"emp-aarav-sharma","brandProcessId":"bp-pixel-pets-cs","role":"PRIMARY","allocationPct":101} is refused (allocationPct)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > assignment {"employeeId":"emp-aarav-sharma","brandProcessId":"bp-pixel-pets-cs","role":"CAPTAIN"} is refused (role)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > holiday {"date":"2026-02-30","name":"Impossible Day"} is refused (date)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > holiday {"date":"25/12/2026","name":"Wrong Format"} is refused (date)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > leave {"employeeId":"emp-aarav-sharma","fromDate":"2026-12-10","toDate":"2026-12-09","type":"PLANNED"} is refused (toDate)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > leave {"employeeId":"emp-aarav-sharma","fromDate":"2026-12-10","toDate":"2026-12-10","type":"HOLIDAY"} is refused (type)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > coverageOverride {"brandProcessId":"bp-pixel-pets-cs","date":"2026-12-10","minStaff":-2} is refused (minStaff)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > compOffCredit {"employeeId":"emp-aarav-sharma","earnedOn":"2026-12-10","reason":""} is refused (reason)
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > an update is checked against the WHOLE merged row, so cross-field rules still hold
master.int.test.ts > master data CRUD (integration, real Postgres) > validation (Zod) refuses bad input and saves nothing > unknown fields, unknown resources, missing rows and a blank actor are refused
master.int.test.ts > master data CRUD (integration, real Postgres) > references and uniqueness > rows that point at nothing are refused
master.int.test.ts > master data CRUD (integration, real Postgres) > references and uniqueness > duplicates are CONFLICTs
master.int.test.ts > master data CRUD (integration, real Postgres) > pods and leads > a lead must belong to the pod; a pod cannot be created with one; a lead cannot move away
master.int.test.ts > master data CRUD (integration, real Postgres) > deletes are guarded > a pod with people or brands, a brand with processes, and a process in use cannot be deleted
master.int.test.ts > master data CRUD (integration, real Postgres) > deletes are guarded > deleting a brand-process removes its assignments and overrides with it, and says so in the audit
master.int.test.ts > master data CRUD (integration, real Postgres) > deletes are guarded > an employee who appears in a saved roster cannot be deleted, only deactivated, and keeps their history
master.int.test.ts > master data CRUD (integration, real Postgres) > a manager can change staffing without touching code > adding a backup for Nimbus Gadgets through assignments, then regenerating, clears Ananya's errors
master.int.test.ts > master data CRUD (integration, real Postgres) > a manager can change staffing without touching code > adding a new employee puts them in the next roster
apply.atomic.int.test.ts > applyRosterChange is atomic (integration, real Postgres) > a failure at the end of the transaction rolls back the new version, its entries, and the audit row
schemas.test.ts > date, month and time formats > accepts real dates and refuses impossible or mis-formatted ones
schemas.test.ts > employee > fills defaults and removes duplicate weekdays
schemas.test.ts > brand-process > needs weekdays for CUSTOM, a forward shift, and valid weekday minimums
schemas.test.ts > leave > cannot end before it starts, and defaults to PENDING
schemas.test.ts > roster inputs > generate defaults the actor
schemas.test.ts > roster inputs > an acknowledgement needs a real note
schemas.test.ts > roster inputs > changes are a tagged union, each validated
schemas.test.ts > error helpers > parse() lists every problem with its field, as a VALIDATION error
schemas.test.ts > error helpers > toResult() turns expected failures into plain data and hides unexpected ones
```

</details>

### Are the tests real? Mutation check

Each change was broken in turn and the whole `src/server` suite run (then restored; 70/70 again).

| Mutation                                                    | Tests that failed                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| publish gate removed (`blockers.length > 0` made false)     | 5 (the blocked, 4-of-5, withdrawn and new-error tests, and the gate run)       |
| previewing an edit commits it                               | 1 ("previewing returns the issue delta, with suggestions, and writes nothing") |
| stale-version check removed                                 | 1 (published and no-longer-latest edits)                                       |
| a late failure in apply is swallowed (no rollback signal)   | 1 (the atomicity test)                                                         |
| hard-delete guard for employees with roster history removed | 1                                                                              |

(My first attempt at the "preview commits" mutation did not apply, because Prettier had wrapped the line my `sed`
looked for, so it appeared to survive. I redid it with a pattern that matches the real text and it is caught.)

## How the gate items are met

| Requirement (CLAUDE.md P3)                                                        | Where                                                                                                                 |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| CRUD for all master data                                                          | `services/master.ts`; `master.int.test.ts` round-trips every resource                                                 |
| `generateRoster(month)`                                                           | `generateMonth`; creates a new DRAFT version each time, keeps locked entries, copies still-valid acknowledgements     |
| `saveManualEdit(entry)` validates first and returns the issue delta before commit | `manualEdit(..., { commit })`: preview writes nothing (tested), commit saves locked and manual                        |
| `simulateChange`                                                                  | `simulateRosterChange`: writes nothing (row counts compared before and after)                                         |
| `applyChange` (new version)                                                       | `applyRosterChange`: master-data effect and new version in one transaction, parent set, rolled back on a late failure |
| `publishRoster` blocked on unacknowledged ERRORs                                  | `publishRoster`; tested with Ananya's 5 errors: 0 of 5, 4 of 5, then 5 of 5 acknowledged                              |
| `acknowledgeIssue(issueId, note)`                                                 | ERRORs only, note of at least 3 characters, withdrawable on a draft                                                   |
| AuditLog for every manual edit and applied change                                 | also generate, acknowledge, publish and every master-data change                                                      |
| Zod on every input                                                                | `schemas.ts`; every service call parses, tested with 20+ bad inputs                                                   |
| Integration tests against a test DB                                               | 61 of them, real Postgres, local and CI                                                                               |

## Deviations from CLAUDE.md

- **Server actions are not exercised by tests directly.** They are three-line wrappers; the tests drive the
  services they call (which is where Zod parsing and every rule live). The build compiles them.
- **Master data is audited as well**, not only manual edits and applied changes (cheap, and a manager's staffing
  changes matter as much).
- **`vite` added as a direct dev dependency** (pnpm does not expose transitive packages to the config).
- **CI changed** (Postgres service, DB gate steps). It cannot be proven green until the first push; the same
  commands pass locally with CI-style environment variables in a fresh clone.
- **Acknowledgements carry over to a new version only for ERRORs whose id still exists** (ASSUMPTIONS 37). This is
  my design choice; the review notes only said the publish gate must use `IssueAck`.

## Known gaps / risks

- **No authentication (security note, from an automated review of this commit).** An automated reviewer flagged
  that the server actions do not authenticate and that the audit `actor` is supplied by the caller, so it can be
  spoofed. That is accurate and by requirement, not oversight: the assessment says the app must be "publicly
  accessible so that it can be tested", and the final checklist says "works without login". Consequence: **once
  deployed, anyone with the URL can edit master data, apply changes and publish.** The audit log records the
  claimed actor faithfully but cannot prove who typed it (ASSUMPTIONS 42). I have not added auth because it would
  break the requirement. **This needs an Owner decision before P6**: (a) accept it for a throwaway demo database
  that is re-seeded; (b) a read-only public mode (mutating actions refuse unless an env flag is set, so the
  deployed demo cannot be vandalised but can still be explored); or (c) a shared demo passcode. My
  recommendation is (b), possibly with (a) as a fallback.
- **Last writer wins within a version is prevented only by the latest-version rule**, not by row-level versions: two
  people editing different cells of the same draft at once both succeed (correct), but a second person is not told a
  cell changed under them. Fine for a single-manager demo; row versions would be the fix.
- **`generateMonth` re-generates the whole month** (keeping locks and, with `today`, history). Re-planning only the
  affected weeks is what `applyRosterChange` does.
- **Issues are computed on read, not stored**, so reading a roster re-runs validation (about 0.1 s without
  suggestions, 0.4 s with). Fine now; caching would matter with many concurrent users.
- **No route handlers**, only server actions. A CSV download (P5) will need one.
- The UI that calls these actions is P4.

## Response to review (round 1: CHANGES_REQUIRED, findings 1 to 4)

Re-verified after the fixes: `pnpm format:check`, `pnpm lint` (0 warnings), `pnpm typecheck`, `pnpm build` exit 0;
`pnpm test` **186/186** (12 files, 10 new tests, all in `src/server/__tests__/roster.int.test.ts`, real Postgres);
`pnpm db:push` in sync, `db:seed` seeded, `verify:seed` 27/27. Engine untouched (`git diff src/engine` is empty).
Schema: two nullable/defaulted columns (`IssueAck.message`, `CompOffCredit.publishedByRosterId`).

1. **[MAJOR] boundary week: fixed, with one deliberate difference from the suggested rule (please rule on it).**
   `services/roster.ts`: `loadDraftWithOwners` / `requireOwnCell` / `manualEdit`.
   - **Overlay on read.** Every roster load (view, validate, acknowledge, publish gate, simulate, next generation)
     replaces each cell dated in another month with the latest version of that month's roster, marked `locked`.
     The stored copy is only the provisional plan from before the neighbour existed. It is done in the server
     layer, the engine stays pure. `getRoster` also returns `foreignDates` (date to owning month) for the UI.
   - **Refusal.** Editing a day that belongs to a month whose roster exists is `CONFLICT`: "2026-12-29 belongs to
     the 2026-12 roster, which already exists, so it cannot be edited from the 2027-01 roster. Edit it in the
     2026-12 roster; it then shows here." Preview and commit both refuse, and the commit re-checks **inside its
     transaction**, so a neighbour generated between the two is still caught. With no neighbour roster the day is
     provisional and editable (that is how December plans Sun 3 Jan for Aarav).
   - **Both repros, re-run.** Jan editing Aarav on 29 Dec: refused. Dec editing Aarav to WORK on 3 Jan, once Jan
     exists: refused. After Dec edits an owned day and after Dec v2, the two views agree on every shared cell
     (helper `expectNoBoundaryDisagreement`, over 100 shared cells). When January has Aarav working on 3 Jan,
     December's view shows `WEEKLY_OFF_NOT_GRANTED` for him, it is the only blocker, and `publishRoster` on
     December returns `BLOCKED` naming it.
   - **Where I differ from your wording.** You wrote "a cell belongs to the roster that owns its **week**". I kept
     the engine's existing rule that a day belongs to the roster of the **month it falls in** (ASSUMPTIONS 22a),
     and left the weekly-off _requirement_ with the week's owner. Reason, with evidence: the week-owner rule
     deadlocks against a PUBLISHED neighbour. Test S18 is exactly that case (January published with WORK on 3 Jan,
     December needs the off there). Under week-owner, December would have to edit a day that January's published
     roster displays, changing a published roster underneath people (ASSUMPTIONS 40), and January would be
     forbidden from editing December's week to get out of it. Under date-owner the way out exists: apply a
     change in January (new draft), edit 3 Jan there, publish. Both of your reproduced failures are closed
     either way, and nothing is silent. Full reasoning is ASSUMPTIONS 44. Known limit there: an edit's response
     does not preview the _neighbour's_ issues; the neighbour shows them when opened or published.
   - **Tests (a)(b)(c) as you specified:** "a day that belongs to the neighbour month's existing roster cannot be
     edited here, in either direction, and nothing is written" (a); "an edit to a December-owned day shows in
     January at once, and after regenerating December; the two never disagree" (b); "January working someone
     December owes an off to is a blocking ERROR in December, never a silent mismatch" (c, on the issue route:
     December cannot publish). Plus "until the neighbour has a roster ... may be edited" and "a neighbour roster
     created between the preview check and the commit still refuses the edit" (a race test through a proxied
     `$transaction`).

2. **[MAJOR] change in a neighbour month's days: fixed by refusing, as you allowed, plus `affectedMonths`.**
   `checkChangeScope` / `changeDateRange` in `services/roster.ts`. A date-bound change (leave, make unavailable,
   remove leave, one-day override) whose dates all fall in another month is `CONFLICT` by both simulate and apply:
   "This change falls on 2026-12-30 to 2026-12-31, which belongs to the 2026-12 roster, not 2027-01. Apply it from
   the 2026-12 roster, which owns those days." Nothing is saved (row counts compared). A change that straddles two
   months is allowed and returns `affectedMonths` (only months that have a roster), also written to the audit row
   (`alsoAffectsMonths`); the other roster is not re-planned but its validator flags the damage (the test asserts
   `WORK_WHILE_UNAVAILABLE` for Divya in December). Rule-wide changes have no dates and are never refused.
   Your repro (Divya leave 30 to 31 Dec applied from January) is now refused. Tests: "is refused from the roster
   that does not own those days, by preview and by apply, and saves nothing" (leave and a one-day override),
   "a change that straddles two months is allowed, names the other month, ..." and "a rule-wide change ... is not
   refused". ASSUMPTIONS 45.

3. **[MINOR] acknowledgements keyed on id only: fixed.** `IssueAck.message` stores the issue's wording at the time.
   An acknowledgement counts only while the issue reads exactly that (`unacknowledgedErrors`). A same-id issue
   that now reads differently comes back as `changedSince` (with `previousMessage`), is a blocker again, and is
   shown as "acknowledged earlier, changed since". This covers both a regenerate/apply (carried but not counted:
   `changedSinceAcknowledged` is returned and audited next to `carriedAcknowledgements`) and a master-data change
   inside the same version. Test: a Coastal Candles gap acknowledged, then a coverage override raises the minimum
   (same id, new message): the issue is a blocker, publish is `BLOCKED`, regenerate reports
   `changedSinceAcknowledged: 1`, and acknowledging the new wording clears it. ASSUMPTIONS 37.

4. **[MINOR] comp-off credits never retracted: implemented rather than documented.** `CompOffCredit.publishedByRosterId`
   marks credits a publish created. Publishing a version deletes the _unused_ credits an earlier publish of the same
   month created for a holiday this version no longer has that person working; a credit already used is kept and
   counted (`compOffCreditsKeptUsed`); a hand-entered credit has no marker and is never touched. The result and the
   audit row carry both counts. Test: v1 published, one credit used, one hand-entered (for someone off on 25 Dec),
   v2 takes two people off Christmas: the unused one is retracted, the used one and the hand-entered one stay,
   the still-earned one stays. ASSUMPTIONS 38.

### Are the new tests real? Mutation check (round 2)

Each fix was broken in turn and `roster.int.test.ts` run (then restored; file byte-identical to the fixed version).

| Mutation                                              | Tests that failed                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| overlay removed (stored spill copy used as is)        | 2 (view follows December; December blocked by January's edit)                                  |
| edit refusal removed from the manual edit             | 1 (neighbour-owned days cannot be edited, both directions)                                     |
| edit refusal removed from the commit transaction only | 1 (the race test; **survived until I added it**)                                               |
| change-scope check removed                            | 2 (refused change; straddling change names the other month)                                    |
| acknowledgement ignores the stored message            | 1 (worse gap stops counting)                                                                   |
| retraction removed                                    | 1                                                                                              |
| retraction also deletes used credits                  | 1                                                                                              |
| retraction also deletes hand-entered credits          | 1 (**survived until the hand-entered credit was given to someone who does not earn that day**) |

Two mutations survived my first tests and led to a stronger test each (the race test; a manual credit that a careless
retract would actually delete). One of my own mutations was malformed (inverted logic made 11 unrelated tests fail),
so I discarded that result and redid it correctly.

### Still open

- The shared-passcode lock is P6, per the Owner ruling. Not part of this round.
- Nothing pushed. CI's Postgres steps are unproven until the first push after PASS.
