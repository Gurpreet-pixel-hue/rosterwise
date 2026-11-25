# Review request: P0 Scaffold

## Done

- Next.js 15.5 (App Router, `src/` layout) + TypeScript `strict`, Tailwind v4, ESLint (flat config, `eslint-config-prettier`), Prettier.
- shadcn/ui initialised (`components.json`, `src/components/ui/button.tsx`, `src/lib/utils.ts`).
- Prisma 6 datasource (`prisma/schema.prisma`, no models yet: P1), `prisma/seed.ts` and `scripts/verify-seed.ts` stubs (exit 1 until P1).
- Vitest (`vitest.config.mts`) with one real test file, `src/lib/utils.test.ts` (2 tests on `cn`).
- Scripts: `dev`, `build` (runs `prisma generate` first), `start`, `test`, `lint`, `typecheck`, `format`, `format:check`, `db:generate`, `db:push`, `db:seed`, `verify:seed`.
- `.env.example` (`DATABASE_URL`, optional `ANTHROPIC_API_KEY`), `docs/PROGRESS.md`, `docs/ASSUMPTIONS.md`.
- `.github/workflows/ci.yml`: install (frozen lockfile) → `db:generate` → lint → typecheck → test → build. CI badge added to `README.md`.
- Existing `README.md`, `CLAUDE.md`, `.gitignore` preserved (README only gained the badge and Prettier spacing).
- 5 small commits on `main`, none with Claude/Anthropic attribution. **Not pushed yet**, per section 6 ("push at every gate PASS").

## How to verify

```
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Verification output

Run from a fresh `git clone` of the local repo (HEAD `2266be3`) with `DATABASE_URL` set to a dummy URL, as CI does. Exit code 0.

```
$ eslint .
$ tsc --noEmit
$ vitest run
 RUN  v5.1.1
 Test Files  1 passed (1)
      Tests  2 passed (2)
$ prisma generate && next build
✔ Generated Prisma Client (v6.19.3)
   ▲ Next.js 15.5.29
 ✓ Compiled successfully in 2.6s
   Linting and checking validity of types ...
 ✓ Generating static pages (5/5)
Route (app)                                 Size  First Load JS
┌ ○ /                                    3.18 kB         106 kB
└ ○ /_not-found                            993 B         104 kB
○  (Static)  prerendered as static content
```

`pnpm format:check` also passes. The GitHub Actions run itself has not happened yet because nothing is pushed.

## Deviations from CLAUDE.md

- **Prisma pinned to 6.x**, not latest: npm `latest` was `8.0.0-rc.35` (a release candidate).
- **`cn()` helper hand-written with `clsx` + `tailwind-merge`.** `shadcn init` generated a re-export from an unrelated npm package called `cn`; removed it.
- **`pnpm-workspace.yaml` added** to allow-list dependency build scripts (`@prisma/client`, `@prisma/engines`, `prisma`, `esbuild`); without it `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`.
- `packageManager` pinned to `pnpm@12.23.0` (what the Owner's machine installed) so CI uses the same version.
- Vitest config is `.mts` to avoid a Vite ESM-loader warning.
- Node 22 in CI; `engines` is `>=20` per the plan.

## Known gaps / risks

- CI is unproven until the first push; the fresh-clone run is the closest local equivalent.
- `db:seed` / `verify:seed` intentionally fail until P1.
- shadcn style generated is `base-nova` (Base UI primitives), the current `shadcn init -d` default, not Radix.
- Only the `button` shadcn component is installed; others are added as the UI phases need them.
