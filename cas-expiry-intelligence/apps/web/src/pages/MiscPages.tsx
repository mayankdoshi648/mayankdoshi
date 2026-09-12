import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Panel } from '../components/ui';

export function HistoryPage() {
  const [notice, setNotice] = useState('Loading…');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api.casHistory().then((r) => {
      setRows(r.rows ?? []);
      setNotice(r.notice);
    }).catch((e) => setNotice(e.message));
  }, []);
  return (
    <Panel title="CAS History" subtitle="Never fabricated">
      <p className="mb-3 text-sm text-slate-400">{notice}</p>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-terminal-border p-6 text-center text-sm text-slate-500">UNAVAILABLE</div>
      ) : (
        <pre className="overflow-auto text-xs text-slate-300">{JSON.stringify(rows, null, 2)}</pre>
      )}
    </Panel>
  );
}

export function BacktestsPage() {
  const [notice, setNotice] = useState('Loading…');
  useEffect(() => {
    api.backtests().then((r) => setNotice(r.notice)).catch((e) => setNotice(e.message));
  }, []);
  return (
    <Panel title="Backtests" subtitle="Scaffold">
      <p className="text-sm text-slate-400">{notice}</p>
    </Panel>
  );
}

export function OptionChainPage() {
  return (
    <Panel title="Option Chain">
      <p className="text-sm text-slate-400">Use the Terminal page for the live ATM± chain. Dedicated chain workspace comes later — analytics only.</p>
    </Panel>
  );
}
