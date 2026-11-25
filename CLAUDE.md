# RosterWise (Smart Roster Management System): Build Plan & Operating Rules

**Repo:** https://github.com/Gurpreet-pixel-hue/rosterwise (public, branch `main`). This is a portfolio
project that goes on the Owner's resume, not a throwaway assignment. Hold it to production quality: CI,
a clean commit history, a real README, and honest metrics.

- The assessment PDF is git-ignored and must **never** be committed (it's the company's document and contains staff emails).
- Don't use the company name in code, UI or the repo name. "DataStraw" appears only in the README's "Context" line.

Source of truth for requirements: `AI_Internship Assessment.pdf` (DataStraw internship assessment).
Read it fully before starting any phase. If this file and the PDF disagree, the PDF wins: flag the
mismatch in `docs/PROGRESS.md`.

---

## 0. Roles (read first)

| Role | Model | Responsibility |
|---|---|---|
| **Executor** | Sonnet 5.5 | Builds everything in this plan, phase by phase. Writes code, tests, seed data, docs. |
| **Reviewer** | Opus 5.5 | Final checker. Reviews each phase at its gate, writes PASS / CHANGES_REQUIRED. Does not write feature code. |
| **Owner** | The human | Picks between options when asked, records the demo video, sends the submission email. |

### Gate protocol (mandatory)

1. Work proceeds in phases P0–P6 (section 6). Each phase ends at a **GATE**.
2. At a gate the Executor:
   - runs every verification command listed for that phase and pastes the real output,
   - writes `docs/reviews/REQUEST-P<n>.md` (template in section 8),
   - updates `docs/PROGRESS.md`,
   - **stops** and tells the Owner: "P<n> ready for Opus review."
3. The Reviewer writes `docs/reviews/REVIEW-P<n>.md` with verdict `PASS` or `CHANGES_REQUIRED` and numbered findings.
4. On `CHANGES_REQUIRED`, the Executor fixes **every** finding, answers each one by number in
   `REQUEST-P<n>.md` (section "Response to review"), and re-requests review.
5. The Executor never starts phase n+1 without `PASS` on phase n, never edits `REVIEW-*.md`, and never
   marks its own phase as passed.
6. If the Executor disagrees with a finding, it says why in the response, with evidence. It does not silently skip a finding.

### Executor ground rules

- **The scheduling engine is the product.** The PDF says a valid roster with clear conflicts beats a
  pretty UI. Engine correctness comes before UI polish, every time.
- **The validator is the single source of truth.** The generator, manual edits, change simulation and
  the publish check all call the same `validateRoster()`. There is no second, UI-only check.
- **Never silently produce an invalid roster.** If a constraint can't be met, emit an issue that explains it.
- Never weaken, skip or delete a failing test to get green. Fix the code, or explain in the gate request.
- Never claim something works without running it. Paste the real command output into gate requests.
- Keep the engine pure: `src/engine/**` has no DB, no Next.js, no I/O imports. Plain TypeScript in and out.
- Deterministic output: the same input gives the same roster. No `Math.random()` without a fixed seed.
- Small commits, one per task, with clear messages. **Never add `Co-Authored-By: Claude`, any
  Claude/Anthropic attribution line, or "Generated with Claude Code" to commits or PRs** (Owner's global rule).
- Never commit `.env`. Commit `.env.example`.
- Every assumption you make goes into `docs/ASSUMPTIONS.md` right away (the PDF asks for these to be documented).
- If you're blocked on a decision that is genuinely the Owner's, ask. Otherwise use the defaults in this file.

---

## 1. Deadline & budget

- Submission window: 4 days. Expected effort per the PDF: 1.5–2 focused days.
- Target: P0–P4 done by end of day 2, P5–P6 on day 3, day 4 kept as a buffer and for the video.
- If time runs short, cut from P5 (optional features), never from P2 (engine) or the P6 docs.

---

## 2. Tech stack (decided, don't relitigate)

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router) + TypeScript (strict) | One deployable unit for UI and API, deploys easily to Vercel |
| UI | Tailwind CSS + shadcn/ui | Fast, accessible tables, dialogs and forms |
| DB | PostgreSQL (Neon free tier) via Prisma | Relational data and a real hosted DB. SQLite doesn't persist on Vercel |
| Engine | Pure TS module `src/engine/` | Testable, deterministic, explainable |
| Tests | Vitest | Engine unit tests and scenario tests |
| Validation | Zod | Server-action and API input validation |
| Export | CSV (built-in), optionally `xlsx` | Optional feature, cheap to add |
| AI (optional) | Anthropic API, model `claude-sonnet-5-5`, behind `ANTHROPIC_API_KEY` | AI explanations of conflicts. **Must fall back to deterministic text when there's no key** |
| Hosting | Vercel + Neon | Public URL, required by the PDF |

