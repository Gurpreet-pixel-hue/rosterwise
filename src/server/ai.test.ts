import { describe, expect, it, vi } from "vitest";
import type { Issue } from "../engine/types";
import { AI_MODEL, aiPayloadFor, explainIssueText } from "./ai";

const issue: Issue = {
  id: "WEEKLY_OFF_NOT_GRANTED:1855a011",
  code: "WEEKLY_OFF_NOT_GRANTED",
  severity: "ERROR",
  date: "2026-11-30",
  employeeId: "emp-ananya-reddy",
  message:
    "Ananya Reddy has 0 of 1 required weekly off(s) in the week of 2026-11-30 to 2026-12-06.",
  suggestions: [
    {
      type: "REASSIGN_FROM_POD",
      description:
        "Give Ananya Reddy the weekly off on 2026-12-01 and ask Farhan Qureshi to cover.",
      edits: [],
      newWarnings: 1,
    },
    { type: "ACCEPT_GAP", description: "Accept this as it stands.", edits: [], newWarnings: 0 },
  ],
};
const DETERMINISTIC =
  "Ananya Reddy is the only person for Nimbus Gadgets, so any day off would leave it unstaffed.";

let clock = 1_000_000;
/** Each test moves the clock a minute on, so the per-minute guard never leaks between tests. */
const tick = () => (clock += 120_000);
const ok = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });

describe("AI explanation (P5.5)", () => {
  it("without a key it returns the standard explanation and never calls the network", async () => {
    const f = vi.fn();
    const r = await explainIssueText(issue, DETERMINISTIC, {
      apiKey: "",
      fetchImpl: f as unknown as typeof fetch,
      now: tick,
    });
    expect(r).toMatchObject({ source: "deterministic", text: DETERMINISTIC });
    expect(r.note).toContain("No AI key");
    expect(f).not.toHaveBeenCalled();
  });

  it("with a key it calls the Messages API once, with the key in a header, and returns the model's text", async () => {
    const f = vi.fn().mockResolvedValue(ok("  Ananya is alone on this brand.  "));
    const r = await explainIssueText(issue, DETERMINISTIC, {
      apiKey: "sk-test-123",
      fetchImpl: f as unknown as typeof fetch,
      now: tick,
    });
    expect(r).toEqual({ source: "ai", text: "Ananya is alone on this brand." });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test-123");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(AI_MODEL);
    expect(AI_MODEL).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBeLessThanOrEqual(400);
    expect(body.system).toContain("ONLY the facts");
  });

  it("sends only the issue's own fields: nothing about anyone or anything else, and the key never enters the body", async () => {
    const f = vi.fn().mockResolvedValue(ok("ok"));
    await explainIssueText(issue, DETERMINISTIC, {
      apiKey: "sk-secret-key",
      fetchImpl: f as unknown as typeof fetch,
      now: tick,
    });
    const sent = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    const user = JSON.parse(sent.messages[0].content);
    expect(Object.keys(user).sort()).toEqual([
      "code",
      "date",
      "engineExplanation",
      "message",
      "severity",
      "suggestions",
    ]);
    expect(user).toEqual(aiPayloadFor(issue, DETERMINISTIC));
    expect(sent.messages).toHaveLength(1);
    const whole = JSON.stringify(sent);
    expect(whole).not.toContain("sk-secret-key");
    expect(whole).not.toContain("emp-ananya-reddy"); // internal ids stay home
    expect(whole).not.toContain("Kabir"); // nobody else's data
    expect(Object.keys(user.suggestions[0]).sort()).toEqual(["description", "type"]); // no edits, no ids
  });

  it("falls back to the standard text, with a reason, on an HTTP error, a network error, a timeout and an empty answer", async () => {
    const cases: Array<[string, typeof fetch, RegExp]> = [
      [
        "HTTP 529",
        (async () => new Response("overloaded", { status: 529 })) as typeof fetch,
        /529/,
      ],
      [
        "network error",
        (async () => {
          throw new TypeError("fetch failed");
        }) as typeof fetch,
        /could not be reached/,
      ],
      [
        "empty content",
        (async () =>
          new Response(JSON.stringify({ content: [] }), { status: 200 })) as typeof fetch,
        /nothing usable/,
      ],
      [
        "not JSON",
        (async () => new Response("<html>", { status: 200 })) as typeof fetch,
        /could not be reached/,
      ],
    ];
    for (const [name, fetchImpl, note] of cases) {
      const r = await explainIssueText(issue, DETERMINISTIC, { apiKey: "k", fetchImpl, now: tick });
      expect(r.source, name).toBe("deterministic");
      expect(r.text, name).toBe(DETERMINISTIC);
      expect(r.note, name).toMatch(note);
    }
    // a request that never answers is aborted after the timeout
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal!.addEventListener("abort", () =>
          rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      })) as unknown as typeof fetch;
    const t = await explainIssueText(issue, DETERMINISTIC, {
      apiKey: "k",
      fetchImpl: hang,
      now: tick,
      timeoutMs: 20,
    });
    expect(t.source).toBe("deterministic");
    expect(t.note).toMatch(/too long/);
  });

  it("stops calling out after 10 requests inside one minute", async () => {
    const f = vi.fn().mockImplementation(async () => ok("fine"));
    const base = tick();
    const results = [];
    for (let i = 0; i < 12; i++)
      results.push(
        await explainIssueText(issue, DETERMINISTIC, {
          apiKey: "k",
          fetchImpl: f as unknown as typeof fetch,
          now: () => base + i * 100,
        }),
      );
    expect(results.filter((r) => r.source === "ai")).toHaveLength(10);
    expect(
      results.slice(10).every((r) => r.source === "deterministic" && /Too many/.test(r.note ?? "")),
    ).toBe(true);
    expect(f).toHaveBeenCalledTimes(10);
  });
});
