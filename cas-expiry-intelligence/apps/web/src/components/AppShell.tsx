import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

const links = [
  ['/', 'Terminal'],
  ['/option-chain', 'Option Chain'],
  ['/history', 'CAS History'],
  ['/backtests', 'Backtests'],
  ['/settings', 'Settings'],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-7xl px-3 pb-10 pt-3 sm:px-5">
      <header className="mb-4 rounded-xl border border-terminal-border bg-terminal-panel/80 p-3">
        <div className="text-[11px] tracking-[0.2em] text-terminal-accent uppercase">Standalone Terminal</div>
        <h1 className="text-lg font-semibold text-slate-100 sm:text-xl">CAS & Expiry Intelligence</h1>
        <p className="text-xs text-slate-500">Analytics / research only — no order execution</p>
      </header>
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-terminal-border bg-terminal-panel/60 p-1">
        {links.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `rounded-lg px-3 py-2 text-sm whitespace-nowrap ${
                isActive ? 'bg-terminal-accent/20 text-terminal-accent' : 'text-slate-400 hover:text-slate-200'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      {children}
      <footer className="mt-8 border-t border-terminal-border pt-4 text-[11px] text-slate-600">
        Independent app. Max Pain ≠ settlement. Direction ≠ CAS pressure. SEBI proposal modes are simulation only.
      </footer>
    </div>
  );
}
