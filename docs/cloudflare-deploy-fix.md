# Cloudflare deploy — fix “Failed: error occurred while running deploy command”

## Most common cause

Cloudflare ran deploy **without** a Worker bundle at `dist/worker.js`.

That happens if Build is `npm run build` and `build` used to be a no-op.  
It is now fixed in the repo: **`npm run build` creates `dist/worker.js`**.

## Paste these Builds settings

**Workers & Pages → mayankdoshi → Settings → Builds**

| Field | Value |
|--------|--------|
| **Production branch** | `master` |
| **Build command** | `npm ci && npm run build` |
| **Deploy command** | `npm run deploy` |
| **Version command** | `npm run deploy:version` |

Save → **Deployments → Retry deployment**.

### Do not use

```text
npx wrangler pages deploy
```

That is for Pages. This project is Worker **`mayankdoshi`**.

## What each command does

- `npm run build` → writes `dist/worker.js`
- `npm run deploy` → rebuilds, then `wrangler deploy`
- `npm run deploy:version` → rebuilds, then `wrangler versions upload` (preview)

## If it still fails

Open the failed build → scroll to **Deploying** (red). Copy the last ~20 lines.

Typical messages:

| Log | Fix |
|-----|-----|
| `Missing entry-point` / `dist/worker.js` not found | Build command must include `npm run build` |
| `Project not found` / `pages deploy` | Deploy command must be `npm run deploy` |
| Auth / API token | Settings → Builds → refresh API token |
| Wrong branch | Production branch must be `master` |
