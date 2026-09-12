import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Panel } from './ui';

function fmtTime(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return '';
  }
}

export function TerminalCharts({ charts }: { charts: any }) {
  if (!charts) {
    return (
      <Panel title="Charts">
        <p className="text-sm text-slate-500">UNAVAILABLE</p>
      </Panel>
    );
  }

  const spotSeries = (charts.spotSeries ?? []).map((p: any) => ({
    t: p.t,
    label: fmtTime(p.t),
    close: p.close,
    sessionVwap: charts.sessionVwap,
    referenceVwap: charts.referenceVwap,
    zoneLower: charts.settlementLower,
    zoneUpper: charts.settlementUpper,
    zoneCentral: charts.settlementCentral,
  }));

  const oiRows = (charts.callOiByStrike ?? []).map((c: any, i: number) => ({
    strike: c.strike,
    callOi: c.oi,
    putOi: charts.putOiByStrike?.[i]?.oi ?? null,
    callChg: charts.oiChangeByStrike?.[i]?.call ?? null,
    putChg: charts.oiChangeByStrike?.[i]?.put ?? null,
  }));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Spot + VWAP + Settlement Zone" tone="accent">
        {spotSeries.length === 0 ? (
          <p className="text-sm text-slate-500">UNAVAILABLE — no intraday series</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={spotSeries}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} minTickGap={24} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} width={56} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="close" stroke="#e2e8f0" dot={false} strokeWidth={1.5} name="Spot" />
                {charts.sessionVwap != null ? (
                  <Line type="monotone" dataKey="sessionVwap" stroke="#38bdf8" dot={false} strokeWidth={1} name="VWAP" />
                ) : null}
                {charts.referenceVwap != null ? (
                  <Line
                    type="monotone"
                    dataKey="referenceVwap"
                    stroke="#f59e0b"
                    dot={false}
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    name="Ref VWAP"
                  />
                ) : null}
                {charts.settlementCentral != null ? (
                  <Line
                    type="monotone"
                    dataKey="zoneCentral"
                    stroke="#14b8a6"
                    dot={false}
                    strokeWidth={1}
                    name="Settlement central"
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title="Call / Put OI by Strike">
        {oiRows.length === 0 ? (
          <p className="text-sm text-slate-500">UNAVAILABLE</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={oiRows}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="strike" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} width={48} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="callOi" fill="#f43f5e" name="Call OI" />
                <Bar dataKey="putOi" fill="#22c55e" name="Put OI" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title="OI Change by Strike">
        {oiRows.every((r: any) => r.callChg == null && r.putChg == null) ? (
          <p className="text-sm text-slate-500">UNAVAILABLE</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={oiRows}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="strike" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} width={48} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="callChg" stroke="#f43f5e" fill="#f43f5e33" name="Call ΔOI" />
                <Area type="monotone" dataKey="putChg" stroke="#22c55e" fill="#22c55e33" name="Put ΔOI" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    </div>
  );
}
