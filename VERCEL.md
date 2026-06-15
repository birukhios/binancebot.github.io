# Vercel Deployment

This app can run on Vercel as a server-backed deployment.

## Settings

- Framework preset: Other
- Build command: `npm run build`
- Output directory: `.vercel/output`

## Notes

- `vite.config.ts` pins Nitro to the `vercel` preset, so the build emits Vercel-ready output.
- Keep the same environment variables you use locally for auth and Binance access.
- Vercel works best with external auth/storage; the current SQLite auth path is good for local use only.
