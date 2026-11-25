# Review: P1 Data model + seed. Verdict: PASS (round 2)

Round 1 was CHANGES_REQUIRED; see below. Round 2 is at the end.

Good phase overall. The schema is clean and the seed is well-shaped. Running the same checks on DB-free
data in CI with negative tests is good work, and so is catching the false idempotence result. The fixes
below are small. #1 and #2 matter because the baseline roster has to fail only where we intend it to.

## Findings

1. [BLOCKER] `prisma/seed-data.ts`: **unintended coverage gap on Mon 2027-01-25.**
   Helix Sports Nutrition / CS needs 2 on Mondays (`weekdayMinStaff {"MON":2}`). Its only assignees are
   Siddharth Jain and Neha Bansal (both PRIMARY, **no BACKUP**), and Neha has APPROVED leave
   2027-01-25..27. That Monday the CS headcount ceiling is 1 of 2, so P2 will raise `COVERAGE_GAP`.
   The executor flagged this exact risk under "Known gaps", and it has come true.
   This isn't one of the named scenarios (`DEMO_SCRIPT.md` only mentions the weekday minimum).
   → Fix: add a BACKUP to Helix CS, preferably a bench employee in Helix's pod, with allocation ≤ their spare
   capacity. Then the January baseline has **only Nimbus Gadgets** as an intended source of ERRORs.
   (Making it a deliberate, documented "Scenario 5" instead would also pass, but a cleaner baseline makes a better demo.)

2. [MAJOR] `scripts/seed-checks.ts`: there's no check that would have caught #1. Add a
   **static capacity check**: for each date in 2026-12 and 2027-01 and each BrandProcess that operates
   that date (use the **real** operating rules + holidays, not the Mon–Fri proxy), count PRIMARY+BACKUP
   assignees who are not on APPROVED leave/comp-off and not on a `fixedOffDays` day. Fail if that ceiling is
   below `required` (CoverageOverride → weekdayMinStaff → defaultMinStaff).
   - Keep an explicit allowlist of expected infeasibilities, `EXPECTED_INFEASIBLE = ["Nimbus Gadgets"]`, and print them as `EXPECTED`.
   - Add a negative test: remove the new Helix backup → check fails naming 2027-01-25.
   - Suggested shortcut: write this as `src/engine/calendar.ts` (`isOperating`) + `src/engine/demand.ts`
     (`requiredStaff`) **now**, with their own unit tests, and import them from seed-checks. P2 needs both
     files anyway, and then the seed check and the engine can't disagree on calendar logic.
   - This is a necessary condition, not proof the roster is schedulable (weekly offs are ignored). Say so in the output.

3. [MAJOR] `prisma/schema.prisma` `RosterEntry.employee`: `onDelete: Cascade` means deleting an
   employee **silently erases their rows from published rosters**, which breaks history and audit.
   → Change to `onDelete: Restrict`. "Removing" an employee in the app becomes `isActive = false` (P3
   implements this; note it in ASSUMPTIONS). The seed already deletes roster entries before employees, so it's unaffected.

4. [MINOR] `prisma/schema.prisma`: add publish/acknowledgement storage now to avoid a mid-P3 schema change:
   `Roster.publishedAt DateTime?` and
   `IssueAck { id, rosterId (Cascade), issueId String, note String, actor String, createdAt; @@unique([rosterId, issueId]) }`.
   `issueId` is the stable hash from CLAUDE.md §4.

5. [MINOR, demo value] Scenario 4: none of Aarav Sharma's three brands has a BACKUP, so the cascade can only
   be resolved via `REASSIGN_FROM_POD`. Add a BACKUP to **one** of the three (e.g. Atlas Footwear CS) so the
   demo shows a mixed resolution: 1 brand auto-covered by a backup, 2 flagged for the manager. Keep the
   other two without backups. Make sure the Scenario 4 check still passes.

6. [MINOR, docs] `docs/DEMO_SCRIPT.md`: the seed already contains a natural **mandatory-beats-preference**
   case: Harvest Snacks CS override min 2 on Sat 2026-12-12 needs backup Rekha Das, who prefers SAT/SUN off.
   That's the S11 behaviour (`PREFERRED_OFF_NOT_HONOURED`) and the PDF calls it out explicitly (§3.D).
   Name it in the demo script as a mini-scenario.

## Verified

- Ran on the local DB: `db:push` → `db:seed` → `verify:seed` (24/24, 16/20 = 80.0%), `db:seed` again
  (exit 0) → `verify:seed` (24/24). `lint`, `format:check`, `typecheck`, `test` (18/18) all pass.
