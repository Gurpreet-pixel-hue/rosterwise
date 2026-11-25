# Review request: P2 Engine

## Done

All of section 4 of CLAUDE.md, in `src/engine/` (pure TypeScript; an ESLint rule and a test enforce that it
imports no Prisma, Next.js, Node I/O or `process`, reads no clock and uses no randomness):

- `types.ts`, `calendar.ts`, `demand.ts` (P1), `availability.ts`, `generate.ts`, `validate.ts` (the single source of truth), `suggest.ts`, `diff.ts`, `explain.ts`, `index.ts`.
- Additions beyond the plan's file list: `change.ts` (`simulateChange`, section 4 "Change handling"), `edit.ts` (apply cell edits), `analyze.ts` (validate + suggestions), `ctx.ts` and `state.ts` (shared indexes and the working roster, so the generator, validator and suggester agree on "covered", "load" and "needed"), `ids.ts` (stable issue ids, FNV-1a, no crypto import).
- `src/server/buildEngineInput.ts`: pure row-to-input mapping (validates the `weekdayMinStaff` JSON), shared by the DB loader, the CLI and the tests. `src/server/loadEngineInput.ts`: the Prisma reader, including the neighbouring months' latest rosters.
- `scripts/roster-dry-run.ts` and `pnpm roster:dry-run YYYY-MM [--no-chain]`: a text grid, per brand-process coverage and an issue summary. Nothing is saved. By default it generates the previous month in memory first, so the boundary-week carry-over is visible.
- Tests: **S01 to S15 with the exact names from section 4, plus S16 to S18 from the P1 review** (names checked mechanically against CLAUDE.md and the review: none missing), one test per issue code, the correctness traps from section 9, `simulateChange`, `diffRosters`, `explainIssue`, engine purity. 103 tests in total.
- The boundary-week mechanism is implemented as the P1 review specified it: full-week planning window, spill entries, neighbour locks, carry-over as a locked `AUTO` entry with a "carried from" note, never overwriting a neighbour's entry, validation scope.
- 4 commits, none with Claude attribution. **Nothing pushed** (push on PASS). The last push was P1 (`0783e84`, CI green).

## How to verify

```
pnpm db:push && pnpm db:seed && pnpm verify:seed      # still 27/27
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm roster:dry-run 2026-12
pnpm roster:dry-run 2027-01
```

## Verification output

### `pnpm test`: 8 files, 103 tests, all passing (full names below)

```
 Test Files  8 passed (8)
      Tests  103 passed (103)
```

<details><summary>All 103 test names</summary>

