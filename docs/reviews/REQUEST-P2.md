# Review request: P2 Engine (round 2)

Round 1 was CHANGES_REQUIRED with three findings. All three are fixed; the numbered response, the
before/after counts and the remaining unavoidable cases are below. The original deliverables (everything in
section 4 of CLAUDE.md, tests S01 to S18, `pnpm roster:dry-run`) are unchanged except where noted.

## Done in this round

- **Finding 1 (BLOCKER).** Weekly offs no longer land on public holidays when another day is free.
  `src/engine/state.ts`: one shared `RosterState.weekOffs()` returns the plain offs, the holiday-hosted offs, the
  free alternative days, and the number of offs that count. `generate.ts` charges **+500** for a holiday day
  (was +4) and counts only offs that count. `validate.ts` raises `WEEKLY_OFF_NOT_GRANTED` when a holiday-hosted
  off does not count, with a message naming the holiday and the free day. No new issue code.
- **Finding 2 (MAJOR).** `src/engine/repair.ts`, a repair pass after weekly-off placement (details below).
- **Finding 3 (MAJOR).** `src/engine/__tests__/oracle.ts`: an independent oracle; S14 now uses it.
- **New tests:** `S19`, `S19b` (validator-only), `S20`. 106 tests in total (was 103).
- ASSUMPTIONS 24, 25 and 31 rewritten, 32 added. 3 commits, none with Claude attribution. **Nothing pushed.**

## How to verify

```
pnpm db:seed && pnpm verify:seed                      # still 27/27
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm roster:dry-run 2026-12
pnpm roster:dry-run 2027-01
```

## Before / after counts

"Before" is the engine as reviewed (commit `93097a9`), "after" is this round. Both are measured by the same
probe on the seed (December generated, then January chained on it).

|                                                                        | Before                                                   | After                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------- |
| **Holiday-hosted weekly offs** (distinct employee + date, both months) | **13**                                                   | **5**                         |
| `CONSECUTIVE_DAYS_EXCEEDED`, December, excluding Ananya                | **5** (Dev, Divya, Pooja, Harleen, Sneha)                | **0**                         |
| `CONSECUTIVE_DAYS_EXCEEDED`, January, excluding Ananya                 | **7** (Gaurav, Nisha, Omkar, Pooja, Tanvi, Arjun, Zoya)  | **1** (Arjun)                 |
| `CONSECUTIVE_DAYS_EXCEEDED`, including Ananya, Dec / Jan               | 6 / 8                                                    | 1 / 2                         |
| **Total WARNINGs, December**                                           | **15** (6 consecutive, 2 pending-leave, 7 preferred-off) | **12** (1, 2, 9)              |
| **Total WARNINGs, January**                                            | **16** (8 consecutive, 8 preferred-off)                  | **11** (2, 9)                 |
| ERRORs, December / January                                             | 5 / 4, all Ananya                                        | 5 / 4, all Ananya (unchanged) |
| Tests                                                                  | 103                                                      | 106                           |

The review text says "14 offs on holidays" but lists 13 names and dates; I reproduced exactly those 13.
One honest trade-off: `PREFERRED_OFF_NOT_HONOURED` rose (Dec 7 to 9, Jan 8 to 9) because shortening a run can
mean giving up a preferred weekday. The total still fell by 3 in December and 5 in January.

### The 5 remaining holiday-hosted offs, and why each is unavoidable

All are **Sun 6 Dec 2026 ("Regional Winter Festival", a public holiday on a Sunday)**. Every one is checked by the
independent oracle in S19.

