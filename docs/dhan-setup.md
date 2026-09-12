# Dhan Setup

Preferred auth for this app is a **static Access Token** with your **Client ID**.
No PIN or TOTP required for that path.

## Preferred: Client ID + Access Token

1. Log into [web.dhan.co](https://web.dhan.co)
2. Open **My Profile → API** (or Access Token / API Access)
3. Copy your **Client ID** (`dhanClientId`)
4. Generate / copy an **Access Token**
5. Put them in `.env` (copy from `.env.example` if needed):

```bash
DHAN_CLIENT_ID=your_client_id
DHAN_ACCESS_TOKEN=your_access_token
# optional: DHAN_ACCESS_TOKEN_EXPIRY=2026-09-13T18:00:00+05:30
```

6. Restart the app:

```bash
npm start
```

Or paste the same values in the UI: **More → Dhan API** → Save & use live.

Access tokens expire (often ~24h). When quotes stop, paste a fresh token — Client ID stays the same.

### Cloudflare Pages

Set Worker/Pages secrets:

- `SESSION_SECRET` (required)
- `DHAN_CLIENT_ID`
- `DHAN_ACCESS_TOKEN`

Never put tokens in the shareable URL. `GET /api/fno/credentials/dhan` never returns the token value.

## Alternate (Node only): PIN + TOTP

On a local Node server you can mint tokens automatically at startup:

```bash
DHAN_CLIENT_ID=your_client_id
DHAN_PIN=your_trading_pin
DHAN_TOTP_SECRET=your_base32_totp_secret
```

Use the **Base32 TOTP secret** from Dhan 2FA setup — not a 6-digit authenticator code.

This path is **not** supported on Cloudflare Pages free deploy (no PIN/TOTP minting there). Prefer Access Token on CF.

## Security

- `.env` is gitignored — never commit real Client ID / Access Token / PIN / TOTP secret
- Prefer Access Token over storing PIN + TOTP when you can rotate the token easily
- Clear credentials anytime via **More → Dhan API → Clear**, or delete the env vars and restart

## Verify

```bash
# After npm start
curl -s http://localhost:3000/api/status | head
curl -s http://localhost:3000/api/fno/credentials/dhan
```

Status should show Dhan connected / live-capable when Client ID + Access Token are set.
