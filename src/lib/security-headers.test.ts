import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

const get = (dev: boolean, key: string) =>
  securityHeaders(dev).find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

describe("securityHeaders", () => {
  it("sets the four headers the Owner ruling asks for", () => {
    expect(get(false, "X-Frame-Options")).toBe("DENY");
    expect(get(false, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(false, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get(false, "Content-Security-Policy")).toBeTruthy();
  });

  it("CSP blocks framing, plugins, foreign form targets and a rewritten <base>", () => {
    const csp = get(false, "Content-Security-Policy")!;
    for (const d of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "connect-src 'self'",
    ])
      expect(csp).toContain(d);
  });

  it("production CSP does not allow eval; development does (React refresh needs it)", () => {
    expect(get(false, "Content-Security-Policy")).not.toContain("unsafe-eval");
    expect(get(true, "Content-Security-Policy")).toContain("'unsafe-eval'");
  });

  it("production sends HSTS, development does not (it would stick to localhost)", () => {
    expect(get(false, "Strict-Transport-Security")).toMatch(/max-age=\d+/);
    expect(get(true, "Strict-Transport-Security")).toBeUndefined();
  });

  it("turns off powerful browser features the app never uses", () => {
    expect(get(false, "Permissions-Policy")).toContain("camera=()");
    expect(get(false, "Permissions-Policy")).toContain("geolocation=()");
  });
});
