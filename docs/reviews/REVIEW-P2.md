# Review: P2 Engine. Verdict: CHANGES_REQUIRED

Strong phase. Shared validator, enforced purity, stable issue ids, boundary-week mechanism exactly as
specified, specific human-readable messages, pre-validated suggestions, and 103 meaningful tests. The
baseline ERRORs are Nimbus Gadgets only, which is right. One rule is being broken silently, though, and
that's the one class of bug this project can't ship with.

## Findings

1. [BLOCKER] `src/engine/generate.ts:382` + `src/engine/validate.ts:226`: **weekly offs are silently
   placed on public holidays, so employees lose the holiday, and the validator can't see it.**
   ASSUMPTIONS 17 and 24 (written in this phase) say a holiday does not replace the weekly off and may host it
   **only if it's the only free day**. The generator only charges a holiday `+4`, while the Sunday rotation
   charges `+3 × Sundays already given` (`:379`) and a spill date `+2`. Holidays therefore regularly win against
   ordinary free days. The validator counts any `WEEKLY_OFF` cell, so it can't tell the difference.
   Reproduced on the seed (Dec generated, then Jan chained), **14 offs on holidays**:
   `Aarav, Gaurav, Imran, Kabir, Nikhil, Pooja, Priya, Siddharth @ 2026-12-06; Arjun @ 2026-12-25;
Gaurav @ 2027-01-01 (then carried into Jan); Kavya @ 2027-01-14; Harleen, Sneha @ 2027-01-26`.
   Concrete case: Gaurav's 28 Dec week off sits on **Fri 1 Jan (New Year's Day)** and he works Sat 2 and Sun 3 Jan,
   though Sun 3 Jan was free (Terra Organics is covered by backup Farhan). Aarav, on the same week, correctly
   gets `H` on 1 Jan and `O` on 3 Jan. Some of the 6 Dec cases are legitimately unavoidable (Sunday-closed brands
   with no backup: Aarav, Kabir, Priya). Pooja, Imran, Arjun and the others are not.
   → Fix both sides:
   - **Generator:** a holiday candidate must cost more than any non-holiday day that keeps coverage, but less
     than 1000 (e.g. `+500`), so it's used only as a last resort before "not granted".
   - **Validator (the source of truth):** a `WEEKLY_OFF` on a public holiday counts toward the week **only if**
     no other day of that full week could have hosted it (every other day is pinned, non-WORK, or
     `newlyShortIfOff(...)` is non-empty). Otherwise raise `WEEKLY_OFF_NOT_GRANTED`. The message should name the
     holiday and the free day, e.g. "off placed on public holiday New Year's Day (2027-01-01) although 2027-01-03 was free".
     This uses the existing code, so no new code is needed. It also catches a manager doing this by hand.
   - **Tests:** `S19 holiday hosts a weekly off only when no other day is free (Gaurav: off on 2027-01-03, H on 2027-01-01; Aarav 2026-12-06 still allowed)`,
     and a validator-only test: hand-build a draft with an avoidable off on a holiday → `WEEKLY_OFF_NOT_GRANTED`.
   - Re-run the dry-runs and list every remaining holiday-hosted off in the request, with the reason each is unavoidable.

2. [MAJOR] `generate.ts` step 6: **avoidable `CONSECUTIVE_DAYS_EXCEEDED`.** Ignoring Ananya, there are 5
   in Dec (Dev, Divya, Pooja, Harleen, Sneha) and 7 in Jan (Gaurav, Nisha, Omkar, Pooja, Tanvi, Arjun, Zoya),
   all runs of 7 caused by an early off in one week followed by a late off in the next. ASSUMPTIONS 31 admits the
   cause (backward-only look). These will be on screen in the demo, and the PDF's "fair distribution of weekly
   offs" is judged on exactly this.
   → Add a **repair pass** after placement: for each run longer than `maxConsecutiveDays`, try moving the off of
   the week that ends the run (or the one that starts it) to another day of the **same week**, only if the move
   keeps score < 1000 (no new shortfall), creates no new over-limit run, and doesn't touch pinned cells.
   Deterministic order (employee id, date). Bounded iterations.
   → Test `S20 repair pass: no avoidable CONSECUTIVE_DAYS_EXCEEDED on the seed`: assert the only
   `CONSECUTIVE_DAYS_EXCEEDED` in both months belong to Ananya Reddy. If some genuinely can't be repaired,
   list them in the request with the reason and allowlist them **by name** in the test. Update ASSUMPTIONS 31.

3. [MAJOR] `scenarios.test.ts:418` S14 is **tautological as written**. `generateRoster` returns
   `analyzeRoster()` = `validateRoster()` plus suggestions, so "generator ERRORs == validator ERRORs" can't fail.
   Its real value is the "only Nimbus" half, and that half still trusts the validator's own coverage maths.
   → Add an **independent oracle** in the test that doesn't use `RosterState`, `ctx` or `validate`: from
   `draft.entries` + `input.assignments` + `requiredStaff`, count per (bp, in-month date) the entries with
   `status === "WORK"`, `coveredBrandProcessIds.includes(bp)` and an assignment for that pair. Assert:
   (a) every shortfall the oracle finds has a matching `COVERAGE_GAP`/`NO_ELIGIBLE_STAFF`, (b) every
   `COVERAGE_GAP` matches an oracle shortfall, and (c) outside Nimbus there are none. Do the same for weekly offs
   (count `WEEKLY_OFF` per owned full week, with rule #1 applied) against `WEEKLY_OFF_NOT_GRANTED`.

## Verified

- Re-ran on my side: `db:seed`, `verify:seed` 27/27, `lint`, `format:check`, `typecheck`, `test` 103/103
  (8 files), `build`; `roster:dry-run 2026-12` (5 ERROR, all Ananya) and `2027-01` (4 ERROR, all Ananya).
- Read `generate.ts` and `validate.ts` in full; `state.ts` `coverers`/`fillDate`/`newlyShortIfOff`; S14–S18.
  - `coverers()` only counts people who have an assignment for that brand-process, so a manual edit can't fake
    coverage by adding an unassigned bp id. Good.
  - The generator never grants an off that breaks coverage (`score >= 1000 → break`); the validator explains it.
  - The boundary-week mechanism matches the P1 ruling: neighbour spill locked, carry-over with note, never
    overwrites, coverage in-month only, owned weeks over the full week.
  - `PREFERRED_OFF_NOT_HONOURED` / `PENDING_LEAVE_CONFLICT` only fire when the person is genuinely needed.
    Rekha 12 Dec (Scenario 5) and Aarav 29–30 Dec (Scenario 4) appear as intended.
- Hand-check: Coastal Candles (Ishita/Divya) and Orbit Electronics (min 2, Arjun's leave 16–17 Dec, 15 Jan
  override of 3) are correct in the grid. Aarav's boundary off on 3 Jan is carried as `Ō`.
- Purity test plus ESLint rule: no Prisma/Next/Node I/O, no clock, no randomness. Good.

## After the fix

In the re-request, include the before/after counts for: holiday-hosted offs, `CONSECUTIVE_DAYS_EXCEEDED`
(excluding Ananya), and total WARNINGs per month. Then push on PASS.
