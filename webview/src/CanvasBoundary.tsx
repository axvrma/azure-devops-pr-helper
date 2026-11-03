import React from 'react';
/** The editor state and diagnostics live outside this boundary, so a failed renderer cannot erase the graph. */
export class CanvasBoundary extends React.Component<{ children: React.ReactNode; onError(message: string): void }, { failed: boolean; attempt: number }> {
    state = { failed: false, attempt: 0 };
    static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
    componentDidCatch(error: Error): void { this.props.onError(`Canvas rendering failed: ${error.message}. Your graph is preserved. Restore the canvas or save the file.`); }
    render(): React.ReactNode {
        if (this.state.failed) { return <div className="canvas-recovery" role="alert"><h2>Canvas needs recovery</h2><p>Your graph is still available. Review Errors in the inspector or save from Actions.</p>
            <button onClick={() => this.setState(s => ({ failed: false, attempt: s.attempt + 1 }))}>Restore canvas</button></div>; }
        return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }
}