```
calendar.test.ts > date helpers (string dates, no local-timezone drift) > weekdayOf
calendar.test.ts > date helpers (string dates, no local-timezone drift) > addDays crosses month, year and leap-day boundaries
calendar.test.ts > date helpers (string dates, no local-timezone drift) > datesBetween is inclusive and crosses a month and year boundary
calendar.test.ts > date helpers (string dates, no local-timezone drift) > monthDates lists every day of the month
calendar.test.ts > date helpers (string dates, no local-timezone drift) > rejects malformed or impossible dates and months
calendar.test.ts > isOperating > ALL_DAYS operates every day, including Sundays and public holidays
calendar.test.ts > isOperating > NO_PUBLIC_HOLIDAYS operates every day except public holidays
calendar.test.ts > isOperating > NO_SUNDAY_NO_PH operates Mon-Sat excluding public holidays
calendar.test.ts > isOperating > CUSTOM operates on its weekdays; public holidays only if worksOnPublicHolidays
calendar.test.ts > isOperating > CUSTOM with no weekdays never operates
calendar.test.ts > weeksOfMonth (Mon-Sun weeks; a weekly off is required only if >= 4 days are in the month) > December 2026: the boundary week 28 Dec - 3 Jan has 4 December days, so it requires an off in December
calendar.test.ts > weeksOfMonth (Mon-Sun weeks; a weekly off is required only if >= 4 days are in the month) > January 2027: the same boundary week has only 3 January days, so it requires NO off in January
calendar.test.ts > weeksOfMonth (Mon-Sun weeks; a weekly off is required only if >= 4 days are in the month) > each boundary week requires an off in exactly one of the two months (never both, never neither)
calendar.test.ts > weeksOfMonth (Mon-Sun weeks; a weekly off is required only if >= 4 days are in the month) > a month that starts on Monday and has 28 days is exactly four full weeks (Feb 2027)
calendar.test.ts > weeksOfMonth (Mon-Sun weeks; a weekly off is required only if >= 4 days are in the month) > a single stray day is not a qualifying week (Nov 2026 ends on Monday 30 Nov)
calendar.test.ts > weeksOfMonth (Mon-Sun weeks; a weekly off is required only if >= 4 days are in the month) > exposes the full Mon-Sun week, so an off can sit on a neighbouring-month day (Sunday 3 Jan for December's boundary week)
calendar.test.ts > weeksOfMonth (Mon-Sun weeks; a weekly off is required only if >= 4 days are in the month) > every day of the month appears in exactly one week
purity.test.ts > the engine is pure (CLAUDE.md: no DB, no Next.js, no I/O, deterministic) > finds the engine source files
purity.test.ts > the engine is pure (CLAUDE.md: no DB, no Next.js, no I/O, deterministic) > imports nothing from Prisma, Next.js, the server layer, or Node I/O
purity.test.ts > the engine is pure (CLAUDE.md: no DB, no Next.js, no I/O, deterministic) > has no hidden randomness or clock reads
purity.test.ts > availabilityOf > only APPROVED leave counts; comp-off wins over leave; fixed off applies otherwise
purity.test.ts > buildEngineInput > validates the weekdayMinStaff JSON column instead of trusting it
purity.test.ts > buildEngineInput > maps the seed into an engine input and carries the brand and process names
purity.test.ts > buildEngineInput > rejects a brand-process that points at a missing brand
demand.test.ts > requiredStaff resolution: CoverageOverride -> weekdayMinStaff -> defaultMinStaff, only if operating > falls back to defaultMinStaff
demand.test.ts > requiredStaff resolution: CoverageOverride -> weekdayMinStaff -> defaultMinStaff, only if operating > weekdayMinStaff beats the default on that weekday only
demand.test.ts > requiredStaff resolution: CoverageOverride -> weekdayMinStaff -> defaultMinStaff, only if operating > a CoverageOverride beats the weekday minimum and the default
demand.test.ts > requiredStaff resolution: CoverageOverride -> weekdayMinStaff -> defaultMinStaff, only if operating > an override can lower the requirement below the default
demand.test.ts > requiredStaff resolution: CoverageOverride -> weekdayMinStaff -> defaultMinStaff, only if operating > an explicit 0 is respected at every level (a brand-process with min 0)
demand.test.ts > requiredStaff resolution: CoverageOverride -> weekdayMinStaff -> defaultMinStaff, only if operating > is 0 when the brand-process is not operating, even with an override
demand.test.ts > requiredStaff resolution: CoverageOverride -> weekdayMinStaff -> defaultMinStaff, only if operating > an override for a different brand-process or date is ignored
demand.test.ts > requiredStaff resolution: CoverageOverride -> weekdayMinStaff -> defaultMinStaff, only if operating > ignores a weekday minimum for a weekday that is not a working day (CUSTOM)
demand.test.ts > expandDemand > returns Map<bpId, Map<date, required>> covering every requested date
codes.test.ts > every issue code is detected, with the right severity > NO_ELIGIBLE_STAFF: a brand-process that operates but has nobody assigned (one issue, not a flood of gaps)
codes.test.ts > every issue code is detected, with the right severity > WORK_WHILE_UNAVAILABLE: only possible through a manual edit on a day of approved leave
codes.test.ts > every issue code is detected, with the right severity > FIXED_OFF_VIOLATED: a contract-fixed off day is forced by the generator, even on a public holiday
codes.test.ts > every issue code is detected, with the right severity > OVERALLOCATED (warning): two processes of the same brand add up to more than 100%
codes.test.ts > every issue code is detected, with the right severity > SHIFT_INCOMPATIBLE: overlapping shifts for DIFFERENT brands that exceed 100% allocation
codes.test.ts > every issue code is detected, with the right severity > CONSECUTIVE_DAYS_EXCEEDED (warning): reported once per run, on the day the limit is passed
codes.test.ts > every issue code is detected, with the right severity > PENDING_LEAVE_CONFLICT (warning): pending leave on a day the employee is the sole cover, and it is NOT applied
codes.test.ts > every issue code is detected, with the right severity > PENDING and REJECTED leave never make anyone unavailable
codes.test.ts > correctness traps > a public holiday inside a leave is not charged to the leave: it is HOLIDAY
codes.test.ts > correctness traps > leave spanning months (30 Dec to 2 Jan, with 1 Jan a holiday) is handled, and the thin week needs no weekly off
codes.test.ts > correctness traps > an employee with zero assignments is a backup-pool member: works, gets weekly offs, raises nothing
codes.test.ts > correctness traps > a brand-process with minimum 0 needs nobody, even when everyone assigned is on leave
codes.test.ts > correctness traps > an inactive employee is ignored entirely: no entries, no issues, never used as cover
codes.test.ts > correctness traps > every employee has exactly one entry per planning-window date
codes.test.ts > correctness traps > weeklyOffsPerWeek 2 gives two offs per qualifying week
src/lib/utils.test.ts > cn > merges class names and lets later Tailwind utilities win
src/lib/utils.test.ts > cn > drops falsy values
scripts/seed-checks.test.ts > seed data satisfies CLAUDE.md section 5 > passes every check
scripts/seed-checks.test.ts > seed data satisfies CLAUDE.md section 5 > has the headline numbers
scripts/seed-checks.test.ts > seed data satisfies CLAUDE.md section 5 > uses unique ids and unique brand-process / assignment pairs
scripts/seed-checks.test.ts > seed data satisfies CLAUDE.md section 5 > is deterministic: building twice gives deep-equal data
scripts/seed-checks.test.ts > the checks actually catch broken data > fewer than 32 employees fails
scripts/seed-checks.test.ts > the checks actually catch broken data > a second PRIMARY on a single-resource brand drops the single-resource %
scripts/seed-checks.test.ts > the checks actually catch broken data > BACKUP assignments do not make a brand multi-resource
scripts/seed-checks.test.ts > the checks actually catch broken data > removing the backup breaks scenario 1
scripts/seed-checks.test.ts > the checks actually catch broken data > adding a backup to the no-backup brand breaks scenario 2
scripts/seed-checks.test.ts > the checks actually catch broken data > a second overlapping leave breaks scenario 3 (it must stay absorbable)
scripts/seed-checks.test.ts > the checks actually catch broken data > giving Aarav's brand a backup breaks scenario 4
scripts/seed-checks.test.ts > the checks actually catch broken data > dropping the pending leave fails the December check
scripts/seed-checks.test.ts > the checks actually catch broken data > over-allocating a PRIMARY past 100% fails integrity
scripts/seed-checks.test.ts > the checks actually catch broken data > an inverted shift fails integrity
scripts/seed-checks.test.ts > static feasibility (review finding 2) > Helix Sports Nutrition CS has a backup, so Neha's leave on Monday 2027-01-25 is coverable
scripts/seed-checks.test.ts > static feasibility (review finding 2) > removing the Helix backup fails the capacity check and names 2027-01-25
scripts/seed-checks.test.ts > static feasibility (review finding 2) > an unexpected blocked weekly off fails: removing Urban Brew's only backup (ALL_DAYS CS)
scripts/seed-checks.test.ts > static feasibility (review finding 2) > Nimbus Gadgets is reported as EXPECTED, not as a failure
scripts/seed-checks.test.ts > static feasibility (review finding 2) > giving Nimbus a backup makes the expected infeasibility vanish, which fails
scripts/seed-checks.test.ts > static feasibility (review finding 2) > a leave only blocks when approved: the PENDING and REJECTED leaves do not shrink capacity
scripts/seed-checks.test.ts > static feasibility (review finding 2) > the December boundary week (28 Dec - 3 Jan) is satisfiable for Sunday-off staff via Sunday 3 Jan
scripts/seed-checks.test.ts > review findings 5 and 6: scenario 4 mixes backup and no-backup brands > Atlas Footwear has a backup; Lumen Skincare and Verdant Tea Co have none
scripts/seed-checks.test.ts > review findings 5 and 6: scenario 4 mixes backup and no-backup brands > scenario 4 still passes with the mixed resolution
scripts/seed-checks.test.ts > review findings 5 and 6: scenario 4 mixes backup and no-backup brands > scenario 4 fails if a second brand gains a backup (it would leave only one gap)
change.test.ts > simulateChange (assessment section F), without saving > approving Aarav's pending leave: CASCADE_GAP on two brands, a backup absorbs the third, only that week is re-planned
scenarios.test.ts > engine scenarios > S01 single-resource ALL_DAYS brand with backup: primary weekly off covered by backup, zero ERRORs
scenarios.test.ts > engine scenarios > S02 single-resource ALL_DAYS brand without backup: WEEKLY_OFF_NOT_GRANTED or COVERAGE_GAP raised, never silent
scenarios.test.ts > engine scenarios > S03 three-employee brand, one on leave: min 1 shared process -> no gap; min 2 -> COVERAGE_GAP
scenarios.test.ts > engine scenarios > S04 NO_SUNDAY_NO_PH process: no demand on Sun/PH; weekly off lands on Sunday
scenarios.test.ts > engine scenarios > S05 public holiday: ALL_DAYS staffed + COMP_OFF_EARNED; NO_PUBLIC_HOLIDAYS not staffed
scenarios.test.ts > engine scenarios > S06 CoverageOverride raises min to 2 on one date and is enforced
scenarios.test.ts > engine scenarios > S07 manual edit makes sole cover OFF -> COVERAGE_GAP with USE_BACKUP/SWAP_OFF_DAY suggestions
scenarios.test.ts > engine scenarios > S08 employee covering 3 brands goes on leave -> CASCADE_GAP lists all 3 brands
scenarios.test.ts > engine scenarios > S09 determinism: same input twice -> deep-equal output
change.test.ts > simulateChange (assessment section F), without saving > a second simultaneous leave in the 3-person brand creates the gap the first one did not (scenario 3)
change.test.ts > simulateChange (assessment section F), without saving > removing a leave frees the employee again and adds no ERROR
change.test.ts > simulateChange (assessment section F), without saving > a one-day minimum-staff override re-plans only that week
scenarios.test.ts > engine scenarios > S10 locked entries preserved across regenerate
scenarios.test.ts > engine scenarios > S11 preferred off conflicts with coverage -> coverage wins + PREFERRED_OFF_NOT_HONOURED
scenarios.test.ts > engine scenarios > S12 incompatible shifts across brands -> SHIFT_INCOMPATIBLE
scenarios.test.ts > engine scenarios > S13 every suggestion returned, when applied, introduces no new ERROR
scenarios.test.ts > engine scenarios > S14 invariant on the full seed for 2 months: generator-reported ERRORs == validator ERRORs
change.test.ts > simulateChange (assessment section F), without saving > changing a brand's operating rule is previewed, not applied, and re-plans the whole month
scenarios.test.ts > engine scenarios > S15 weekly offs: every employee gets >= weeklyOffsPerWeek in qualifying weeks unless an ERROR explains why
change.test.ts > simulateChange (assessment section F), without saving > dates before today are history: a change cannot rewrite them
change.test.ts > diffRosters > identical rosters have no changes
scenarios.test.ts > engine scenarios > S16 boundary week: Dec generated first -> Aarav's off lands on 2027-01-03; Jan generated next carries it locked
scenarios.test.ts > engine scenarios > S17 boundary week: Jan generated with no Dec roster -> no weekly-off issue for the Dec-owned week in Jan
change.test.ts > diffRosters > reports changed cells and matches issues by stable id
change.test.ts > diffRosters > issue ids are stable across regeneration
scenarios.test.ts > engine scenarios > S18 boundary week: neighbour PUBLISHED with WORK on the only free day -> WEEKLY_OFF_NOT_GRANTED naming that date
change.test.ts > explainIssue is deterministic and specific > covers every issue code and always includes the issue's own message
change.test.ts > explainIssue is deterministic and specific > explains Ananya Reddy's missing weekly off by naming the brands she alone covers
```

