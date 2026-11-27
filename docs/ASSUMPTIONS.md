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
37. **Acknowledgements are per version, per stable issue id, ERRORs only, with a note of at least 3 characters,
    and they are tied to the issue's wording.** The id is a hash of code + entity + date, so a gap that worsens
    ("has 1 of 2" to "has 0 of 2") keeps its id. The acknowledgement therefore stores the message it was given
    for and counts only while the issue still reads exactly that. If the same issue now reads differently, the
    old acknowledgement is returned as `changedSince` (with the previous message) and the issue is a blocker
    again, in the same version (a master-data change) as well as after a regenerate. Publishing is blocked while
    any ERROR lacks a current acknowledgement. They can be withdrawn on a draft. When a new version is created
    (regenerate or apply), acknowledgements are copied for ERRORs whose id still exists; the result reports how
    many still match (`carriedAcknowledgements`) and how many were copied but have changed
    (`changedSinceAcknowledged`). Anything new must be acknowledged again. Both counts go to the audit log.
38. **Publishing creates comp-off credits** for public holidays worked inside the month, never twice for the same
    employee and date, so re-publishing a later version adds only genuinely new credits. **It also retracts**
    (P3 review, finding 4): a credit that an earlier publish of the same month created
    (`CompOffCredit.publishedByRosterId`) for a holiday the newly published version no longer has that person
    working is deleted if unused. One already used (`usedOn` set) is kept, because the day off was taken, and is
    counted as `compOffCreditsKeptUsed` in the result and the audit row. A credit a manager entered by hand has
    no `publishedByRosterId` and is never touched. A credit's holiday is always inside its own month, so only
    that month's credits are candidates.
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

44. **A day belongs to the roster of the month it falls in; the weekly-off requirement belongs to the week's
    owner (P3 review, finding 1).** The roster for December stores the whole planning window, so 1 to 3 Jan are
    stored in it as well as in January's, and 28 to 31 Dec in January's. Each such cell has one authoritative
    copy: the one in the roster of the month the date is in (this is what the generator already assumed,
    22a). So:
    - **Reads overlay.** Whenever a roster is loaded (view, validate, acknowledge, publish gate, simulate, next
      generation), every cell dated in another month is replaced by the latest version of that month's roster
      (when it exists), marked `locked`. The stored copy of a day is only the provisional plan from before the
      neighbour existed. This happens in `loadDraft` in the server layer; the engine stays pure and unchanged.
    - **Edits are refused for such days** (`CONFLICT`, naming the roster that owns the day), by preview and by
      commit, and the commit re-checks inside its transaction, so a neighbour generated between preview and commit
      is still caught. With no neighbour roster the day is provisional and may be edited (that is how December
      plans Sunday 3 Jan for Aarav).
    - **Consequences are visible, not silent.** If January then has someone working on a day December needed
      for that person's weekly off, December's validator reports `WEEKLY_OFF_NOT_GRANTED`, which blocks
      publishing December until fixed or acknowledged. The fix is made where the day lives (January).
    - **Why not "the week's owner owns all seven days"?** The reviewer's wording was week-owner. I kept the engine's
      existing date-owner rule because the week-owner rule deadlocks with a PUBLISHED neighbour (ASSUMPTIONS 22d, test S18:
      January published with WORK on 3 Jan, December needs the off there; December would have to overwrite a
      published roster, and January could not edit December's week to unblock it). Under date-owner the way out is
      to apply a change in January (a new draft version), edit 3 Jan there and publish again.
    - **Known limit:** the response to an edit does not preview the neighbour's issues; the neighbour shows them
      the next time it is opened or published.
45. **A change is applied from the roster whose days it touches (P3 review, finding 2).** A date-bound change (a
    leave, "make unavailable", removing a leave, a one-day coverage override) whose dates all fall in another
    month is refused with `CONFLICT` naming the month to apply it from, because this roster re-plans only its own
    days and "applied, nothing changed" would be false reassurance. A change that straddles two months is
    allowed and returns `affectedMonths`: the other month's roster exists and is **not** re-planned (its
    validator flags what the change breaks, e.g. `WORK_WHILE_UNAVAILABLE`); apply the same change there too. A
    rule-wide change (rule, default or weekday minimum) has no dates and is never refused.

46. **Writers on one roster are serialised by its row lock** (found by the automated security review after P3 passed).
    Publishing, a committed edit, an acknowledgement or its withdrawal, and applying a change each take
    `SELECT ... FOR UPDATE` on the roster row first. Publishing does its whole gate (load, validate, check
    acknowledgements) **inside** that transaction, so an un-acknowledge or an edit cannot land between the check
    and the publish. Test: a writer holds the lock and withdraws every acknowledgement while a publish waits; the
    publish ends `BLOCKED` and the roster stays a DRAFT.

## UI (P4)

