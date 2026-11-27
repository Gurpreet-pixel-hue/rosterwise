# Demo script (about 5 minutes; trim to 4:30 as noted)

Live site: https://rosterwise-iota.vercel.app (view-only without the passcode).
Four things to show, in this order: **roster generation**, **different brand schedules**, **conflict
detection**, **handling a change**. Everything below was run end to end by `pnpm walkthrough:p4` against the
public URL (`docs/reviews/p6/walkthrough-public-url-output.txt`), so each click exists.

## Before recording

1. Reset the data so the clicks match this script: `SEED_ALLOW_REMOTE=1 pnpm db:reset-demo` with the production
   `DATABASE_URL` (direct, non-pooled), or run it locally with `pnpm db:seed && pnpm build && pnpm start`.
2. Have the passcode ready. Use a desktop window of about 1600 px so the whole grid is visible.
3. Demo months are December 2026 and January 2027. The app's fixed "today" is 27 Nov 2026.

## The timed run

| Time     | Say                                                                                                                                                                                             | Do                                                                                                                                                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0:00** | "Anyone can look at the roster. Changing anything needs a shared passcode, and every change is audited."                                                                                        | Open the site. Point at **View only** (top right). Click **Roster**: December 2026 says "No roster yet".                                                                                                                                                                                         |
| **0:20** | "I unlock with the passcode and a name. The name goes in the audit log."                                                                                                                        | **Unlock to edit**, enter a name and the passcode. Nav now reads **Editing as ...**.                                                                                                                                                                                                             |
| **0:35** | **Roster generation.** "The engine builds the month from each brand's operating calendar and each person's availability. Same input, same roster, always."                                      | **Generate December 2026**. Point at the status badge (DRAFT, version 1) and the Issues counter.                                                                                                                                                                                                 |
| **0:55** | "Same data, five views."                                                                                                                                                                        | Click the tabs **Company, Pod, Brand, Process, Employee**. Land on **Brand**.                                                                                                                                                                                                                    |
| **1:10** | **Different brand schedules.** "Coastal Candles has one person, but a backup, so the weekly offs and leave are covered. Clean." (scenario 1)                                                    | **Brand** tab, choose **Coastal Candles**. Show the grid rows and the coverage strip (all green).                                                                                                                                                                                                |
| **1:35** | "Nimbus Gadgets has one person and no backup. The coverage strip stays green because Ananya keeps working, but never gets a day off, and the engine says so instead of hiding it." (scenario 2) | Choose **Nimbus Gadgets**. Show the green strip. Open the **Issues** tab: five `WEEKLY_OFF_NOT_GRANTED` errors for Ananya Reddy, one per week.                                                                                                                                                   |
| **2:00** | **Conflict detection.** "Every issue says who, when and by how much, and separates mandatory rules from preferences."                                                                           | **Show details** on one of them: the explanation, and the suggestions (`REASSIGN_FROM_POD` or accept the gap, which needs a note). Then find the `PREFERRED_OFF_NOT_HONOURED` warning for Rekha Das on 12 Dec: "client coverage beat the preference, and the roster says so."                    |
| **2:30** | **Editing with validation.** "A manual edit shows its consequences before it is saved."                                                                                                         | **Coastal Candles**, click Ishita Verma's cell on 16 Dec, set **Status** to Weekly off. The **Before you save** panel lists the new errors. **Save anyway**, open **Issues**, and **Apply** the `USE_BACKUP` suggestion (Divya Menon). The gaps close, and the cell is marked as edited by hand. |
| **3:00** | **Handling a change.** "A pending leave is not applied until approved. What happens if I approve it?" (scenario 4)                                                                              | **What if...** (the Changes page). **What changes?** = **Approve a pending leave**, pick Aarav's 29 to 30 Dec leave, **Preview**.                                                                                                                                                                |
| **3:30** | "One person's leave breaks two brands at once. The engine groups it as a `CASCADE_GAP`. The third brand has a backup and is fine. Nothing is saved yet."                                        | Show the preview: cells changed, issues added, the `CASCADE_GAP` naming Lumen Skincare and Verdant Tea Co.                                                                                                                                                                                       |
| **3:50** | "Applying creates a new version with a diff, so nothing is silently overwritten."                                                                                                               | **Apply as version 2**. Show the diff banner, then the version label "version 2 of 2".                                                                                                                                                                                                           |
| **4:10** | **Publish gate.** "A roster with ERRORs cannot be published unless a manager acknowledges each one with a reason."                                                                              | Click **Publish**: blocked, with the reason. Open an ERROR, enter an **Acknowledgement note**.                                                                                                                                                                                                   |
| **4:35** | **Honest limit.** "One weakness I found by building the fairness report: most weekly offs land on weekdays, so many people work every Sunday."                                                  | Open the **fairness** report page and read the summary line.                                                                                                                                                                                                                                     |
| **4:50** | "The validator is the single source of truth: generation, manual edits, what-if and publish all call it."                                                                                       | End on the Issues tab.                                                                                                                                                                                                                                                                           |

To land at 4:30, cut the 2:30 editing step's second half (applying `USE_BACKUP`) and the 4:35 fairness step.
Do not cut 1:35 (a conflict the engine refuses to hide) or 3:00 (a change with a preview).

