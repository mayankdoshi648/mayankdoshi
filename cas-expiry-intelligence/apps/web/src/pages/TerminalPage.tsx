import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Metric, Panel, Pill, fmtNum } from '../components/ui';
import { CasTimeline } from '../components/CasTimeline';
import { TerminalCharts } from '../components/TerminalCharts';

export function TerminalPage() {
  const [instruments, setInstruments] = useState<any[]>([]);
  const [modes, setModes] = useState<any[]>([]);
  const [instrumentId, setInstrumentId] = useState('NIFTY');
  const [expiry, setExpiry] = useState('');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [casMode, setCasMode] = useState('CURRENT_NSE');
  const [wings, setWings] = useState(5);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([api.instruments(), api.casModes()])
      .then(([i, m]) => {
        setInstruments(i.instruments ?? []);
        setModes(m.modes ?? []);
        if (m.defaultMode) setCasMode(m.defaultMode);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api
      .expiries(instrumentId)
      .then((r) => {
        setExpiries(r.expiries ?? []);
        setExpiry((prev) => prev || r.expiries?.[0] || '');
      })
      .catch(() => setExpiries([]));
  }, [instrumentId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.analytics(instrumentId, { expiry: expiry || undefined, casMode, wings }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentId, expiry, casMode, wings]);

  const locked = Boolean(data?.signalScore?.locked);
  const simulation = Boolean(data?.cas?.isSimulation);
  const q = data?.quotes ?? {};
  const om = data?.optionMetrics ?? {};
  const chain = data?.optionChain ?? [];

  return (
    <div className="space-y-4">
      <Panel title="Session Controls" subtitle={data?.istTime ? `IST ${data.istTime}` : undefined}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-slate-400">
            Instrument
            <select className="mt-1 w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-sm" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
              {(instruments.length ? instruments : [{ id: 'NIFTY' }, { id: 'BANKNIFTY' }]).map((i) => (
                <option key={i.id} value={i.id}>{i.displayName ?? i.id}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Expiry
            <select className="mt-1 w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-sm" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="">Auto</option>
              {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            CAS Mode
            <select className="mt-1 w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-sm" value={casMode} onChange={(e) => setCasMode(e.target.value)}>
              {(modes.length ? modes : [
                { mode: 'CURRENT_NSE', displayName: 'CURRENT NSE' },
                { mode: 'SEBI_PROPOSAL_A', displayName: 'SEBI PROPOSAL A — SIMULATION' },
                { mode: 'SEBI_PROPOSAL_B', displayName: 'SEBI PROPOSAL B — SIMULATION' },
              ]).map((m) => <option key={m.mode} value={m.mode}>{m.displayName}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Chain Wings
            <select className="mt-1 w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-sm" value={wings} onChange={(e) => setWings(Number(e.target.value))}>
              {[5, 10, 15].map((n) => <option key={n} value={n}>ATM ±{n}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button onClick={load} className="w-full rounded-lg bg-terminal-accent/20 px-3 py-2 text-sm text-terminal-accent">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {simulation ? <p className="mt-3 text-xs text-terminal-warn">SIMULATION ONLY — SEBI proposal timings are not live NSE rules.</p> : null}
      </Panel>

      {error ? <Panel title="Data Error" tone="danger"><p className="text-sm text-terminal-danger">{error}</p></Panel> : null}

      <CasTimeline
        timeline={data?.cas?.timeline}
        displayName={data?.cas?.displayName}
        isSimulation={simulation}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Spot" tone="accent"><Metric label="LTP" value={fmtNum(q.spot?.value)} health={q.spot?.health} /></Panel>
        <Panel title="Futures"><Metric label="LTP" value={fmtNum(q.futures?.value)} health={q.futures?.health} /></Panel>
        <Panel title="Basis"><Metric label="Fut − Spot" value={fmtNum(q.basis?.value)} hint={q.basisPct?.value != null ? `${fmtNum(q.basisPct.value)}%` : undefined} health={q.basis?.health} /></Panel>
        <Panel title="CAS Phase" tone={locked ? 'warn' : 'default'}>
          <div className="mono text-lg">{data?.cas?.phase?.label ?? '—'}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Pill tone={locked ? 'warn' : 'ok'}>{locked ? 'SIGNALS LOCKED' : 'SIGNALS OPEN'}</Pill>
            <Pill tone={simulation ? 'warn' : 'accent'}>{data?.cas?.displayName ?? casMode}</Pill>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Session VWAP"><Metric label="Intraday VWAP" value={fmtNum(q.sessionVwap?.value)} health={q.sessionVwap?.health} /></Panel>
        <Panel title="Reference VWAP" subtitle="15:00–15:15 IST" tone="accent"><Metric label="Reference VWAP" value={fmtNum(q.referenceVwap?.value)} health={q.referenceVwap?.health} /></Panel>
        <Panel title="Max Pain" subtitle="One input only"><Metric label="Max Pain" value={fmtNum(om.maxPain?.value, 0)} health={om.maxPain?.health} /></Panel>
        <Panel title="PCR">
          <Metric label="OI PCR" value={fmtNum(om.pcrOi?.value)} health={om.pcrOi?.health} />
          <div className="mt-2"><Metric label="Vol PCR" value={fmtNum(om.pcrVolume?.value)} health={om.pcrVolume?.health} /></div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Market Direction" subtitle="Independent of CAS settlement">
          <div className="mono text-xl">{data?.marketState?.state ?? 'NO EDGE'}</div>
          <div className="mt-1 text-xs text-slate-500">Confidence {data?.marketState?.confidence ?? 0}%</div>
          <ul className="mt-3 space-y-1 text-xs text-slate-400">{(data?.marketState?.explanation ?? []).slice(0, 6).map((x: string) => <li key={x}>• {x}</li>)}</ul>
        </Panel>
        <Panel title="CAS Settlement Pressure" subtitle="Independent of direction" tone="accent">
          <div className="mono text-xl text-terminal-accent">{data?.casIntelligence?.state ?? 'HIGH UNCERTAINTY'}</div>
          <div className="mt-1 text-xs text-slate-500">Score {data?.casIntelligence?.score ?? 0} · Confidence {data?.casIntelligence?.confidence ?? 0}%</div>
          <ul className="mt-3 space-y-1 text-xs text-slate-400">{(data?.casIntelligence?.explanation ?? []).slice(0, 6).map((x: string) => <li key={x}>• {x}</li>)}</ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Settlement Zone" tone="accent">
          <div className="mono text-sm text-slate-300">{data?.settlementZone?.lower != null ? `${fmtNum(data.settlementZone.lower)} — ${fmtNum(data.settlementZone.upper)}` : 'UNAVAILABLE'}</div>
          <div className="mono mt-2 text-2xl">{fmtNum(data?.settlementZone?.central)}</div>
          <div className="mt-1 text-xs text-slate-500">Confidence {data?.settlementZone?.confidence ?? 0}%</div>
          <ul className="mt-3 space-y-1 text-xs text-slate-400">{(data?.settlementZone?.explanation ?? []).slice(0, 6).map((x: string) => <li key={x}>• {x}</li>)}</ul>
        </Panel>
        <Panel title="Signal Score" tone={locked ? 'warn' : 'default'}>
          <div className="mono text-3xl">{locked ? 'LOCKED' : (data?.signalScore?.score ?? '—')}</div>
          <div className="mt-1 text-sm text-slate-400">{data?.signalScore?.label}</div>
        </Panel>
        <Panel title="CAS Risk">
          <div className="mono text-3xl">{data?.casRisk?.level ?? '—'}</div>
          <ul className="mt-3 space-y-1 text-xs text-slate-400">{(data?.casRisk?.explanation ?? []).slice(0, 6).map((x: string) => <li key={x}>• {x}</li>)}</ul>
        </Panel>
      </div>

      <Panel title="Option Chain" subtitle={`ATM ±${wings}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-2 py-2">Call OI</th><th className="px-2 py-2">Call Δ</th><th className="px-2 py-2">CE LTP</th>
                <th className="px-2 py-2">Strike</th>
                <th className="px-2 py-2">PE LTP</th><th className="px-2 py-2">Put Δ</th><th className="px-2 py-2">Put OI</th>
              </tr>
            </thead>
            <tbody>
              {chain.length === 0 ? (
                <tr><td className="px-2 py-3 text-slate-500" colSpan={7}>UNAVAILABLE</td></tr>
              ) : chain.map((row: any) => (
                <tr key={row.strike} className={om.atm === row.strike ? 'bg-terminal-accent/10' : undefined}>
                  <td className="mono px-2 py-1.5">{fmtNum(row.call?.oi, 0)}</td>
                  <td className="mono px-2 py-1.5">{fmtNum(row.call?.oiChange, 0)}</td>
                  <td className="mono px-2 py-1.5">{fmtNum(row.call?.ltp)}</td>
                  <td className="mono px-2 py-1.5 font-semibold">{fmtNum(row.strike, 0)}</td>
                  <td className="mono px-2 py-1.5">{fmtNum(row.put?.ltp)}</td>
                  <td className="mono px-2 py-1.5">{fmtNum(row.put?.oiChange, 0)}</td>
                  <td className="mono px-2 py-1.5">{fmtNum(row.put?.oi, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <TerminalCharts charts={data?.charts} />

      {(data?.notices ?? []).length ? (
        <Panel title="Notices">
          <ul className="space-y-1 text-xs text-slate-400">{data.notices.map((n: string) => <li key={n}>• {n}</li>)}</ul>
        </Panel>
      ) : null}
    </div>
  );
}
