import { expect, test } from '@playwright/test';
test('adding more than ten branches keeps the canvas and application usable', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'refs', refs: Array.from({ length: 30 }, (_, i) => ({ name: `release/extra-${i}`, sha: 'a'.repeat(40) })) } }));
    });
    for (let i = 0; i < 20; i++) {
        await page.getByRole('button', { name: `Add release/extra-${i}`, exact: true }).click();
        await expect(page.locator('.react-flow__node')).toHaveCount(i + 4);
        if (i % 3 === 0) {
            await page.locator('.react-flow__node').last().click();
            await page.evaluate(() => { const graph = (window as unknown as { edits: { edges: { analysis?: unknown }[] }[] }).edits.slice(-1)[0]; if (graph?.edges[0]?.analysis) { window.dispatchEvent(new MessageEvent('message', { data: { type: 'progress', completed: 1, total: 2, edge: graph.edges[0].analysis } })); } });
        }
    }
    const positions = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform));
    expect(new Set(positions).size).toBe(23);
    expect(await page.evaluate(() => (window as unknown as { hostActions: { type: string }[] }).hostActions.filter(m => m.type === 'ready').length)).toBe(1);
    expect(errors).toEqual([]);
});
