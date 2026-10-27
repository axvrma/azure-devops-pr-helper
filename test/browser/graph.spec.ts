import { expect, test } from '@playwright/test';
test('bundled webview renders under production CSP and supports editing, inspection and history', async ({ page }) => {
    const errors: string[] = []; const violations: string[] = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
    await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', event => { (window as unknown as { violations: string[] }).violations ??= []; (window as unknown as { violations: string[] }).violations.push(event.violatedDirective); }); });
    await page.goto('/'); await expect(page.getByRole('textbox', { name: 'Graph name' })).toHaveValue('Release Train');
    await expect(page.locator('.react-flow__node')).toHaveCount(3); await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await page.getByRole('button', { name: /Integrate release\/2.1.0/ }).click();
    await expect(page.getByRole('button', { name: 'Create PR…' })).toBeVisible(); await expect(page.getByText('Merge conflicts have not been checked.', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/branch-flow.png', fullPage: true });
    await page.getByRole('button', { name: 'Add hotfix/urgent' }).click(); await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await page.getByRole('button', { name: 'Actions ▾' }).click(); await page.getByRole('menuitem', { name: 'Undo', exact: true }).click(); await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await page.getByRole('button', { name: 'Actions ▾' }).click(); await page.getByRole('menuitem', { name: 'Redo', exact: true }).click(); await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await page.getByRole('button', { name: 'Actions ▾' }).click(); await page.getByRole('menuitem', { name: 'Auto Layout' }).click();
    await page.getByRole('button', { name: 'Actions ▾' }).click(); await page.getByRole('menuitem', { name: 'Fit View' }).click();
    violations.push(...await page.evaluate(() => (window as unknown as { violations?: string[] }).violations ?? []));
    expect(violations).toEqual([]); expect(errors).toEqual([]);
});
test('keyboard connector rejects cycles, and secrets/network APIs are absent from the webview', async ({ page }) => {
    await page.goto('/'); await page.getByText('Connect branches with keyboard').click();
    await page.getByLabel('Connection source').selectOption('c'); await page.getByLabel('Connection target').selectOption('a');
    await page.getByRole('button', { name: 'Connect', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('acyclic');
    expect(await page.evaluate(() => Object.keys(window).some(key => /AZURE_PAT|axios|SecretStorage/.test(key)))).toBe(false);
});

test('wheel gestures pan vertically and horizontally while modifier zoom stays available', async ({ page }) => {
    await page.goto('/'); const viewport = page.locator('.react-flow__viewport');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    const transform = () => viewport.evaluate(element => { const matrix = new DOMMatrix(getComputedStyle(element).transform); return { x: matrix.e, y: matrix.f, zoom: matrix.a }; });
    const bounds = await page.getByRole('region', { name: 'Branch dependency graph' }).boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height - 150);
    const initial = await transform(); await page.mouse.wheel(0, 100);
    await expect.poll(async () => (await transform()).y).not.toBe(initial.y);
    const vertical = await transform(); expect(vertical.zoom).toBe(initial.zoom);
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 100); await page.keyboard.up('Shift');
    await expect.poll(async () => (await transform()).x).not.toBe(vertical.x);
    const horizontal = await transform(); expect(horizontal.zoom).toBe(initial.zoom); expect(horizontal.y).toBe(vertical.y);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
    await expect.poll(async () => (await transform()).zoom).toBeGreaterThan(initial.zoom);
});

test('actions menu supports keyboard navigation, notifications and persistent error details', async ({ page }) => {
    await page.goto('/'); await page.getByRole('button', { name: 'Actions ▾' }).focus(); await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'New', exact: true })).toBeFocused(); await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add hotfix/urgent' }).click(); await expect(page.getByRole('status').filter({ hasText: 'Added hotfix/urgent.' })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'error', operation: 'Save graph', message: 'Test filesystem refused the save.' } })));
    const errors = page.getByRole('region', { name: 'Error history' }); await expect(errors).toContainText('Test filesystem refused the save.');
    await page.getByRole('alert').getByRole('button', { name: 'Dismiss notification' }).click(); await expect(errors).toContainText('Test filesystem refused the save.');
});
