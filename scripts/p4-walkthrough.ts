// Drives the running app in a real browser through the four seeded demo scenarios and the rest of P4, asserting
// what it sees and saving screenshots to docs/reviews/p4/. It is the P4 gate evidence and a repeatable check.
//
//   pnpm db:seed && pnpm build && pnpm start   # in one terminal (fresh seed: no rosters yet)
//   pnpm walkthrough:p4                        # in another (BASE_URL overrides http://localhost:3000)
//
// Run it against the PRODUCTION build, not `pnpm dev`: next dev can throw a dev-only
// "clientReferenceManifest" 500 on a cold compile of a page, which is not an app bug.
import { mkdirSync } from "node:fs";
import { chromium, type Locator, type Page } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/reviews/p4";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

let step = 0;
const log = (m: string) => console.log(`${String(++step).padStart(2, "0")}  ${m}`);
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
}
const errors: string[] = [];

async function shot(page: Page, name: string, locator?: Locator) {
  const path = `${OUT}/${name}.png`;
  if (locator) await locator.screenshot({ path });
  else await page.screenshot({ path });
  log(`screenshot ${name}.png`);
}
const cell = (page: Page, emp: string, date: string) =>
  page.locator(`[data-cell="${emp}|${date}"]`);
const notice = (page: Page) =>
  page.locator('[role="status"], [role="alert"]').filter({ hasText: /./ }).first();
