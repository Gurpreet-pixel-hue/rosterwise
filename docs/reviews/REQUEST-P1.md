# Review request: P1 Data model + seed

## Done

- `prisma/schema.prisma`: all 13 models and enums from section 3. Dates are `String` `YYYY-MM-DD`, months `YYYY-MM`.
  - Unique: `RosterEntry(rosterId, employeeId, date)`, `Assignment(employeeId, brandProcessId)`,
    `BrandProcess(brandId, processId)`, `CoverageOverride(brandProcessId, date)` (this is the `(brandProcessId, date)` index), `Roster(month, version)`, `PublicHoliday(date)`.
  - Extra indexes: `RosterEntry(rosterId, date)`, `Assignment(brandProcessId, role)`, `Leave(employeeId, fromDate, toDate)`, FK columns.
  - `Pod.leadId` is nullable and unique (a lead is an Employee); deleting an employee sets it to null.
- `prisma/seed-data.ts`: pure data (no DB) for 4 pods, 32 employees, 20 brands, 34 brand-processes, 59 assignments, 5 holidays, 11 leaves, 2 comp-off credits, 2 coverage overrides, plus the exported `DEMO_SCENARIOS`.
- `prisma/seed.ts`: idempotent (clears all tables, re-inserts stable ids, one transaction). Refuses a non-local `DATABASE_URL` unless `SEED_ALLOW_REMOTE=1`.
- `scripts/seed-checks.ts`: 24 checks, one per section 5 bullet plus integrity and the four scenarios. Pure functions on plain rows.
- `scripts/verify-seed.ts`: loads the live DB, runs the same checks, prints the table, the single-resource % with its definition, and per-brand staffing. Exit 1 on any failure.
- `scripts/seed-checks.test.ts`: 16 tests. The same checks run in CI **without a database** on `buildSeedData()`, with negative tests that break the data and expect the matching check to fail.
- `docs/DEMO_SCRIPT.md` (names the four scenarios), `docs/ASSUMPTIONS.md` (items 8 to 15), `docs/PROGRESS.md`.
- Folded in from the P0 review: `coverage/**` in the ESLint ignores, `format:check` in CI (both already pushed, CI green: run 45652593375).
- 5 commits ahead of `origin/main`, **not pushed** (push on PASS). None has Claude attribution.

## How to verify

```
brew services start postgresql@15 && createdb rosterwise     # once; .env holds DATABASE_URL
pnpm db:push && pnpm db:seed && pnpm verify:seed
pnpm db:seed && pnpm db:seed                                  # idempotence: re-run, then verify:seed again
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

## Verification output

### `db:push` -> `db:seed` -> `verify:seed` on a brand-new empty database (created, then dropped)

```
🚀  Your database is now in sync with your Prisma schema.
Seeded: 4 pods, 32 employees, 20 brands, 34 brand-processes, 59 assignments, 5 holidays, 11 leaves, 2 comp-off credits, 2 coverage overrides.
Single-resource brands: 16/20 = 80.0%
24/24 checks passed.
```

### Full `verify:seed` output (local dev database)

```
RosterWise seed verification

PASS  >= 32 employees                                                                           32 employees
PASS  4 pods, each with a lead who is an employee of that pod                                   Alpha: Nisha Kapoor; Bravo: Rohan Mehta; Charlie: Priya Nair; Delta: Karan Malhotra
PASS  about 20 brands (18 to 22)                                                                20 brands
PASS  78% to 85% of brands are single-resource                                                  16/20 = 80.0%
PASS  every other brand has 2 or 3 distinct PRIMARY employees                                   Nova Wellness: 3; Orbit Electronics: 3; Cedar and Co Furniture: 2; Helix Sports Nutrition: 3
PASS  at least one brand has separate processes per person                                      Nova Wellness; Cedar and Co Furniture; Helix Sports Nutrition
PASS  at least one brand where 2 or more people share a process                                 Orbit Electronics / CS; Helix Sports Nutrition / CS
PASS  processes CS, ACC, NDR, RET plus a brand-specific one                                     CS, ACC, NDR, RET, COD
PASS  all four operating rules are used                                                         ALL_DAYS, CUSTOM, NO_PUBLIC_HOLIDAYS, NO_SUNDAY_NO_PH
PASS  a brand whose CS is ALL_DAYS while its other process is NO_SUNDAY_NO_PH                   Nova Wellness; Cedar and Co Furniture
PASS  at least one weekdayMinStaff                                                              Helix Sports Nutrition: {"MON":2}
PASS  at least one CoverageOverride                                                             Harvest Snacks 2026-12-12 min 2; Orbit Electronics 2027-01-15 min 3
PASS  some employees cover 2 to 3 single-resource brands                                        Aarav Sharma (3); Kabir Singh (2); Imran Sheikh (2); Gaurav Chopra (2)
PASS  varied preferredOffDays (3+ distinct) and at least one fixedOffDays                       8 distinct preferences; fixed off: Kabir Singh SUN; Siddharth Jain SUN
PASS  public holidays include 25 Dec 2026, 1 Jan 2027, 26 Jan 2027                              2026-12-06 Regional Winter Festival; 2026-12-25 Christmas Day; 2027-01-01 New Year's Day; 2027-01-14 Makar Sankranti; 2027-01-26 Republic Day
PASS  a public holiday falls on a Sunday (edge case for the engine)                             2026-12-06 Regional Winter Festival
PASS  December has approved leave, an approved comp-off, and there is a PENDING leave           5 approved leaves, 1 approved comp-off, 1 pending
PASS  a leave spans the Dec/Jan month boundary (edge case for the engine)                       leave crossing 31 Dec / 1 Jan
PASS  each approved COMP_OFF leave has a matching used credit                                   1 used credit(s), 1 unused
PASS  references, ranges, shifts and PRIMARY allocation (<= 100%) are consistent                no problems
PASS  Scenario 1: single-resource ALL_DAYS brand with a backup                                  Coastal Candles: Ishita Verma backed up by Divya Menon
PASS  Scenario 2: single-resource ALL_DAYS brand without a backup                               Nimbus Gadgets: Ananya Reddy, no BACKUP assignments
PASS  Scenario 3: 3-person shared process (min 2): one leave absorbable, no overlapping second  Orbit Electronics / CS: Pooja Desai, Arjun Nambiar, Sneha Kulkarni; seeded leave: Arjun Nambiar
PASS  Scenario 4: multi-brand employee with a pending leave on a day all their brands operate   Aarav Sharma -> Lumen Skincare, Verdant Tea Co, Atlas Footwear; pending 2026-12-29..2026-12-30

