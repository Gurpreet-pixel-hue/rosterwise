# Review request: P4 UI

## Done

- **Setup (`/setup/*`)**: one generic manager (`src/components/setup/resource-manager.tsx`) driven by
  `resources.ts` serves all ten resources: employees, pods, brands, processes, brand rules (operating rule, custom
  weekdays and holiday flag, default and per-weekday minimum, shift), assignments (primary or backup, allocation),
  public holidays, leave, comp-off credits and coverage overrides. Search, add, edit, delete, with the service's
  readable errors shown in the dialog. The manager changes every assignment and rule without touching code (PDF 3.A, 3.B).
- **Roster (`/roster/[month]`)**: month navigation, DRAFT/PUBLISHED badge and version, Generate / Regenerate
  (keeps manual edits), Publish (disabled with the reason while errors are unacknowledged; the server still enforces it).
  - **Five views** by tabs plus a filter: Company, Pod, Brand, Process, Employee (`src/lib/roster-view.ts`, unit-tested).
  - **Employee by day grid**, colour and a letter code (W O L C H U), markers for an issue, pending leave (`p`, not
    applied) and an edit by hand. The whole Mon-Sun window is shown; boundary-week days owned by the neighbouring month
    are dimmed, dashed and read-only.
  - **Coverage strip** (brand-process by day, `covering/required`, red when short, grey when not operating), computed
    by the engine from the same overlaid draft the validator reads (`coverageTable`).
  - **Who's working on a date** panel: working with what they cover, available (backup pool), and off by status.
  - **Issues panel**: grouped by severity, scoped to the view by default, a jump-to-cell button, the engine's
    explanation, ranked suggestions with a one-click **Apply** (the server re-derives the suggestion and applies it
    through the validated edit path; `REASSIGN_FROM_POD` asks for an explicit approval), acknowledgement with a note,
    and "acknowledged earlier, changed since".
  - **Cell edit dialog**: status and coverage, the **issue delta shown before saving** (errors before and after,
    added, resolved), and the two P3 round 2 notes: a warning for a weekly off that serves the other month's week, and a
    preview of what the edit does to the neighbouring roster. Neighbour-owned days are read-only with a link to the
    owning month.
- **What-if (`/roster/[month]/changes`)**: approve a pending leave, add leave, make someone unavailable, cancel a leave,
  change an operating rule, change a minimum (default or one date). Preview shows errors before and after, cells
  changed, issues added and resolved, weeks re-planned and how to resolve; Apply (enabled only for the inputs just
  previewed) saves a new draft version and shows a diff of it against its parent.
- **Server additions** (all tested, all in `src/server`): `coverageTable` (engine, pure); `editCells`, a batch edit that
  `manualEdit` and suggestions both go through (one validated path, one transaction, audited); `applySuggestionToRoster`;
  `neighbourImpact` on every edit result; `getRoster` now also returns `coverage` and `explanations`; `loadRosterPage`.
- **Fix after the P3 push (automated security review, finding 3):** the publish gate ran before its transaction, so an
  un-acknowledge could slip in between. Now the roster row is locked (`SELECT ... FOR UPDATE`) and the whole gate runs inside
  the publish transaction; edits, acknowledgements and apply take the same lock (ASSUMPTIONS 46).
- **Tests:** 209 total (was 186): 8 new integration tests (`p4.int.test.ts`), 1 for the publish lock, 14 pure unit
  tests for the view logic. Plus `pnpm walkthrough:p4`, a real-browser end-to-end walk that asserts what it sees.
- 5 commits since the P3 push (`git log d569232..HEAD`), none with Claude attribution. **Nothing pushed.**

## How to verify

```
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm db:seed && pnpm dev                 # terminal 1 (a fresh seed has no rosters yet)
pnpm walkthrough:p4                      # terminal 2; uses the installed Google Chrome, writes docs/reviews/p4/*.png
```

## Verification output

`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` exit 0. `pnpm test`: **14 files, 209 tests passed**.
`pnpm walkthrough:p4`, run three times in a row from a fresh seed: `WALKTHROUGH OK`, `browser errors: 0` each time.
Full output of the last run: `docs/reviews/p4/walkthrough-output.txt`.

## The gate: the four demo scenarios, in the browser (screenshots in `docs/reviews/p4/`)

| Scenario                                                              | What the walkthrough asserts, then the screenshot                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Single-resource ALL_DAYS brand **with** a backup (Coastal Candles) | Brand view: 0 short days in the strip, the Issues panel for the view has no ERROR (one preference warning). `03-scenario1-coastal-with-backup-clean.png`                                                                                                                           |
| 2. Single-resource brand **without** a backup (Nimbus Gadgets)        | 5 `WEEKLY_OFF_NOT_GRANTED` for Ananya, each with the explanation and borrow-from-pod suggestions; the jump button lands on her row. `04-scenario2-nimbus-no-backup-conflict.png`                                                                                                   |
| 3. Three-person brand, one leave absorbed, a second is not (Orbit)    | Arjun's seeded leave leaves 0 short days (`05-...`); What-if "Add leave" for Pooja on 17 Dec previews `COVERAGE_GAP ... has 1 of 2`, nothing saved (`06-...`)                                                                                                                      |
| 4. Multi-brand employee, leave causes `CASCADE_GAP` (Aarav)           | What-if "Approve a pending leave" previews errors 5 to 13 naming Lumen Skincare and Verdant Tea Co (`07-...`); Apply gives version 2 with a diff against version 1 (`08-...`); the roster shows the cascade (`09-...`); one click applies a suggestion, 13 to 12 errors (`10-...`) |

