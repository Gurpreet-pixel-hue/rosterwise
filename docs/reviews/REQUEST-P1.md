# Review request: P1 Data model + seed

## Done

- `prisma/schema.prisma`: all 13 models and enums from section 3. Dates are `String` `YYYY-MM-DD`, months `YYYY-MM`.
  - Unique: `RosterEntry(rosterId, employeeId, date)`, `Assignment(employeeId, brandProcessId)`,
    `BrandProcess(brandId, processId)`, `CoverageOverride(brandProcessId, date)` (this is the `(brandProcessId, date)` index), `Roster(month, version)`, `PublicHoliday(date)`.
  - Extra indexes: `RosterEntry(rosterId, date)`, `Assignment(brandProcessId, role)`, `Leave(employeeId, fromDate, toDate)`, FK columns.
  - `Pod.leadId` is nullable and unique (a lead is an Employee); deleting an employee sets it to null.
- `prisma/seed-data.ts`: pure data (no DB) for 4 pods, 32 employees, 20 brands, 34 brand-processes, 61 assignments, 5 holidays, 11 leaves, 2 comp-off credits, 2 coverage overrides, plus the exported `DEMO_SCENARIOS`.
- `prisma/seed.ts`: idempotent (clears all tables, re-inserts stable ids, one transaction). Refuses a non-local `DATABASE_URL` unless `SEED_ALLOW_REMOTE=1`.
- `scripts/seed-checks.ts`: 27 checks: one per section 5 bullet, integrity, three static-feasibility checks and the four scenarios. Pure functions on plain rows.
- `scripts/verify-seed.ts`: loads the live DB, runs the same checks, prints the table, the single-resource % with its definition, and per-brand staffing. Exit 1 on any failure.
- `scripts/seed-checks.test.ts`: 24 tests. The same checks run in CI **without a database** on `buildSeedData()`, with negative tests that break the data and expect the matching check to fail.
- `src/engine/{types,calendar,demand}.ts` + 25 unit tests (added in review round 1, see Response). `scripts/seed-capacity.ts`: the static feasibility checks.
- `docs/DEMO_SCRIPT.md` (names the four scenarios plus the preference-vs-coverage mini-scenario), `docs/ASSUMPTIONS.md` (items 8 to 15), `docs/PROGRESS.md`.
- Folded in from the P0 review: `coverage/**` in the ESLint ignores, `format:check` in CI (both already pushed, CI green: run 45652593375).
- Not pushed: everything after `eb7fda7` is local only (`git log origin/main..HEAD`). The rule is to push on PASS. None has Claude attribution.

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
Seeded: 4 pods, 32 employees, 20 brands, 34 brand-processes, 61 assignments, 5 holidays, 11 leaves, 2 comp-off credits, 2 coverage overrides.
Single-resource brands: 16/20 = 80.0%
27/27 checks passed.
```

### Full `verify:seed` output (local dev database, after review fixes)

```
RosterWise seed verification