Package manager: `pnpm`. Node 20+.

---

## 3. Domain model

Keep the **brand operating calendar** separate from the **employee working schedule**. The PDF
calls this out explicitly. Demand comes from BrandProcess rules. Supply comes from Employees.

```
Pod 1──* Employee            (Pod.leadId -> Employee, a lead is also an Employee)
Brand *──1 Pod               (owning pod; employees may still cross pods)
Process                      (CS, ACC, NDR, RET, ... a catalog, editable)
BrandProcess                 (Brand × Process + operating rule + coverage + shift)  <- DEMAND
Assignment                   (Employee × BrandProcess, role PRIMARY | BACKUP, allocationPct)  <- who CAN cover
PublicHoliday                (date, name)
Leave                        (employee, from, to, type PLANNED | SICK | COMP_OFF, status PENDING | APPROVED | REJECTED)
CompOffCredit                (employee, earnedOn, reason, usedOn?)
CoverageOverride             (brandProcess, date, minStaff)   <- "minimum staffing on specific days"
Roster                       (month YYYY-MM, version, status DRAFT | PUBLISHED, parentVersionId?, createdAt)
RosterEntry                  (roster, employee, date, status, coveredBrandProcessIds[], locked, source AUTO | MANUAL)
AuditLog                     (who/what/when/before/after) for manual edits and change events
```

### Field details

**Employee**: `id, name, podId, isActive, weeklyOffsPerWeek (default 1), fixedOffDays: Weekday[]`
(a contract-fixed off day is a hard constraint), `preferredOffDays: Weekday[]` (a preference, soft),
`maxConsecutiveDays (default 6)`, `maxDailyHours (default 9)`.

**BrandProcess**:
- `operatingRule`: enum
  - `ALL_DAYS`: 365 days, including Sundays and PHs
  - `NO_PUBLIC_HOLIDAYS`: every day except PHs
  - `NO_SUNDAY_NO_PH`: Mon–Sat, excluding PHs
  - `CUSTOM`: `customWeekdays: Weekday[]` plus a `worksOnPublicHolidays: boolean` flag
- `defaultMinStaff` (int ≥ 0)
- `weekdayMinStaff?: Partial<Record<Weekday, number>>` (e.g. CS needs 2 on Mondays)
- `shiftStart`, `shiftEnd` (HH:mm), used for incompatible-shift detection

**RosterEntry.status**: `WORK | WEEKLY_OFF | LEAVE | COMP_OFF | HOLIDAY | UNAVAILABLE`.
Exactly one entry per (roster, employee, date).

### Resolution order for "required staff on date D for BrandProcess BP"
`CoverageOverride(BP, D)` → `weekdayMinStaff[weekday(D)]` → `defaultMinStaff`, and only if `isOperating(BP, D)`. Otherwise 0.

---

## 4. Scheduling engine (`src/engine/`)

### Files
```
src/engine/
  types.ts          # EngineInput, RosterDraft, Issue, Suggestion, enums
  calendar.ts       # isOperating(bp, date, holidays), weeks of month, weekday helpers
  demand.ts         # requiredStaff(bp, date): Map<bpId, Map<date, number>>
  availability.ts   # per employee per date: AVAILABLE | LEAVE | COMP_OFF | FIXED_OFF
  generate.ts       # generateRoster(input, { locks }) -> { draft, issues }
  validate.ts       # validateRoster(input, draft) -> Issue[]   (THE source of truth)
  suggest.ts        # suggestionsFor(issue, input, draft) -> Suggestion[]
  diff.ts           # diffRosters(a, b) -> changed cells + issue delta
  explain.ts        # deterministic human-readable explanation per issue
  index.ts
```

### Generation algorithm (deterministic, greedy with repair)

1. **Expand demand.** For every BP and every date in the month: `required[bp][d]`.
2. **Expand availability.** Approved leave and approved comp-off make the employee unavailable (status LEAVE / COMP_OFF).
   Pending leave is **not** applied. Show it as a warning chip in the UI.