</details>

`pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm build` exit 0. `pnpm verify:seed`: 27/27 checks passed.

### `pnpm roster:dry-run 2026-12` and `2027-01`

Summary (full output below and in `docs/reviews/p2/`):

| Month   | ERROR                      | WARNING                                              | INFO                 | What the ERRORs are                                                     |
| ------- | -------------------------- | ---------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| 2026-12 | 5 `WEEKLY_OFF_NOT_GRANTED` | 6 consecutive-days, 7 preferred-off, 2 pending-leave | 16 `COMP_OFF_EARNED` | all five are Ananya Reddy (Nimbus Gadgets, intentionally unschedulable) |
| 2027-01 | 4 `WEEKLY_OFF_NOT_GRANTED` | 8 consecutive-days, 8 preferred-off                  | 24 `COMP_OFF_EARNED` | all four are Ananya Reddy                                               |

**Hand-check pointers** (two brands, as the reviewer checklist asks). December, `|` marks the month boundary, `Ō` a locked off:

```
Legend: W work, w works but covers nothing (backup pool / closed day), O weekly off, Ō locked weekly off, L leave, C comp-off, H holiday. '|' marks the month boundary (dates outside it are spill).

                           3|0000000001111111111222222222233|000
Aarav Sharma               W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Divya Menon                w|OwwwWHOwwwwWwOwwwwWwWWWwHWOOwww|HWw
Ishita Verma               W|WWWWOWWWWWWOWWWWWWOWLLLWWOWWWWW|WOW
Ananya Reddy               W|WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW|WWW
Arjun Nambiar              W|WWWOWWWWWWOWWWWLLOWWWWWWOWWOWWW|HWW
Pooja Desai                W|WWWWWOWWWWWWOOWWWWWWOWWWWWWWOWW|WWW
Sneha Kulkarni             W|OWWWWWWOWWWWWWOWWWWWWOWWWWWWWOW|WWW
Coastal Candles / ACC              NPH 1|11111.111111111111111111.111111|.11
Coastal Candles / CS               365 1|1111111111111111111111111111111|111
Helix Sports Nutrition / CS        CUS 2|21222.221222.221222.2212.2.2212|.2.
Nimbus Gadgets / CS                365 1|1111111111111111111111111111111|111
Nimbus Gadgets / NDR               365 1|1111111111111111111111111111111|111
Orbit Electronics / CS             365 3|2332323233232222223322332332223|233
```

