# Cloudflare Pages — free permanent deployment

PowerBull Pro can run **without Render** on Cloudflare’s free tier:

- **Cloudflare Pages** serves `frontend/` (HTTPS + CDN + `*.pages.dev` URL)
- **Pages Functions** (`functions/api/[[path]].js`) run the F&O REST API (same engines as Express)
- **Dhan secrets** stay in Pages Environment Variables and/or encrypted httpOnly cookies
- **GitHub Pages** remains the static MOCK demo — do not delete it until Cloudflare is verified

## Architecture

```
USER → https://<project>.pages.dev
         ↓
   Cloudflare Pages (static UI)
         ↓  /api/*
   Pages Function (Worker)
      ↙           ↘
   Dhan REST     NSE public
      ↘           ↙
   HybridProvider → normalize → FnoService engines → JSON
```

**Not on Cloudflare free (Node-only):** equity Dhan WebSocket `/live`, SQLite signals, DarvaX persistence, PIN/TOTP token minting, live Equity Markets 52w board (Markets shows demo quotes on CF).

If a feature exceeds Workers CPU time on the free plan (rare; heavy scanner cold start), **stop and stay on free alternatives** — do not add paid hosting unless you choose to.

## One-time Cloudflare setup

> **Critical:** create a **Pages** project, not a Worker.  
> If the form shows **Deploy command** (and no **Build output directory**), you are on the Workers path — that will fail with `error occurred while running deploy command`. Go back and choose **Pages → Connect to Git**.

1. Push this repo to GitHub (already done for `mayankdoshi648/mayankdoshi`).
2. Open [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → **Pages** → **Import an existing Git repository** (or **Connect to Git**).
3. Select the repository. Configure:

| Field | Value |
|-------|--------|
| Framework preset | **None** |
| Build command | `npm ci && npm run build:cloudflare` |
| **Build output directory** | `frontend` |
| Root directory | `/` (repo root) |
| Node version | `22` (Environment variable `NODE_VERSION=22` if asked) |
| Deploy command | **Do not set** — Pages has no Deploy command field |

4. **Compatibility:** `wrangler.toml` sets `nodejs_compat` and `pages_build_output_dir = "frontend"`. Pages Functions in `functions/` deploy automatically with the site.
5. After first deploy, open **Settings → Environment variables** (Production):

### SECRET variables

| Variable | Type | Purpose |
|----------|------|---------|
| `SESSION_SECRET` | Secret | Encrypts per-browser Dhan credential cookies |
| `DHAN_CLIENT_ID` | Secret | Optional shared host Client ID |
| `DHAN_ACCESS_TOKEN` | Secret | Optional shared host Access Token (never put in frontend) |
| `ADMIN_SETUP_KEY` | Secret | Optional; if set, credential PUT/DELETE requires `X-Setup-Key` |

### PUBLIC / plain variables

| Variable | Type | Purpose |
|----------|------|---------|
| `DEMO_MODE` | Plain | `false` for live F&O (default) |
| `FNO_FORCE_MOCK` | Plain | Leave unset; `1` forces labeled mock |
| `DHAN_API_BASE` | Plain | Optional override (`https://api.dhan.co`) |

6. Redeploy after saving secrets.
7. Permanent URL: `https://<project-name>.pages.dev` (or attach a custom domain for free).

Suggested project name: `powerbullpro` → `https://powerbullpro.pages.dev`.

## GitHub connection

Connecting Pages to GitHub enables:

```
git push → Cloudflare build → automatic deploy → same permanent URL
```

No laptop needs to stay on. No Render required.

## How to enter Dhan credentials

### Option A — shared host secrets (best for a personal permanent link)

Set `DHAN_CLIENT_ID` + `DHAN_ACCESS_TOKEN` in Cloudflare Secrets. Anyone with the URL sees live F&O using that account (token never exposed to the browser).

### Option B — per visitor (More → Dhan API)

1. Open the permanent URL
2. **More → Dhan API**
3. Enter **Client ID** + **Access Token**
4. Click **Save & use live**
5. UI shows **DHAN CONNECTED ✓**; token field is cleared
6. Token is sealed into an **httpOnly Secure cookie** (not localStorage, not URL)

### Temporary URL bootstrap (avoid for sharing)

`https://powerbullpro.pages.dev/?client_id=XXX&token=YYY`

The app immediately `history.replaceState` strips the query, then PUTs credentials into the session cookie. **Do not share links that contain tokens.**

## Local preview of the Function bundle

```bash
npm ci
npm run build:cloudflare
npx wrangler pages dev frontend --compatibility-flags=nodejs_compat
```

## Verify checklist

- [ ] `https://….pages.dev` loads over HTTPS on phone + laptop
- [ ] `/api/health` returns `runtime: cloudflare-pages`
- [ ] `/api/fno/ticker` returns JSON (NSE indices even without Dhan)
- [ ] More → Dhan API connects; GET status never returns the raw token
- [ ] Scanner / Smart Money / Opportunity / Playbook still render
- [ ] GitHub Pages MOCK URL still works independently
- [ ] No secrets committed to GitHub

## Troubleshooting deploy failures

| Symptom | Cause | Fix |
|---------|--------|-----|
| Build OK, **Deploying** fails: `error occurred while running deploy command` | Project was created as a **Worker** (form had **Deploy command**) | Delete that project. Recreate via **Pages → Connect to Git**. Use **Build output directory = `frontend`**. Leave Deploy command empty (field should not exist). |
| `Project not found [code: 8000007]` | `wrangler pages deploy` against a Worker name | Same as above — need a real Pages project |
| No **Build output directory** field | Wrong create wizard (Workers Builds) | Back out → **Create** → **Pages** → **Import existing Git repository** |
| Build fails on `build:cloudflare` | Node too old / missing lockfile | Set `NODE_VERSION=22`; ensure `package-lock.json` is on `master` |

### Delete the failed Worker project

1. **Workers & Pages** → open `mayankdoshipowerbullpro`
2. **Settings** → scroll to **Delete application / Delete project**
3. Confirm delete
4. Recreate as **Pages** using the table above (suggested name: `powerbullpro`)

## Troubleshooting Dhan / NSE

| Symptom | Check |
|---------|--------|
| MOCK banner | Credentials missing / expired token / `FNO_FORCE_MOCK` |
| 401 from Dhan | Paste a fresh Access Token; CF cannot mint via PIN/TOTP |
| Wrong LTP | `/api/fno/instruments/resolve?symbol=RELIANCE&kind=FUTURES` — confirm securityId |
| NSE indices fail | NSE may block some data-center IPs; indices fall back to labeled mock |
| CPU timeout on scanner | Retry once (warm isolate); if persistent, free Workers CPU may be insufficient — stay on REST + cache, do not add paid plans without deciding |
| Cookie not sticking | Needs HTTPS; use `*.pages.dev` or custom domain with Secure cookies |

## Updating the app later

```bash
git checkout master
# …edit…
git commit && git push
# Cloudflare Pages rebuilds automatically
```

GitHub Pages MOCK updates via its own workflow; leave it until Cloudflare live is confirmed.
