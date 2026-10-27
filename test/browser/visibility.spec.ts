import { expect, test } from '@playwright/test';

test('measured nodes and minimap survive analysis updates and repeated fit view', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/'); await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.locator('.react-flow__minimap-node')).toHaveCount(3);
    for (let round = 0; round < 6; round++) {
        await page.evaluate((round) => {
            const edge = { edgeId: 'ab', operation: 'merge-pr', sourceSha: 'a'.repeat(40), targetSha: 'b'.repeat(40), status: round % 2 ? 'SYNCED' : 'ANALYZING', verified: !!(round % 2), validationMethod: 'fixture', checkedAt: new Date().toISOString(), reasons: ['Fixture analysis'], warnings: [] };
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'progress', completed: round, total: 6, edge } }));
        }, round);
        await page.getByRole('button', { name: 'Fit View', exact: true }).click();
        for (const node of await page.locator('.react-flow__node').all()) { await expect(node).toBeVisible(); }
        await expect(page.locator('.react-flow__minimap-node')).toHaveCount(3);
    }
    expect(errors).toEqual([]);
});

test('24 nodes and 24 edges stay drawn through refreshes, idle time, resize and fit', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.evaluate(() => {
        const nodes = Array.from({ length: 24 }, (_, i) => ({ id: `n${i}`, branch: `release/${i}`, position: { x: i % 6 * 360, y: Math.floor(i / 6) * 180 } }));
        const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id, operation: 'merge-pr' }));
        edges.push({ id: 'long-edge', source: 'n0', target: 'n23', operation: 'merge-pr' });
        const graph = { schemaVersion: 1, graphId: '24-node-regression', name: '24 releases', repository: { organizationUrl: 'https://dev.azure.com/example', project: 'Platform', repositoryId: 'repo' }, nodes, edges, snapshot: { validatedAt: null, branchHeads: {} }, ui: { viewport: { x: 20, y: 20, zoom: 0.4 }, snapToGrid: true } };
        (window as unknown as { fixtureGraph: typeof graph }).fixtureGraph = graph;
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', graph, revision: 1, dirty: false, external: false, recent: [] } }));
    });
    await expect(page.locator('.react-flow__minimap-node')).toHaveCount(24);
    await expect(page.locator('.react-flow__edge')).toHaveCount(24);
    await page.clock.install();
    await page.evaluate(() => {
        setInterval(() => { const graph = (window as unknown as { fixtureGraph: unknown }).fixtureGraph; window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', graph: structuredClone(graph), revision: 2, dirty: true, external: false, recent: [] } })); }, 10000);
    });
    await page.clock.runFor(61000);
    await page.clock.resume();
    await page.setViewportSize({ width: 1150, height: 750 });
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Canvas fitted to branches and connections.' })).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(24);
    await expect(page.locator('.react-flow__minimap-node')).toHaveCount(24);
    await expect(page.locator('.react-flow__edge')).toHaveCount(24);
    const drawn = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).visibility === 'visible' && node.getBoundingClientRect().width > 0));
    expect(drawn).toBe(true); expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/24-node-routing.png', fullPage: true });
});
