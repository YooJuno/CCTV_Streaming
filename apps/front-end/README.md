# CCTV Front End

React 19 + Vite + TypeScript dashboard for authenticated multi-stream HLS playback.

## Run

```bash
cd apps/front-end
npm install
npm run dev
```

Open `http://localhost:5173`.

## Test

```bash
npm run test:run
```

## Environment variables

- `VITE_API_BASE_URL`: API base URL (default `http://localhost:8080`)
- `VITE_HLS_BASE_URL`: HLS base URL (default `http://localhost:8080/hls`)
- `VITE_HLS_URL`: full manifest URL override (for single-stream debug)
- `VITE_DEFAULT_USERNAME`: login form default username
- `VITE_DEFAULT_PASSWORD`: login form default password