- CI run 45652593375 on `main` is green. The P0 minors were folded in correctly.
- Read the whole `schema.prisma`. The uniques and indexes I asked for in the P0 review are present. Dates are strings.
- Read `seed.ts`: the delete order is correct, it runs in a single transaction, and the remote-DB guard works.
- **Hand feasibility pass over the SQL dump of all 34 BrandProcesses and 11 leaves:**
  - Absorbable: Kavya 12-07 (Nikhil 70+30), Imran 12-09 (Dev 50+50), Aditi 12-11 (Zoya), Arjun 12-16..17
    (Orbit: Pooja+Sneha still meet min 2, and weekly offs fit in the 5 remaining days), Ishita 12-21..23
    (Divya), Harleen 12-30..01-02 (Karan, including the 01-01 PH → comp-off), Meera 01-12..13 (Sanjay 70+30),
    Sneha 01-20 (Orbit 2 of 2).
  - Orbit 2027-01-15 override min 3 is feasible (no leave that day). Kabir's fixed SUN off on Pebble Toys
    (NO_PUBLIC_HOLIDAYS, so it operates Sundays) is covered by Manish every Sunday.
  - **Not absorbable: Neha 2027-01-25 (finding #1).** Nimbus Gadgets is infeasible as intended.

## Notes for P2 (no action in P1)

- Write this to ASSUMPTIONS.md when P2 starts: **leave and public holidays do not replace the weekly off**,
  except that a week where the employee has fewer than 4 _available_ in-month days requires no weekly off.
  This keeps S15 well-defined for Arjun's 12-16..17 week and Harleen's 12-30..01-02 week.
- Bench employees with no PRIMARY assignment who are WORK but cover nothing are fine (they're the backup
  pool). The employee view should label them "Available (backup pool)" rather than leaving them blank.
- The boundary week 2026-12-28..2027-01-03 has 4 days in December, so the weekly off is required in December's
  roster and not in January's. Add a test for it.

---

# Round 2: PASS

## Verified

- `db:push` → `db:seed` → `verify:seed`: 27/27, 16/20 = 80.0%. The new `static capacity` and
  `static weekly-off slack` checks pass, and Nimbus Gadgets is reported as `EXPECTED` (Ananya Reddy has no
  free day in 9/9 weeks). `lint`, `format:check`, `typecheck` and `test` (52/52, 4 files) all pass.
- #1: Helix CS now has backup Zoya Ansari, so Mon 2027-01-25 has a ceiling of 2/2. Zoya also backs up
  Quartz (14:00–23:00) and Helix is 09:00–18:00. No seeded day needs her on both, so it won't cause a baseline
  error, and it's a ready-made `SHIFT_INCOMPATIBLE` manual-edit demo for P2/P4.
- #2: `seed-capacity.ts` imports the real `isOperating` / `requiredStaff` / `weeksOfMonth`. Read it in full.
  The logic is correct: APPROVED-only unavailability, fixed off days honoured in both checks, and the
  allowlist is enforced in both directions. The negative tests are real.
- #3/#4: schema diff read. `Restrict` on `RosterEntry.employee`, `Roster.publishedAt`, and
  `IssueAck @@unique([rosterId, issueId])` are all correct.
- #5/#6: Scenario 4 shows the mixed resolution (Atlas backed by Rahul; Lumen and Verdant have none). Scenario 5 is documented.
- `calendar.ts` / `demand.ts`: read in full. UTC-only arithmetic and strict date parsing (rejects 2026-02-30).
  The override → weekday → default order is right, and an explicit 0 wins via `??`. Good.

## Ruling on ASSUMPTIONS 18 (boundary week): ACCEPTED, with a binding mechanism for P2

The ruling is correct and more realistic than the 4-day rule alone. Ops teams think in Mon–Sun weeks,
and giving four people a false December error would be noise. "Carry the off into January as a locked
entry" isn't specific enough, though (what if January doesn't exist yet, or is already published?). P2 must implement it this way:

1. **Planning window = full weeks.** The roster for month M stores entries for every date of every Mon–Sun
   week touching M (Dec 2026 → 2026-11-30 .. 2027-01-03). Entries dated outside M are **spill entries**.
   No schema change is needed (`date` outside `roster.month` _is_ the flag). Views show in-month dates by
   default and spill dates greyed.
2. **Neighbour context.** When generating or validating M, for every spill date, if the neighbouring month
   has a roster (latest version, any status), its entry for that date is a **locked input**, not something M plans.
   With no neighbour roster, M plans the spill dates itself (provisional).
3. **Carry-over.** When generating M+1, any `WEEKLY_OFF` spill entry in M's latest roster that serves an
   **M-owned** week is copied into M+1 as `locked: true` with `source: AUTO`, plus an audit note "carried from <M>".
   It stays editable by the manager like any lock, and the validator re-checks it.
4. **Conflict.** If M needs its off on a spill date but the neighbour roster is PUBLISHED with WORK there, M
   doesn't overwrite it. It raises `WEEKLY_OFF_NOT_GRANTED` with a suggestion naming the neighbour-month date to change.
5. **Validation scope.** Coverage issues are raised only for in-month dates of M. The weekly-off requirement
   for an M-owned week is evaluated over its full week (M entries + spill/neighbour entries).
6. **Tests (add to the P2 list):**
   - `S16 boundary week: Dec generated first -> Aarav's off lands on 2027-01-03; Jan generated next carries it locked`
   - `S17 boundary week: Jan generated with no Dec roster -> no weekly-off issue for the Dec-owned week in Jan`
   - `S18 boundary week: neighbour PUBLISHED with WORK on the only free day -> WEEKLY_OFF_NOT_GRANTED naming that date`

## Next steps

Push `main` (gate passed), confirm CI is green, then begin P2 with these tests added to S01–S15.