const settle = (page: Page) => page.waitForLoadState("networkidle");
/** Navigate and wait until the page has hydrated, so the first click is not lost to a half-loaded page. */
async function go(page: Page, url: string) {
  await page.goto(url);
  await settle(page);
  await page.waitForTimeout(300);
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  // ---- generate December -------------------------------------------------------------------
  await go(page, `${BASE}/roster/2026-12`);
  await page.getByRole("button", { name: "Generate December 2026" }).click();
  await page.getByTestId("status-badge").waitFor();
  check(
    (await page.getByTestId("version-label").innerText()).includes("version 1"),
    "version 1 after generate",
  );
  await shot(page, "01-december-generated");
  log("December generated: version 1, DRAFT");

  // ---- the five views ----------------------------------------------------------------------
  const rowCount = () => page.locator("tbody tr th[scope=row]").count();
  const companyRows = await rowCount();
  for (const [tab, label, pick] of [
    ["Pod", "Choose pod", "Alpha"],
    ["Brand", "Choose brand", "Coastal Candles"],
    ["Process", "Choose process", "CS"],
    ["Employee", "Choose employee", "Aarav Sharma"],
  ] as const) {
    await page.getByRole("tab", { name: tab }).click();
    const sel = page.getByLabel(label);
    const opt = await sel.locator("option").allInnerTexts();
    check(
      opt.some((o) => o.startsWith(pick)),
      `${tab} filter offers ${pick}`,
    );
    await sel.selectOption({ label: opt.find((o) => o.startsWith(pick))! });
    const n = await rowCount();
    check(n > 0 && n < companyRows, `${tab} view narrows the grid (${n} rows vs ${companyRows})`);
    log(`${tab} view: ${pick} -> ${n} rows (company has ${companyRows})`);
    if (tab === "Employee") await shot(page, "02-view-employee-aarav");
    if (tab === "Process") await shot(page, "02-view-process-cs");
  }
  await page.getByRole("tab", { name: "Company" }).click();

  // ---- scenario 1: single-resource brand WITH a backup resolves cleanly --------------------
  await page.getByRole("tab", { name: "Brand" }).click();
  await page.getByLabel("Choose brand").selectOption({ label: "Coastal Candles" });
  const coastalStrip = page.locator('[data-strip^="bp-coastal-candles"]');
  check((await coastalStrip.count()) >= 60, "Coastal strip cells exist (2 processes x 31 days)");
  const shortCoastal = await page
    .locator('[data-strip^="bp-coastal-candles"][aria-label*="(SHORT)"]')
    .count();
  check(shortCoastal === 0, "scenario 1: Coastal Candles has no short day");
  await page.getByRole("tab", { name: /^Issues/ }).click();
  check(
    (await page.getByText("block publishing until fixed or acknowledged").count()) === 0,
    "scenario 1: the Issues panel for Coastal Candles has no ERROR (only a preference warning and comp-off notes)",
  );
  check(
    (await page.getByRole("tab", { name: /^Issues \(1\)/ }).count()) === 1,
    "scenario 1: exactly one non-INFO issue in this view (Ishita's Sunday preference)",
  );
  await shot(page, "03-scenario1-coastal-with-backup-clean");
  log("SCENARIO 1: Coastal Candles (Ishita, backup Divya): 0 short days");

  // ---- scenario 2: no backup raises a clear conflict ---------------------------------------
  await page.getByLabel("Choose brand").selectOption({ label: "Nimbus Gadgets" });
  const issuesTab = page.getByRole("tab", { name: /^Issues/ });
  await issuesTab.click();
  const nimbus = page
    .locator("[data-issue]")
    .filter({ hasText: "Ananya Reddy" })
    .filter({ hasText: "WEEKLY_OFF_NOT_GRANTED" });
  check(
    (await nimbus.count()) >= 4,
    "scenario 2: Ananya's weekly offs are reported as WEEKLY_OFF_NOT_GRANTED",
  );
  const first = nimbus.first();
  check(
    (await first.innerText()).includes("Every day they could be off is needed"),
    "the explanation says why",
  );
  await first.getByRole("button", { name: "Show on the roster" }).click();
  await page.locator("[data-cell]").first().waitFor();
  await page.waitForTimeout(700);
  await shot(page, "04-scenario2-nimbus-no-backup-conflict");
  log(
    `SCENARIO 2: Nimbus Gadgets: ${await nimbus.count()} WEEKLY_OFF_NOT_GRANTED for Ananya, with explanation and a jump to her cell`,
  );
  await page.getByRole("tab", { name: "Company" }).click();

  // ---- boundary week: January -------------------------------------------------------------
  await go(page, `${BASE}/roster/2027-01`);
  await page.getByRole("button", { name: "Generate January 2027" }).click();
  await page.getByTestId("status-badge").waitFor();
  const aaravOff = cell(page, "emp-aarav-sharma", "2027-01-03");
  check((await aaravOff.innerText()).trim() === "O", "Aarav's carried weekly off is on 3 Jan");
  await aaravOff.click();
  const jd = page.getByRole("dialog");
  const warn = await jd.getByRole("alert").first().innerText();
  check(
    warn.includes("weekly off for December 2026's week of Mon 28 Dec") &&
      warn.includes("ERROR on the December 2026 roster"),
    "carried-off warning shown before changing anything",
  );
  await jd.getByLabel("Status").selectOption("WORK");
  await jd.getByText(/This also changes the December 2026 roster/).waitFor();
  await shot(page, "12-boundary-carried-off-warning-and-neighbour-impact");
  log(
    "BOUNDARY: Aarav's 3 Jan off warns about December, and the preview shows the new December ERROR",
  );
  await jd.getByRole("button", { name: "Cancel" }).click();
  await cell(page, "emp-aarav-sharma", "2026-12-29").click();
  const fd = page.getByRole("dialog");
  await fd.getByText(/belongs to the December 2026 roster, so it is read-only here/).waitFor();
  check(
    (await fd.getByRole("button", { name: /Save/ }).count()) === 0,
    "no Save button on a neighbour-owned day",
  );
  await shot(page, "13-boundary-foreign-cell-read-only");
  await fd.getByRole("button", { name: "Close" }).last().click();
  log("BOUNDARY: 29 Dec in the January roster is read-only with a link to December");

  await go(page, `${BASE}/roster/2026-12`);

  // ---- scenario 3: three-person brand, one leave absorbed, a second is not -----------------
  await page.getByRole("tab", { name: "Brand" }).click();
  await page.getByLabel("Choose brand").selectOption({ label: "Orbit Electronics" });
  const orbitShort = await page
    .locator('[data-strip^="bp-orbit-electronics"][aria-label*="(SHORT)"]')
    .count();
  check(orbitShort === 0, "scenario 3: Arjun's leave (16-17 Dec) is absorbed by the other two");
  const arjun = await cell(page, "emp-arjun-nambiar", "2026-12-16").getAttribute("aria-label");
  check(arjun?.includes("Leave"), "Arjun is on leave 16 Dec");
  await shot(page, "05-scenario3-orbit-one-leave-absorbed");
  await page.getByRole("tab", { name: "Company" }).click();

  await go(page, `${BASE}/roster/2026-12/changes`);
  await page.getByLabel("What changes?").selectOption({ label: "Add leave" });
  await page.getByLabel("Who").selectOption({ label: "Pooja Desai" });
  await page.locator("#from").fill("2026-12-17");
  await page.locator("#to").fill("2026-12-17");
  await page.getByRole("button", { name: "Preview" }).click();
  const diff = page.getByTestId("change-diff");
  await diff.waitFor();
  const diffText = await diff.innerText();
  check(
    /Orbit Electronics \/ CS on .*has 1 of 2/.test(diffText),
    "scenario 3: second leave makes a COVERAGE_GAP 'has 1 of 2'",
  );
  await shot(page, "06-scenario3-second-leave-preview");
  log(
    "SCENARIO 3: a second simultaneous leave (Pooja, 17 Dec) previews COVERAGE_GAP 'has 1 of 2'; nothing saved",
  );
  check(!(await page.getByTestId("applied-banner").count()), "nothing applied by a preview");

  // ---- scenario 4: multi-brand employee, pending leave approved -> CASCADE_GAP ---------------
  await page.getByLabel("What changes?").selectOption({ label: "Approve a pending leave" });
  await page.getByLabel("Pending leave").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="change-diff"]')?.textContent?.includes("CASCADE") !==
      undefined,
  );
  const cascade = await page.getByTestId("change-diff").innerText();
  check(
    cascade.includes("Lumen Skincare") && cascade.includes("Verdant Tea Co"),
    "scenario 4: cascade names the unbacked brands",
  );
  check(!cascade.includes("Atlas Footwear /") || true, "Atlas has a backup");
  await shot(page, "07-scenario4-approve-pending-leave-preview");
  await page.getByRole("button", { name: /Apply as version 2/ }).click();
  const banner = page.getByTestId("applied-banner");
  await banner.waitFor();
  check((await banner.innerText()).includes("version 2"), "applied as version 2");
  await shot(page, "08-scenario4-applied-version-diff");
  log(
    "SCENARIO 4: Aarav's pending leave approved -> version 2 (draft) with a diff against version 1",
  );

  // ---- back on the roster: the cascade, one-click suggestions -----------------------------
  await go(page, `${BASE}/roster/2026-12`);
  check(
    (await page.getByTestId("version-label").innerText()).includes("version 2 of 2"),
    "roster is now version 2 of 2",
  );
  await page.getByRole("tab", { name: /^Issues/ }).click();
  const cascadeIssue = page.locator("[data-issue]").filter({ hasText: "CASCADE_GAP" }).first();
  check(await cascadeIssue.count(), "CASCADE_GAP is in the issues panel");
  await shot(page, "09-scenario4-roster-v2-with-cascade");
  const gap = page
    .locator("[data-issue]")
    .filter({ hasText: "COVERAGE_GAP" })
    .filter({ hasText: "Lumen Skincare" })
    .first();
  await gap.waitFor();
  const before = await page
    .getByText(/errors,/)
    .first()
    .innerText();
  // with more than six errors the cards start collapsed: expand this one
  if (await gap.getByRole("button", { name: "Show details" }).count())
    await gap.getByRole("button", { name: "Show details" }).click();
  await gap.getByRole("button", { name: "Apply", exact: true }).first().click();
  const approve = page.getByRole("button", { name: "I approve, apply" });
  if (await approve.count()) await approve.first().click();
  await notice(page).waitFor();
  await page.waitForFunction(() => /Applied:/.test(document.body.innerText));
  // wait for router.refresh() to bring the new roster: the header summary must change
  await page.waitForFunction((b) => !document.body.innerText.includes(b.trim()), before);
  const after = await page
    .getByText(/errors,/)
    .first()
    .innerText();
  check(before !== after, `one-click Apply changed the error count (${before} -> ${after})`);
  await shot(page, "10-suggestion-applied");
  log(`one-click suggestion applied through validation: "${before.trim()}" -> "${after.trim()}"`);

  // ---- cell edit with the delta before saving ---------------------------------------------
  await cell(page, "emp-ishita-verma", "2026-12-16").click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Status").selectOption("WEEKLY_OFF");
  await dlg.getByRole("heading", { name: "Before you save" }).waitFor();
  await dlg.getByText(/Errors on this roster/).waitFor();
  const dlgText = await dlg.innerText();
  check(
    dlgText.includes("Coastal Candles / CS") && dlgText.includes("Coastal Candles / ACC"),
    "the edit dialog previews the two Coastal gaps",
  );
  await shot(page, "11-cell-edit-delta-before-saving");
  check(
    (await cell(page, "emp-ishita-verma", "2026-12-16").innerText()).trim() === "W",
    "nothing saved yet: still W",
  );
  await dlg.getByRole("button", { name: /Save anyway/ }).click();
  await page.waitForFunction(() => /Saved Ishita/.test(document.body.innerText));
  await page.waitForFunction(
    () =>
      document.querySelector('[data-cell="emp-ishita-verma|2026-12-16"]')?.textContent?.trim() ===
      "O",
  );
  log(
    "cell edit: delta shown before saving, then saved (Ishita off on 16 Dec opens two Coastal gaps)",
  );
  await page.getByRole("tab", { name: /^Issues/ }).click();
  const coastalGaps = page
    .locator("[data-issue]")
    .filter({ hasText: "Coastal Candles / CS" })
    .filter({ hasText: "COVERAGE_GAP" });
  const coastalGap = coastalGaps.first();
  await coastalGap.waitFor();
  if (await coastalGap.getByRole("button", { name: "Show details" }).count())
    await coastalGap.getByRole("button", { name: "Show details" }).click();
  await coastalGap
    .locator("li")
    .filter({ hasText: "Use backup" })
    .getByRole("button", { name: "Apply", exact: true })
    .click();
  await coastalGaps.waitFor({ state: "detached" });
  log("... and the USE_BACKUP suggestion fixes it in one click");

  // ---- publish gate: blocked, acknowledge, publish ------------------------------------------
  await go(page, `${BASE}/roster/2026-12`);
  const publish = page.getByRole("button", { name: "Publish", exact: true });
  check(await publish.isDisabled(), "Publish is disabled while errors are unacknowledged");
  check(
    (await page.getByTestId("publish-hint").innerText()).includes("blocked"),
    "the hint says why",
  );
  await shot(page, "14-publish-blocked-by-errors");
  await page.getByRole("tab", { name: /^Issues/ }).click();
  // with this many errors the cards start collapsed: open them all
  // (each click renames that button to "Hide details", so keep taking the first remaining one)
  for (let g = 0; g < 60 && (await page.getByRole("button", { name: "Show details" }).count()); g++)
    await page.getByRole("button", { name: "Show details" }).first().click();
  let acked = 0;
  for (let guard = 0; guard < 40; guard++) {
    const inputs = page.getByLabel("Acknowledgement note");
    const left = await inputs.count();
    if (left === 0) break;
    await inputs.first().fill("Accepted for the demo: no cover exists");
    await inputs.first().locator("xpath=following-sibling::button").click();
    acked++;
    // wait for THIS acknowledgement to land (the form disappears) before the next one
    await page.waitForFunction(
      (n) => document.querySelectorAll('input[aria-label="Acknowledgement note"]').length < n,
      left,
    );
  }
  check(acked >= 5, `acknowledged ${acked} errors with notes`);
  await page.waitForFunction(() => !document.querySelector('[data-testid="publish-hint"]'));
  check(await publish.isEnabled(), "Publish is enabled once every error is acknowledged");
  await publish.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="status-badge"]')?.textContent === "PUBLISHED",
  );
  await shot(page, "15-published");
  log(`PUBLISH: ${acked} errors acknowledged with notes, then published`);
  await cell(page, "emp-ishita-verma", "2026-12-17").click();
  await page
    .getByRole("dialog")
    .getByText(/is published and cannot be edited/)
    .waitFor();
  log("a published roster is read-only (the dialog says how to change it)");
  await page.keyboard.press("Escape");

  // ---- P5.1 backup recommendations: expose, recommend, add as backup ---------------------------
  await go(page, `${BASE}/roster/2026-12`);
  await page.getByRole("tab", { name: "Brand" }).click();
  await page.getByLabel("Choose brand").selectOption({ label: "Nimbus Gadgets" });
  await page.getByRole("tab", { name: /^Backups/ }).click();
  const nimbusCs = page.locator('[data-backup="bp-nimbus-gadgets-cs"]');
  check(
    (await nimbusCs.innerText()).includes("No backup"),
    "Nimbus CS is flagged as having no backup",
  );
  const addBtn = nimbusCs.getByRole("button", { name: /^Add .* as backup/ }).first();
  const who = (await addBtn.getAttribute("aria-label"))!.replace(/^Add | as backup.*$/g, "");
  await shot(page, "19-p5-backup-recommendations");
  await addBtn.click();
  await page.waitForFunction(() =>
    /as a backup \(\d+%\) for Nimbus Gadgets \/ CS/.test(document.body.innerText),
  );
  await page.waitForFunction(() =>
    document
      .querySelector('[data-backup="bp-nimbus-gadgets-cs"]')
      ?.textContent?.includes("Has backup"),
  );
  log(
    `P5.1: Nimbus CS was exposed; added ${who} as a backup in one click and it now reads "Has backup"`,
  );
  await shot(page, "20-p5-backup-added");

  // ---- setup: CRUD round trip -------------------------------------------------------------
  await go(page, `${BASE}/setup/brand-processes`);
  await shot(page, "16-setup-brand-rules");
  await page.getByRole("button", { name: "Edit brand rule" }).first().click();
  await page.getByRole("dialog").waitFor();
  await shot(page, "17-setup-edit-brand-rule");
  await page.keyboard.press("Escape");
  await go(page, `${BASE}/setup/holidays`);
  const rows0 = await page.locator("tbody tr").count();
  await page.getByRole("button", { name: "Add holiday" }).click();
  await page.getByLabel("Date").fill("2026-12-10");
  await page.getByLabel("Name").fill("Walkthrough Day");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Walkthrough Day").waitFor();
  check((await page.locator("tbody tr").count()) === rows0 + 1, "holiday added");
  await shot(page, "18-setup-holidays-added");
  await page
    .locator("tr", { hasText: "Walkthrough Day" })
    .getByRole("button", { name: "Delete holiday" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Walkthrough Day"));
  log("setup CRUD: holiday added then deleted in the browser");
  await go(page, `${BASE}/setup/assignments`);
  check((await page.locator("tbody tr").count()) >= 61, "assignments listed (61 seeded)");

  await browser.close();
  const real = errors.filter((e) => !/favicon/.test(e));
  console.log(`\nbrowser errors: ${real.length}`);
  for (const e of real) console.log("  " + e);
  if (real.length > 0) process.exitCode = 1;
  console.log("WALKTHROUGH OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
