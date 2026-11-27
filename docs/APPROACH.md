# Approach

**The problem.** Roughly 20 brands, each with its own operating calendar, and about 32 people who cover one brand or
several. A roster has to keep every brand staffed on the days it runs, give everyone their weekly off, respect leave,
and say clearly when it cannot. A valid roster with honest conflicts matters more than a pretty one.

## Decisions

1. **Demand and supply are modelled separately.** A brand-process says when it operates and how many people it needs
   (an override for a date, then a weekday minimum, then a default). A person says when they are available. The roster
   is the reconciliation, so a Sunday-closed brand and a 365-day brand sit side by side without special cases.
2. **A deterministic engine, not a solver.** Generation is a greedy pass with a repair step: everyone starts on WORK,
   weekly offs are placed week by week for the most constrained people first, then backups fill the gaps. It is not
   optimal. I chose it because every decision can be explained in a sentence and re-run to the same result, which a
   reviewer or a manager can trust and check.
3. **One validator, called by everything.** Generation, manual edits, what-if previews, suggestions and the publish
   check all call `validateRoster()`. There is no second, UI-only check to drift out of step. A test asserts that every
   ERROR the validator finds is one the generator reports.
4. **Never silently invalid.** If a rule cannot be met, the engine emits an issue with who, when and by how much, and
   proposes fixes. Mandatory rules (coverage, weekly off, contract-fixed off) are separated from preferences. Client
   coverage beats a preferred day off, and a missing weekly off is always surfaced.
5. **Changes are previewed, then versioned.** A leave or rule change is simulated first (nothing saved), showing the
   cells and issues it would change. Applying it creates a new roster version with a diff. Manual edits and past dates
   stay locked.
6. **Plain, testable layers.** The engine is pure TypeScript. Services own the rules and are tested against a real
   Postgres. The UI is a thin layer on both. Dates are plain `YYYY-MM-DD` strings throughout.

## Limits, stated plainly

- **Greedy, not optimal**, and the weekly-off placement does not spread Sunday work evenly: in the seed, 15 of 26
  Sunday-eligible people get no Sunday weekly off in December and 20 of 26 in January (`docs/METRICS.md`).
- **Generation with suggestions grows faster than linearly**: about 0.33 s for this organisation, about 2 s at twice
  the size and about 15 s at four times (`docs/METRICS.md`). Fine for this scale, not for a very large one.
- **No per-user accounts.** Public read, shared-passcode write, display name self-declared.

## The short version, for the email

> I built RosterWise, a roster planner whose deterministic engine generates a monthly roster from each brand's
> operating calendar and each person's availability, and whose single validator flags every coverage and weekly-off
> conflict with a plain explanation and ranked fixes, never producing an invalid roster silently. Changes are previewed
> and applied as versioned diffs. It is live at https://rosterwise-iota.vercel.app with the source, tests and a timed
> demo script in the repository.
