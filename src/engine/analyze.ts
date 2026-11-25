import { attachSuggestions } from "./suggest";
import type { EngineInput, Issue, RosterDraft } from "./types";
import { validateRoster } from "./validate";

/** validateRoster() plus ranked, pre-validated suggestions attached to the issues that can use them. */
export function analyzeRoster(input: EngineInput, draft: RosterDraft): Issue[] {
  return attachSuggestions(input, draft, validateRoster(input, draft));
}
