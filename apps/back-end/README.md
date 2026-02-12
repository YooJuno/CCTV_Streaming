# Back End (Spring Boot)

Serves health checks and HLS static files.

## Endpoints

- Health: `/health`
- HLS: `/hls/{streamId}.m3u8`

`hls.path` can be configured in `apps/back-end/src/main/resources/application.properties`.
`hls.allowed-origins` controls CORS for `/hls/**` (default `http://localhost:5173`).
`/health` includes basic HLS directory readability/writability info.

See root `README.md` for full run instructions.
