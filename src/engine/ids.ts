/** FNV-1a 32-bit hash as 8 hex chars. Deterministic and dependency-free (the engine does no I/O). */
export function hash32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Stable issue id: the same code + entity + date always gives the same id, across versions. */
export function issueId(
  code: string,
  parts: { employeeId?: string; brandProcessId?: string; date?: string },
): string {
  return `${code}:${hash32(`${code}|${parts.employeeId ?? ""}|${parts.brandProcessId ?? ""}|${parts.date ?? ""}`)}`;
}