3. **Apply locks.** Entries that are `locked` (manual edits, past dates) are fixed and never changed.
4. **Default everyone to WORK** on every available day, covering all of their PRIMARY BPs that operate that day.
5. **Public holidays.** For each PH, an employee gets `HOLIDAY` unless they are needed to meet
   `required` for some `ALL_DAYS`/`CUSTOM+PH` BP. If needed, they WORK and earn a `CompOffCredit` (INFO issue).
6. **Place weekly offs**, week by week (Mon–Sun), employees ordered **most-constrained first**
   (fewest substitutes across their BPs, ties broken by employee id for determinism):
   - Candidate days in that week are scored. Lower is better.
     - `+∞` if it's not a weekly-off-eligible day (already LEAVE/HOLIDAY, or locked WORK)
     - `+1000` per BP that would fall below `required` that day *after* trying backups (see 7)
     - `0` if none of the employee's BPs operate that day (e.g. Sunday for NO_SUNDAY_NO_PH staff). Best option.
     - `-5` if it's a preferred off day
     - `+fairness`: penalise giving the same person the "good" day (Sunday) every week. Rotate across the team.
   - A `fixedOffDays` day is forced (hard). If that breaks coverage, a backup must cover or it becomes an issue.
   - Pick the lowest score. If the best score is ≥1000, granting the off would break coverage, so **do not
     grant it.** Keep the employee on WORK and emit `WEEKLY_OFF_NOT_GRANTED` (ERROR) with suggestions.
     Manager decides. Coverage (client-mandatory) beats a *preferred* off day. A *missing* weekly off is
     still a hard labor violation that must be surfaced, never hidden.
   - Partial weeks at month boundaries: require an off only if ≥4 days of that week are in the month.
     Document this in ASSUMPTIONS.md.
7. **Backup fill.** When a PRIMARY is off/on leave and `assigned < required`, pull a BACKUP who is working that
   day, whose daily load (sum of allocationPct for operating BPs) stays ≤100%, and whose shift span stays
   ≤ `maxDailyHours`. Add the BP to their `coveredBrandProcessIds`. Prefer same pod, then lowest load, then id.
8. **Validate.** Run `validateRoster()` on the result. The generator returns exactly the validator's issues
   plus its own explanatory ones. **Invariant (tested): every ERROR the validator finds is reported by the
   generator. The generator never claims "no issues" when the validator finds some.**

Single-resource vs multi-resource brands fall out of the same algorithm. A single-resource brand's employee
has zero PRIMARY substitutes, so it's scheduled first and its weekly off goes to a non-operating day, or a
day a BACKUP can cover, or it raises an ERROR. A 3-person brand checks remaining headcount against `required`.

### Issue model
```ts
type Severity = 'ERROR' | 'WARNING' | 'INFO';   // ERROR blocks publish (unless acknowledged with a note)
interface Issue {
  id: string;            // stable hash of code+entity+date, so issue diffs work across versions
  code: IssueCode;
  severity: Severity;
  date?: string;         // YYYY-MM-DD
  brandProcessId?: string;
  employeeId?: string;
  relatedIds?: string[]; // e.g. all brands affected by one employee
  message: string;       // human readable, specific: who, what, when, by how much
  suggestions: Suggestion[];
}
```

### Issue codes (use exactly these)
| Code | Sev | Meaning |
|---|---|---|
| `COVERAGE_GAP` | ERROR | BP operating on D has fewer covering staff than required (message says "has X of Y") |
| `NO_ELIGIBLE_STAFF` | ERROR | BP operates but has zero PRIMARY/BACKUP assignments in master data |
| `WORK_WHILE_UNAVAILABLE` | ERROR | Entry says WORK but approved leave/comp-off exists (only possible via manual edit) |
| `WEEKLY_OFF_NOT_GRANTED` | ERROR | Employee has no weekly off in a qualifying week |
| `FIXED_OFF_VIOLATED` | ERROR | Employee scheduled on a contract-fixed off day |
| `SHIFT_INCOMPATIBLE` | ERROR | Covered BPs' shift span > maxDailyHours, or overlapping shifts for different brands exceed allocation |
| `OVERALLOCATED` | WARNING | Daily allocation > 100% |
| `CASCADE_GAP` | ERROR | One employee's unavailability causes gaps in ≥2 brands (groups the related COVERAGE_GAPs) |
| `PREFERRED_OFF_NOT_HONOURED` | WARNING | Preference violated for coverage |
| `CONSECUTIVE_DAYS_EXCEEDED` | WARNING | > maxConsecutiveDays in a row |
| `PENDING_LEAVE_CONFLICT` | WARNING | Pending leave on a day the employee is the sole cover |
| `COMP_OFF_EARNED` | INFO | Worked a PH or weekly-off day, credit created |