- _Single-resource ALL_DAYS brand with a backup (Coastal Candles, Ishita Verma + Divya Menon):_ Ishita's offs are the four Saturdays (5, 12, 19, 26 Dec: her preferred days); Divya works each of those days and Coastal Candles / CS reads `1` on all 35 days. Her leave 21 to 23 Dec shows `LLL` and Divya covers (CS still `1`, ACC `1`). On the public holidays 6 and 25 Dec Ishita works and earns a comp-off while Divya is `H`; ACC (every day except holidays) reads `.` on those two days.
- _3-person brand (Orbit Electronics, Pooja / Arjun / Sneha, min 2):_ coverage reads `2` or `3` every day, including `2 2` on Arjun's leave 16 and 17 Dec (Pooja + Sneha), and the Jan 15 override of 3 reads `3` (see the January file).
- _Intentionally unschedulable (Nimbus Gadgets, Ananya Reddy):_ no `O` in the whole row, 5 errors, each with a suggestion (a same-pod temporary assignment).
- _Boundary week:_ Aarav Sharma (three brands closed on Sundays) has his December-boundary-week off on Sun 3 Jan. In the January dry-run it is carried into 3 Jan as a locked `Ō` entry (also test S16).

<details><summary>Full dry-run 2026-12</summary>

```

Roster dry-run 2026-12 (previous month 2026-11 generated in memory for boundary-week carry-over)
32 employees, 34 brand-processes, 1120 cells, generated + validated + suggestions in 305 ms. Nothing was saved.
Legend: W work, w works but covers nothing (backup pool / closed day), O weekly off, Ō locked weekly off, L leave, C comp-off, H holiday. '|' marks the month boundary (dates outside it are spill).

                           3|0000000001111111111222222222233|000
                           0|1234567890123456789012345678901|123
                           M|TWTFSSMTWTFSSMTWTFSSMTWTFSSMTWT|FSS
-- pod-alpha
Aarav Sharma               W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Divya Menon                w|OwwwWHOwwwwWwOwwwwWwWWWwHWOOwww|HWw
Ishita Verma               W|WWWWOWWWWWWOWWWWWWOWLLLWWOWWWWW|WOW
Meera Iyer                 W|OWWWWHWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Nisha Kapoor               W|OWWWWHWWWWWWOWWWWWWOOWWWHWWOWWW|HWW
Rahul Bhatt                w|WwwwOHwwwwwOWwwwwwOWWwwwHOwWwww|HOw
Sanjay Patil               W|WOWWWHWWOWWWWWWOWWWWWWOWHWWWWOW|HWW
Tanvi Joshi                w|wWOwwHWOWwwwwWOWwwwwWOWwHwwWOWw|Hww
Vikram Rao                 W|WOWWWWOWWWWWWOWWWWWWOWWWWWWOWWW|WWW
-- pod-bravo
Ananya Reddy               W|WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW|WWW
Arjun Nambiar              W|WWWOWWWWWWOWWWWLLOWWWWWWOWWOWWW|HWW
Farhan Qureshi             w|wwwwOHwwwwwOWwwwwwOWwwwwHOWwwww|HOw
Kabir Singh                W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Manish Gupta               w|OwwwwHOwwwwwWOwwwwwWOwwwHwWOwww|HwW
Pooja Desai                W|WWWWWOWWWWWWOOWWWWWWOWWWWWWWOWW|WWW
Rohan Mehta                w|OwwwwHOwwwwwwOwwwwwwOwwwHwwOwww|Hww
Sneha Kulkarni             W|OWWWWWWOWWWWWWOWWWWWWOWWWWWWWOW|WWW
-- pod-charlie
Dev Choudhary              w|OwwwwWOwWwwwWWOwwwwwWOwwHwwWOww|Hww
Imran Sheikh               W|WWWWWOWWLWWWOOWWWWWWOWWWWWWOWWW|WWW
Kavya Hegde                W|WWOWWWLWWOWWWWWWOWWWWWWOWWWWWWO|WWW
Nikhil Agarwal             W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Priya Nair                 W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Rekha Das                  w|WwwwOHWwwwwWOWwwwwOwWwwwHOwWwww|HOw
Shruti Banerjee            W|OWWWWHOWWWWWWOWWWWWWOWWWHWWOWWW|HWW
-- pod-delta
Aditi Saxena               W|OWWWWHWWWWCWOWWWWWWOWWWWHWOWWWW|HWO
Gaurav Chopra              W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|OWW
Harleen Kaur               W|OWWWWWWOWWWWWWOWWWWWWOWWWWWWWLL|HLW
Karan Malhotra             w|WOwwwHOWwwwwwOWwwwwwOWwwHwwOwWW|WWw
Neha Bansal                W|WOWWWHWWOWWWWWWOWWWWWWOWHWwWWOW|HWw
Omkar Kadam                W|OWWWWHWWWWWWOWWWWWWOOWWWHWWOWWW|HWW
Siddharth Jain             W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Zoya Ansari                w|WwOwwHOwwwWwwOwwwwwwOwwwHwwOwww|Hww

Coverage per brand-process (digit = people covering, '.' = not operating, '!' = short)
Atlas Footwear / CS                NSP 1|11111.111111.111111.1111.1.1111|.1.
Cedar and Co Furniture / ACC       NSP 1|11111.111111.111111.1111.1.1111|.1.
Cedar and Co Furniture / CS        365 1|1111111111111111111111111111111|111
Coastal Candles / ACC              NPH 1|11111.111111111111111111.111111|.11
Coastal Candles / CS               365 1|1111111111111111111111111111111|111
Harvest Snacks / ACC               NPH 1|11111.111111111111111111.111111|.11
Harvest Snacks / CS                NPH 1|11111.111112111111111111.111111|.11
Helix Sports Nutrition / COD       NPH 1|11111.111111111111111111.111111|.11
Helix Sports Nutrition / CS        CUS 2|21222.221222.221222.2212.2.2212|.2.
Indigo Denim / CS                  NSP 1|11111.111111.111111.1111.1.1111|.1.
Indigo Denim / RET                 NSP 1|11111.111111.111111.1111.1.1111|.1.
Lumen Skincare / ACC               NSP 1|11111.111111.111111.1111.1.1111|.1.
Lumen Skincare / CS                NSP 1|11111.111111.111111.1111.1.1111|.1.
Mango Mobiles / CS                 NSP 1|11111.111111.111111.1111.1.1111|.1.
Nimbus Gadgets / CS                365 1|1111111111111111111111111111111|111
Nimbus Gadgets / NDR               365 1|1111111111111111111111111111111|111
Nova Wellness / ACC                NSP 1|11111.111111.111111.1111.1.1111|.1.
Nova Wellness / CS                 365 1|1111111111111111111111111111111|111
Nova Wellness / NDR                NPH 1|11111.111111111111111111.111111|.11
Orbit Electronics / CS             365 3|2332323233232222223322332332223|233
Orchid Home / ACC                  NSP 1|11111.111111.111111.1111.1.1111|.1.
Orchid Home / CS                   NSP 1|11111.111111.111111.1111.1.1111|.1.
Pebble Toys / CS                   NPH 1|11111.111111111111111111.111111|.11
Pebble Toys / NDR                  NPH 1|11111.111111111111111111.111111|.11
Pixel Pets / CS                    NSP 1|11111.111111.111111.1111.1.1111|.1.
Quartz Jewellery / ACC             NSP 1|11111.111111.111111.1111.1.1111|.1.
Quartz Jewellery / CS              NSP 1|11111.111111.111111.1111.1.1111|.1.
Saffron and Salt / CS              NPH 1|11111.111111111111111111.111111|.11
Saffron and Salt / RET             NSP 1|11111.111111.111111.1111.1.1111|.1.
Terra Organics / CS                NPH 1|11111.111111111111111111.111111|.11
Urban Brew Coffee / CS             365 1|1111111111111111111111111111111|111
Urban Brew Coffee / NDR            NPH 1|11111.111111111111111111.111111|.11
Verdant Tea Co / CS                NSP 1|11111.111111.111111.1111.1.1111|.1.
Zephyr Apparel / CS                365 1|1111111111111111111111111111111|111

Issues: 36 total
     5  ERROR WEEKLY_OFF_NOT_GRANTED
    16  INFO COMP_OFF_EARNED
     6  WARNING CONSECUTIVE_DAYS_EXCEEDED
     2  WARNING PENDING_LEAVE_CONFLICT
     7  WARNING PREFERRED_OFF_NOT_HONOURED

ERRORs (5):
  [WEEKLY_OFF_NOT_GRANTED] Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2026-11-30 to 2026-12-06. Every day they could be off is needed to keep coverage: Nimbus Gadgets / CS, Nimbus Gadgets / NDR. Locked days that cannot be changed here: 2026-11-30.
      -> REASSIGN_FROM_POD: Give Ananya Reddy the weekly off on 2026-12-01 and ask Farhan Qureshi (same pod, 0% allocated) to cover Nimbus Gadgets / CS and Nimbus Gadgets / NDR under a manager-approved temporary assignment.
  [WEEKLY_OFF_NOT_GRANTED] Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2026-12-07 to 2026-12-13. Every day they could be off is needed to keep coverage: Nimbus Gadgets / CS, Nimbus Gadgets / NDR.
      -> REASSIGN_FROM_POD: Give Ananya Reddy the weekly off on 2026-12-07 and ask Farhan Qureshi (same pod, 0% allocated) to cover Nimbus Gadgets / CS and Nimbus Gadgets / NDR under a manager-approved temporary assignment.
  [WEEKLY_OFF_NOT_GRANTED] Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2026-12-14 to 2026-12-20. Every day they could be off is needed to keep coverage: Nimbus Gadgets / CS, Nimbus Gadgets / NDR.
      -> REASSIGN_FROM_POD: Give Ananya Reddy the weekly off on 2026-12-14 and ask Farhan Qureshi (same pod, 0% allocated) to cover Nimbus Gadgets / CS and Nimbus Gadgets / NDR under a manager-approved temporary assignment.
  [WEEKLY_OFF_NOT_GRANTED] Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2026-12-21 to 2026-12-27. Every day they could be off is needed to keep coverage: Nimbus Gadgets / CS, Nimbus Gadgets / NDR.
      -> REASSIGN_FROM_POD: Give Ananya Reddy the weekly off on 2026-12-27 and ask Rohan Mehta (same pod, 0% allocated) to cover Nimbus Gadgets / CS and Nimbus Gadgets / NDR under a manager-approved temporary assignment.
  [WEEKLY_OFF_NOT_GRANTED] Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2026-12-28 to 2027-01-03. Every day they could be off is needed to keep coverage: Nimbus Gadgets / CS, Nimbus Gadgets / NDR.
      -> REASSIGN_FROM_POD: Give Ananya Reddy the weekly off on 2026-12-28 and ask Farhan Qureshi (same pod, 0% allocated) to cover Nimbus Gadgets / CS and Nimbus Gadgets / NDR under a manager-approved temporary assignment.

Comp-off credits earned this month: 16
```

