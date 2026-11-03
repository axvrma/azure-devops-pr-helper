import { test, expect } from "@playwright/test";
import AxeBuilderSource from "axe-core";
const repository = "https://github.com/axvrma/azure-devops-pr-helper";
test("graph scenarios, branch and connection inspectors, analysis, zoom and reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const demo = page.locator("#demo");
  await demo.scrollIntoViewIfNeeded();
  await expect(
    demo.getByText("INTEGRATION STATUS", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Conflict Detected", exact: true })
    .click();
  await expect(
    demo.getByText("SIMULATED CONFLICT EVIDENCE", { exact: true }),
  ).toBeVisible();
  await expect(
    demo.getByText("src/checkout/payment.ts", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Release Drift", exact: true })
    .click();
  await expect(demo.locator(".integration-status")).toContainText("DRIFTED");
  await page
    .getByRole("button", { name: "Run sample analysis", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Analyzing…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Run sample analysis", exact: true }),
  ).toBeEnabled();
  await expect(demo.locator(".integration-status")).toContainText("DRIFTED");
  await demo
    .locator(".react-flow__node")
    .filter({ hasText: "feature/checkout" })
    .click();
  await expect(
    demo.getByRole("heading", { name: "feature/checkout", exact: true }),
  ).toBeVisible();
  await demo.locator(".relationship-list button").click();
  await expect(demo.locator(".integration-status")).toContainText("DRIFTED");
  const viewport = demo.locator(".react-flow__viewport");
  const before = await viewport.getAttribute("style");
  await demo.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(viewport).not.toHaveAttribute("style", before!);
  await demo.getByRole("button", { name: "Zoom out", exact: true }).click();
  await demo.getByRole("button", { name: "Fit graph to viewport" }).click();
  await demo.getByRole("button", { name: "Reset graph" }).click();
  await expect(demo.locator(".integration-status")).toContainText("SYNCED");
  await demo.locator(".react-flow__edge").first().focus();
  await page.keyboard.press("Enter");
  await expect(
    demo.getByText("BRANCH ANALYSIS", { exact: true }),
  ).toBeVisible();
  await demo.getByText("View accessible relationship summary").click();
  await expect(demo.locator(".graph-summary li")).toHaveCount(6);
  expect(errors).toEqual([]);
});
test("showcase tabs work with keyboard and editable local PR preview", async ({
  page,
}) => {
  await page.goto("/");
  const tab = page.getByRole("tab", { name: "Branch Flow", exact: true });
  await tab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "PR Creator", exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Release checkout fixes");
  await page
    .getByLabel("Description Editable sample")
    .fill("Review the retry changes.");
  await page
    .getByRole("button", { name: "Preview sample", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Release checkout fixes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Preview ready. No pull request was submitted."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to edit" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Release checkout fixes",
  );
  await page.getByRole("tab", { name: "Branch Flow", exact: true }).click();
  await page.getByRole("button", { name: "Prepare sample PR" }).click();
  await expect(
    page.getByRole("tab", { name: "PR Creator", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
test("mobile menu, touch-friendly branch list and relationship inspection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const menu = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await menu.click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await menu.click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Features" })
    .click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await page
    .getByRole("button", { name: "Conflict Detected", exact: true })
    .click();
  await page
    .locator(".mobile-branches button")
    .filter({ hasText: "feature/checkout" })
    .click();
  await expect(
    page
      .locator(".inspector")
      .getByRole("heading", { name: "feature/checkout" }),
  ).toBeVisible();
  await page.locator(".relationship-list button").click();
  await expect(page.locator(".integration-status")).toContainText("CONFLICT");
  await page.getByRole("button", { name: "Reset sample" }).click();
  await expect(page.locator(".integration-status")).toContainText("SYNCED");
});
test("all local anchors and shipped assets resolve, repository destinations are correct", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator("#demo")).toBeVisible();
  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
  for (const href of new Set(hrefs)) {
    if (href.startsWith("#"))
      expect(await page.locator(href).count(), `${href} exists`).toBe(1);
    else
      expect([
        repository,
        `${repository}/issues`,
        "https://github.com/axvrma",
        "https://reactflow.dev?utm_source=attribution",
      ]).toContain(href);
  }
  for (const asset of [
    "/favicon.svg",
    "/prism-logo.svg",
    "/og-image.png",
    "/robots.txt",
  ])
    expect((await request.get(asset)).status()).toBe(200);
  await expect(page).toHaveTitle(
    "Prism — Visual Git Branch Management for Azure DevOps",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /visual branch planning/,
  );
});
test("reduced motion and keyboard entry", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe("auto");
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.locator(".react-flow__node").first().focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .locator(".inspector")
      .getByRole("heading", { name: "main", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run sample analysis", exact: true })
    .click();
  await expect(page.locator(".react-flow__edge.animated")).toHaveCount(0);
});
for (const width of [320, 375, 768, 1024, 1440]) {
  test(`responsive layout and axe accessibility at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.locator("#demo").scrollIntoViewIfNeeded();
    await expect(page.locator(".inspector-heading")).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.addScriptTag({ content: AxeBuilderSource.source });
    const results = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              context: Document,
              options: object,
            ) => Promise<{
              violations: {
                id: string;
                nodes: { target: string[]; failureSummary: string }[];
              }[];
            }>;
          };
        }
      ).axe;
      return axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] },
      });
    });
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  });
}

test("Netlify CSP allows graph and sample PR interactions with no external requests", async ({
  page,
}) => {
  const { readFileSync } = await import("node:fs");
  const config = readFileSync(
    new URL("../../../netlify.toml", import.meta.url),
    "utf8",
  );
  const policy = config.match(/Content-Security-Policy = "([^"]+)"/)![1];
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4173/")) external.push(r.url());
  });
  await page.route("http://127.0.0.1:4173/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": policy },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Conflict Detected", exact: true })
    .click();
  await page.locator(".sample-commits summary").click();
  await expect(page.locator(".sample-commits li")).toHaveCount(3);
  await page.getByRole("tab", { name: "PR Creator", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview sample", exact: true })
    .click();
  await expect(
    page.getByText("Preview ready. No pull request was submitted."),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("branch drag, keyboard movement, canvas pan and reset restore the sample", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const branch = page.locator(".react-flow__node").first();
  await expect(branch).toBeVisible();
  const original = await branch.evaluate((n) => n.style.transform);
  await branch.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => branch.evaluate((n) => n.style.transform))
    .not.toBe(original);
  const beforeDrag = await branch.evaluate((n) => n.style.transform);
  const rect = await branch.boundingBox();
  await page.mouse.move(rect!.x + 50, rect!.y + 30);
  await page.mouse.down();
  await page.mouse.move(rect!.x + 90, rect!.y + 70, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => branch.evaluate((n) => n.style.transform))
    .not.toBe(beforeDrag);
  const pane = page.locator(".react-flow__pane");
  await pane.scrollIntoViewIfNeeded();
  const bounds = await pane.boundingBox();
  const viewport = page.locator(".react-flow__viewport");
  const beforePan = await viewport.getAttribute("style");
  await page.mouse.move(bounds!.x + 15, bounds!.y + bounds!.height - 80);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 65, bounds!.y + bounds!.height - 60, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute("style", beforePan!);
  await page.getByRole("button", { name: "Reset graph", exact: true }).click();
  await expect
    .poll(() => branch.evaluate((n) => n.style.transform))
    .toBe(original);
});
