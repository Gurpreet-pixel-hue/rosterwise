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

_More assumptions are added per phase._
