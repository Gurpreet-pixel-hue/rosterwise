/**
 * Neon's pooled endpoint (host contains "-pooler") is PgBouncer in transaction mode, which Prisma needs told
 * about (`pgbouncer=true` turns off prepared statements). The Vercel integration's DATABASE_URL omits it, so add it
 * here. Direct and local URLs, and a URL that already sets the option, are returned unchanged.
 */
export function withPgBouncer(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.hostname.includes("-pooler") || u.searchParams.has("pgbouncer")) return url;
    u.searchParams.set("pgbouncer", "true");
    return u.toString();
  } catch {
    return url;
  }
}