### Suggestions
`USE_BACKUP(employeeId)`, `SWAP_OFF_DAY(employeeId, fromDate, toDate)`, `REASSIGN_FROM_POD(employeeId)`
(someone in the same pod, working, with spare load, not yet assigned to that BP: needs a manager-approved
temporary assignment), `ACCEPT_GAP` (manager acknowledges). Each suggestion is pre-validated: applying it
must not create a new ERROR. Rank by fewest new warnings, then same pod, then lowest load.

### Change handling (PDF section F)
- `simulateChange(input, roster, change)` where `change` is a leave added/removed, an employee made unavailable,
  a BP rule changed, or a min-staff changed. It returns `{ newDraft, issueDelta, suggestions }` **without saving**.
- Re-generation keeps all `locked` entries and dates before "today", and only re-plans affected weeks.
  It does not rebuild the whole month from scratch.
- Applying a change creates a new Roster **version** (`parentVersionId`). The UI shows a diff: cells changed, issues added/resolved.

### Required engine tests (`src/engine/__tests__/`, named exactly like this)
- `S01 single-resource ALL_DAYS brand with backup: primary weekly off covered by backup, zero ERRORs`
- `S02 single-resource ALL_DAYS brand without backup: WEEKLY_OFF_NOT_GRANTED or COVERAGE_GAP raised, never silent`
- `S03 three-employee brand, one on leave: min 1 shared process -> no gap; min 2 -> COVERAGE_GAP`
- `S04 NO_SUNDAY_NO_PH process: no demand on Sun/PH; weekly off lands on Sunday`
- `S05 public holiday: ALL_DAYS staffed + COMP_OFF_EARNED; NO_PUBLIC_HOLIDAYS not staffed`
- `S06 CoverageOverride raises min to 2 on one date and is enforced`
- `S07 manual edit makes sole cover OFF -> COVERAGE_GAP with USE_BACKUP/SWAP_OFF_DAY suggestions`
- `S08 employee covering 3 brands goes on leave -> CASCADE_GAP lists all 3 brands`
- `S09 determinism: same input twice -> deep-equal output`
- `S10 locked entries preserved across regenerate`
- `S11 preferred off conflicts with coverage -> coverage wins + PREFERRED_OFF_NOT_HONOURED`
- `S12 incompatible shifts across brands -> SHIFT_INCOMPATIBLE`
- `S13 every suggestion returned, when applied, introduces no new ERROR`
- `S14 invariant on the full seed for 2 months: generator-reported ERRORs == validator ERRORs`
- `S15 weekly offs: every employee gets >= weeklyOffsPerWeek in qualifying weeks unless an ERROR explains why`

---

## 5. Sample data (`prisma/seed.ts`) and its verification

Demo months: **December 2026** and **January 2027** (today is late Nov 2026). Public holidays: fictional
but realistic Indian calendar, e.g. 25 Dec 2026 Christmas, 1 Jan 2027 New Year, 26 Jan 2027 Republic Day.