47. **The five views** (Company, Pod, Brand, Process, Employee) are filters over one roster, not separate data. Company
    shows everyone active. Pod shows the pod's members. Brand and Process show everyone **assigned** (primary or backup)
    to one of the brand's or process's brand-processes, so a backup from another pod appears on the brand they would
    cover. Process groups by process code across brands. Employee shows one person and the brand-processes they are
    assigned to. The coverage strip shows the brand-processes the view is about. Rules are in `src/lib/roster-view.ts`
    and unit-tested; the page draws what they return.
48. **The Issues panel is scoped to the view by default** (an "Only issues in this view" checkbox, off for Company):
    issues about someone the view shows or about one of its brand-processes. The publish gate and the blockers count
    always use the whole roster. Issues are grouped ERROR, WARNING, INFO; INFO (comp-off notes) starts collapsed, and
    ERROR cards start collapsed when there are more than six.
49. **A suggestion is re-derived on the server when applied.** The browser sends only the issue id and the suggestion's
    index, never the edits, and the server applies them through the same validated edit path (`editCells`) that a manual
    edit uses, in one transaction, audited with `via: suggestion ...`. `ACCEPT_GAP` is not an edit: it opens the
    acknowledgement form.
50. **Known limit: a "temporary assignment" from `REASSIGN_FROM_POD` is saved as an ordinary BACKUP assignment.** It needs
    an explicit "I approve" click, is audited, and shows in Setup, Assignments, but nothing expires it. The manager
    removes it by hand. A date-bounded assignment would need a schema change.
51. **The cell dialog lets you pick only brand-processes the person is assigned to**, because the engine counts only
    assignees as covering. A person with none is the backup pool; the dialog says so and points to Setup.
52. **The edit dialog warns before saving, twice.** Statically, when the cell is a weekly off that serves another
    month's week ("This is Aarav's weekly off for December's week of Mon 28 Dec..."), and from the live preview, which
    now includes `neighbourImpact`: the issues the edit would add to or resolve in the neighbouring roster
    (the P3 round 2 note, closing the limit in ASSUMPTIONS 44). A day owned by another month's roster is read-only, with a
    link to that roster.
53. **"Today" for re-planning is a fixed demo date** (`DEMO_TODAY = 2026-11-27`, `src/lib/config.ts`), not the clock. Otherwise
    anyone opening the demo after December 2026 would find the whole month "history" and every change would re-plan
    nothing. Real use would pass the actual date.
54. **No login yet, so the audit actor is the constant `manager`** (`ACTOR`). The shared-passcode session of P6 replaces it
    with a name from the signed cookie, on the server.
55. **A "what if" never saves.** Preview calls `simulateChange`; Apply is enabled only for the inputs that were just
    previewed, saves the change and a new draft version (parent = the base) in one transaction, and shows a diff of
    that version against its parent. Applying to a published roster creates a new draft; the published one stays in
    history. A change that falls wholly in another month is refused, and one that straddles two months names the
    other (ASSUMPTIONS 45).
56. **Dates in the grid are the whole Mon-Sun planning window**, so the boundary week appears at the edges, dimmed, in a
    dashed cell when it belongs to the neighbouring roster. Letter codes (W O L C H U) carry the status, so colour is
    never the only signal; markers: a dot for an issue on that day, `p` for pending leave (not applied), a small
    dot for an edit by hand.

## Optional features (P5)

57. **Backup recommendations (P5.1)** come from `backupReport` (engine, pure). A brand-process is EXPOSED when it has no
    BACKUP and no more primaries than the most it ever needs on one day (so one absence is a gap), SHARED when there
    are more primaries than that, COVERED_BY_BACKUP when a backup exists. Candidates (EXPOSED or unstaffed only) are
    active people not already on it, with spare allocation (100 minus the sum of their assignments), whose daily
    span including this shift fits their daily hours, ranked same pod as the brand first, then least allocated, then
    name. A new backup takes 20% (less if that is all they have spare). "Add as backup" creates an ordinary BACKUP
    assignment, noted as such, which applies to the next generation or re-plan.
58. **CSV export (P5.2)** is a read-only GET (`/roster/<month>/export?what=grid|coverage|issues|fairness&kind=&value=`) of
    the latest version, built by the same view rules as the screen (it ignores the person-name search box). Cells that
    start with `=`, `+`, `-`, `@`, a tab or a carriage return are prefixed with an apostrophe so a spreadsheet reads
    them as text.
59. **Fairness report (P5.3)** counts in-month days: Sundays that are not public holidays, and public holidays (a
    holiday Sunday counts as a holiday). "Worked" means status WORK, so a backup-pool person who is rostered to work
    but covers nothing still counts. The spread (max minus min) is taken only over people who could be asked: assigned
    to a brand-process that operates on at least one such day. Everyone else is listed, labelled "no brand open", and
    left out of the comparison, so closed-on-Sunday brands do not flatter the numbers. Holidays worked across everyone
    equal the comp-off credits earned (tested).
60. **Version comparison (P5.4)** diffs the cells of two versions of a month and validates BOTH with today's master data,
    so it compares plans under the same rules. The consequence, tested and deliberate: after an applied change
    (which also approved a leave), the older version reads "works while on approved leave" where it was saved with
    "pending leave" warnings. It is not a record of what each version said on the day it was saved.
