import React, { useCallback, useEffect, useRef, useState } from 'react';
export interface Diagnostic { id: number; message: string; operation: string; time: string; details?: string }
interface Toast { id: number; message: string; error: boolean }
export function useNotifications() {
    const [toasts, setToasts] = useState<Toast[]>([]); const [errors, setErrors] = useState<Diagnostic[]>([]);
    const serial = useRef(0); const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
    useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
    const dismiss = useCallback((id: number) => setToasts(previous => previous.filter(t => t.id !== id)), []);
    const notify = useCallback((message: string, error = false) => {
        const id = ++serial.current; setToasts(previous => [...previous.slice(-2), { id, message, error }]);
        const timer = setTimeout(() => { dismiss(id); timers.current.delete(timer); }, error ? 8000 : 4000); timers.current.add(timer);
    }, [dismiss]);
    const report = useCallback((message: string, operation = 'Graph action', details?: string) => {
        setErrors(previous => [{ id: ++serial.current, message, operation, details, time: new Date().toISOString() }, ...previous].slice(0, 50));
        notify(message, true);
    }, [notify]);
    return { errors, notify, report, clearErrors: () => setErrors([]),
        toasts: <div className="toast-stack" aria-label="Action notifications">{toasts.map(toast => <div key={toast.id} className={`action-toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>
            <span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>×</button>
        </div>)}</div> };
}
export function ErrorInspector({ errors, clear }: { errors: Diagnostic[]; clear(): void }): React.JSX.Element {
    return <section className="error-inspector" aria-label="Error history"><div className="section-heading"><h2>Errors <span>({errors.length})</span></h2>
        <button disabled={!errors.length} onClick={clear}>Clear errors</button></div>
        {!errors.length ? <p className="muted">No errors in this session.</p> : errors.map((error, index) => <details key={error.id} open={index === 0}>
            <summary>{error.operation} · <time dateTime={error.time}>{new Date(error.time).toLocaleTimeString()}</time></summary>
            <p className="break">{error.message}</p>{error.details && <p className="break muted">{error.details}</p>}
        </details>)}
    </section>;
}