The seed must satisfy, and `pnpm verify:seed` must check and print:
- ≥ 32 employees, 4 pods, each with a pod lead (a lead is also an employee and can be a BACKUP)
- ~20 brands; **≥ 78% and ≤ 85% single-resource** (one PRIMARY employee covering all of that brand's BPs)
- remaining brands have 2–3 PRIMARY employees: at least one brand with **separate processes per person**,
  and at least one where **≥2 people share a process**
- processes: CS, ACC, NDR, RET, plus one brand-specific process (e.g. COD verification)
- all four operating rules are used, including one brand whose CS is `ALL_DAYS` while its other process is `NO_SUNDAY_NO_PH`
- at least one `weekdayMinStaff` and one `CoverageOverride` (e.g. sale day min 2)
- some employees cover 2–3 single-resource brands (multi-brand staff)
- varied `preferredOffDays` and at least one `fixedOffDays`
- planned leaves and an approved comp-off in December, plus one PENDING leave
- **deliberate demo scenarios**, all named in `docs/DEMO_SCRIPT.md`:
  1. a single-resource ALL_DAYS brand **with** a backup (resolves cleanly)
  2. a single-resource ALL_DAYS brand **without** a backup (raises a clear conflict)
  3. a 3-person brand where one leave is absorbable and a second simultaneous leave is not
  4. a multi-brand employee whose leave causes `CASCADE_GAP`

Names and brands are fictional. Don't use real companies.

---

## 6. Phases & gates

### P0 — Scaffold (≈1h)
- Git is already initialised with `origin` set. Scaffold Next.js into the existing folder and keep the
  existing `README.md`, `CLAUDE.md` and `.gitignore` (merge, don't overwrite). Add TS strict, Tailwind,
  shadcn/ui, Prisma, Vitest and ESLint/Prettier.
- `.github/workflows/ci.yml`: on push/PR, run pnpm install → lint → typecheck → test → build (Prisma generate first;
  engine tests need no DB). Add a CI badge to the README.
- Push to `origin main` at every gate PASS. Don't force-push.
- Scripts: `dev`, `build`, `test`, `lint`, `typecheck`, `db:push`, `db:seed`, `verify:seed`.
- `.env.example` (`DATABASE_URL`, optional `ANTHROPIC_API_KEY`), `docs/PROGRESS.md`, `docs/ASSUMPTIONS.md`.
- **GATE P0 verify:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass.

### P1 — Data model + seed (≈2–3h)
- Prisma schema exactly per section 3 (with indexes on `(rosterId, employeeId, date)` unique, `(brandProcessId, date)`).
- Seed per section 5, plus `scripts/verify-seed.ts` that asserts every bullet in section 5 and prints a table.
- **GATE P1 verify:** `pnpm db:push && pnpm db:seed && pnpm verify:seed` output pasted, showing the single-resource % and the scenario list.

### P2 — Engine (≈5–6h) ⚠️ most important gate
- Everything in section 4. The engine takes a plain `EngineInput` built by `src/server/loadEngineInput.ts`.
- All S01–S15 tests pass. Add a CLI `pnpm roster:dry-run 2026-12` that prints a compact text grid plus
  an issue summary for the seed. The Reviewer uses this to hand-check a month.
- **GATE P2 verify:** `pnpm test` (full list of test names in output), `pnpm roster:dry-run 2026-12`, `pnpm roster:dry-run 2027-01`.

### P3 — Persistence & server actions (≈2–3h)
- Server actions / route handlers: CRUD for all master data; `generateRoster(month)`, `saveManualEdit(entry)`
  (validates first and returns the issue delta before commit), `simulateChange`, `applyChange` (new version),
  `publishRoster` (blocked on unacknowledged ERRORs), `acknowledgeIssue(issueId, note)`.
- AuditLog for every manual edit and applied change. Zod on every input.
- **GATE P3 verify:** integration tests against a test DB, or a scripted run showing generate → edit → simulate → apply → publish.

### P4 — UI (≈5–6h)
Pages:
- `/setup/*`: CRUD for employees, pods, brands, processes, brand-process rules (operating rule, min staff,
  weekday mins, overrides, shift), assignments (primary/backup, allocation), holidays, leaves, comp-offs.
  The manager can change all assignments without touching code (PDF 3.A).
- `/roster/[month]`: month picker, Generate button, status badge (DRAFT/PUBLISHED, version).
  - **Views** via tabs plus a filter: Company | Pod | Brand | Process | Employee (all five are required).
  - Employee × day grid with colour-coded cells (WORK / WEEKLY_OFF / LEAVE / COMP_OFF / HOLIDAY), not colour-only: include a letter code.
  - **Coverage strip**: BrandProcess × day showing `covered/required`, red when short and grey when not operating.
  - **"Who's working on <date>"** panel (PDF 3.E).
  - **Issues panel**: grouped by severity, click to jump to the cell, shows explanation and suggestions,
    with one-click Apply suggestion (goes through validation).
  - Cell edit dialog: change status/coverage → shows the issue delta **before** saving.
- `/roster/[month]/changes`: "What if" panel: add leave / make unavailable / change rule → preview delta → apply as new version → diff view.
- **GATE P4 verify:** the Executor walks the 4 demo scenarios in the browser and attaches screenshots in `docs/reviews/p4/`.

### P5 — Optional features (pick in this order, stop when time runs out)
1. Backup recommendations (largely done by suggestions, surface it on the brand view)
2. CSV export per view
3. Fair weekly-off distribution report (Sundays/PH worked per employee)
4. Version comparison (diff of two roster versions, the "alternative plans" lite)
5. AI explanation button on an issue (Anthropic API; deterministic `explain.ts` fallback; never send employee data beyond what the issue needs)
6. Simple approval: pod lead "approve pod" checkbox before publish

### P6 — Deploy & docs (≈3h)
- Deploy to Vercel + Neon, seed the production DB, smoke-test the public URL in an incognito window.
- `README.md`: what it is, live URL, local setup, scripts, architecture diagram (text/mermaid), and
  **"How I think" with all 8 questions from PDF section 8 answered individually and honestly**, including trade-offs and limits.
- `docs/APPROACH.md`: short approach note (≤1 page) + the **2–3 sentence version** for the email.
- `docs/ASSUMPTIONS.md`: complete.
- `docs/DEMO_SCRIPT.md`: a timed 3–5 minute script covering roster generation, different brand schedules, conflict detection, and handling a change.
- `docs/METRICS.md`: **measured** numbers for the resume, produced by a script (`pnpm metrics`), never estimated:
  employees/brands/BPs in the seed, test count, generation time for 1 month (median of 10 runs), generation
  time on a 2× synthetic dataset (answers README Q7), number of issue codes detected, and % of seeded
  demand-days covered with and without backups.
- GitHub repo polish: description, topics (`scheduling`, `constraint-satisfaction`, `nextjs`, `typescript`,
  `prisma`), homepage set to the live URL, CI green, a screenshot in the README.
- **GATE P6 verify:** public URL loads with data, `pnpm build` passes, CI green on `main`, README checklist below is fully ticked.

---

## 7. Final submission checklist (Reviewer signs off on this at the end)

- [ ] Public app URL works without login, with realistic seed data (PDF §7.1)
- [ ] GitHub repo public: source, README, setup steps, `.env.example` (§7.2)
- [ ] Demo script ready (Owner records the 3–5 min video) (§7.3)
- [ ] Approach note (§7.4)
- [ ] README answers all 8 "How you think" questions (§8)
- [ ] ≥30 employees, ~80% single-resource brands, multi-employee patterns present (§3.A, §4)
- [ ] All operating rules configurable from the UI (§3.B)
- [ ] Month selection + generation; brand calendar ≠ employee schedule (§3.C)
- [ ] Every conflict type in §3.D detected, mandatory vs preference distinguished
- [ ] Five views + edit with validation (§3.E)
- [ ] At least one post-generation change demonstrated with resolution help (§3.F)
- [ ] No invalid roster ever produced silently (§3.C, §10)
- [ ] No Claude attribution in commits
- [ ] CI green on `main`; repo description, topics and homepage set; `docs/METRICS.md` generated by script
- [ ] Reviewer drafts the resume entry from `docs/METRICS.md` (only numbers that are actually measured)
- Owner handles: LinkedIn link, submission email (subject: `Smart Roster Management System Assignment - <Full Name>`)

---

## 8. Templates

### `docs/reviews/REQUEST-P<n>.md`
```md
# Review request: P<n> <name>
## Done
- bullet list of what was built (files)
## How to verify
- exact commands, in order
## Verification output
<paste real output>
## Deviations from CLAUDE.md
- what and why (or "none")
## Known gaps / risks
## Response to review   (fill only on re-request)
1. <finding #> -> fixed in <file:line> / disagree because ...
```

### `docs/reviews/REVIEW-P<n>.md` (Reviewer writes)
```md
# Review: P<n>. Verdict: PASS | CHANGES_REQUIRED
## Findings
1. [BLOCKER|MAJOR|MINOR] file:line: problem → expected fix
## Verified
- what the reviewer actually ran/checked
```

---

## 9. Reviewer checklist (Opus uses at every gate)

- Re-run the gate's verification commands myself. Don't trust pasted output alone.
- **Engine (P2):** read `generate.ts`/`validate.ts` line by line; hand-check two brands in
  `roster:dry-run` (one single-resource ALL_DAYS, one 3-person); confirm tests assert the actual behaviour
  (no tautological tests, no `expect(true)`); look for hidden randomness; confirm the validator is shared.
- **Correctness traps:** month boundaries and partial weeks, PH on a Sunday, leave spanning months,
  employee with zero assignments, BP with min 0, timezone bugs (store dates as `YYYY-MM-DD` strings, never `Date` at midnight UTC/local).
- **UI (P4):** every view exists; the coverage strip matches the engine; edits show the delta before saving;
  publish is blocked by ERRORs.
- **Docs (P6):** the 8 answers are specific to this implementation, not generic; assumptions match the code.
- Blockers = anything that lets an invalid roster pass silently, a missing required view, or a broken deploy.
