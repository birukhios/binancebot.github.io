# Vercel Deployment

This app can run on Vercel as a server-backed deployment.

## Settings

- Framework preset: Other
- Build command: `npm run build`
- Output directory: `.vercel/output`

## Notes

- `vite.config.ts` pins Nitro to the `vercel` preset, so the build emits Vercel-ready output.
- The Vercel build uses Node entry format with a 60-second function limit and 1024 MB memory.
- Set `BETTER_AUTH_DB_PATH=/tmp/auth.sqlite` in Vercel so the auth DB uses writable serverless storage.
- Keep the same environment variables you use locally for auth and Binance access.
- Vercel still treats that SQLite file as ephemeral, so login state can reset on redeploys.
