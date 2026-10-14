# CCTV Front End

React 19 + Vite + TypeScript dashboard for authenticated live MJPEG and HLS playback.
Requires Node.js 22.12+ or 24+.

The Korean interface includes camera search and state filters, grid/focus views, system
diagnostics, USB installation, and per-camera capture settings.

## Architecture

Front-end is organized by feature domains:

- `src/features/auth`: authentication/session lifecycle (`useAuthSession`)
- `src/features/streams`: stream list query (`useStreamsQuery`)
- `src/features/health`: adaptive health polling (`useHealthPolling`)
- `src/features/system`: system health query cache (`useSystemHealthQuery`)
- `src/features/player`: playback state/recovery policy (`useHlsPlayback`, `hlsErrorPolicy`)
- `src/features/device`: browser flashing and newline-delimited USB configuration
- `src/components`: presentational components
- `src/styles`: split stylesheet modules (`app.css`, `auth.css`, `stream-card.css`, `player.css`)

Authentication uses backend HttpOnly cookie session (`/api/auth/login`).

## Camera setup and streaming

Build the public, credential-free firmware from the repository root:

```bash
./scripts/build_firmware.sh
```

Log in and open **장비 설치** in desktop Chrome/Edge over HTTPS or localhost. Select
the USB serial port, confirm the AI Thinker ESP32-CAM board, install the firmware,
and enter the 2.4GHz Wi-Fi and server settings. USB-UART boards may need GPIO0
connected to GND and a reset before flashing; remove the jumper and reset afterward.

The server recommends a reachable LAN address for local development. For a camera
on a different network, enter the public HTTP(S) address of the same backend, including
any context path. `localhost` refers to the camera itself and is rejected. HTTPS verifies
the server certificate; a custom CA can be supplied for private certificates.

The browser obtains a per-stream publishing key from the authenticated backend and
sends it with the Wi-Fi configuration directly over USB. Wi-Fi passwords are not sent
to the backend or browser storage. Device keys are stored as SHA-256 digests on the
server. Each key is bound to an existing camera ID that the account is authorized to use.

The camera uploads JPEG frames to `/api/devices/{id}/video`; the default **실시간** player
reads authenticated multipart JPEG from `/api/live/{id}/stream.mjpeg`. The server keeps
only the newest frame, so viewers skip old frames when they fall behind. The **호환 재생**
option reads the existing FFmpeg HLS output and supports legacy LAN pull sources.
A separate pull converter is unnecessary for push mode. Do not run
the legacy pull converter for the same camera ID at the same time.

Open **송출 설정** on a camera card to change target FPS, resolution, JPEG quality,
and adaptive network behavior. Online devices fetch settings periodically, approximately
every 10 seconds. A change can briefly reconnect the video. These are capture settings,
not multiple viewer-selectable HLS quality variants. Actual FPS depends on the device
and network; normal HLS playback has several seconds of latency.

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

- `VITE_API_BASE_URL`: backend origin/context-path override (default empty, `/api/*` uses Vite proxy -> `8081`)
- `VITE_HLS_BASE_URL`: HLS base URL override (default `/hls`, Vite proxy -> `8081`)
- `VITE_HLS_URL`: full manifest URL override (for single-stream debug)
- `VITE_DEFAULT_USERNAME`: login form default username (default empty)
- `VITE_DEFAULT_PASSWORD`: login form default password (default empty)
- `VITE_PROXY_TARGET`: dev proxy target (default `http://127.0.0.1:8081`)

The Vite config binds localhost by default. `scripts/dev-up.sh --frontend-host <host>`
can explicitly enable LAN development access. Production hosting needs a reverse proxy
for `/api` and `/hls`; the development proxy is not included in the static build.
