# Progress

Source of truth for scope: `AI_Internship Assessment.pdf` (git-ignored) and `CLAUDE.md`.
PDF/CLAUDE.md mismatches found so far: none.

| Phase                           | Status           | Gate request                 | Review                      |
| ------------------------------- | ---------------- | ---------------------------- | --------------------------- |
| P0 Scaffold                     | PASS             | `docs/reviews/REQUEST-P0.md` | `docs/reviews/REVIEW-P0.md` |
| P1 Data model + seed            | CHANGES_REQUIRED | `docs/reviews/REQUEST-P1.md` | `docs/reviews/REVIEW-P1.md` |
| P2 Engine                       | Not started      |                              |                             |
| P3 Persistence & server actions | Not started      |                              |                             |
| P4 UI                           | Not started      |                              |                             |
| P5 Optional features            | Not started      |                              |                             |
| P6 Deploy & docs                | Not started      |                              |                             |

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
