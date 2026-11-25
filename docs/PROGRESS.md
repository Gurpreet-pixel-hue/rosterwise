# Progress

Source of truth for scope: `AI_Internship Assessment.pdf` (git-ignored) and `CLAUDE.md`.
PDF/CLAUDE.md mismatches found so far: none.

| Phase                           | Status                      | Gate request                 | Review  |
| ------------------------------- | --------------------------- | ---------------------------- | ------- |
| P0 Scaffold                     | Built, awaiting Opus review | `docs/reviews/REQUEST-P0.md` | pending |
| P1 Data model + seed            | Not started                 |                              |         |
| P2 Engine                       | Not started                 |                              |         |
| P3 Persistence & server actions | Not started                 |                              |         |
| P4 UI                           | Not started                 |                              |         |
| P5 Optional features            | Not started                 |                              |         |
| P6 Deploy & docs                | Not started                 |                              |         |

## Decisions log

- **Prisma 6.x, not latest.** The npm `latest` tag for `prisma` was an 8.0 release candidate at
  P0 time. Pinned `prisma`/`@prisma/client` to `^6` for a stable, well-documented toolchain.
- **`cn()` helper is the standard `clsx` + `tailwind-merge` pair.** `shadcn init` generated
  `src/lib/utils.ts` re-exporting `cn` from an unrelated third-party npm package named `cn`.
  Replaced with the conventional implementation and removed that dependency.
- **pnpm build scripts allow-listed** in `pnpm-workspace.yaml` (`@prisma/client`, `@prisma/engines`,
  `prisma`, `esbuild`) so `pnpm install` works in CI without interactive approval.
- **`db:seed` and `verify:seed` are stubs** that exit 1 with a message until P1 implements them.