</details>

<details><summary>Full dry-run 2027-01</summary>

```

Roster dry-run 2027-01 (previous month 2026-12 generated in memory for boundary-week carry-over)
32 employees, 34 brand-processes, 1120 cells, generated + validated + suggestions in 250 ms. Nothing was saved.
Legend: W work, w works but covers nothing (backup pool / closed day), O weekly off, Ō locked weekly off, L leave, C comp-off, H holiday. '|' marks the month boundary (dates outside it are spill).

                           2233|0000000001111111111222222222233
                           8901|1234567890123456789012345678901
                           MTWT|FSSMTWTFSSMTWTFSSMTWTFSSMTWTFSS
-- pod-alpha
Aarav Sharma               WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Divya Menon                Ōwww|HWwOwwwwWwOwwHwWwOwwwwWwOHwwwWw
Ishita Verma               WWWW|WŌWWWWWWOWWWWWWOWWWWWWOWWWWWWOW
Meera Iyer                 WWWW|HWŌWWWWWWOWLLHWWOWWWWWWOWHWWWWO
Nisha Kapoor               ŌWWW|HWWOWWWWWWWWWHWWOWWWWWWOOHWWWWW
Rahul Bhatt                Wwww|HŌwWwwwwOwwwwHwOWwwwwwOWWHwwwOw
Sanjay Patil               WWŌW|HWWWWOWWWWOWWHWWWWWOWWWWWHOWWWW
Tanvi Joshi                WŌWw|HwwWOWwwwwWwwHOwwWOWwwwwWHWOwww
Vikram Rao                 ŌWWW|WWWOWWWWWWOWWWWWWOWWWWWWOWWWWWW
-- pod-bravo
Ananya Reddy               WWWW|WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
Arjun Nambiar              ŌWWW|WWWOWWWWWWOWWWWWWOWWWWWWWWWWOWW
Farhan Qureshi             wwww|HŌwwwwwwOWwwwHwOWwwwwwOWwHwwwOW
Kabir Singh                WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Manish Gupta               Ōwww|HwWOwwwwwWOwwHwwWOwwwwwWOHwwwwW
Pooja Desai                WŌWW|WWWWOWWWWWWWWHWWOWWWWWWOOWWWWWW
Rohan Mehta                Ōwww|HwwOwwwwwwOwwHwwwOwwwwwwOHwwwww
Sneha Kulkarni             WWŌW|HWWWWOWWWWWOWWWWWWOLWWWWWOWWWWW
-- pod-charlie
Dev Choudhary              WŌww|HwwWOwwwwwWOwHwwwWOwwwwwWHOwwww
Imran Sheikh               ŌWWW|WWWOWWWWWWOWWWWWWOWWWWWWOWWWWWW
Kavya Hegde                WWWŌ|WWWWWWOWWWWWWOWWWWWWOWWWWWWOWWW
Nikhil Agarwal             WWWW|HWŌWWWWWWOWWWWWWOWWWWWWOWHWWWWO
Priya Nair                 WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Rekha Das                  Wwww|HŌwWwwwwOwWwwHwOwWwwwwOwWHwwwOw
Shruti Banerjee            ŌWWW|HWWOWWWWWWOWWHWWWOWWWWWWOHWWWWW
-- pod-delta
Aditi Saxena               WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Gaurav Chopra              WWWW|ŌWWWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Harleen Kaur               WWLL|HLWWOWWWWWWOWWWWWWOWWWWWWOWWWWW
Karan Malhotra             ŌwWW|WWwOWwwwwwOWwHwwwOWwwwwwOWwwwww
Neha Bansal                WWŌW|HWwWWOWWWwWWOHWWWWWOWWWWLHLWOWw
Omkar Kadam                ŌWWW|HWWOWWWWWWWWWHWWOWWWWWWOWHWOWWW
Siddharth Jain             WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Zoya Ansari                Ōwww|HwwOwwwwwwOwwHwwwOwwwwwwWHwOwww

Coverage per brand-process (digit = people covering, '.' = not operating, '!' = short)
Atlas Footwear / CS                NSP 1111|.1.111111.111.11.111111.1.1111.
Cedar and Co Furniture / ACC       NSP 1111|.1.111111.111.11.111111.1.1111.
Cedar and Co Furniture / CS        365 1111|1111111111111111111111111111111
Coastal Candles / ACC              NPH 1111|.111111111111.11111111111.11111
Coastal Candles / CS               365 1111|1111111111111111111111111111111
Harvest Snacks / ACC               NPH 1111|.111111111111.11111111111.11111
Harvest Snacks / CS                NPH 1111|.111111111111.11111111111.11111
Helix Sports Nutrition / COD       NPH 1111|.111111111111.11111111111.11111
Helix Sports Nutrition / CS        CUS 2212|.2.221222.221.22.221222.2.1212.
Indigo Denim / CS                  NSP 1111|.1.111111.111.11.111111.1.1111.
Indigo Denim / RET                 NSP 1111|.1.111111.111.11.111111.1.1111.
Lumen Skincare / ACC               NSP 1111|.1.111111.111.11.111111.1.1111.
Lumen Skincare / CS                NSP 1111|.1.111111.111.11.111111.1.1111.
Mango Mobiles / CS                 NSP 1111|.1.111111.111.11.111111.1.1111.
Nimbus Gadgets / CS                365 1111|1111111111111111111111111111111
Nimbus Gadgets / NDR               365 1111|1111111111111111111111111111111
Nova Wellness / ACC                NSP 1111|.1.111111.111.11.111111.1.1111.
Nova Wellness / CS                 365 1111|1111111111111111111111111111111
Nova Wellness / NDR                NPH 1111|.111111111111.11111111111.11111
Orbit Electronics / CS             365 2223|2332223333223233222233322233233
Orchid Home / ACC                  NSP 1111|.1.111111.111.11.111111.1.1111.
Orchid Home / CS                   NSP 1111|.1.111111.111.11.111111.1.1111.
Pebble Toys / CS                   NPH 1111|.111111111111.11111111111.11111
Pebble Toys / NDR                  NPH 1111|.111111111111.11111111111.11111
Pixel Pets / CS                    NSP 1111|.1.111111.111.11.111111.1.1111.
Quartz Jewellery / ACC             NSP 1111|.1.111111.111.11.111111.1.1111.
Quartz Jewellery / CS              NSP 1111|.1.111111.111.11.111111.1.1111.
Saffron and Salt / CS              NPH 1111|.111111111111.11111111111.11111
Saffron and Salt / RET             NSP 1111|.1.111111.111.11.111111.1.1111.
Terra Organics / CS                NPH 1111|.111111111111.11111111111.11111
Urban Brew Coffee / CS             365 1111|1111111111111111111111111111111
Urban Brew Coffee / NDR            NPH 1111|.111111111111.11111111111.11111
Verdant Tea Co / CS                NSP 1111|.1.111111.111.11.111111.1.1111.
Zephyr Apparel / CS                365 1111|1111111111111111111111111111111

Issues: 44 total
     4  ERROR WEEKLY_OFF_NOT_GRANTED
    24  INFO COMP_OFF_EARNED
     8  WARNING CONSECUTIVE_DAYS_EXCEEDED
     8  WARNING PREFERRED_OFF_NOT_HONOURED

ERRORs (4):
  [WEEKLY_OFF_NOT_GRANTED] Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2027-01-04 to 2027-01-10. Every day they could be off is needed to keep coverage: Nimbus Gadgets / CS, Nimbus Gadgets / NDR.
      -> REASSIGN_FROM_POD: Give Ananya Reddy the weekly off on 2027-01-04 and ask Farhan Qureshi (same pod, 0% allocated) to cover Nimbus Gadgets / CS and Nimbus Gadgets / NDR under a manager-approved temporary assignment.
  [WEEKLY_OFF_NOT_GRANTED] Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2027-01-11 to 2027-01-17. Every day they could be off is needed to keep coverage: Nimbus Gadgets / CS, Nimbus Gadgets / NDR.
      -> REASSIGN_FROM_POD: Give Ananya Reddy the weekly off on 2027-01-11 and ask Farhan Qureshi (same pod, 0% allocated) to cover Nimbus Gadgets / CS and Nimbus Gadgets / NDR under a manager-approved temporary assignment.
  [WEEKLY_OFF_NOT_GRANTED] Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2027-01-18 to 2027-01-24. Every day they could be off is needed to keep coverage: Nimbus Gadgets / CS, Nimbus Gadgets / NDR.
      -> REASSIGN_FROM_POD: Give Ananya Reddy the weekly off on 2027-01-18 and ask Farhan Qureshi (same pod, 0% allocated) to cover Nimbus Gadgets / CS and Nimbus Gadgets / NDR under a manager-approved temporary assignment.
  [WEEKLY_OFF_NOT_GRANTED] Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2027-01-25 to 2027-01-31. Every day they could be off is needed to keep coverage: Nimbus Gadgets / CS, Nimbus Gadgets / NDR.
      -> REASSIGN_FROM_POD: Give Ananya Reddy the weekly off on 2027-01-25 and ask Farhan Qureshi (same pod, 0% allocated) to cover Nimbus Gadgets / CS and Nimbus Gadgets / NDR under a manager-approved temporary assignment.

Comp-off credits earned this month: 24
```

