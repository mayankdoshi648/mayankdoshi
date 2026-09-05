# Kotak Neo setup (Market Breadth live quotes)

## What Neo is used for

- **Live CMP + % change** for Nifty, Bank Nifty, India VIX, size indices, and sector indices on the Market Breadth tab.
- Neo does **not** provide historical candles, so DMA/EMA breadth still uses Yahoo (or Dhan when configured).

## Minimum setup (quotes only)

1. Create a Neo API app and copy the **consumer access token**.
2. Put it in `.env`:

```bash
KOTAK_NEO_CONSUMER_KEY=your_consumer_access_token
```

3. Restart the server (`npm start`).
4. Open http://localhost:3000/?tab=breadth — status should show `quoteSource: kotak-neo` (or `Overview … · kotak-neo` in the UI).
5. `GET /api/status` includes `kotakNeo.quotesReady: true` when the key is set.

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
