// Response headers for every route (wired in next.config.ts).
//
// Known trade-off: script-src keeps 'unsafe-inline' because Next.js emits inline bootstrap scripts and a
// nonce-based policy needs middleware that forces every route dynamic. The app renders no user-supplied HTML
// (React escapes all text), so the remaining CSP directives (framing, forms, connections, base, objects) are
// the ones doing the work. Revisit with nonces if the app ever renders rich text.
export interface HeaderKV {
  key: string;
  value: string;
}

export function securityHeaders(isDev: boolean): HeaderKV[] {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const headers: HeaderKV[] = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ];
  if (!isDev)
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  return headers;
}
