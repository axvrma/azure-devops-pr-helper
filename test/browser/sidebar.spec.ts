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

for (const theme of ['dark', 'light', 'contrast']) {
    test(`recent graph menu removes only the selected history entry in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 340, height: 850 }); await page.goto(`/sidebar?theme=${theme}`);
        const first = page.getByRole('button', { name: 'Actions for Release readiness', exact: true });
        await first.focus(); await page.keyboard.press('ArrowDown');
        const remove = page.getByRole('menuitem', { name: 'Remove from recent', exact: true });
        await expect(remove).toBeFocused(); await expect(page.getByText('File stays on disk', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape'); await expect(first).toBeFocused();
        await expect(page.getByRole('menu', { name: 'Recent graph actions' })).toBeHidden();
        await first.click();
        await page.screenshot({ path: `test-results/sidebar-recent-menu-${theme}.png`, fullPage: true });
        await remove.click();
        await expect(page.locator('#graphCount')).toHaveText('1');
        await expect(page.locator('.graph-file strong')).toHaveText('Release integration');
        await expect(page.getByRole('button', { name: 'Actions for Release integration', exact: true })).toBeFocused();
        await expect(page.getByRole('status')).toContainText('Your graph file stays on disk');
        const messages = await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages);
        expect(messages).toContainEqual({ command: 'removeRecentGraph', data: { id: 'sample-release-readiness' } });
        expect(messages).not.toContainEqual(expect.objectContaining({ command: 'openGraph' }));
        await page.getByRole('button', { name: 'Actions for Release integration', exact: true }).click();
        await remove.click();
        await expect(page.locator('#graphCount')).toHaveText('0');
        await expect(page.getByRole('button', { name: 'Open graph', exact: true })).toBeFocused();
        await expect(page.locator('#recentGraphs')).toContainText('Your next flow starts here');
    });
}
test('recent menus dismiss outside, remain within a narrow panel and follow host acknowledgements', async ({ page }) => {
    await page.setViewportSize({ width: 220, height: 750 }); await page.goto('/sidebar');
    await page.getByRole('button', { name: 'Actions for Release readiness', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Recent graph actions' }); await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(220);
    await page.getByRole('heading', { name: 'Prism', exact: true }).click(); await expect(menu).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { command: 'recentGraphError', data: { message: 'Could not update recent graphs. Your file has not been changed.' } } })));
    await expect(page.locator('#graphCount')).toHaveText('2');
    await expect(page.getByRole('status')).toContainText('file has not been changed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
