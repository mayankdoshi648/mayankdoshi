# Dhan Setup

This app uses a manually-generated access token — no OAuth flow, since
it's a single-user personal app.

1. Log into https://web.dhan.co
2. Go to "Access DhanHQ APIs" (developer/API section of your profile).
3. Generate an access token. Copy your Client ID (`dhanClientId`) and
   the generated token into `.env` as `DHAN_CLIENT_ID` and
   `DHAN_ACCESS_TOKEN` (see `.env.example`).
4. The token is valid for **24 hours from generation**. Every trading
   day, regenerate it at web.dhan.co and restart the server
   (`npm start`) before 9:30 IST — there is no in-app refresh flow.
