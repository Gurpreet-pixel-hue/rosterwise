import { buildCtx } from "./ctx";
import { attachSuggestions } from "./suggest";
import { RosterState, computeCompOffEarned } from "./state";
import type { CompOffEarned, EngineInput, Issue, RosterDraft } from "./types";
import { validateRoster } from "./validate";

/** validateRoster() plus ranked, pre-validated suggestions attached to the issues that can use them. */
export function analyzeRoster(input: EngineInput, draft: RosterDraft): Issue[] {
  return attachSuggestions(input, draft, validateRoster(input, draft));
}

/** Comp-off credits a roster earns (working a public holiday inside the month), derived from its entries. */
export function compOffEarnedFor(input: EngineInput, draft: RosterDraft): CompOffEarned[] {
  const ctx = buildCtx(input);
  return computeCompOffEarned(ctx, RosterState.fromDraft(ctx, draft));
}
