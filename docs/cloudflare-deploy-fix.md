# Cloudflare deploy — fix “Failed: error occurred while running deploy command”

## Why it fails

Your Git project **`mayankdoshipowerbullpro` is a Worker** (Workers Builds).

If **Deploy command** is still:

```text
npx wrangler pages deploy …
```

deploy **always** fails. That command is only for Pages projects.

## Exact settings to paste

Open:

**Workers & Pages → mayankdoshipowerbullpro → Settings → Builds**

Set:

| Field | Value |
|--------|--------|
| **Build command** | `npm ci && npm run build:cloudflare` |
| **Deploy command** | `npm run deploy` |
| **Non-production branch deploy command** (if shown) | `npm run deploy` |

Then click **Save** → **Retry deployment**.

`npm run deploy` rebuilds `dist/worker.js` and runs `wrangler deploy` (Worker + Assets). It never calls `pages deploy`.

## After a green build

1. Open the project **Overview**
2. Copy the `*.workers.dev` URL
3. Optional secrets under **Settings → Variables and Secrets**:
   - `SESSION_SECRET` (required for Dhan cookie login)
   - `DHAN_CLIENT_ID` / `DHAN_ACCESS_TOKEN` (optional shared live account)

## If it still fails

Scroll to the bottom of the build log (red lines under **Deploying**) and check:

| Log text | Meaning |
|----------|---------|
| `pages deploy` / `Project not found` | Deploy command still wrong — must be `npm run deploy` |
| `dist/worker.js was not found` | Build command missing `npm run build:cloudflare` |
| `Authentication error` | Reconnect Git / regenerate Workers Builds API token in Settings → Builds |

Paste the last ~20 red log lines here if you want them decoded.
