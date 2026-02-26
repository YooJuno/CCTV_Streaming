# CCTV Front End

React 19 + Vite + TypeScript dashboard for authenticated multi-stream HLS playback.

## Architecture

Front-end is organized by feature domains:

- `src/features/auth`: authentication/session lifecycle (`useAuthSession`)
- `src/features/streams`: stream list query (`useStreamsQuery`)
- `src/features/health`: adaptive health polling (`useHealthPolling`)
- `src/features/system`: system health query cache (`useSystemHealthQuery`)
- `src/features/player`: playback state/recovery policy (`useHlsPlayback`, `hlsErrorPolicy`)
- `src/components`: presentational components
- `src/styles`: split stylesheet modules (`app.css`, `auth.css`, `stream-card.css`, `player.css`)

Authentication uses backend HttpOnly cookie session (`/api/auth/login`).

## Run

```bash
cd apps/frontend
npm install
npm run dev
```

Open `http://localhost:5174`.

## Quality Gates

```bash
# static
npm run typecheck

# unit/component tests
npm run test:run

# production build
npm run build

# e2e tests (Playwright)
npm run e2e
```

Before first E2E run on a machine:

```bash
npx playwright install chromium
```

## Environment variables

- `VITE_API_BASE_URL`: API base URL override (default `/api`, Vite proxy -> `8081`)
- `VITE_HLS_BASE_URL`: HLS base URL override (default `/hls`, Vite proxy -> `8081`)
- `VITE_HLS_URL`: full manifest URL override (for single-stream debug)
- `VITE_DEFAULT_USERNAME`: login form default username (default empty)
- `VITE_DEFAULT_PASSWORD`: login form default password (default empty)
- `VITE_PROXY_TARGET`: dev proxy target (default `http://127.0.0.1:8081`)
