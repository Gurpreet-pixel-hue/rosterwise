# Demo script

> The timed 3 to 5 minute walkthrough is written in P6. This file already names the four seeded
> demo scenarios (CLAUDE.md section 5). They are defined in `DEMO_SCENARIOS` in
> `prisma/seed-data.ts`, and `pnpm verify:seed` fails if the data stops supporting them.
> Demo months: **December 2026** and **January 2027**.

## Seeded scenarios

The baseline roster is meant to fail **only** where intended: Nimbus Gadgets (scenario 2) is the one
brand that cannot be scheduled cleanly. `pnpm verify:seed` checks this statically and prints it as `EXPECTED`.

### 1. Single-resource ALL_DAYS brand WITH a backup: resolves cleanly

- **Brand:** Coastal Candles. **Primary:** Ishita Verma (CS ALL_DAYS, ACC every day except public holidays).
  **Backup:** Divya Menon (Alpha pod, no primary work).
- **Story:** Ishita's weekly offs and her approved leave on 21 to 23 Dec are covered by Divya.
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
  `PENDING_LEAVE_CONFLICT` warning (he is the sole cover).
- **Live demo (what-if / approve):** simulate approving it. Atlas Footwear is covered automatically by
  Rahul. Lumen Skincare and Verdant Tea Co lose their only person on the same days, so one
  `CASCADE_GAP` lists those two brands, with suggestions from the Alpha pod bench (Divya Menon,
  Tanvi Joshi) via a manager-approved temporary assignment. One brand resolved, two flagged.

### 5. Mini-scenario: client coverage beats a preferred day off

- **Brand:** Harvest Snacks (CS and ACC, every day except public holidays). **Primary:** Shruti Banerjee.
  **Backup:** Rekha Das, who prefers Saturday and Sunday off.
- **Seeded:** a coverage override of **2 on Saturday 12 Dec 2026** (sale day). Shruti alone is not enough,
  so Rekha must work that Saturday even though she prefers it off.
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
