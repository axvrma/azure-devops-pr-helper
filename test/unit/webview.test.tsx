// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { graph, A, B, C } from './fixtures';
import type { ViewMessage } from '../../src/branchFlow/protocol';
const { postMessage } = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock('../../webview/src/bridge', () => ({ bridge: { postMessage, getState: () => undefined, setState: vi.fn() }, action: (action: string) => postMessage({ type: 'action', action }) }));
import { App } from '../../webview/src/main';

function host(message: ViewMessage): void { act(() => { window.dispatchEvent(new MessageEvent('message', { data: message })); }); }
function load(): void {
    render(<ReactFlowProvider><App /></ReactFlowProvider>);
    host({ type: 'state', graph: graph(), revision: 0, dirty: false, external: false, recent: [] });
    host({ type: 'refs', refs: [{ name: 'release/2.1', sha: A }, { name: 'release/2.2', sha: B }, { name: 'release/2.3', sha: C }, { name: '<unsafe-label>', sha: A }] });
}
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    Object.defineProperty(window, 'DOMMatrixReadOnly', { configurable: true, value: class { m22 = 1; constructor() {} } });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => undefined });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('renders initial empty state with a repository chooser and sends ready', () => {
    render(<ReactFlowProvider><App /></ReactFlowProvider>);
    expect(screen.getByText('Map your branch flow')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose repository' })).toBeTruthy(); expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
});
it('renders branch labels as text, disables duplicates and adds branches by keyboard-accessible button', () => {
    load(); expect(screen.getByRole('button', { name: 'Add release/2.1' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('<unsafe-label>')).toBeTruthy(); expect(document.querySelector('unsafe-label')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add <unsafe-label>' }));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'edit', graph: expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ branch: '<unsafe-label>' })]) }) }));
});
it('handles errors, loading, cancellation and external-file actions', () => {
    load(); host({ type: 'busy', value: true, label: 'Validating branches…' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions ▾' }));
    expect(screen.getByRole('menuitem', { name: 'Analyze All' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(postMessage).toHaveBeenCalledWith({ type: 'action', action: 'cancel' });
    host({ type: 'error', message: 'Authentication failed. Update your PAT.' }); expect(screen.getByRole('alert').textContent).toContain('Authentication');
    host({ type: 'meta', dirty: true, external: true }); fireEvent.click(screen.getByRole('button', { name: 'Reload file' })); expect(postMessage).toHaveBeenCalledWith({ type: 'action', action: 'reloadExternal' });
});
it('rejects cyclic keyboard connections and preserves undo/redo for valid edits', () => {
    load(); fireEvent.click(screen.getByText('Connect branches with keyboard'));
    fireEvent.change(screen.getByLabelText('Connection source'), { target: { value: 'c' } }); fireEvent.change(screen.getByLabelText('Connection target'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect', exact: true })); expect(screen.getByRole('alert').textContent).toContain('acyclic');
    fireEvent.click(screen.getByRole('button', { name: 'Actions ▾' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Auto Layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions ▾' })); expect(screen.getByRole('menuitem', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Undo' })); fireEvent.click(screen.getByRole('button', { name: 'Actions ▾' })); expect(screen.getByRole('menuitem', { name: 'Redo' }).hasAttribute('disabled')).toBe(false);
});
it('filters branches after a 200ms debounce', async () => {
    load(); fireEvent.change(screen.getByRole('textbox', { name: 'Search remote branches' }), { target: { value: '2.3' } });
    await act(async () => { await new Promise(r => setTimeout(r, 220)); });
    expect(screen.getByRole('button', { name: 'Add release/2.3' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Add release/2.1' })).toBeNull();
});

it('retains error details after dismissing a toast or starting a new action', () => {
    load(); host({ type: 'error', message: 'Disk is full.', operation: 'Save graph' });
    host({ type: 'busy', value: true, label: 'Validating…' });
    const inspector = screen.getByRole('region', { name: 'Error history' }); expect(inspector.textContent).toContain('Disk is full.'); expect(inspector.textContent).toContain('Save graph');
    fireEvent.click(screen.getByRole('button', { name: 'Clear errors' })); expect(inspector.textContent).toContain('No errors');
});
it('places the connection controls in one toolbar without a branding header', () => {
    load(); const toolbar = screen.getByRole('navigation', { name: 'Graph toolbar' });
    expect(toolbar.contains(screen.getByLabelText('New connection'))).toBe(true); expect(document.querySelector('.brand')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save', exact: true })).toBeNull();
});
