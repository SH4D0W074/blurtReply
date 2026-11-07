# Public demo for today

The app needs a running Node.js 24+ server and a writable SQLite file. A static-only website host is not enough.

## Temporary HTTPS link

`start-demo.command` builds the app, runs a separate production server on port 4310, and opens a Cloudflare Quick Tunnel. It leaves the development server on port 3000 alone. Install `cloudflared` first, or set `BLURT_CLOUDFLARED` to the executable location. Dependencies must already be installed with `pnpm install --frozen-lockfile`.

```sh
./start-demo.command
```

Share the `https://…trycloudflare.com` link printed in the terminal. Keep that terminal open and this computer awake and online. On macOS the launcher prevents idle sleep while it runs; keep the lid open. Press Control-C to stop the link and the separate demo server. A new run creates a new URL.

The launcher uses `.env.local` by default. `BLURT_DEMO_ENV_FILE=/absolute/path/to/.env.local` can point to an existing configuration when running from a separate checkout. Keys stay on the server. `BLURT_DEMO_PORT` optionally selects another port.

Visitors have separate browser sessions. Demo data is stored in `.local/public-demo.sqlite`, separate from local development sessions. The launcher does not copy existing practice data. Do not promise long-term retention for this temporary demo.

Live practice uses the configured OpenAI and optional ElevenLabs keys. Existing per-process caps apply across all visitors: by default 60 text calls, 12 transcriptions, and 30 generated question audio clips. A full practice uses multiple calls. Restarting the server resets those counters. The free guided demo needs no paid calls, and typed answers/device voice remain alternatives when a voice limit is reached.

## Why the public-demo setting exists

`VIVACOACH_PUBLIC_DEMO=true` requires production mode, permits the public tunnel hostname, and marks session cookies Secure. It does not turn on a development server. Keep `VIVACOACH_HOST=127.0.0.1` when using the tunnel. Do not rewrite the HTTP Host header: the browser Origin and Host need to match for write requests. Existing source-file blocking, browser ownership, body limits, and same-origin checks remain active.

## Render hosting for the demo

`render.yaml` defines one free Node web service with HTTPS, a health check, and automatic deploys disabled. It starts with the free guided demo enabled and live AI disabled. No provider secrets are included.

1. Push these deployment changes to your private `blurtReply` GitHub repository.
2. Sign in to [Render](https://dashboard.render.com/), connect the GitHub repository, and create a **Blueprint** from the branch containing `render.yaml`.
3. Deploy the `blurtreply-demo` service. Render displays its public `onrender.com` URL when ready.
4. After approving public live-AI use, add `OPENAI_API_KEY` and optionally `ELEVENLABS_API_KEY` in Render's environment settings and set `VIVACOACH_LIVE_AI=true`. The keys belong in secret settings, never in Git or browser variables.

Render's free service sleeps after 15 minutes without traffic and can take about a minute to wake. Its SQLite sessions are temporary and can disappear on idle shutdown, restart, or redeploy. Provider counters also reset on process restart. Open the site shortly before demonstrating; do not use this plan for long-term student records. See [Render free-service limits](https://render.com/docs/free).

## Other Node hosting

The same production app can run on a Node.js 24+ host with HTTPS:

1. Install dependencies with `pnpm install --frozen-lockfile` and run `pnpm build`.
2. Set `NODE_ENV=production`, `VIVACOACH_PUBLIC_DEMO=true`, `VIVACOACH_HOST=0.0.0.0`, and the host-provided `PORT`.
3. Set `VIVACOACH_DB_PATH` to writable persistent storage. Run a single instance; SQLite files and provider counters are not shared between replicas.
4. Supply API keys through the host's secret settings, then run `pnpm start`.

Without persistent storage, saved sessions can disappear on a restart or redeploy. No Supabase account is required for the temporary demo.

Cloudflare Quick Tunnels have no uptime guarantee, use a new hostname for each run, and allow up to 200 in-flight requests. They do not support SSE; this app uses ordinary HTTP polling. See [Cloudflare's Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Connection failure during setup

On 7 November 2026, the local Cisco Umbrella filter returned HTTP 403 for `api.trycloudflare.com`, so no public tunnel URL was created. The launcher cleaned up its server and tunnel processes. Use an allowed network or an independent host such as Render; do not disable network protection to force the tunnel through.
