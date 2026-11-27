// CSV writing (RFC 4180) with protection against spreadsheet formula injection: a cell that starts with = + - @
// (or a tab or carriage return) is prefixed with an apostrophe so Excel and Sheets read it as text, not a formula.
const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  // negative numbers are numbers, not formulas
  if (typeof value !== "number" && FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
