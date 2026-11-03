import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { isSupportedNodeVersion } from '../../scripts/check-node.mjs';

for (const [version, expected] of [
    ['18.20.6', false], ['20.19.0', false], ['22.0.0', false], ['22.11.9', false],
    ['22.12.0', true], ['22.23.4', true], ['23.0.0', false], ['24.0.0', true],
    ['25.0.0', false], ['26.0.0', true], ['27.0.0', true], ['22.12.0-rc.1', false], ['invalid', false],
]) {
    test(`Node ${version} is ${expected ? 'supported' : 'rejected'}`, () => {
        assert.equal(isSupportedNodeVersion(version), expected);
    });
}

test('unsupported runtimes get setup instructions and a nonzero exit code without loading build dependencies', () => {
    const moduleUrl = new URL('../../scripts/check-node.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { checkNode } from ${JSON.stringify(moduleUrl)}; if (!checkNode('18.20.6')) process.exitCode = 1;`], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot run on Node\.js v18\.20\.6/);
    assert.match(result.stderr, /nvm install/);
    assert.match(result.stderr, /nvm use/);
    assert.match(result.stderr, /npm ci/);
    assert.doesNotMatch(result.stderr, /SyntaxError|rolldown|styleText/);
});