## What to say if asked

- **Is the roster optimal?** No. It is a deterministic greedy pass with a repair step, chosen so every decision
  can be explained and re-run. It is valid and explained, not mathematically optimal.
- **Why is Nimbus not "fixed"?** There is no one to fix it with. The engine suggests a manager-approved temporary
  assignment from another pod rather than inventing staff.
- **Where is the login?** There are no per-user accounts by design: public read, shared-passcode write. See the
  README's security note.

## Seeded scenarios (reference)

The baseline roster is meant to fail **only** where intended: Nimbus Gadgets (scenario 2) is the one
brand that cannot be scheduled cleanly. `pnpm verify:seed` checks this statically and prints it as `EXPECTED`.

### 1. Single-resource ALL_DAYS brand WITH a backup: resolves cleanly

- **Brand:** Coastal Candles. **Primary:** Ishita Verma (CS ALL_DAYS, ACC every day except public holidays).
  **Backup:** Divya Menon (Alpha pod, no primary work).
- **Story:** Ishita's weekly offs and approved leave on 21 to 23 Dec are covered by Divya.
  Expected result: no ERROR for this brand.

### 2. Single-resource ALL_DAYS brand WITHOUT a backup: raises a clear conflict

- **Brand:** Nimbus Gadgets. **Primary:** Ananya Reddy (CS and NDR, both ALL_DAYS). **Backups:** none.
- **Story:** whenever Ananya would take a weekly off, nobody can cover. The roster must not grant the
  off silently or leave a hidden hole: it raises `WEEKLY_OFF_NOT_GRANTED` / `COVERAGE_GAP` with
  suggestions (for example a manager-approved temporary assignment from the Bravo pod).

### 3. Three-person brand: one leave is absorbable, a second simultaneous leave is not

- **Brand:** Orbit Electronics. **Process:** CS, ALL_DAYS, minimum 2 per day.
  **People:** Pooja Desai, Arjun Nambiar, Sneha Kulkarni. No backups.
- **Seeded:** Arjun is on approved leave 16 to 17 Dec. Two people remain, so coverage holds.
- **Live demo (what-if):** add a second leave for Pooja or Sneha on 17 Dec. One person remains for a
  minimum of 2, so `COVERAGE_GAP` ("has 1 of 2") appears.
- Also seeded here: a coverage override of 3 on 15 Jan 2027 (everyone works).

### 4. Multi-brand employee: leave causes CASCADE_GAP, with a mixed resolution

- **Employee:** Aarav Sharma, sole primary for three brands: Lumen Skincare, Verdant Tea Co and
  Atlas Footwear (all Mon to Sat, closed on Sundays and public holidays).
- **Backups:** only **Atlas Footwear** has one (Rahul Bhatt). Lumen Skincare and Verdant Tea Co have none.
- **Seeded:** a **PENDING** leave on 29 to 30 Dec. Pending leave is not applied, so the roster shows a
  `PENDING_LEAVE_CONFLICT` warning (Aarav is the sole cover).
- **Live demo (what-if / approve):** simulate approving it. Atlas Footwear is covered automatically by
  Rahul. Lumen Skincare and Verdant Tea Co lose their only person on the same days, so one
  `CASCADE_GAP` lists those two brands, with suggestions from the Alpha pod bench (Divya Menon,
  Tanvi Joshi) via a manager-approved temporary assignment. One brand resolved, two flagged.

### 5. Mini-scenario: client coverage beats a preferred day off

- **Brand:** Harvest Snacks (CS and ACC, every day except public holidays). **Primary:** Shruti Banerjee.
  **Backup:** Rekha Das, who prefers Saturday and Sunday off.
- **Seeded:** a coverage override of **2 on Saturday 12 Dec 2026** (sale day). Shruti alone is not enough,
  so Rekha must work that Saturday even though Rekha prefers it off.
- **Expected:** coverage wins, the roster stays valid, and a `PREFERRED_OFF_NOT_HONOURED` warning names
  Rekha. This is the mandatory-versus-preference distinction the assessment asks for (section 3.D).

## Other seeded features worth showing

- **Sunday public holiday:** 6 Dec 2026 "Regional Winter Festival".
- **Leave across the month boundary and a public holiday:** Harleen Kaur, 30 Dec to 2 Jan (Urban Brew Coffee,
  backed up by pod lead Karan Malhotra).
- **Approved comp-off:** Aditi Saxena, 11 Dec. **Rejected leave** (Vikram Rao, 24 to 26 Dec) must not affect the roster.
- **Fixed weekly off:** Kabir Singh and Siddharth Jain are contractually off on Sundays.
- **Sale-day override:** Harvest Snacks needs 2 on 12 Dec 2026.
- **Weekday minimum:** Helix Sports Nutrition CS needs 2 on Mondays; its rule is CUSTOM (Mon to Sat). Zoya Ansari backs it up, which keeps Monday 25 Jan 2027 covered while Neha Bansal is on leave.
- **Mixed calendars in one brand:** Nova Wellness and Cedar and Co Furniture run CS ALL_DAYS next to an
  ACC process that is closed on Sundays and public holidays.