PASS  >= 32 employees                                                                                                                                                     32 employees
PASS  4 pods, each with a lead who is an employee of that pod                                                                                                             Alpha: Nisha Kapoor; Bravo: Rohan Mehta; Charlie: Priya Nair; Delta: Karan Malhotra
PASS  about 20 brands (18 to 22)                                                                                                                                          20 brands
PASS  78% to 85% of brands are single-resource                                                                                                                            16/20 = 80.0%
PASS  every other brand has 2 or 3 distinct PRIMARY employees                                                                                                             Nova Wellness: 3; Orbit Electronics: 3; Cedar and Co Furniture: 2; Helix Sports Nutrition: 3
PASS  at least one brand has separate processes per person                                                                                                                Nova Wellness; Cedar and Co Furniture; Helix Sports Nutrition
PASS  at least one brand where 2 or more people share a process                                                                                                           Orbit Electronics / CS; Helix Sports Nutrition / CS
PASS  processes CS, ACC, NDR, RET plus a brand-specific one                                                                                                               CS, ACC, NDR, RET, COD
PASS  all four operating rules are used                                                                                                                                   ALL_DAYS, CUSTOM, NO_PUBLIC_HOLIDAYS, NO_SUNDAY_NO_PH
PASS  a brand whose CS is ALL_DAYS while its other process is NO_SUNDAY_NO_PH                                                                                             Nova Wellness; Cedar and Co Furniture
PASS  at least one weekdayMinStaff                                                                                                                                        Helix Sports Nutrition: {"MON":2}
PASS  at least one CoverageOverride                                                                                                                                       Harvest Snacks 2026-12-12 min 2; Orbit Electronics 2027-01-15 min 3
PASS  some employees cover 2 to 3 single-resource brands                                                                                                                  Aarav Sharma (3); Kabir Singh (2); Imran Sheikh (2); Gaurav Chopra (2)
PASS  varied preferredOffDays (3+ distinct) and at least one fixedOffDays                                                                                                 8 distinct preferences; fixed off: Kabir Singh SUN; Siddharth Jain SUN
PASS  public holidays include 25 Dec 2026, 1 Jan 2027, 26 Jan 2027                                                                                                        2026-12-06 Regional Winter Festival; 2026-12-25 Christmas Day; 2027-01-01 New Year's Day; 2027-01-14 Makar Sankranti; 2027-01-26 Republic Day
PASS  a public holiday falls on a Sunday (edge case for the engine)                                                                                                       2026-12-06 Regional Winter Festival
PASS  December has approved leave, an approved comp-off, and there is a PENDING leave                                                                                     5 approved leaves, 1 approved comp-off, 1 pending
PASS  a leave spans the Dec/Jan month boundary (edge case for the engine)                                                                                                 leave crossing 31 Dec / 1 Jan
PASS  each approved COMP_OFF leave has a matching used credit                                                                                                             1 used credit(s), 1 unused
PASS  references, ranges, shifts and PRIMARY allocation (<= 100%) are consistent                                                                                          no problems
PASS  static capacity (Dec 2026 and Jan 2027): every operating day has enough available staff (necessary condition only, not proof a roster exists; ignores weekly offs)  no unexpected shortfall
PASS  static weekly-off slack: everyone with PRIMARY duties has a day they are not needed (necessary condition only, not proof a roster exists)                           no unexpected blocked weekly off || EXPECTED: Nimbus Gadgets: Ananya Reddy cannot be given a weekly off in 9 week(s) (Nimbus Gadgets needs them every candidate day): weeks of 2026-11-30, 2026-12-07, 2026-12-14, 2026-12-21, 2026-12-28, 2027-01-04, 2027-01-11, 2027-01-18, 2027-01-25
PASS  every deliberately unschedulable brand (EXPECTED_INFEASIBLE) really is infeasible                                                                                   EXPECTED: Nimbus Gadgets
PASS  Scenario 1: single-resource ALL_DAYS brand with a backup                                                                                                            Coastal Candles: Ishita Verma backed up by Divya Menon
PASS  Scenario 2: single-resource ALL_DAYS brand without a backup                                                                                                         Nimbus Gadgets: Ananya Reddy, no BACKUP assignments
PASS  Scenario 3: 3-person shared process (min 2): one leave absorbable, no overlapping second                                                                            Orbit Electronics / CS: Pooja Desai, Arjun Nambiar, Sneha Kulkarni; seeded leave: Arjun Nambiar
PASS  Scenario 4: multi-brand employee, pending leave; 1 brand has a backup, 2 do not                                                                                     Aarav Sharma -> Lumen Skincare, Verdant Tea Co, Atlas Footwear; Atlas Footwear backed up by Rahul Bhatt; pending 2026-12-29..2026-12-30

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

27/27 checks passed.
```

### Idempotence

`db:seed` was run twice with a row deleted in between. Both runs exit 0, and a per-table row count plus
`md5(string_agg(row::text order by id))` was identical for all 10 seeded tables, with the deleted row restored. Re-run after the review fixes with explicit exit codes: run1 exit=0, run2 exit=0, IDENTICAL, `Assignment 61`.
(The first attempt at this found a real bug: the second run failed with `Employee_podId_fkey` because pods were
deleted before employees. Fixed in `prisma/seed.ts` by deleting employees first; `Pod.leadId` is `SetNull`.)

### Safety guard

```
$ DATABASE_URL="postgresql://u:p@ep-example.neon.tech/db" pnpm db:seed
Refusing to reset a non-local database (ep-example.neon.tech). Set SEED_ALLOW_REMOTE=1 to confirm.
```

### Unit tests (fresh clone of HEAD, as CI runs them)

```
 Test Files  4 passed (4)
      Tests  52 passed (52)
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

## Response to review

Round 1 verdict was CHANGES_REQUIRED (6 findings). All six are fixed. Evidence is in the output above and in the tests named below.

1. **[BLOCKER] Helix gap on Mon 2027-01-25** -> fixed in `prisma/seed-data.ts`: Helix Sports Nutrition CS now has `Zoya Ansari` as BACKUP (60%, Delta pod bench). On that Monday the ceiling is Siddharth + Zoya = 2 of 2. I first made the new check report the problem on the unfixed data (`Helix Sports Nutrition / CS: 2027-01-25 has at most 1 of 2`, the "passes every check" test went RED), then applied the fix (GREEN). Zoya also backs up Quartz Jewellery (14:00 to 23:00) while Helix is 09:00 to 18:00, so the engine must never put her on both on the same day; she is also a useful `SHIFT_INCOMPATIBLE` case for P2. Now the only source of baseline ERRORs is Nimbus Gadgets.

