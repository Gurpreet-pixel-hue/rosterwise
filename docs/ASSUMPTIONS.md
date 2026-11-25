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

_More assumptions are added per phase._
