// AI explanation of one issue (CLAUDE.md P5.5). Optional, and never required: with no ANTHROPIC_API_KEY, or if the
// call fails for any reason, the caller gets the engine's deterministic explanation (explain.ts), labelled as such.
//
// Privacy: the request contains ONLY the issue's own fields (its code, severity, date, message, the engine's
// explanation and the descriptions of its suggestions). No roster, no other employees, no leave records, no
// contact details. The model is told to use only those facts. The call goes out from the server; the key is never
// sent to the browser.
import type { Issue } from "../engine/types";

export const AI_MODEL = "claude-sonnet-5-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const TIMEOUT_MS = 15_000;
const MAX_WINDOW = 10; // calls per minute per server process: a guard against a runaway client, not real quota control

export interface ExplainResult {
  text: string;
  /** "ai" when the model wrote it; "deterministic" for the engine's own explanation. */
  source: "ai" | "deterministic";
  /** Why the deterministic text was used, when it was. */
  note?: string;
}

/** Exactly what leaves the server. Kept in one place so it can be reviewed and tested. */
export function aiPayloadFor(issue: Issue, deterministic: string) {
  return {
    code: issue.code,
    severity: issue.severity,
    date: issue.date ?? null,
    message: issue.message,
    engineExplanation: deterministic,
    suggestions: issue.suggestions.map((s) => ({ type: s.type, description: s.description })),
  };
}

const SYSTEM = [
  "You explain a staff-scheduling conflict to an operations manager in plain language.",
  "Use ONLY the facts in the JSON the user sends. Do not invent names, dates, numbers or rules.",
  "In 3 to 5 short sentences say: what is wrong, why the roster could not avoid it, and which suggestion you would try first and why.",
  "Do not use markdown, headings or bullet points.",
].join(" ");

const recent: number[] = [];
function underRateLimit(now: number): boolean {
  while (recent.length > 0 && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= MAX_WINDOW) return false;
  recent.push(now);
  return true;
}

export interface ExplainOptions {
  apiKey?: string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export async function explainIssueText(
  issue: Issue,
  deterministic: string,
  opts: ExplainOptions = {},
): Promise<ExplainResult> {
  const fallback = (note: string): ExplainResult => ({
    text: deterministic,
    source: "deterministic",
    note,
  });
  const key = (opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!key) return fallback("No AI key is configured, so this is the standard explanation.");
  if (!underRateLimit((opts.now ?? Date.now)()))
    return fallback("Too many AI requests a minute: showing the standard explanation.");

  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(aiPayloadFor(issue, deterministic)) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok)
      return fallback(`The AI service answered ${res.status}: showing the standard explanation.`);
    const body = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (body.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!.trim())
      .join(" ")
      .trim();
    if (!text)
      return fallback("The AI service returned nothing usable: showing the standard explanation.");
    return { text, source: "ai" };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return fallback(
      aborted
        ? "The AI service took too long: showing the standard explanation."
        : "The AI service could not be reached: showing the standard explanation.",
    );
  } finally {
    clearTimeout(timer);
  }
}
