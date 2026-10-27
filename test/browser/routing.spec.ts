import { expect, test } from '@playwright/test';

test('fan-out and convergence use separate visible paths before and after moving a node', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.evaluate(() => {
        const nodes = [ ['a', 0, 140], ['b', 420, 0], ['c', 420, 180], ['d', 420, 360], ['e', 840, 140] ].map(([id, x, y]) => ({ id, branch: `release/${id}`, position: { x, y } }));
        const edges = [['ab', 'a', 'b'], ['ac', 'a', 'c'], ['ad', 'a', 'd'], ['be', 'b', 'e'], ['ce', 'c', 'e'], ['de', 'd', 'e'], ['ae', 'a', 'e']].map(([id, source, target]) => ({ id, source, target, operation: 'merge-pr' }));
        const graph = { schemaVersion: 1, graphId: 'fan-routing', name: 'Fan routing', repository: { organizationUrl: 'https://dev.azure.com/example', project: 'Platform', repositoryId: 'repo' }, nodes, edges, snapshot: { validatedAt: null, branchHeads: {} }, ui: { viewport: { x: 30, y: 120, zoom: 0.6 }, snapToGrid: true } };
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', graph, revision: 1, dirty: false, external: false, recent: [] } }));
    });
    await expect(page.locator('.react-flow__minimap-node')).toHaveCount(5);
    await expect(page.locator('.react-flow__edge-path')).toHaveCount(7);
    const separate = async () => page.locator('.react-flow__edge-path').evaluateAll(paths => {
        const segments: { id: number; from: number[]; to: number[] }[] = [];
        for (let id = 0; id < paths.length; id++) {
            const tokens = paths[id].getAttribute('d')!.match(/[MLQ]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!;
            let cursor = [0, 0]; let i = 0;
            while (i < tokens.length) {
                const command = tokens[i++];
                if (command === 'M') { cursor = [+tokens[i++], +tokens[i++]]; }
                else if (command === 'Q') { i += 2; cursor = [+tokens[i++], +tokens[i++]]; }
                else if (command === 'L') {
                    const to = [+tokens[i++], +tokens[i++]];
                    for (const previous of segments) {
                        if (previous.id === id) { continue; }
                        const horizontal = Math.abs(cursor[1] - to[1]) < 0.001 && Math.abs(previous.from[1] - previous.to[1]) < 0.001 && Math.abs(cursor[1] - previous.from[1]) < 0.001;
                        const vertical = Math.abs(cursor[0] - to[0]) < 0.001 && Math.abs(previous.from[0] - previous.to[0]) < 0.001 && Math.abs(cursor[0] - previous.from[0]) < 0.001;
                        const axis = horizontal ? 0 : 1;
                        if ((horizontal || vertical) && Math.min(Math.max(cursor[axis], to[axis]), Math.max(previous.from[axis], previous.to[axis])) - Math.max(Math.min(cursor[axis], to[axis]), Math.min(previous.from[axis], previous.to[axis])) > 0.001) { return false; }
                    }
                    segments.push({ id, from: cursor, to }); cursor = to;
                } else { throw new Error('Unexpected path command: ' + command); }
            }
        }
        return true;
    });
    expect(await separate()).toBe(true);
    const before = await page.locator('.react-flow__edge-path').evaluateAll(paths => paths.map(p => p.getAttribute('d')).join('|'));
    const node = page.locator('.react-flow__node[data-id="c"]'); await node.click(); await node.focus(); await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.locator('.react-flow__edge-path').evaluateAll(paths => paths.map(p => p.getAttribute('d')).join('|'))).not.toBe(before);
    expect(await separate()).toBe(true); await expect(page.locator('.react-flow__minimap-node')).toHaveCount(5); expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await page.screenshot({ path: 'test-results/separate-edge-routes.png', fullPage: true });
});