</details>

### Are the tests real? Mutation check

I broke the engine three ways and ran the whole suite each time (then restored; 103/103 again):

| Mutation                                        | Tests that failed                     |
| ----------------------------------------------- | ------------------------------------- |
| backup fill does nothing                        | 28 (S01 and others)                   |
| weekly off granted even when it breaks coverage | 8 (S02, S06, S15, S17, S18, ...)      |
| validator ignores a missing weekly off          | 8 (S02, S13, S14, S15, S17, S18, ...) |

Coverage in tests is computed independently of the engine in `__tests__/fixtures.ts` (`coverageOf`, `offDates`), not by calling the validator. The ESLint purity rule was also shown to fail on a deliberate `@prisma/client` / `node:fs` / `process` import.

## Deviations from CLAUDE.md

- **S03 as literally named cannot happen** (three people, one leave, min 2 leaves two). The test asserts the one-leave halves and also the case the assessment means (a second simultaneous leave, the seeded Orbit scenario). ASSUMPTIONS 30.
- **`CASCADE_GAP` groups the coverage gaps but does not replace them**: the underlying `COVERAGE_GAP`s stay (the coverage strip needs them) and are listed in `groupedIssueIds`.
- **A public holiday may host a weekly off** when it is the only free day, instead of raising a false error (Aarav, Kabir, Priya, Gaurav on Sunday 6 Dec). The generator prefers to give both. ASSUMPTIONS 24.
- **Leave on a public holiday is `HOLIDAY`, a contract-fixed off beats a holiday, and a holiday employee may be called in as cover** (ranked last, earns a comp-off). ASSUMPTIONS 23, 26.
- **`Suggestion.temporaryAssignments` is a list** (a pod-mate may cover two brand-processes at once, e.g. Nimbus CS and NDR).
- **`generateRoster(..., { suggestions: false })`** skips suggestion pre-validation for bulk runs (tests, `prepare` steps). Default is on.
- **The dry-run chains the previous month in memory** by default (`--no-chain` turns it off).
- Files and exports beyond the plan's list are noted under Done.

