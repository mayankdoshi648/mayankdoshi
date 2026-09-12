import { Panel, Pill } from './ui';

export function CasTimeline({
  timeline,
  displayName,
  isSimulation,
}: {
  timeline?: Array<{
    id: string;
    label: string;
    start: string;
    end: string;
    active?: boolean;
    lockDirectionalSignals?: boolean;
  }>;
  displayName?: string;
  isSimulation?: boolean;
}) {
  const phases = timeline ?? [];
  return (
    <Panel title="CAS Timeline" subtitle={displayName} tone={isSimulation ? 'warn' : 'accent'}>
      {isSimulation ? (
        <p className="mb-3 text-xs text-terminal-warn">
          SIMULATION — timings from CAS_CONFIG, not live NSE rules.
        </p>
      ) : null}
      {phases.length === 0 ? (
        <div className="text-sm text-slate-500">UNAVAILABLE</div>
      ) : (
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {phases.map((p) => (
            <li
              key={p.id}
              className={`rounded-lg border px-3 py-2 ${
                p.active
                  ? 'border-terminal-accent bg-terminal-accent/10'
                  : 'border-terminal-border bg-terminal-bg/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="mono text-[11px] text-slate-500">
                  {String(p.start).slice(0, 5)}–{String(p.end).slice(0, 5)}
                </span>
                {p.active ? <Pill tone="accent">NOW</Pill> : null}
              </div>
              <div className="mt-1 text-sm text-slate-100">{p.label}</div>
              {p.lockDirectionalSignals ? (
                <div className="mt-1 text-[11px] text-terminal-warn">Signals locked</div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
