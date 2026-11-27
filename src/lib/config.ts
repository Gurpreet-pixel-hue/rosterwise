/** The month the demo opens on (the seed covers December 2026 and January 2027). */
export const DEMO_MONTH = "2026-12";

export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/**
 * The demo's fixed "today" (the seed is written for late November 2026), so December and January stay in the
 * future however late someone opens the demo. Dates before it count as history when a change re-plans a month.
 */
export const DEMO_TODAY = "2026-11-27";
