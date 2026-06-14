# Render Deployment

This app needs a Render Web Service, not GitHub Pages, because it uses server-side auth, server functions, and Binance API calls.

## Settings

- Repository: `birukhios/binancebot`
- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Runtime: Node

## Required Environment Variables

Set these in Render after creating the service:

```env
NODE_ENV=production
BETTER_AUTH_URL=https://YOUR-RENDER-SERVICE.onrender.com
BETTER_AUTH_SECRET=<generate a long random secret>
BETTER_AUTH_DB_PATH=/tmp/auth.sqlite
BINANCE_TESTNET=true
SUPABASE_URL=<your Supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<your Supabase service role key>
SUPABASE_PUBLISHABLE_KEY=<your Supabase publishable key>
VITE_SUPABASE_URL=<same Supabase URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<same Supabase publishable key>
```

Optional Binance/proxy variables:

```env
BINANCE_PROXY_URL=
BINANCE_TESTNET_API_KEY=
BINANCE_TESTNET_API_SECRET=
BINANCE_API_KEY=
BINANCE_API_SECRET=
```

## Notes

- Keep live trading off until testnet works on Render.
- If Binance rejects Render's IP, check the app Settings page for the server public IP and update the Binance API key allow-list.
- Free Render services may sleep when idle.
- Free Render services have an ephemeral filesystem, so the local Better Auth SQLite file can reset after redeploys/restarts. For durable production login state, use a paid persistent disk or move auth storage to a managed database.
