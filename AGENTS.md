# Base44 dev environment — Orbit (Next.js + Supabase)

## What this is
A Next.js 16 (App Router, Turbopack) social network. The web app lives in `src/`.
`orbit-mobile/` is a separate Expo/React Native companion app, excluded from the
web `tsconfig.json` and not part of the port-3000 preview.

## Running it
```
docker compose -f docker-compose.base44.yml up -d
```
- Web entry point is on host port **3000** (`next dev -H 0.0.0.0 -p 3000`).
- Source is bind-mounted into the `node:22` container; `npm ci` runs on startup, then
  `next dev` with live reload. Edits appear without rebuilding the image.
- `node_modules` lives in a named volume (`web_node_modules`) so host/container
  platform binaries don't collide.

## Environment / secrets
- `.env.base44-defaults` (committed) holds **placeholder** Supabase/Resend/cron
  values so the app boots with no real credentials. It is listed FIRST in the
  compose `env_file:` so real secrets always override it.
- `/run/base44/app.env` (platform-managed, outside the repo) is listed LAST and
  overrides the placeholders. Provide real `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` there for the
  app to actually read/write data and authenticate.
- Local-infra credentials are not needed — Supabase is a hosted service, so there
  is no database container in this compose setup.

## Verification
- `npm run build` — production build (what Vercel runs on push to `main`). Must exit 0.
- `npm run typecheck` — `tsc --noEmit`. Must be clean.
- `npm run lint` — ESLint; currently 0 errors / ~35 warnings (warnings don't fail CI).
- Preview: curl `http://localhost:3000/` returns 200 with the landing page; authed
  routes render their shells (data depends on real Supabase creds).

## Performance quirks
- `.next` is a named volume (`web_next`), not the bind mount: Turbopack writes a lot
  there. Don't run `npm run build` inside the dev container — it drops a ~1 GB
  production build into `.next` next to the dev cache. Run build/typecheck/lint in a
  throwaway container or accept the cleanup (`docker compose ... down`, then
  `docker volume rm app_web_next`).
- With the placeholder Supabase URL every server-side query fails and the Supabase
  client retries with backoff, so routes that query on the server (e.g. `/[username]`)
  take ~14 s and client pages sit on loading skeletons. Real Supabase credentials
  are the actual fix.
- Sign-up is `/signup`; `/register` is a redirect alias (`next.config.ts`). Without it
  `/register` is swallowed by the `/[username]` profile route.

## Notes
- `next.config.ts` has no `allowedDevOrigins` entry; Next 16 Turbopack dev has not
  blocked the preview origin in practice here. If the preview ever shows a blank
  page while curl works, add `allowedDevOrigins` covering the preview origin.
- The web build excludes `orbit-mobile/`; changes under `orbit-mobile/` do not
  affect the web build or the port-3000 preview.