61. **The AI explanation (P5.5)** sends only the issue's own fields (code, severity, date, message, the engine's
    explanation, and each suggestion's type and description): no roster, no other people, no ids, no leave data, and
    never the key. Without `ANTHROPIC_API_KEY`, on any error, a timeout (15 s) or an empty answer, the deterministic
    explanation is returned and labelled "Standard explanation" with the reason. A per-process cap of 10 calls a
    minute is a guard against a runaway client, **not** cost control: on a public deployment the real control is the
    passcode (63), and `explainIssueAction` is behind it. The live API call is not exercised by the tests (they inject
    `fetch`).
62. **Pod-lead approval (P5.6)** is per pod, per DRAFT version, cleared when any of that pod's cells is edited, and absent
    on a new version. Publishing requires every pod with an active employee only when `REQUIRE_POD_APPROVAL` is set
    (off by default, so existing flows are unchanged). **The approver's name is recorded, not verified**: it is the
    display name typed at unlock (64), taken from the signed session on the server. Nothing checks that it is the
    pod's lead, so "approved by Nisha" means "someone with the passcode said they were Nisha".

## Access and deployment (P6)

63. **Access model: public read, shared-secret write, no per-user accounts** (Owner ruling, `REVIEW-P3.md`). Anyone can
    view; every change (setup, generate, edit, apply, publish, acknowledge, approve, explain) needs the shared
    passcode. Previews and what-if simulations write nothing and stay public. One guard, `guarded()`, wraps every
    mutating server action, and a test lists the real exports of both action modules and fails if any non-public one
    does not refuse without a session.
64. **The name in "Editing as ..." is self-declared.** The session cookie is HMAC-signed, so the name cannot be altered
    afterwards, but whoever knows the passcode types whatever name they like. The audit log therefore records "which
    session said it was whom", not a verified identity. The client can never choose the actor: the server overwrites it
    from the session (tested, including a client that sends `actor: "evil"`).
65. **Everything readable is public**: rosters, employee names, leave, setup data and CSV exports. That is acceptable
    only because the data is fictional. Real employee data would need authentication on reads too.
66. **Fail closed.** If `DEMO_PASSCODE` is unset or empty, or `SESSION_SECRET` is under 32 characters, every write is
    refused with `UNAUTHORIZED`, locally and in production, and the unlock endpoint answers 503. The app never falls
    back to "open".
67. **Sessions are stateless: 12 hours, no server-side store.** "Lock" clears the cookie in that browser only. A copied
    cookie works until it expires. Rotating `SESSION_SECRET` ends every session at once.
68. **Brute-force limit:** 5 wrong passcodes per 15 minutes per client, kept in Postgres (an in-memory counter does not
    survive serverless instances). The client is a salted hash of its IP, never the IP. The attempt is recorded
    _before_ the passcode is compared, so parallel guesses cannot beat the limit (a 30-way test failed on the earlier
    check-then-record order and passes now). The IP comes from `x-forwarded-for` / `x-real-ip`, which is trustworthy on
    Vercel only; behind another proxy it could be spoofed. There is **no global limit**, because one would let an
    attacker lock evaluators out. Passcode strength carries the weight instead: the production passcode is 20 random
    characters from a 31-symbol alphabet (about 99 bits). A person who can rotate IPs and guess 5 times each from every
    one still faces that.
69. **Cross-site requests:** `/api/unlock` and `/api/lock` refuse a request whose `Origin` is not this site (403, and a
    missing Origin is refused). Server actions rely on Next.js's built-in Origin check plus `SameSite=Lax`.
70. **Security headers** are set on every route (CSP, `X-Frame-Options: DENY`, nosniff, Referrer-Policy,
    Permissions-Policy, HSTS in production). **The CSP keeps `'unsafe-inline'` for scripts and styles**, because Next.js
    emits inline bootstrap scripts and a nonce-based policy needs middleware that makes every route dynamic. The app
    renders no user-supplied HTML (React escapes text), so framing, form, connection, base and object restrictions are
    the directives doing the work. Use nonces if rich text is ever added.
71. **One shared production database** (Neon, free tier, pooled connection with `pgbouncer=true` added in code). Anyone
    with the passcode edits the same data as everyone else; there are no per-evaluator sandboxes. `pnpm db:reset-demo`
    re-seeds it (needs `SEED_ALLOW_REMOTE=1` against a remote database) and also clears the unlock-attempt table, so it
    lifts a lockout. The public demo's fixed "today" is 27 Nov 2026 (`DEMO_TODAY`), so December and January stay
    "the future" however late someone opens it.
72. **Previews and simulations are public and cost CPU.** They are not rate limited beyond the platform's own limits.
    Generation with suggestions grows faster than linearly with organisation size (see `docs/METRICS.md`), which also
    bounds how large a deployment this design suits.

_More assumptions are added per phase._
