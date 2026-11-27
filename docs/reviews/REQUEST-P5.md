# Review request: P5 Optional features

All six, in the CLAUDE.md order, plus the three P4 review notes (done first). Nothing was cut, and P6 has not been touched.

## Done

**P4 review notes (non-blocking, folded in):**

1. **`REASSIGN_FROM_POD` is permanent, and now says so.** The confirm text names the person, brand-process and share and
   says it "stays after this roster and changes future months until you remove it in Setup, Assignments". The assignment row
   carries a note ("Added from roster 2026-12 v1 (suggestion REASSIGN_FROM_POD for ...). Remove it here if it is no longer
   needed."), shown in a new Note column. Tested.
2. **One counter definition.** The tab says `Issues (n)` and the filter says `n of m to review`, both counting ERROR and WARNING.
3. **Regenerate on a published roster** reads "Regenerate as new draft" with "Creates draft version N+1; published version N
   stays in history."
4. The walkthrough docs now say to run it against `pnpm build && pnpm start` (done below).

**P5.1 Backup recommendations.** `src/engine/backup.ts` (`backupReport`, pure): per brand-process, who is primary and backup,
a status (`EXPOSED`, `SHARED`, `COVERED_BY_BACKUP`, `NO_STAFF`) and, for exposed ones, ranked candidates (same pod first, then
least allocated, only active people with spare allocation whose day still fits their daily hours). A **Backups** tab on the
roster page shows it for the brand-processes in the current view with a one-click "Add as backup (20%)".

**P5.2 CSV export per view.** A read-only route (`/roster/<month>/export?what=grid|coverage|issues|fairness&kind=&value=`),
linked from the view bar, built from the same view rules as the screen. RFC 4180 quoting and spreadsheet-formula
protection (`=`, `+`, `-`, `@` prefixed with an apostrophe). Safe download names, validated query.

**P5.3 Fair weekly-off distribution.** `src/engine/fairness.ts`, `/roster/<month>/fairness`: per person Sundays and public
holidays worked and off, premium days, working days, and the spread over the people who **could** be asked (so closed-on-Sunday
brands do not flatter it). CSV export of the same.

**P5.4 Version comparison.** `compareVersions` + `/roster/<month>/versions`: pick any two versions, see changed cells and issues
added or resolved (the What-if diff component, reused), in either direction.

**P5.5 AI explanation.** An **Explain** button on each issue. The server sends only that issue's own fields to the Messages API
(`claude-sonnet-5-5`), with the key in a header; with no key, on any error, a timeout (15 s) or an empty answer it returns the
engine's deterministic explanation, labelled "Standard explanation" with the reason.

**P5.6 Pod-lead approval.** An **Approval** tab: each pod's lead signs off their pod's part of a draft version; the sign-off is
cleared if any of the pod's cells is edited and absent on a new version. Publishing requires every pod approved **only when
`REQUIRE_POD_APPROVAL` is set** (off by default).

Schema: `Assignment.note`, `PodApproval`. No change to the scheduling or validation rules.

## How to verify

```
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm db:seed && ANTHROPIC_API_KEY= pnpm start                  # terminal 1: production build, AI key blanked
WALKTHROUGH_EXPLAIN=fallback pnpm walkthrough:p4               # terminal 2
```

## Verification output

`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` exit 0. `pnpm test`: **19 files, 243 tests passed** (was 209).
`pnpm walkthrough:p4` against the production server, from a fresh seed: `WALKTHROUGH OK`, `browser errors: 0`, 0 errors in the server
log. Output: `docs/reviews/p4/walkthrough-output.txt`. New screenshots: `19-p5-backup-recommendations`, `20-p5-backup-added`,
`21-p5-fairness`, `22-p5-version-comparison`, `23-p5-explain`, `24-p5-pod-approval` (in `docs/reviews/p4/`).

What the walkthrough asserts for P5, in the browser:

| Item | Asserted                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | Brand: Nimbus Gadgets CS reads "No backup"; one click adds Rohan Mehta as a backup; it now reads "Has backup"                                                                                           |
| 5.2  | The export links carry the current view; grid, coverage and issues answer 200, `text/csv`, a descriptive file name, and the grid has 2 lines (header + Ananya), coverage 3 (header + 2 brand-processes) |
| 5.3  | The fairness page lists 32 people with spreads, labels people with no brand open, and its CSV has 33 lines                                                                                              |
| 5.4  | The versions page compares v2 with v1 by default, and both directions work from the form                                                                                                                |
| 5.5  | Explain returns the standard explanation (key blanked), labelled as such                                                                                                                                |
| 5.6  | A new January draft shows `Approval (0/4)`; one click approves Alpha and it reads `Approval (1/4)`                                                                                                      |

### Are the new tests real? Mutation check

Each change below was made on its own, the relevant tests run, then the file restored.

| Mutation                                                      | Result                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| backup ranking ignores pod                                    | **survived my first tests**; added a case where another pod's person is less loaded; now 1 fails |
| "exposed" off by one (`<` for `<=`)                           | 3 fail                                                                                           |
| fairness stops treating a holiday Sunday as a holiday         | 3 fail                                                                                           |
| CSV formula protection removed                                | 2 fail                                                                                           |
| the AI request also sends an employee id                      | 1 fails (the test pins the exact set of keys)                                                    |
| version comparison reads the two versions the wrong way round | 1 fails                                                                                          |
| approval gate switched off                                    | 1 fails                                                                                          |
| an edit no longer clears the pod's approval                   | 1 fails                                                                                          |

## Deviations from CLAUDE.md

- **P5.6 is not "required before publish" by default.** It is built and tested both ways, but the publish gate asks for it only when
  `REQUIRE_POD_APPROVAL` is set, so the existing publish flow, its 40-odd tests and the demo are unchanged. Say if you want it on by default.
- **The side-panel tab "Who's working" is now labelled "Day"** (with that as its tooltip) to fit four tabs on one line.
- **`PodApproval` has no relation check that the approver is the pod lead.** There is no login to check against (see below).

## Known gaps / risks (also ASSUMPTIONS 57 to 62)

- **The live AI call was not exercised.** The tests inject `fetch` and pin the request (URL, headers, model, body keys); the
  walkthrough ran with the key blanked. I did not spend your key or send even fictional issue text to an outside service without
  being asked. One real call is a ten-second check once you want it.
- **The AI action costs money on a public deployment.** A per-process cap of 10 calls a minute is a guard against a runaway
  client, not cost control. **P6's passcode must guard `explainIssueAction`** (and I will make that part of the P6 test list).
- **No approver identity.** The name in an approval is recorded, not verified; the P6 session supplies a server-side display name and
  is where a "must match the pod lead" check belongs.
- **Version comparison validates both versions with today's master data**, so an older version can read as having errors it was
  not saved with (tested, ASSUMPTIONS 60). It compares plans under the same rules; it is not a snapshot of what each said.
- **An added backup is permanent** until removed in Setup (noted on the row, ASSUMPTIONS 50 and 57). It applies to the next generation
  or re-plan, not to saved rosters.
- **Fairness counts "WORK" status**, so a backup-pool person rostered to work but covering nothing counts as working a Sunday.
  They are labelled and left out of the spread, but they appear in the table.
- Mobile and a full accessibility audit are still not done (as in P4).
