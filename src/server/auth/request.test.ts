import { describe, expect, it } from "vitest";
import { clientIp, isSameOrigin } from "./request";

const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp", () => {
  it("uses the first address of x-forwarded-for (the platform sets it)", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("falls back to x-real-ip, then to a fixed bucket", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(h({}))).toBe("unknown");
  });
  it("trims and bounds what it returns (it becomes part of a hash input)", () => {
    expect(clientIp(h({ "x-forwarded-for": "  203.0.113.7  " }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "x".repeat(500) })).length).toBeLessThanOrEqual(64);
  });
});

describe("isSameOrigin (CSRF check for the cookie-setting routes)", () => {
  it("accepts an Origin whose host is the request's host", () => {
    expect(isSameOrigin(h({ origin: "https://app.example.com", host: "app.example.com" }))).toBe(
      true,
    );
  });
  it("rejects another origin, a missing Origin, and a malformed one", () => {
    expect(isSameOrigin(h({ origin: "https://evil.example", host: "app.example.com" }))).toBe(
      false,
    );
    expect(isSameOrigin(h({ host: "app.example.com" }))).toBe(false);
    expect(isSameOrigin(h({ origin: "not a url", host: "app.example.com" }))).toBe(false);
    expect(isSameOrigin(h({ origin: "null", host: "app.example.com" }))).toBe(false);
  });
  it("is not fooled by a look-alike host", () => {
    expect(
      isSameOrigin(h({ origin: "https://app.example.com.evil.io", host: "app.example.com" })),
    ).toBe(false);
  });
});