2. **[MAJOR] No static capacity check** -> fixed in `scripts/seed-capacity.ts` + `scripts/seed-checks.ts` (three checks: `static-capacity`, `static-weekly-off`, `expected-infeasible`).
   - Uses the **real** rules: it imports `src/engine/calendar.ts` (`isOperating`, `weeksOfMonth`) and `src/engine/demand.ts` (`requiredStaff`: override, then weekday, then default), as suggested. Both are new files with their own tests (`src/engine/__tests__/calendar.test.ts`, `demand.test.ts`, 25 tests). The old Mon-Fri proxy and the duplicate date helpers in `seed-checks.ts` are gone.
   - For every date in Dec 2026 and Jan 2027 and every operating brand-process, it counts PRIMARY+BACKUP assignees who are not on **APPROVED** leave or comp-off (PENDING and REJECTED are ignored; tested) and not on a fixed off day, and fails if that is below `required`.
   - `EXPECTED_INFEASIBLE = ["Nimbus Gadgets"]`, printed as `EXPECTED:`. Since the pure capacity check ignores weekly offs and so cannot see Nimbus, I added a weekly-off slack check, so the allowlist is not vestigial: it finds Ananya Reddy blocked in 9 of 9 weeks. A third check fails if an expected brand stops being infeasible.
   - Negative tests: removing the Helix backup fails and names `2027-01-25 has at most 1 of 2`; removing Urban Brew's only backup fails with `UNEXPECTED ... Harleen Kaur`; giving Nimbus a backup fails `expected-infeasible`; approving the PENDING/REJECTED leaves fails capacity.
   - The output labels say "necessary condition only, not proof a roster exists".
   - **Beyond the finding, it caught a real problem you did not predict** (see Deviations: boundary-week ruling).

3. **[MAJOR] `RosterEntry.employee` cascade** -> fixed in `prisma/schema.prisma`: `onDelete: Restrict`. Verified on the live DB: with a published roster and an entry for Aarav, `delete from "Employee"` fails with `RosterEntry_employeeId_fkey`, the row survives, and `db:seed` still exits 0 and clears everything (it deletes entries first). ASSUMPTIONS 16 notes that removal means `isActive = false` (P3).

4. **[MINOR] Publish/ack storage** -> fixed in `prisma/schema.prisma`: `Roster.publishedAt DateTime?` and model `IssueAck { id, rosterId (Cascade), issueId, note, actor, createdAt, @@unique([rosterId, issueId]) }`. Verified on the DB: a duplicate `(rosterId, issueId)` is rejected. `seed.ts` clears it.

5. **[MINOR] Scenario 4 mixed resolution** -> fixed: Atlas Footwear CS has BACKUP `Rahul Bhatt` (25%, Alpha bench); Lumen Skincare and Verdant Tea Co keep none. `DEMO_SCENARIOS.cascade` now names the backed-up and unbacked brands, and the `scenario-4` check asserts exactly one backed-up brand and two without. Negative test: giving a second brand a backup fails it. Still `Aarav -> 3 brands, pending 2026-12-29..2026-12-30`. A `CASCADE_GAP` still lists two brands (Lumen, Verdant).

6. **[MINOR] Mini-scenario in the demo script** -> fixed in `docs/DEMO_SCRIPT.md`: new "Scenario 5: client coverage beats a preferred day off" (Harvest Snacks, override min 2 on Sat 2026-12-12, Rekha Das prefers SAT/SUN off, expects `PREFERRED_OFF_NOT_HONOURED`). The baseline-feasibility note and the Helix/Zoya detail are in there too.

### Deviations introduced by this round (please confirm)

- **Boundary-week ruling (ASSUMPTIONS 18).** The new weekly-off check first reported four _unintended_ blocked offs in December (Aarav Sharma, Kabir Singh, Priya Nair, Gaurav Chopra) in the week of 28 Dec. Cause: that week belongs to December (4 days), but December's share is Mon to Thu only, so staff on Sunday-closed brands without backups have no free in-month day; their natural off is Sunday 3 Jan, which is a January date. I ruled that the owning month's requirement may be satisfied on **any day of that Mon-Sun week, including the neighbouring month's days**, and the engine will carry the off into the next roster as a locked entry (P2). `weeksOfMonth()` now exposes `fullWeek`, with a test. It does not change which month owns the requirement (your note stands: December, not January). Cost if you disagree: the alternative is adding backups for those four people or accepting four December errors, and P2's S15 design depends on this being settled.
- `calendar.ts`, `demand.ts` and `types.ts` were written in P1 (your suggestion), so P2's engine work starts with them done. `types.ts` holds only the types they need; the rest arrives in P2.
- Your P2 notes: weekly-off/leave rule (ASSUMPTIONS 17), the "Available (backup pool)" label (ASSUMPTIONS 20) and the boundary-week test (`calendar.test.ts`) are already recorded or done; nothing else was pre-empted.
