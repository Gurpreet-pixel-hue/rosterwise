# Assumptions

The assessment says not every detail is given and asks for assumptions to be written down. Each one
is recorded here as soon as it is made.

## Calendar and dates

1. **Dates are plain `YYYY-MM-DD` strings**, never `Date` objects at midnight, so there are no
   timezone shifts. Weeks run Monday to Sunday.
2. **Partial weeks at month boundaries:** a weekly off is required only if at least 4 days of that
   week fall inside the month being rostered.
3. **Public holidays are a fictional but realistic Indian calendar**, editable in the UI.
   Demo months are December 2026 and January 2027.

## Leave and availability

4. **Only APPROVED leave and comp-off make an employee unavailable.** PENDING leave is not applied
   to the roster; it is shown as a warning, and `PENDING_LEAVE_CONFLICT` is raised when the
   employee is the sole cover that day.
5. **A contract-fixed off day is a hard constraint;** a preferred off day is a soft preference.

## Coverage

6. **Client coverage beats a preferred off day.** A missing weekly off is a labour violation and is
   always surfaced as `WEEKLY_OFF_NOT_GRANTED`, never hidden.
7. **Required staff for a brand-process on a date** resolves as: `CoverageOverride` for that date,
   then the weekday minimum, then the default minimum, and only on days the brand-process operates.

## Sample data (P1)

8. **The sample company is fictional:** 32 employees, 4 pods, 20 brands, 34 brand-processes, 61 assignments. Names, brands
   and the holiday calendar are invented. The holiday on a Sunday (6 Dec 2026) is deliberate, to
   exercise that edge case.
9. **"Single-resource brand"** means exactly one distinct PRIMARY employee across all of the brand's
   processes. BACKUP assignments do not count. The seed has 16 of 20 (80%).
10. **Bench staff:** 10 of the 32 employees hold no PRIMARY assignment. They are the support pool that
    provides BACKUP cover (one pod lead, Rohan Mehta, deliberately has no assignment at all).
11. **`allocationPct`** is the share of an employee's day an assignment takes. A PRIMARY employee's
    allocations sum to at most 100%. A BACKUP's value is the load they take on when they cover.
12. **Shifts are same-day windows** (`shiftStart < shiftEnd`), e.g. 09:00 to 18:00 or 14:00 to 23:00.
    Overnight shifts are not modelled. `maxDailyHours` defaults to 9, and a 09:00 to 18:00 shift is
    exactly 9 hours.
13. **A brand's owning pod is not a staffing limit.** Employees can be assigned across pods (for
    example Gaurav Chopra of Delta covers Terra Organics, a Bravo brand).
14. **`db:seed` resets the database.** It clears every table (including rosters) and re-inserts rows with
    stable ids, so running it twice gives an identical database. It refuses a non-local database
    unless `SEED_ALLOW_REMOTE=1`.
15. **Dates in the schema are `YYYY-MM-DD` strings** and months are `YYYY-MM`; there are no `Date`
    columns for calendar dates (only `createdAt` timestamps).

16. **Employees are never deleted, only deactivated.** `RosterEntry.employee` is `onDelete: Restrict`, so a
    hard delete is refused while the employee appears in any roster. "Removing" an employee in the
    app sets `isActive = false` (implemented in P3). History and audit stay intact.
17. **Leave and public holidays do not replace the weekly off.** A week where the employee has fewer than 4
    _available_ in-month days (not on approved leave or comp-off) requires no weekly off.
18. **Boundary weeks: one owner, any day.** A Mon-Sun week that straddles two months requires a weekly off in
    the month holding at least 4 of its days (28 Dec to 3 Jan belongs to **December**, not January), but the
    off may sit on **any day of that week, including days in the neighbouring month**. This matters:
    December's share of that week is Mon to Thu only, so Sunday-off staff on brands closed on Sundays
    (Aarav Sharma, Kabir Singh, Priya Nair, Gaurav Chopra) can only be off on Sunday 3 Jan. The engine
    will carry such an off into the January roster as a locked entry (P2). Without this rule December
    would raise `WEEKLY_OFF_NOT_GRANTED` for four people for no real reason.
19. **The seed's static feasibility checks are necessary conditions, not proof.** `verify:seed` checks that
    on every operating day enough assignees are available, and that everyone with PRIMARY duties has at
    least one day they are not needed. It ignores that colleagues also need offs. The only brand allowed
    to fail is Nimbus Gadgets (`EXPECTED_INFEASIBLE`, demo scenario 2).
20. **Bench staff with no assignments** (the backup pool) are shown as "Available (backup pool)" in the
    employee view, not as blank (UI, P4).

## Scheduling engine (P2)

