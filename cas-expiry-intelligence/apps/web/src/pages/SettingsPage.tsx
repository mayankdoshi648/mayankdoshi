import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Panel, Pill } from '../components/ui';

export function SettingsPage() {
  const [configured, setConfigured] = useState(false);
  const [clientId, setClientId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [masked, setMasked] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [futIds, setFutIds] = useState<Record<string, string>>({ NIFTY: '', BANKNIFTY: '' });
  const [liveApi, setLiveApi] = useState('');

  const refreshFutures = () =>
    api
      .getFuturesSettings()
      .then((r) => {
        const next: Record<string, string> = { NIFTY: '', BANKNIFTY: '' };
        for (const m of r.mappings ?? []) {
          next[m.instrumentId] = m.securityId ?? '';
        }
        setFutIds(next);
      })
      .catch((e) => setErr(e.message));


  const refresh = () =>
    api
      .getDhanSettings()
      .then((r) => {
        setConfigured(Boolean((r as any).configured));
        setMasked((r as any).clientIdMasked ?? (r as any).clientIdMasked ?? null);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    setLiveApi(api.getLiveApiOrigin() || '');
    refresh();
    refreshFutures();
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Panel title="Live API host" tone="accent">
        <p className="mb-3 text-sm text-slate-400">
          GitHub Pages is static. Paste your Cloudflare Worker URL once in this browser so Dhan Client ID + Access Token
          can be saved to the live host (encrypted httpOnly cookie). Never put the token in the shareable URL.
        </p>
        <label className="mb-3 block text-xs text-slate-400">
          Cloudflare Worker URL
          <input
            className="mt-1 w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-sm"
            value={liveApi}
            onChange={(e) => setLiveApi(e.target.value)}
            placeholder="https://mayankdoshi.&lt;subdomain&gt;.workers.dev"
            autoComplete="off"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-terminal-accent/20 px-4 py-2 text-sm text-terminal-accent"
            onClick={() => {
              setErr(null);
              setMsg(null);
              const origin = api.setLiveApiOrigin(liveApi);
              if (!origin) {
                setErr('Enter a valid https:// Worker URL');
                return;
              }
              setLiveApi(origin);
              setMsg(`Live API host saved: ${origin}`);
              refresh();
            }}
          >
            Save host
          </button>
          <button
            className="rounded-lg bg-terminal-danger/15 px-4 py-2 text-sm text-terminal-danger"
            onClick={() => {
              api.setLiveApiOrigin('');
              setLiveApi('');
              setMsg('Live API host cleared');
            }}
          >
            Clear host
          </button>
        </div>
      </Panel>

      <Panel title="Dhan Market Data Credentials" tone="accent">
        <p className="mb-4 text-sm text-slate-400">
          Market-data credentials only. This app never places, modifies, or cancels orders. Secrets are encrypted at rest
          and never returned to the browser after save.
          {api.hasLiveApiOrigin()
            ? ' Credentials save to the Live API host above.'
            : ' On GitHub Pages, set Live API host first.'}
        </p>
        <div className="mb-3 flex gap-2">
          <Pill tone={configured ? 'ok' : 'warn'}>{configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</Pill>
          {masked ? <Pill>{masked}</Pill> : null}
        </div>
        <label className="mb-3 block text-xs text-slate-400">
          Client ID
          <input
            className="mt-1 w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-sm"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="mb-4 block text-xs text-slate-400">
          Access Token
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-sm"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-terminal-accent/20 px-4 py-2 text-sm text-terminal-accent"
            onClick={async () => {
              setErr(null);
              setMsg(null);
              try {
                await api.saveDhanSettings(clientId, accessToken);
                setAccessToken('');
                setMsg('Saved.');
                refresh();
              } catch (e: any) {
                setErr(e.message);
              }
            }}
          >
            Save
          </button>
          <button
            className="rounded-lg bg-terminal-danger/15 px-4 py-2 text-sm text-terminal-danger"
            onClick={async () => {
              setErr(null);
              setMsg(null);
              try {
                await api.clearDhanSettings();
                setClientId('');
                setAccessToken('');
                setMsg('Cleared.');
                refresh();
              } catch (e: any) {
                setErr(e.message);
              }
            }}
          >
            Clear
          </button>
        </div>
        {msg ? <p className="mt-3 text-xs text-terminal-ok">{msg}</p> : null}
        {err ? <p className="mt-3 text-xs text-terminal-danger">{err}</p> : null}
      </Panel>

      <Panel title="Futures Security IDs" subtitle="Required for basis" tone="accent">
        <p className="mb-3 text-sm text-slate-400">
          Dhan futures security IDs change with the contract month. Leave blank to keep Futures / Basis as UNAVAILABLE.
          Values are stored server-side only.
        </p>
        <div className="space-y-3">
          {['NIFTY', 'BANKNIFTY'].map((id) => (
            <label key={id} className="block text-xs text-slate-400">
              {id} futures security ID
              <input
                className="mt-1 w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-sm"
                value={futIds[id] ?? ''}
                onChange={(e) => setFutIds((prev) => ({ ...prev, [id]: e.target.value }))}
                autoComplete="off"
                placeholder="UNAVAILABLE until set"
              />
            </label>
          ))}
        </div>
        <button
          className="mt-4 rounded-lg bg-terminal-accent/20 px-4 py-2 text-sm text-terminal-accent"
          onClick={async () => {
            setErr(null);
            setMsg(null);
            try {
              await api.saveFuturesSettings(futIds);
              setMsg('Futures IDs saved.');
              refreshFutures();
            } catch (e: any) {
              setErr(e.message);
            }
          }}
        >
          Save Futures IDs
        </button>
      </Panel>

    </div>
  );
}
