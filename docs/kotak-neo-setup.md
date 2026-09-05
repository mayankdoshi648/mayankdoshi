# Kotak Neo setup (Market Breadth live quotes)

## What Neo is used for

- **Live CMP + % change** for Nifty, Bank Nifty, India VIX, size indices, and sector indices on the standalone Market Breadth page (`/breadth`).
- Neo does **not** provide historical candles, so DMA/EMA breadth still uses Yahoo (or Dhan when configured).

## Minimum setup (quotes only)

1. In your project folder `C:\Darvax Brain`, open `.env` (or `mayankdoshi\.env` if the repo is nested) and set:

```bash
KOTAK_NEO_CONSUMER_KEY=your_consumer_access_token
```

Also accepted: `KOTAK_CONSUMER_KEY`, `NEO_CONSUMER_KEY`, `CONSUMER_KEY`.

2. In PowerShell from that folder, pull the Kotak branch and restart:

```powershell
cd "C:\Darvax Brain"
# if the repo is nested:
# cd "C:\Darvax Brain\mayankdoshi"
git fetch
git checkout cursor/kotak-neo-api-b028
git pull
npm start
```

3. Open http://localhost:3000/breadth — status should show `· kotak-neo`.
4. `GET /api/status` includes `kotakNeo.quotesReady: true` when the key is set.

Market Breadth is a **separate page** from PowerBull Pro (`/`), so the two dashboards stay independent.

**Note:** `.env` is gitignored. Cloud agents cannot read your Windows `.env` — add the same key as a Cursor Cloud secret if you want Neo quotes in the cloud agent.

## Optional trade session

Needed only if you later use Neo order/WS APIs (not required for breadth quotes):

```bash
KOTAK_NEO_MOBILE=+91XXXXXXXXXX
KOTAK_NEO_UCC=your_ucc
KOTAK_NEO_MPIN=your_mpin
KOTAK_NEO_TOTP_SECRET=base32_secret_from_neo
# or one-shot: KOTAK_NEO_TOTP=123456
```

## Fallback

If `KOTAK_NEO_CONSUMER_KEY` is missing or Neo quotes fail, the overview falls back to NSE `allIndices`.
