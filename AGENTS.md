# Orbit — Base44 Development Notes

## Stack
- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4
- Supabase (Postgres + Auth + Storage + Realtime) is the sole backend — the app is non-functional without real Supabase credentials
- Package manager: npm (lockfile: `package-lock.json`)

## Running in Base44
- `docker compose -f docker-compose.base44.yml up -d` starts the Next.js dev server on port 3000
- Source is bind-mounted; `node_modules` and `.next` use named volumes (persist across restarts)
- `npm ci` runs only on first boot (when `node_modules/.package-lock.json` is missing)
- Dev server: `next dev -H 0.0.0.0 -p 3000` with watchpack polling for bind-mount reliability

## Environment
- `.env.base44-defaults` — placeholder values so the app boots without real credentials (committed)
- `/run/base44/app.env` — real secrets delivered by the platform (overrides defaults)
- Required for full functionality: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Without real Supabase credentials, only the static landing page (`/`) renders; all backend calls fail gracefully

## Next.js config
- `allowedDevOrigins` in `next.config.ts` is set from `BASE44_PUBLIC_HOST_SUFFIX` so the preview origin can access dev assets/HMR
- `BASE44_PUBLIC_HOST_SUFFIX` is passed to the web service via compose `environment:`

## Verification
- `curl -s http://localhost:3000/` returns the Orbit landing page HTML
- Healthcheck: node-based HTTP GET to `/` (status < 500 = healthy)
- The landing page is a static server component — no Supabase calls, renders without a backend

## Migrations
- SQL migrations live in `supabase/migrations/` — apply via `supabase db push` against a real Supabase project (not run in Base44 sandbox)
