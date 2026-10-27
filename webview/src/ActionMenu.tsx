import React, { useEffect, useRef, useState } from 'react';
export interface MenuAction { label: string; run(): void; disabled?: boolean; group: string }
export function ActionMenu({ actions }: { actions: MenuAction[] }): React.JSX.Element {
    const [open, setOpen] = useState(false); const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) { setOpen(false); } };
        document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
    }, []);
    const focus = (index: number): void => {
        const items = root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
        if (items?.length) { items[(index + items.length) % items.length].focus(); }
    };
    return <div className="action-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); } }}
        onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); root.current?.querySelector('button')?.focus(); }
            if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); const items = Array.from(root.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') ?? []);
                const current = items.indexOf(document.activeElement!);
                focus(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : current + (event.key === 'ArrowUp' ? -1 : 1));
            }
        }}>
        <button className="menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls="graph-action-menu" onClick={() => setOpen(v => !v)}
            onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); requestAnimationFrame(() => focus(0)); } }}>Actions ▾</button>
        {open && <div id="graph-action-menu" role="menu" aria-label="Graph actions" className="menu-popup">{actions.map((item, index) => <React.Fragment key={item.label}>
            {index === 0 || item.group !== actions[index - 1].group ? <div className="menu-group" role="presentation">{item.group}</div> : null}
            <button role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); item.run(); }}>{item.label}</button>
        </React.Fragment>)}</div>}
    </div>;
}