Single-resource brands: 16/20 = 80.0%
  definition: single-resource brand = exactly 1 distinct PRIMARY employee across all of the brand's processes (BACKUPs not counted); % = single-resource brands / all brands

Brand staffing (PRIMARY employees)
  Lumen Skincare          single  Aarav Sharma
  Verdant Tea Co          single  Aarav Sharma
  Atlas Footwear          single  Aarav Sharma
  Orchid Home             single  Kabir Singh
  Pebble Toys             single  Kabir Singh
  Zephyr Apparel          single  Imran Sheikh
  Mango Mobiles           single  Imran Sheikh
  Pixel Pets              single  Gaurav Chopra
  Terra Organics          single  Gaurav Chopra
  Saffron and Salt        single  Nisha Kapoor
  Indigo Denim            single  Priya Nair
  Coastal Candles         single  Ishita Verma
  Nimbus Gadgets          single  Ananya Reddy
  Harvest Snacks          single  Shruti Banerjee
  Quartz Jewellery        single  Aditi Saxena
  Urban Brew Coffee       single  Harleen Kaur
  Nova Wellness           multi   Meera Iyer, Sanjay Patil, Vikram Rao
  Orbit Electronics       multi   Arjun Nambiar, Pooja Desai, Sneha Kulkarni
  Cedar and Co Furniture  multi   Kavya Hegde, Nikhil Agarwal
  Helix Sports Nutrition  multi   Neha Bansal, Omkar Kadam, Siddharth Jain

24/24 checks passed.
```

### Idempotence

`db:seed` was run twice with a row deleted in between. Both runs exit 0, and a per-table row count plus
`md5(string_agg(row::text order by id))` was identical for all 10 seeded tables, with the deleted row restored.
(The first attempt at this found a real bug: the second run failed with `Employee_podId_fkey` because pods were
deleted before employees. Fixed in `prisma/seed.ts` by deleting employees first; `Pod.leadId` is `SetNull`.)

### Safety guard

```
$ DATABASE_URL="postgresql://u:p@ep-example.neon.tech/db" pnpm db:seed
Refusing to reset a non-local database (ep-example.neon.tech). Set SEED_ALLOW_REMOTE=1 to confirm.
```

### Unit tests (fresh clone of HEAD, as CI runs them)

```
 Test Files  2 passed (2)
      Tests  18 passed (18)
```

`pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm build` also exit 0 from the fresh clone.

## Deviations from CLAUDE.md

- **Seed is destructive by design** (idempotent via clear-and-reinsert) rather than upsert, so a changed seed can never leave stale rows. This is why it has the remote-database guard. Documented in ASSUMPTIONS item 14.
- **More than ~20 "employee" slots are bench staff:** 22 of the 32 employees hold a PRIMARY assignment, the other 10 are the backup pool (ASSUMPTIONS 10). Required to reach 32 employees with 80% single-resource brands.
- **Scenarios 3 and 4 are staged partly through what-if, not baseline data.** Scenario 3 seeds the absorbable leave only (the second leave is the live demo). Scenario 4 seeds the leave as the single PENDING one, so the baseline roster shows a warning and the `CASCADE_GAP` appears when it is approved or simulated. `verify:seed` checks the structure the engine needs, not the engine's output (that is P2: S03, S08).
- Seed checks use a conservative "operating" proxy (Mon to Fri, non-holiday) rather than reimplementing engine calendar logic.

## Known gaps / risks

- Nothing in P1 proves the roster is schedulable; Scenario 2 (Nimbus Gadgets) is _expected_ to be unschedulable. The rest of the seed should be feasible, and P2's S14/S15 are what confirm it. If P2 shows an unintended ERROR, the seed will need tuning.
- `weekdayMinStaff` is a `Json` column typed `Partial<Record<Weekday, number>>`; Zod validation arrives with the server actions in P3.
- Issue acknowledgement storage (`acknowledgeIssue`) is not in section 3; it will be added in P3 if needed.
- Vercel/Neon is untouched until P6. CI does not run `db:push` or `verify:seed`; it runs the DB-free seed tests.
