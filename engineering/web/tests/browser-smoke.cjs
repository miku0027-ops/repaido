/* Run against the local engineering service, never against production.
 * PLAYWRIGHT_MODULE may point to the managed environment's installed Playwright.
 * BROWSER_EXECUTABLE may select its installed Chromium. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const base = process.env.ENGINEERING_TEST_URL || "http://127.0.0.1:8010";
  assert(
    ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
    "Only local smoke tests are allowed.",
  );
  const artifacts =
    process.env.TEST_ARTIFACTS || path.resolve(__dirname, "../../test-results");
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === base
        ? route.continue()
        : route.abort(),
    );
    await page.goto(base);
    await page.getByText("Live data disconnected", { exact: true }).waitFor();
    await page.locator(".system-node").first().waitFor();
    await page.screenshot({ path: path.join(artifacts, "overview.png") });
    await page
      .locator(".system-node")
      .filter({ hasText: "repaido-api" })
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("button", { name: "connections", exact: true })
      .click();
    assert((await page.locator(".connection").count()) > 0);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Application", exact: true })
      .click();
    await page.getByRole("button", { name: "LLD", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Find a service, API or collection" })
      .fill("/operations/local-business/policy");
    await page.locator(".system-node").first().waitFor();
    await page.locator(".system-node").first().click();
    await page.getByRole("button", { name: "code", exact: true }).click();
    await page.locator("pre").waitFor();
    assert.match(await page.locator("pre").textContent(), /def policy/);
    await page.screenshot({ path: path.join(artifacts, "source.png") });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Data coverage", exact: true })
      .click();
    // Test-only, same-origin audit script; the real CSP remains enforced.
    await page.route("**/assets/axe-check.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"),
      }),
    );
    await page.addScriptTag({ url: "/assets/axe-check.js" });
    const audit = () =>
      page.evaluate(() =>
        axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag2aaa"] },
        }),
      );
    const desktop = await audit();
    fs.writeFileSync(
      path.join(artifacts, "accessibility-desktop.json"),
      JSON.stringify(desktop.violations, null, 2),
    );
    assert.deepEqual(
      desktop.violations.map((v) => v.id),
      [],
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: path.join(artifacts, "mobile.png") });
    await page
      .getByRole("button", { name: "System overview", exact: true })
      .click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const mobile = await audit();
    fs.writeFileSync(
      path.join(artifacts, "accessibility-mobile.json"),
      JSON.stringify(mobile.violations, null, 2),
    );
    assert.deepEqual(
      mobile.violations.map((v) => v.id),
      [],
    );
    assert.deepEqual(errors, []);
    console.log(
      "Browser smoke passed: diagram, connections, full API path, source, mobile overflow, reduced-motion view and desktop/mobile axe checks.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
