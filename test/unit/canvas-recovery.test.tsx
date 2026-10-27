// @vitest-environment jsdom
import React from 'react';
import { expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CanvasBoundary } from '../../webview/src/CanvasBoundary';
it('keeps editor actions outside the failed renderer available, reports the error and allows recovery', () => {
    let shouldThrow = true; const report = vi.fn(); const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Renderer(): React.JSX.Element { if (shouldThrow) { throw new Error('Fixture renderer failure'); } return <div>Recovered graph</div>; }
    try {
        render(<><button>Save graph</button><CanvasBoundary onError={report}><Renderer /></CanvasBoundary></>);
        expect(screen.getByRole('button', { name: 'Save graph' })).toBeTruthy(); expect(screen.getByText('Canvas needs recovery')).toBeTruthy();
        expect(report).toHaveBeenCalledWith(expect.stringContaining('Fixture renderer failure'));
        shouldThrow = false; fireEvent.click(screen.getByRole('button', { name: 'Restore canvas' })); expect(screen.getByText('Recovered graph')).toBeTruthy();
    } finally { cleanup(); logging.mockRestore(); }
});
