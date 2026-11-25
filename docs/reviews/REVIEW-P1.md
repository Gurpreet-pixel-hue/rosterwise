# Review: P1 Data model + seed. Verdict: CHANGES_REQUIRED

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
