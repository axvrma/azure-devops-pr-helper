import { expect, test } from '@playwright/test';
for (const theme of ['dark', 'light', 'contrast']) {
    test(`sidebar has consistent, compact controls and safe recent files in ${theme} theme`, async ({ page }) => {
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width: 340, height: 900 }); await page.goto(`/sidebar?theme=${theme}`);
        await expect(page.locator('#graphCount')).toHaveText('2');
        const controls = page.locator('.flow-actions button');
        const first = await controls.first().evaluate(element => ({ height: element.getBoundingClientRect().height, background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
        const second = await controls.last().evaluate(element => ({ height: element.getBoundingClientRect().height, background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
        expect(first).toEqual(second); expect(first.height).toBeGreaterThanOrEqual(28); expect(first.height).toBeLessThanOrEqual(32);
        const file = page.locator('#recentGraphs button').first();
        await expect(file.locator('strong')).toHaveText('Release readiness');
        expect(await file.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(page.locator('#clearHistoryBtn')).toBeDisabled();
        await expect(page.locator('#openPRCreatorAction')).toHaveJSProperty('tagName', 'BUTTON');
        await page.screenshot({ path: `test-results/sidebar-${theme}.png`, fullPage: true });
        await file.click(); expect(await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages)).toContainEqual({ command: 'openGraph', data: { index: 0 } });
        expect(errors).toEqual([]);
    });
}
test('PR and Settings share the sidebar typography, themed controls and line icons', async ({ page }) => {
    for (const name of ['pr', 'settings']) {
        await page.goto(`/${name}`);
        const heading = page.locator('h1'); expect(await heading.evaluate(element => getComputedStyle(element).fontSize)).toBe('20px');
        await expect(heading.locator('svg')).toHaveCount(1);
        await expect(page.locator('link[href$="/ui/workbench.css"]')).toHaveCount(1);
        expect(await page.locator('body').textContent()).not.toMatch(/[🚀📋📭🤖🔗]/u);
    }
});

test('sidebar remains usable in a narrow panel and with no recent graphs', async ({ page }) => {
    await page.setViewportSize({ width: 220, height: 900 }); await page.goto('/sidebar');
    await expect(page.locator('#graphCount')).toHaveText('2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { command: 'context', data: { hasAzure: false, hasAI: false, prHistory: [], recentGraphs: [] } } })));
    await expect(page.locator('#warningBanner')).toBeVisible(); await expect(page.locator('#recentGraphs')).toContainText('No graphs opened yet.');
    await expect(page.locator('#graphCount')).toHaveText('0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