| Employee       | Why the holiday hosts the off                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aarav Sharma   | Sole cover for Lumen Skincare, Verdant Tea Co and (with a backup) Atlas Footwear. Lumen and Verdant are closed on Sundays and have no backup, so Mon to Sat are all needed. The Sunday holiday is the only free day. |
| Kabir Singh    | Sole cover for Orchid Home (closed Sundays, no backup): Mon to Sat all needed. His contract-fixed Sunday off is also the holiday.                                                                                    |
| Priya Nair     | Sole cover for Indigo Denim (closed Sundays, no backup).                                                                                                                                                             |
| Gaurav Chopra  | Sole cover for Pixel Pets (closed Sundays, no backup); Terra Organics has a backup but that does not free his Pixel Pets days.                                                                                       |
| Siddharth Jain | His contract-fixed Sunday off falls on the holiday and is forced. But other days were free, so he **also gets a real off on Tue 1 Dec** (`O` twice in his row) and keeps the holiday.                                |

Gaurav's case from the review, now: his 28 Dec week off is on **Sun 3 Jan** (carried into January as a locked
`Ō`), and New Year's Day stays `H`. In December's draft: `Gaurav Chopra ... |HWO`.

```
Legend: W work, w works but covers nothing (backup pool / closed day), O weekly off, Ō locked weekly off, L leave, C comp-off, H holiday. '|' marks the month boundary (dates outside it are spill).

                           3|0000000001111111111222222222233|000
Aarav Sharma               W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Arjun Nambiar              W|WWWOWWWWWWOWWWWLLOWWOWWWWWWOWWW|HWW
Kabir Singh                W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Pooja Desai                W|WWWWOWWWWWWOWWWWWWOWWWWWHWOWOWW|WWW
Imran Sheikh               W|WWOWWWWWLWWWOWWWWWWOOWWWWWWOWWW|WWW
Priya Nair                 W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Gaurav Chopra              W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Siddharth Jain             W|OWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
```

January, Gaurav's carried off (`Ō`) on 3 Jan and `H` on 1 Jan:

```
Gaurav Chopra              WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
```

## Verification output

`pnpm test`: **8 files, 106 tests, all passing**. `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and
`pnpm build` exit 0. `pnpm verify:seed`: 27/27.

```
 Test Files  8 passed (8)
      Tests  106 passed (106)
```

<details><summary>All 106 test names</summary>

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
change.test.ts > simulateChange (assessment section F), without saving > changing a brand's operating rule is previewed, not applied, and re-plans the whole month
scenarios.test.ts > engine scenarios > S14 invariant on the full seed for 2 months: generator-reported ERRORs == validator ERRORs
change.test.ts > simulateChange (assessment section F), without saving > dates before today are history: a change cannot rewrite them
scenarios.test.ts > engine scenarios > S15 weekly offs: every employee gets >= weeklyOffsPerWeek in qualifying weeks unless an ERROR explains why
change.test.ts > diffRosters > identical rosters have no changes
scenarios.test.ts > engine scenarios > S16 boundary week: Dec generated first -> Aarav's off lands on 2027-01-03; Jan generated next carries it locked
change.test.ts > diffRosters > reports changed cells and matches issues by stable id
scenarios.test.ts > engine scenarios > S17 boundary week: Jan generated with no Dec roster -> no weekly-off issue for the Dec-owned week in Jan
change.test.ts > diffRosters > issue ids are stable across regeneration
scenarios.test.ts > engine scenarios > S18 boundary week: neighbour PUBLISHED with WORK on the only free day -> WEEKLY_OFF_NOT_GRANTED naming that date
scenarios.test.ts > engine scenarios > S19 holiday hosts a weekly off only when no other day is free (Gaurav: off on 2027-01-03, H on 2027-01-01; Aarav 2026-12-06 still allowed)
change.test.ts > explainIssue is deterministic and specific > covers every issue code and always includes the issue's own message
change.test.ts > explainIssue is deterministic and specific > explains Ananya Reddy's missing weekly off by naming the brands she alone covers
scenarios.test.ts > engine scenarios > S19b validator-only: an avoidable weekly off on a public holiday is WEEKLY_OFF_NOT_GRANTED, naming the holiday and the free day
scenarios.test.ts > engine scenarios > S20 repair pass: no avoidable CONSECUTIVE_DAYS_EXCEEDED on the seed
```

