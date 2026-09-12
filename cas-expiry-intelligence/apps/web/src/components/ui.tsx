import type { ReactNode } from 'react';

export function Panel({
  title,
  subtitle,
  children,
  tone = 'default',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  tone?: 'default' | 'accent' | 'warn' | 'danger';
}) {
  const border =
    tone === 'accent'
      ? 'border-terminal-accent/40'
      : tone === 'warn'
        ? 'border-terminal-warn/40'
        : tone === 'danger'
          ? 'border-terminal-danger/40'
          : 'border-terminal-border';
  return (
    <section className={`rounded-xl border ${border} bg-terminal-panel/90 p-4 shadow-lg shadow-black/20`}>
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">{title}</h2>
        {subtitle ? <span className="mono text-[11px] text-slate-500">{subtitle}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
  health,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  health?: string | null;
}) {
  const healthColor =
    health === 'LIVE' || health === 'OK'
      ? 'text-terminal-ok'
      : health === 'STALE' || health === 'WARN'
        ? 'text-terminal-warn'
        : health === 'UNAVAILABLE' || health === 'ERROR'
          ? 'text-terminal-danger'
          : 'text-slate-500';
  return (
    <div className="min-w-0">
      <div className="text-[11px] tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mono mt-1 truncate text-lg text-slate-100">{value ?? 'UNAVAILABLE'}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
        {health ? <span className={healthColor}>{health}</span> : null}
        {hint ? <span className="text-slate-500">{hint}</span> : null}
      </div>
    </div>
  );
}

/** Alias used by some pages */
export const MetricCard = Metric;

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';
}) {
  const cls =
    tone === 'ok'
      ? 'bg-terminal-ok/15 text-terminal-ok'
      : tone === 'warn'
        ? 'bg-terminal-warn/15 text-terminal-warn'
        : tone === 'danger'
          ? 'bg-terminal-danger/15 text-terminal-danger'
          : tone === 'accent'
            ? 'bg-terminal-accent/15 text-terminal-accent'
            : 'bg-slate-700/40 text-slate-300';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${cls}`}>{children}</span>;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(Number(v))) return 'UNAVAILABLE';
  return Number(v).toLocaleString('en-IN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