## Known gaps / risks

- **Greedy, not optimal.** The planner is deterministic and never trades coverage for a weekly off, but it can leave a working run slightly over `maxConsecutiveDays` (a warning; 6 in December, 8 in January). Typical cause: a colleague's off forces a backup to work through. ASSUMPTIONS 31. A look-ahead or repair pass would fix it; I did not add one.
- **Weights are hand-tuned** (ASSUMPTIONS 25). They are exercised by S01 to S18 and the seed, not by a search over alternatives.
- **Some PREFERRED_OFF warnings are caused by the generator's own choices** (e.g. Ishita on Sun 27 Dec, because Divya's off landed there). They are accurate but could be avoided with more look-ahead.
- **Suggestion validation scope:** a suggestion is checked with the in-month validator, plus an explicit coverage check when it edits a spill date. Cross-month effects beyond that are not simulated.
- **Retroactive changes:** a leave added for a date before `today` is not applied to the (pinned) past, so the validator can report `WORK_WHILE_UNAVAILABLE` for it. That is the intended "history is history" behaviour, but P3/P4 should surface it clearly.
- **Performance:** about 350 ms per month on the seed including validation and suggestions. The 2x dataset timing the README question 7 needs belongs to P6's `pnpm metrics`.
- No persistence yet (P3). `loadEngineInput` is tested only indirectly (the pure mapper is tested; the Prisma read is exercised by the dry-run).
