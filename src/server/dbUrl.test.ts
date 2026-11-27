import { describe, expect, it } from "vitest";
import { withPgBouncer } from "./dbUrl";

describe("withPgBouncer", () => {
  it("adds pgbouncer=true to a Neon pooled URL (Prisma needs it behind PgBouncer)", () => {
    const out = new URL(
      withPgBouncer(
        "postgresql://u:p@ep-x-pooler.c-16.us-east-1.aws.neon.tech/neondb?sslmode=require",
      )!,
    );
    expect(out.searchParams.get("pgbouncer")).toBe("true");
    expect(out.searchParams.get("sslmode")).toBe("require");
    expect(out.username).toBe("u");
    expect(out.password).toBe("p");
  });

  it("leaves a direct URL, a local URL and an already-set option alone", () => {
    for (const u of [
      "postgresql://u:p@ep-x.c-16.us-east-1.aws.neon.tech/neondb?sslmode=require",
      "postgresql://u:p@localhost:5432/rosterwise?schema=public",
      "postgresql://u:p@ep-x-pooler.aws.neon.tech/neondb?pgbouncer=false",
    ])
      expect(withPgBouncer(u)).toBe(u);
  });

  it("passes through undefined and unparseable values unchanged", () => {
    expect(withPgBouncer(undefined)).toBeUndefined();
    expect(withPgBouncer("not a url")).toBe("not a url");
  });
});