</details>

<details><summary>Full dry-run 2026-12</summary>

```

Roster dry-run 2026-12 (previous month 2026-11 generated in memory for boundary-week carry-over)
32 employees, 34 brand-processes, 1120 cells, generated + validated + suggestions in 369 ms. Nothing was saved.
Legend: W work, w works but covers nothing (backup pool / closed day), O weekly off, Ō locked weekly off, L leave, C comp-off, H holiday. '|' marks the month boundary (dates outside it are spill).

                           3|0000000001111111111222222222233|000
                           0|1234567890123456789012345678901|123
                           M|TWTFSSMTWTFSSMTWTFSSMTWTFSSMTWT|FSS
-- pod-alpha
Aarav Sharma               W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Divya Menon                w|OwwwWHwwwwOWwwwwwOWwWWWwHWOOwww|HWw
Ishita Verma               W|WWWWOWWWWWWOWWWWWWOWLLLWWOWWWWW|WOW
Meera Iyer                 W|OWWWWHWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Nisha Kapoor               W|OWWWWHWWWWWWOWWWWWWOOWWWHWWOWWW|HWW
Rahul Bhatt                w|WwwwOHwwwwwOWwwwwwOWWwwwHOwWwww|HOw
Sanjay Patil               W|WOWWWHWWOWWWWWWOWWWWWWOWHWWWWOW|HWW
Tanvi Joshi                w|wWOwwHWOWwwwwWOWwwwwWOWwHwwWOWw|Hww
Vikram Rao                 W|WOWWWWOWWWWWWOWWWWWWOWWWWWWOWWW|WWW
-- pod-bravo
Ananya Reddy               W|WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW|WWW
Arjun Nambiar              W|WWWOWWWWWWOWWWWLLOWWOWWWWWWOWWW|HWW
Farhan Qureshi             w|wwwwOHwwwwwOWwwwwwOWwwwwHOWwwww|HOW
Kabir Singh                W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Manish Gupta               w|OwwwwHOwwwwwWOwwwwwWOwwwHwWOwww|HwW
Pooja Desai                W|WWWWOWWWWWWOWWWWWWOWWWWWHWOWOWW|WWW
Rohan Mehta                w|OwwwwHOwwwwwwOwwwwwwOwwwHwwOwww|Hww
Sneha Kulkarni             W|WOWWWHWWWWWWOWWWWWWOWWOWWWWWWOW|WWW
-- pod-charlie
Dev Choudhary              w|wOWwwHwwWwOwWwwwwOwWWwwwHOwWOww|Hww
Imran Sheikh               W|WWOWWWWWLWWWOWWWWWWOOWWWWWWOWWW|WWW
Kavya Hegde                W|WWOWWWLWWOWWWWWWOWWWWWWOWWWWWWO|WWW
Nikhil Agarwal             W|OWWWWHWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Priya Nair                 W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Rekha Das                  w|WwwwOHWwwwwWOWwwwwOwWwwwHOwWwww|HOw
Shruti Banerjee            W|OWWWWHOWWWWWWOWWWWWWOWWWHWWOWWW|HWW
-- pod-delta
Aditi Saxena               W|OWWWWHWWWWCWOWWWWWWOWWWWHWOWWWW|HWO
Gaurav Chopra              W|WWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
Harleen Kaur               W|WWOWWWWWOWWWWWWOWWWWWWOWWWWWWLL|HLW
Karan Malhotra             w|wOWwwHOwWwwwwOwWwwwwOwWwHwwOwWW|WWw
Neha Bansal                W|WOWWWHWWOWWWWWWOWWWWWWOWHWwWWOW|HWw
Omkar Kadam                W|OWWWWHWWWWWWOWWWWWWOOWWWHWWOWWW|HWW
Siddharth Jain             W|OWWWWOWWWWWWOWWWWWWOWWWWHWOWWWW|HWO
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
Helix Sports Nutrition / CS        CUS 2|11222.221222.221222.2212.2.2212|.2.
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
Orbit Electronics / CS             365 3|3232223333222332222223232322223|233
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

Issues: 33 total
     5  ERROR WEEKLY_OFF_NOT_GRANTED
    16  INFO COMP_OFF_EARNED
     1  WARNING CONSECUTIVE_DAYS_EXCEEDED
     2  WARNING PENDING_LEAVE_CONFLICT
     9  WARNING PREFERRED_OFF_NOT_HONOURED

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
32 employees, 34 brand-processes, 1120 cells, generated + validated + suggestions in 275 ms. Nothing was saved.
Legend: W work, w works but covers nothing (backup pool / closed day), O weekly off, Ō locked weekly off, L leave, C comp-off, H holiday. '|' marks the month boundary (dates outside it are spill).

                           2233|0000000001111111111222222222233
                           8901|1234567890123456789012345678901
                           MTWT|FSSMTWTFSSMTWTFSSMTWTFSSMTWTFSS
-- pod-alpha
Aarav Sharma               WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Divya Menon                Ōwww|HWwOwwwwWwOwwHwWwOwwwwWwOHwwwWw
Ishita Verma               WWWW|WŌWWWWWWOWWWWWWOWWWWWWOWWWWWWOW
Meera Iyer                 WWWW|HWŌWWWWWWOWLLHWWOWWWWWWOWHWWWWO
Nisha Kapoor               ŌWWW|HWWWWWOWWWWWWHWWOWWWWWWOOHWWWWW
Rahul Bhatt                Wwww|HŌwwwwWwOwwwwHwOWwwwwwOWWHwwwOw
Sanjay Patil               WWŌW|HWWWWOWWWWOWWHWWWWWOWWWWWHOWWWW
Tanvi Joshi                WŌWw|HwwWOWwwwwWOwHwwwWOWwwwwWHWOwww
Vikram Rao                 ŌWWW|WWWOWWWWWWOWWWWWWOWWWWWWOWWWWWW
-- pod-bravo
Ananya Reddy               WWWW|WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
Arjun Nambiar              ŌWWW|WWWOWWWWWWOWWWWWWOWWWWWWWHWWOWW
Farhan Qureshi             wwww|HŌWwwwwwOWwwwHwOWwwwwwOWwHwwwOW
Kabir Singh                WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Manish Gupta               Ōwww|HwWOwwwwwWOwwHwwWOwwwwwWOHwwwwW
Pooja Desai                WŌWW|WWWWOWWWWWWOWHWWWWWWOWWWOWWWWWW
Rohan Mehta                Ōwww|HwwOwwwwwwOwwHwwwOwwwwwwOHwwwww
Sneha Kulkarni             WWŌW|HWWWWOWWWWWWOWWWWWOLWWWWWWOWWWW
-- pod-charlie
Dev Choudhary              WŌww|HwwWOwwwwwWOwHwwwWOwwwwwWHOwwww
Imran Sheikh               ŌWWW|WWWOWWWWWWOWWWWWWOWWWWWWOWWWWWW
Kavya Hegde                WWWŌ|WWWWWWOWWWOWWWWWWOWWWWWWOWWWWWW
Nikhil Agarwal             WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Priya Nair                 WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Rekha Das                  Wwww|HŌwWwwwwOwWwwHwOwWwwwwOwWHwwwOw
Shruti Banerjee            ŌWWW|HWWOWWWWWWOWWHWWWOWWWWWWOHWWWWW
-- pod-delta
Aditi Saxena               WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Gaurav Chopra              WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Harleen Kaur               WWLL|HLWWOWWWWWWOWWWWWWOWWWWWOWWWWWW
Karan Malhotra             ŌwWW|WWwOWwwwwwOWwHwwwwWOwwwwWHOwwww
Neha Bansal                WWŌW|HWwWWOWWWwWWOHWWWWWOWWWWLHLWOWw
Omkar Kadam                ŌWWW|HWWWWWOWWWWWWHWWOWWWWWWOWHWOWWW
Siddharth Jain             WWWW|HWŌWWWWWWOWWWHWWOWWWWWWOWHWWWWO
Zoya Ansari                Ōwww|HwwOwwwwwwOwwHwwwwOwwwwwWHwOwww

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
Orbit Electronics / CS             365 2223|2332223333222233322223332223233
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

Issues: 39 total
     4  ERROR WEEKLY_OFF_NOT_GRANTED
    24  INFO COMP_OFF_EARNED
     2  WARNING CONSECUTIVE_DAYS_EXCEEDED
     9  WARNING PREFERRED_OFF_NOT_HONOURED

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

### The new tests can fail: mutation check

Each change was broken in turn and the whole suite run (then restored; 106/106 again).

| Mutation                                                                          | Tests that failed                 |
| --------------------------------------------------------------------------------- | --------------------------------- |
| validator forgets the holiday rule (`effective` counts every off)                 | S14, S19, S19b                    |
| generator charges the old +4 for a holiday                                        | S14, S15, S19, S20                |
| repair pass disabled                                                              | S20                               |
| **validator stops emitting `COVERAGE_GAP`** (generator and validator still agree) | 9, **including S14** (the oracle) |

The last row is the point of finding 3: with the mutation, "generator ERRORs == validator ERRORs" still holds,
and only the independent oracle notices.

## Response to review

1. **[BLOCKER] holiday-hosted weekly offs: fixed** in `generate.ts` (holiday cost `+500`, offs counted through
   `weekOffs()`), `validate.ts` (a hosted off that does not count raises `WEEKLY_OFF_NOT_GRANTED`, message, verbatim from S19b: "A has 0 of 1 required weekly off(s) in the week of 2026-12-21 to 2026-12-27. The off was placed on public holiday Christmas Day (2026-12-25) although 2026-12-23, 2026-12-24, 2026-12-26, 2026-12-27 were free, so the employee loses the holiday."), and `state.ts` (`weekOffs`, shared so generator and validator cannot disagree).
   - Tests: **S19** (Gaurav off on 2027-01-03 and `HOLIDAY` on 2027-01-01 in both the December draft and the
     chained January draft; Aarav on 2026-12-06 still allowed and not flagged; every remaining hosted off is one the
     oracle agrees was unavoidable, with the explicit list of 5). **S19b** is the validator-only test: a hand-built
     draft with an avoidable off on Christmas Day gets `WEEKLY_OFF_NOT_GRANTED` naming "public holiday",
     "Christmas Day", "2026-12-25" and a free date.
   - Re-run dry-runs and the full list of the 5 remaining hosted offs, with reasons, are above.
   - Fixed-day case (not in the review, found while doing this): a contract-fixed off that lands on a holiday used
     to count as the weekly off. It now counts only if nothing else was free, so Siddharth gets a second, real off.
2. **[MAJOR] avoidable `CONSECUTIVE_DAYS_EXCEEDED`: fixed** in `repair.ts`. Counts above: December 5 to 0,
   January 7 to 1. Test **S20** asserts the only owners in both months are Ananya Reddy plus one allowlisted name.
   - **I deviated from the suggested move rule, deliberately.** The review suggested moving the off of the week that
     ends (or starts) the run to another day of the same week. I built that first (adjacent off, one move at a
     time): it left December at 5 and January at 2. Three things defeated it: a public holiday can end a run
     without being an off, so the off that bounds it can sit later in the week; one-at-a-time moves get stuck on
     plateaus (Harleen's run needs two offs to change together); and three people sharing a minimum of 2 can only
     be off on different days. So `repair.ts` now (a) for each over-limit employee, with everyone else fixed, works
     out which days of each owned week can host their off without worsening coverage and **enumerates the
     combinations exactly** (bounded), keeping the least total excess; then (b) **swaps two colleagues' off days**
     in a week. Same safeguards as asked: accepted only if excess strictly falls, coverage is no worse on every
     touched day (score stays under 1000), no pinned cell, no contract-fixed day, no holiday, deterministic order
     (employee id, then date), bounded passes.
   - **One case cannot be repaired and is allowlisted by name in S20 with the reason:** Arjun Nambiar, 19 to 25 Jan
     2027, Orbit Electronics. Three people share a minimum of 2 (so at most one off a day) around the 26 Jan
     holiday, which still needs 2 working. Moving his own off only trades one 7-day run for another; 25 Jan is
     Pooja's off; rotating all three pushes Sneha (sick on 20 Jan) over her limit. It needs re-planning the three
     together across several weeks. Ananya's run is inherent (no backup, no off possible).
   - ASSUMPTIONS 31 rewritten, 32 added (the limit above and the preference trade-off).
3. **[MAJOR] S14 was tautological: fixed.** `__tests__/oracle.ts` imports nothing from `state.ts`, `ctx.ts`,
   `validate.ts` or `generate.ts`. From `draft.entries`, `input.assignments` and `requiredStaff` it counts, per
   brand-process and in-month date, the entries with `status === "WORK"`, `coveredBrandProcessIds.includes(bp)` and
   an assignment for that pair. S14 now asserts (a) every oracle shortfall has a matching `COVERAGE_GAP` or
   `NO_ELIGIBLE_STAFF`, (b) every `COVERAGE_GAP` matches an oracle shortfall and its "has X of Y" numbers, (c) outside
   Nimbus there are none (in fact there are none at all: Nimbus is never short on coverage, its errors are missing
   weekly offs). For weekly offs, the oracle counts `WEEKLY_OFF` per owned full week with the holiday rule applied
   and S14 asserts its set of missing weeks equals the reported `WEEKLY_OFF_NOT_GRANTED` set exactly.
   - **Not vacuous, shown two ways.** (i) Before the fix, this oracle was RED: it flagged three employee-weeks the
     engine's own validator let through (Arjun week of 21 Dec, Pooja and Siddharth week of 30 Nov), which is how
     finding 1 was confirmed independently. (ii) The test breaks a roster by hand (Ishita and Divya both off on
     16 Dec) and asserts the oracle and the validator both report the same two gaps; and the mutation above.
   - The "generator == validator" assertion is kept as a regression guard but, as you said, is not relied on.

## Deviations from CLAUDE.md and from the review

- **The repair uses exact per-employee enumeration plus swaps** instead of the suggested single move (above).
- **Holiday cost is +500, as suggested.** The oracle's "free day" is stricter than the engine's (it assumes no backup
  fill), so it can only agree with the engine in one direction; S19 and S14 check both consistent outcomes.
- **For the avoidability test, only non-holiday days count as free alternatives** (a week with two holidays would
  otherwise be indifferent between them).
- Test name `S19b` is an addition alongside the requested `S19`.

## Known gaps / risks

- **One 7-day run remains** (Arjun, 19 to 25 Jan), allowlisted with its reason; and Ananya's inherent ones.
- **The repair optimises one person or one swapped pair at a time**, not whole groups (ASSUMPTIONS 32).
- **`PREFERRED_OFF_NOT_HONOURED` rose slightly** (see the trade-off above). The weights are still hand-tuned.
- **The 13 to 5 improvement depends on `weekOffs()` and the oracle agreeing.** They are independent
  implementations; the one-way difference is the oracle being stricter.
- **Performance:** about 0.4 s per month including validation and suggestions; the repair adds little. The 2x
  dataset timing (README question 7) still belongs to P6's `pnpm metrics`.
- No persistence yet (P3).