Also walked and screenshotted: the five views (`02-*`, and 66 rows in Company narrowing to 20, 4, 49 and 5), the cell edit
with its delta before saving (`11`), the boundary week (`12`: Aarav's 3 Jan weekly off warns about December and the
preview shows the new December ERROR; `13`: 29 Dec in the January roster is read-only with a link), the publish gate
(`14` blocked, then 13 errors acknowledged with notes, `15` published), a published roster being read-only, and setup CRUD
in the browser (`16` to `18`: a holiday added, then deleted).

### The two P3 round 2 notes

- **Edit dialog warns before saving** for a weekly off owed to the other month: shown on opening the cell
  (static text, exactly as you worded it) and again from the live preview (`neighbourImpact`, the real December issue).
  `foreignDates` cells are read-only with a link to the owning month. Screenshots `12` and `13`.
- **The coverage strip uses the same overlaid draft as the validator.** Asserted in
  `p4.int.test.ts`: for December (after an edit) and January, a brand-process/day is short in the strip **exactly when**
  the validator reports a `COVERAGE_GAP` for it (4 short cells compared, both months), and `coverers.length ===
covering`. Mutation: making the strip count one fewer fails 2 tests.

### Are the new server tests real? Mutation check

| Mutation                                                     | Tests that failed                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| strip counts one fewer covering person                       | 2 (strip equals validator; page loader)                            |
| `neighbourImpact` always null                                | 1                                                                  |
| a suggestion skips creating its temporary assignment         | 1                                                                  |
| the same cell twice in one batch no longer refused           | 1 (all or nothing)                                                 |
| `ACCEPT_GAP` no longer refused as an edit                    | 1                                                                  |
| publish takes no roster lock (last round, before P4 started) | 1 (a writer withdraws every acknowledgement while a publish waits) |

## Bugs the walkthrough and screenshots found in my own work (fixed)

1. **The edit dialog reset its form whenever the roster data refreshed**, so a late `router.refresh()` from an earlier
   action wiped a status the manager had just chosen. It now resets only when a different cell opens.
2. **The whole UI rendered in a serif font.** The scaffold's `--font-sans: var(--font-sans)` was circular, and the Geist
   variables lived on `<body>` while `font-sans` is applied on `<html>`, which invalidated the declaration. Fixed.
3. The issue explanation repeated the issue message as its first sentence; the panel now shows only what it adds.
4. `shadcn add` again re-added the unrelated npm package `cn` and imported from it. Reverted to `@/lib/utils` and removed
   (the fix command is in PROGRESS).
5. Script races (an Apply read before `router.refresh` landed, an acknowledgement clicked again before the previous one
   landed). These were bugs in my script, not the app: I confirmed each by reproducing it, then made the script wait for
   the page to change. Three consecutive clean runs.

## Deviations from CLAUDE.md

- **Native `<select>` for form selects** instead of the shadcn (base-ui) Select: robust, keyboard and screen-reader friendly,
  and far simpler for the dense setup forms. Dialog, Tabs, Table, Badge, Checkbox and Input are shadcn.
- **`playwright-core` added as a dev dependency**, used only by `scripts/p4-walkthrough.ts` (it drives the Chrome already
  installed; nothing is downloaded). The walkthrough is not run in CI.
- **Pending-leave chip** is a small `p` marker with a tooltip rather than a separate chip component, to keep the grid dense.
- No change to the engine's scheduling or validation. One pure function was added (`coverageTable`).

## Known gaps / risks

- **No login yet** (the audit actor is the constant `manager`). The shared-passcode lock is P6, per the Owner ruling; the
  automated security review's missing-authorization and actor-spoofing findings are exactly that.
- **A "temporary assignment" is saved as an ordinary BACKUP assignment** (ASSUMPTIONS 50); nothing expires it.
- **The what-if "preview then apply" re-runs the simulation on apply** (it does not trust the preview's numbers), so in the
  rare case the master data changed in between, the applied version is what the server computed at apply time.
- **Not done:** a mobile layout check (the grid scrolls horizontally and the side panel stacks under it; I only looked at
  1700 px wide), virtualised rows (66 rows in Company view is fine), and an accessibility audit beyond letter codes,
  labels on every control, roles on the tabs and `aria-live` on the edit preview.
- **The grid shows the whole planning window (35 columns)** which needs horizontal scrolling on screens narrower than
  about 1500 px.
- The shared-secret write lock, deploy, README, metrics and the timed demo script are P6. P5 (optional features) has not
  started; the gate asked for P4 only.