21. **Planning window.** The roster for month M stores one entry per active employee for every date of every
    Mon-Sun week touching M (December 2026 is 30 Nov to 3 Jan, 35 days). Entries dated outside M are
    **spill entries**; the date being outside `roster.month` is the flag (no schema change). Coverage and
    per-day rules are validated for in-month dates only. Weekly offs for a week M owns are validated over
    the whole week.
22. **Boundary-week mechanism** (binding, from the P1 review; tests S16 to S18). (a) A neighbouring month's roster
    (latest version, any status) supplies locked entries for M's spill dates. (b) With no neighbour roster, M
    plans its spill dates itself, provisionally, and owes no weekly off for a week it does not own. (c) When M+1
    is generated, any `WEEKLY_OFF` spill entry in M's roster that serves an M-owned week is carried into M+1 as
    `locked: true, source: AUTO` with the note "carried from M" (unless approved leave covers that day). (d) If
    M needs an off on a spill date the neighbour has locked or published as WORK, M never overwrites it: it raises
    `WEEKLY_OFF_NOT_GRANTED` whose message names the locked date and whose `SWAP_OFF_DAY` suggestion names the
    neighbour-month date to change. A suggestion on a spill date is only offered if that date stays covered.
23. **Public holidays.** A holiday is `HOLIDAY` for everyone not needed. Needed people are chosen to meet each
    operating brand-process's requirement, PRIMARY first, then by fewest holidays worked so far (rotation), then
    id. Whoever works one earns a comp-off credit (`COMP_OFF_EARNED`, INFO; counted for in-month holidays only).
    Approved leave on a public holiday is `HOLIDAY`, not `LEAVE`, so the holiday is not charged against the leave.
    A contract-fixed off day beats a public holiday (`WEEKLY_OFF`).
24. **A holiday does not replace the weekly off, but may host it as a last resort.** An off placed on a public
    holiday costs the employee the holiday, so it counts toward the week **only if no other non-holiday day of
    that Mon-Sun week could have hosted it** (every other day is pinned, not working, or needed to keep coverage
    even after backups). The generator charges +500 for a holiday day (more than any ordinary day that keeps
    coverage, less than the 1000 for "not granted"). The validator enforces the same rule through the same
    function (`RosterState.weekOffs`), so a manager moving an off onto a holiday by hand gets
    `WEEKLY_OFF_NOT_GRANTED` naming the holiday and the free day. A contract-fixed off that lands on a holiday
    is forced (and counts only if nothing else was free), so a fixed-day employee with free days also gets a
    real off that week and keeps the holiday. On the seed the only remaining holiday-hosted offs are the five on
    Sun 6 Dec 2026, each unavoidable (tests S19, S19b).
25. **Weekly-off placement.** Week by week, most-constrained employee first (fewest substitutes across their PRIMARY
    brand-processes, then id). A day scores: +1000 for each person it would leave short even after backups; +1 if
    one of their brand-processes operates; -5 preferred weekday; +3 per Sunday off already given when Sunday is an
    operating day (rotation); +500 on a public holiday (see 24); +2 on a spill date; +2 per colleague sharing a
    brand-process already away; +10 per day their working run is already past their limit; -20 for the day the
    previous draft used (so a re-plan changes little). Lowest wins, earliest date breaks ties. A best score of
    1000 or more means the off is **not granted**; coverage beats a weekly off, and the validator reports it.
26. **Backup fill.** A short brand-process pulls in an assignee who is working that day (PRIMARY first, then same pod,
    then lowest load) if their load stays at most 100% and the earliest-start-to-latest-end span of everything they
    cover stays within `maxDailyHours`. A person on a public holiday without approved leave may be called in, ranked
    last, and then earns a comp-off.
27. **Issue scope and definitions.** `CASCADE_GAP` = one person who is not working and is PRIMARY on short
    brand-processes in two or more brands that day; the underlying `COVERAGE_GAP`s stay and are listed in
    `groupedIssueIds`. `SHIFT_INCOMPATIBLE` = covered shifts span more than `maxDailyHours`, or overlapping shifts of
    different brands exceed 100% allocation; `OVERALLOCATED` (warning) is reported only when that is not already the
    case. `PREFERRED_OFF_NOT_HONOURED` and `PENDING_LEAVE_CONFLICT` fire only when the person is genuinely needed:
    removing them leaves a brand-process short even after backups (including people who could be called in on a
    holiday). `NO_ELIGIBLE_STAFF` replaces the per-day gaps for a brand-process nobody is assigned to.
28. **Suggestions** carry concrete cell edits and are pre-validated: applying one to a copy of the roster must add no
    new ERROR and must resolve its own issue. They are ranked by fewest new warnings, then same pod, then lowest load.
    A suggestion never undoes a locked cell. `REASSIGN_FROM_POD` proposes a manager-approved temporary assignment
    from the brand's pod. `ACCEPT_GAP` is always available for an ERROR. Applying a suggestion marks its cells
    `MANUAL` and locked.
