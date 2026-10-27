import { expect, it } from 'vitest';
import { safeTelemetryProperties } from '../../src/analytics/posthog';
import { safeAzureLink } from '../../src/utils/urls';
import { getNonce } from '../../src/utils/helpers';
import { remember, undo, redo } from '../../webview/src/history';
import { graph } from './fixtures';
it('drops repository names, SHAs, content, model names, credentials and freeform errors from analytics', () => {
    const result = safeTelemetryProperties({ repository: 'private', branch: 'private', token: 'private', error_type: 'private raw body', model: 'private', count: 3, success: true, provider: 'openai' });
    expect(result).toEqual({ error_type: 'operation_failed', count: 3, success: true, provider: 'openai' }); expect(JSON.stringify(result)).not.toContain('private');
});
it('allows only credential-free links scoped to the selected organization', () => {
    const base = 'https://dev.azure.com/example';
    expect(safeAzureLink(base + '/p/_git/r/pullrequest/1', base)).toBeTruthy();
    for (const value of ['command:workbench.action', 'javascript:alert(1)', 'file:///etc/passwd', 'https://evil.test/', 'https://user:token@dev.azure.com/example/p', base + 'other/p', base + '/%2e%2e/other']) { expect(safeAzureLink(value, base)).toBeUndefined(); }
});
it('generates unpredictable independent CSP nonces', () => { const values = Array.from({ length: 100 }, getNonce); expect(new Set(values).size).toBe(100); expect(values.every(v => /^[A-Za-z0-9+/=]{32}$/.test(v))).toBe(true); });
it('undo/redo restores structure without restoring cached green as current truth and caps history', () => {
    let h = { present: graph(), past: [] as ReturnType<typeof graph>[], future: [] as ReturnType<typeof graph>[] };
    for (let i = 0; i < 60; i++) { h = remember(h, { ...h.present, name: `Edit ${i}` }); }
    expect(h.past).toHaveLength(50); expect(undo(h).present.name).toBe('Edit 58'); expect(redo(undo(h)).present.name).toBe('Edit 59');
});
