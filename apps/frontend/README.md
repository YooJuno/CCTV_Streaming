# CCTV Front End

React 19 + Vite + TypeScript dashboard for authenticated multi-stream HLS playback.

## Run

```bash
cd apps/frontend
npm install
npm run dev
```

Open `http://localhost:5174`.

## Test

```bash
npm run test:run
```

## Environment variables

- `VITE_API_BASE_URL`: API base URL override (default `/api`, Vite proxy -> `8081`)
- `VITE_HLS_BASE_URL`: HLS base URL override (default `/hls`, Vite proxy -> `8081`)
- `VITE_HLS_URL`: full manifest URL override (for single-stream debug)
- `VITE_DEFAULT_USERNAME`: login form default username
- `VITE_DEFAULT_PASSWORD`: login form default password
- `VITE_PROXY_TARGET`: dev proxy target (default `http://127.0.0.1:8081`)
