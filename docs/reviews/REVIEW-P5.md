# Review: P5 Optional features. Verdict: PASS

All six optional features shipped in the CLAUDE.md order, and the four P4 notes are done first. Each feature
reuses the shared engine paths rather than building a second one. Backups and fairness are pure engine modules.
Version comparison reuses `diffRosters` and `validateRoster`. The approval clear sits in `editCells`, which is
the only path that writes cells. The AI call falls back to `explain.ts` on every failure path. No scheduling or
validation rule changed. The mutation table is real evidence: it found a weak backup-ranking test, and the
Executor fixed it (5bd7309).

## Verified (independently)

- `lint`, `format:check`, `typecheck` exit 0. `test`: **19 files, 243/243**. `build`: 10 routes, including
  `/export`, `/fairness` and `/versions`.
- **I ran the walkthrough myself.** I ran `db:push && db:seed`, then `ANTHROPIC_API_KEY= pnpm start` (production
  build), then `WALKTHROUGH_EXPLAIN=fallback pnpm walkthrough:p4`. Result: `WALKTHROUGH OK`, `browser errors: 0`,
  and no errors in the server log. Every P5 line asserted: Nimbus CS exposed → Rohan added → "Has backup";
  CSV grid 2 / coverage 3 / issues 13 lines; fairness 32 people, CSV 33 lines; v1↔v2 compared both ways;
  Explain gave a labelled standard explanation; Approval (0/4) → (1/4). Afterwards I restored the committed
  screenshots and output.
- **Hostile inputs against the running server:** `what=evil` → 400. A 101-character `value` → 400. An unknown
  filter value falls back to the first choice, as the page does. A month with no roster → 404 with a clear
  message. `versions?from=99999` → the page shows "Invalid comparison: … <=10000" with no 500. `from=to` → 200.
- **Code read:** `ai.ts` (`aiPayloadFor` holds the exact keys, the key is in a header and never in the body, the
  timeout aborts, an empty answer falls back), `csv.ts` (RFC 4180, formula prefix, numbers exempt),
  `exportFileName` (slugged, no header injection), `backup.ts`, `fairness.ts` (a holiday Sunday counts as a
  holiday, and eligibility uses non-holiday Sundays only), `approval.ts` (row lock + draft + latest checks, both
  audited), the publish gate (inside the locked transaction, only pods with active members count), and the
  `editCells` clear (only the edited pods, audited).
- Screenshots 19 and 21 read: the backup panel ranks same-pod first with reasons, and the fairness page shows
  people outside the comparison greyed out and labelled.

## Notes (non-blocking; fold into P6)

1. **The P6 passcode guard must cover every server action, not just the old ones.** That means
   `explainIssueAction` (costs money once a key is set), `approvePodAction`, `revokePodApprovalAction`, and the
   setup `createRecordAction` used by "Add as backup". Add one test that lists every exported action and asserts
   each one refuses without the session, so a future action can't skip the guard. `/export` and the GET pages stay
   public (read-only), which is correct.
2. **Approvals are all recorded as `"manager"`** (`ACTOR` in `approval-panel.tsx`), so the panel's "approved by"
   doesn't name the lead. This is disclosed, and it's acceptable while there is no login. In P6, take the
   display name from the session, or label it "recorded by manager" so the UI makes no claim the data can't back.
3. **The fairness report shows a real engine weakness, so own it in the README.** In December, 16 of the 27
   people who can be asked to work Sundays get no weekly off on a Sunday in the month, and many of them work all 3 Sundays. January is worse: only 6
   such people get one. Most
   weekly offs land on weekdays, where coverage is easiest. That is what CLAUDE.md §4 step 6's "+fairness"
   term was meant to prevent. Don't change the engine now. The report doing its job is the right outcome. But the
   README "How I think" answers (limits / trade-offs) should say so plainly, with the number. Expect an evaluator
   to spot it in the demo.
4. **Backup panel copy:** "It applies to the next roster you generate or re-plan" is half right. Saved cells
   don't change. But the validator and suggestions use today's master data, so the new backup appears right away
   as a `USE_BACKUP` suggestion on existing gaps in the saved draft. That's a good thing for the demo, so say it
   ("…and is offered as a USE_BACKUP suggestion on this roster's gaps").
5. The `ai.ts` header comment says "No … other employees", but suggestion descriptions do name the suggested
   backup. That's needed and fictional, so it's fine. Just make the comment say what's actually sent.
6. **`REQUIRE_POD_APPROVAL` off by default: accepted.** CLAUDE.md lists it as optional ("simple approval"), and
   keeping the demo publish flow unchanged is the right call. Mention the flag in the README.
7. The one real AI call can wait for P6, after the Owner says yes. Do it once against the deployed app with the
   key set, and paste the result (source `"ai"`) into the P6 request.

## Gate

PASS. Push `main` and confirm CI is green. Then start P6. Its order (passcode lock, then deploy, then the
locked/unlocked smoke test, docs and `pnpm metrics`) stays as written in CLAUDE.md, including note 4 from P4
(a walkthrough smoke run against the public URL).