29. **Re-planning after a change** (`simulateChange`) pins every entry outside the affected Mon-Sun weeks, every entry
    before `today`, and every locked entry; it re-plans only the affected weeks and reuses last time's weekly-off day
    where it can. It returns the new roster, the changed cells and the issue delta without saving anything.
30. **S03, read literally, cannot happen:** with three people, one leave leaves two and cannot break a minimum of 2.
    The test therefore also uses the case the assessment means (seeded as Orbit Electronics): a second simultaneous
    leave. The one-leave halves are asserted too.
31. **Repair pass for long working runs.** Weekly offs are placed one week at a time, which can leave a run over
    `maxConsecutiveDays` (an early off one week, a late one the next). After placement, for each employee with a
    run over their limit and with everyone else held fixed, the engine finds which days of each owned week could
    host their off without leaving any day worse covered, enumerates the combinations and keeps the one with the
    least total excess; then a second stage swaps two colleagues' off days in the same week. A change is applied
    only if it strictly reduces excess and never touches a pinned cell, a contract-fixed day or a holiday.
    Deterministic and bounded. It never trades coverage for it.
32. **Known limit of the repair.** It optimises one person (or one swapped pair) at a time. A group that needs
    re-planning together can be left with one 7-day run: on the seed, Arjun Nambiar, 19 to 25 Jan 2027
    (Orbit Electronics, three people sharing a minimum of 2, around the 26 Jan holiday). Ananya Reddy's
    run is inherent (Nimbus Gadgets, no backup, no weekly off possible). Test S20 allowlists Arjun by name.
    Repairing preferences is a trade: moving an off to shorten a run can give up a preferred weekday, so
    `PREFERRED_OFF_NOT_HONOURED` rose slightly (Dec 7 to 9, Jan 8 to 9) while the warning total fell.

    ## Persistence and workflow (P3)

33. **A roster is one VERSION of a month, and only the latest can change.** Generating again or applying a change
    creates version n+1 with `parentVersionId` = n; an older version is history and every write against it is a
    `CONFLICT` naming the newer one. Every write also re-checks this inside its own transaction.
34. **A PUBLISHED roster is never edited in place.** Manual edits, acknowledgements and withdrawals are refused on
    it. Applying a change to a published roster creates a new DRAFT version that must be published again.
35. **A manual edit is validated first.** `previewManualEdit` returns the issue delta (added issues come with
    suggestions) and writes nothing; `saveManualEdit` commits. An edit that introduces ERRORs is still allowed,
    because the manager may be doing it on purpose; the errors then block publishing until acknowledged. Saved
    edits are `locked` and `source = MANUAL`, so regeneration keeps them. Only a `WORK` cell can cover
    brand-processes.
36. **Applying a change saves its master-data effect and the new version in one transaction** (a leave is created,
    updated or deleted; a rule or minimum is changed; an override is upserted). The effect runs last, so a late
    failure rolls the new version and its entries back too. Regeneration keeps locked entries, and keeps
    everything before `today` when `today` is given.
37. **Acknowledgements are per version, per stable issue id, ERRORs only, with a note of at least 3 characters.**
    Publishing is blocked while any ERROR lacks one. They can be withdrawn on a draft. When a new version is
    created (regenerate or apply), acknowledgements are **carried over only for ERRORs whose id still exists**;
    anything new must be acknowledged again. The count carried is returned and written to the audit log.
38. **Publishing creates comp-off credits** for public holidays worked inside the month, never twice for the same
    employee and date, so re-publishing a later version adds only genuinely new credits.
39. **Employees are deactivated, not deleted.** A hard delete is refused if they lead a pod or appear in any saved
    roster. A deactivated employee drops out of new rosters and stays in old ones.
40. **Master-data edits do not rewrite existing rosters.** They show up through the same validator (adding an approved
    leave on a day someone works gives `WORK_WHILE_UNAVAILABLE` on the saved roster); regenerating or applying a
    change re-plans. This is deliberate: a published roster must not change underneath people.
41. **Every mutation writes an AuditLog row in the same transaction**: actor, action, entity, before, after, and the
    roster it belongs to. Master data is audited too, not only rosters.
42. **Known limit: there is no login.** The brief asks for a public app that works without one, so `actor` is a
    free-text label supplied by the caller and is not authenticated. The audit log records it faithfully but it
    cannot prove who typed it.
43. **Integration tests run against a real Postgres** named by `TEST_DATABASE_URL` (CI uses a service container,
    local use `createdb rosterwise_test`). They wipe and re-seed it, so the name must contain "test" and differ
    from `DATABASE_URL`; otherwise they refuse to run. Without it they are skipped and say so.

_More assumptions are added per phase._
