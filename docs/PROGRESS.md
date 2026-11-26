# Progress

Source of truth for scope: `AI_Internship Assessment.pdf` (git-ignored) and `CLAUDE.md`.
PDF/CLAUDE.md mismatches found so far: none.

| Phase                           | Status                                                                                                                  | Gate request                 | Review                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------- |
| P0 Scaffold                     | PASS                                                                                                                    | `docs/reviews/REQUEST-P0.md` | `docs/reviews/REVIEW-P0.md`   |
| P1 Data model + seed            | PASS (round 2)                                                                                                          | `docs/reviews/REQUEST-P1.md` | `docs/reviews/REVIEW-P1.md`   |
| P2 Engine                       | PASSED, pushed, CI green ([run 45666301496](https://github.com/Gurpreet-pixel-hue/rosterwise/actions/runs/45666301496)) | `docs/reviews/REQUEST-P2.md` | `REVIEW-P2.md` PASS (round 2) |
| P3 Persistence & server actions | Round 1 findings 1 to 4 fixed, re-review requested (round 2)                                                            | `docs/reviews/REQUEST-P3.md` | `REVIEW-P3.md`                |
| P4 UI                           | Not started                                                                                                             |                              |                               |
| P5 Optional features            | Not started                                                                                                             |                              |                               |
| P6 Deploy & docs                | Not started                                                                                                             |                              |                               |

## Decisions log

- **Prisma 6.x, not latest.** The npm `latest` tag for `prisma` was an 8.0 release candidate at
  P0 time. Pinned `prisma`/`@prisma/client` to `^6` for a stable, well-documented toolchain.
- **`cn()` helper is the standard `clsx` + `tailwind-merge` pair.** `shadcn init` generated
  `src/lib/utils.ts` re-exporting `cn` from an unrelated third-party npm package named `cn`.
  Replaced with the conventional implementation and removed that dependency.
- **pnpm build scripts allow-listed** in `pnpm-workspace.yaml` (`@prisma/client`, `@prisma/engines`,
  `prisma`, `esbuild`) so `pnpm install` works in CI without interactive approval.
- **Vitest config is `.mts`** to silence a Vite ESM-loader warning; CI uses Node 22 (`engines` `>=20`).
- **`db:seed` and `verify:seed` are stubs** that exit 1 with a message until P1 implements them.
- **CI first run:** the push of the P0 commits (`5e0a467`) did not start a workflow run; the next push (`ac4ffa9`) did, and it passed all steps. `workflow_dispatch` was added so a run can be started by hand if that recurs.
- **Local database for development** is Homebrew `postgresql@15` (`brew services start postgresql@15`, database `rosterwise`, `DATABASE_URL` in the git-ignored `.env`). Neon is only needed at P6.
- **Seed checks run in CI without a database.** `scripts/seed-checks.ts` works on plain rows; `scripts/seed-checks.test.ts` runs it on `buildSeedData()` (plus negative tests that break the data), and `pnpm verify:seed` runs the same checks on the live DB.
- **Reviewer's P1 pointers applied:** single-resource definition printed with the %, string dates, unique `Assignment(employeeId, brandProcessId)` and `BrandProcess(brandId, processId)`, idempotent seed.
- **Schema vs section 3:** exactly per section 3. `RosterEntry` has an extra `(rosterId, date)` index for per-day views. `(brandProcessId, date)` is the unique key on `CoverageOverride`. Issue acknowledgements (`acknowledgeIssue`, P3) are not in section 3 and will be added in P3 if needed.
- **P1 review round 1:** all six findings fixed (see "Response to review" in `REQUEST-P1.md`). `calendar.ts`, `demand.ts` and `types.ts` were written in P1 (not P2) so the seed's feasibility check and the engine share one calendar. The new check also exposed a boundary-week problem the review had not predicted; see ASSUMPTIONS 18.
- **P1 passed and pushed:** CI green on `0783e84` ([run 45656871590](https://github.com/Gurpreet-pixel-hue/rosterwise/actions/runs/45656871590)).
- **P2 additions beyond the plan:** `src/server/buildEngineInput.ts` (pure row-to-input mapping shared by the DB loader, the CLI and tests), `src/engine/{analyze,edit,change,ids,ctx,state}.ts`, an ESLint rule that keeps `src/engine/**` free of Prisma, Next.js, Node I/O and `process`, and an engine-purity test.
- **Tests S16 to S18** (boundary week) were added to S01 to S15 as the P1 review required.
- **P2 review round 1:** all three findings fixed (see "Response to review" in `REQUEST-P2.md`): holiday-hosted weekly offs (generator cost +500 and a shared validator rule), a repair pass for working runs, and an independent coverage and weekly-off oracle for S14. Tests S19, S19b and S20 added.
- **P3 structure:** `src/server/services/{master,roster}.ts` hold all rules and are tested directly; `src/server/actions/*.ts` are thin `"use server"` wrappers that turn expected failures into serialisable results. Zod schemas for every input are in `src/server/schemas.ts`.
- **CI now has a Postgres service** and runs `db:push`, `db:seed`, `verify:seed` and the integration tests against it, so the P1 and P3 gates run in CI and not only locally.
- **`vite` added as a direct dev dependency** (the vitest config and global setup import `loadEnv` from it; pnpm does not expose transitive packages).
- **Seed refactored** into `prisma/seed-lib.ts` (`seedDatabase(prisma)`), used by the CLI and by the integration tests to reset the test database.
- **P3 review round 1:** all four findings fixed (see "Response to review" in `REQUEST-P3.md`): roster cells owned by a neighbour month are overlaid on read and refused for editing (ASSUMPTIONS 44), a change in another month's days is refused (45), acknowledgements are tied to the issue's wording (37), publishing retracts unused auto comp-off credits (38). One deliberate difference from the review's wording (date-owner instead of week-owner) is argued in the response. Schema gained `IssueAck.message` and `CompOffCredit.publishedByRosterId`.
- **Owner ruling recorded (P6):** shared-passcode write lock with the spec in `REVIEW-P3.md`; not started.
