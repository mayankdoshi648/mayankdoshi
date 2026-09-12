# Cloudflare — free permanent deployment

PowerBull Pro can run **without Render** on Cloudflare’s free tier.

## Recommended path (matches your existing project)

You already have Workers Builds project **`mayankdoshi`**. Use **Worker + Assets** (not Pages `wrangler pages deploy`).

### Dashboard → Settings → Builds

Set **exactly**:

| Field | Value |
|-------|--------|
| **Production branch** | `master` |
| **Build command** | `npm ci && npm run build` |
| **Deploy command** | `npm run deploy` |
| **Version command** | `npm run deploy:version` |
| Root directory | `/` |

> **This is the CI fix.**  
> - `npm run build` now writes `dist/worker.js` (required entry point).  
> - Deploy **must** be `npm run deploy` — never `wrangler pages deploy`.  
> - Production branch **must** be `master` (not `main`), or every push uses the Version command.

Then **Save** → **Deployments** → **Retry deployment**.

See also [`cloudflare-deploy-fix.md`](./cloudflare-deploy-fix.md).

Permanent URL after green deploy:

`https://mayankdoshi.<your-subdomain>.workers.dev`  
(or the workers.dev / custom domain shown on the project Overview)

### Secrets (Settings → Variables and Secrets)

| Variable | Type | Purpose |
|----------|------|---------|
| `SESSION_SECRET` | Secret | Encrypts per-browser Dhan cookies (**required**) |
| `DHAN_CLIENT_ID` | Secret | Optional shared host Client ID |
| `DHAN_ACCESS_TOKEN` | Secret | Optional shared host Access Token |
| `ADMIN_SETUP_KEY` | Secret | Optional; require `X-Setup-Key` to change credentials |
| `DEMO_MODE` | Plain | `false` for live F&O |
| `FNO_FORCE_MOCK` | Plain | Leave unset for live |

Redeploy once after saving secrets.

## Architecture

```
USER → https://mayankdoshi….workers.dev
         ↓
   Cloudflare Worker
      ↙           ↘
  /api/*         static assets (frontend/)
  FnoService     ASSETS binding
      ↙    ↘
   Dhan    NSE
```

**Not on Cloudflare free (Node-only):** equity Dhan WebSocket `/live`, SQLite signals, DarvaX persistence, PIN/TOTP minting, live Equity Markets 52w board (Markets shows demo quotes on CF).

## Alternate path — classic Pages (optional)

Only if you delete the Worker project and want `*.pages.dev`:

1. Workers & Pages → **Create** → **Pages** → **Connect to Git**
2. Framework **None**
3. Build: `npm ci && npm run build:cloudflare`
4. **Build output directory:** `frontend`
5. No Deploy command field

Do **not** mix Pages deploy commands with a Worker project.

## How to enter Dhan credentials

### Option A — shared host secrets

Set `DHAN_CLIENT_ID` + `DHAN_ACCESS_TOKEN` in Cloudflare Secrets.

### Option B — per visitor (More → Dhan API)

Enter Client ID + Access Token → **Save & use live** → token sealed in httpOnly cookie (never in URL).

## Local preview

```bash
npm ci
npm run build:cloudflare
npx wrangler dev
```

## Verify checklist

- [ ] Deploy command is `npx wrangler deploy` (not `pages deploy`)
- [ ] Workers Builds check is green on GitHub
- [ ] Site loads on phone + laptop over HTTPS
- [ ] `/api/health` returns `runtime: cloudflare`
- [ ] `/api/fno/ticker` returns JSON
- [ ] Dhan connect works; GET never returns raw token
- [ ] GitHub Pages MOCK still works
- [ ] No secrets in GitHub

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `error occurred while running deploy command` | Set Deploy command to `npx wrangler deploy` and Retry |
| `Project not found [8000007]` | Same — stop using `wrangler pages deploy` on this Worker |
| Build OK, site 404 on `/api` | Confirm `npm run build:cloudflare` produces `dist/worker.js` |
| MOCK banner | Add Dhan secrets or connect via More → Dhan API |
| F&O scanner still mock while NSE is live | Merge/redeploy PR with bundled futures security ids (CF cannot parse Dhan’s 25MB scrip CSV) |
| 401 from Dhan | Paste a fresh Access Token |

## Updating later

```bash
git checkout master
# …edit…
git commit && git push
# Workers Builds redeploys automatically
```
