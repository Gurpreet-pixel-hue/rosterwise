# Review: P0 Scaffold. Verdict: PASS

## Findings

None are blocking. Fold these into P1's first commit:

1. [MINOR] `.github/workflows/ci.yml`: `pnpm format:check` isn't in CI, so formatting can drift unnoticed.
   Add it after `pnpm lint`.
2. [MINOR] `eslint.config.mjs`: add `coverage/**` to `ignores`. `@vitest/coverage-v8` is installed, and a
   local coverage run would otherwise get linted.
3. [MINOR] `ci.yml`: `pnpm db:generate` runs and then `pnpm build` runs `prisma generate` again. Harmless,
   so keep it (typecheck needs the client before build). Noted only so no one "fixes" it by removing the
   generate step that comes before typecheck.

## Verified

- A fresh `git clone` of HEAD `a5b1052` into a scratch dir with a dummy `DATABASE_URL`:
  `pnpm install --frozen-lockfile` → `db:generate` → `lint` → `typecheck` → `test` (2/2) →
  `format:check` → `build` all exit 0.
- `git ls-files`: the PDF, `.env`, `next-env.d.ts` and `tsconfig.tsbuildinfo` are **not** tracked.
- Every commit's author and body was checked: there are no Claude/Anthropic/Co-Authored-By lines.
- `CLAUDE.md` and `.gitignore` are unchanged from the plan commit. The only README changes are the CI badge
  and blank lines from Prettier.
- Deviations accepted: Prisma pinned to 6.x (the 8.x tag is an RC), the hand-written `cn()` replacing a
  third-party re-export (a good catch), the `allowBuilds` allow-list, and Node 22 in CI.
  `shadcn` stays in `dependencies` because `globals.css` imports `shadcn/tailwind.css`.
- The seed and verify stubs fail loudly (exit 1) rather than pretending to pass. Correct.

## Next steps

- Push `main` to `origin` now (gate passed), then confirm the first GitHub Actions run is green and
  record the run URL in `PROGRESS.md`. If CI fails, fix that before any P1 work.
- **P1 needs a real database.** Use the Owner's local Homebrew Postgres for development
  (`brew services start postgresql@<ver>`, `createdb rosterwise`, and `DATABASE_URL` in `.env`).
  Neon is only needed at P6. If Postgres won't start, ask the Owner. Don't switch to SQLite.
- P1 pointers from the reviewer:
  - Define "single-resource brand" in `verify-seed` as **a brand whose PRIMARY assignments across all its
    BrandProcesses involve exactly one distinct employee** (BACKUPs don't count). Print the formula with the %.
  - Store dates as `String` `YYYY-MM-DD` columns (or `@db.Date` mapped at the boundary). Never a JS `Date` at local midnight.
  - Put a unique constraint on `Assignment(employeeId, brandProcessId)` and on `BrandProcess(brandId, processId)`.
  - The seed must be idempotent: running `db:seed` twice gives the same DB, with no duplicates.
