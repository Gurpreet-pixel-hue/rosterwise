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
