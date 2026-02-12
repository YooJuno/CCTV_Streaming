# CCTV Front End

React + Vite front-end with an HLS player (`hls.js`).

## Run

```bash
cd apps/front-end
npm install
npm run dev
```

Open `http://localhost:5173`.

## Environment variables

- `VITE_HLS_BASE_URL`: base URL for manifests (default `http://localhost:8080/hls`)
- `VITE_HLS_URL`: full manifest URL override (takes priority over base URL)
- `VITE_STREAM_ID`: default stream id shown in UI (default `mystream`)
