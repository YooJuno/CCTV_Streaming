# Back End (Spring Boot)

Provides JWT auth, stream authorization, health checks, and HLS static files.

## Endpoints

- Health: `/health`
- Auth login: `POST /api/auth/login`
- Current user: `GET /api/auth/me`
- Authorized streams: `GET /api/streams`
- HLS: `/hls/{streamId}.m3u8` (JWT required)

`hls.path` can be configured in `apps/back-end/src/main/resources/application.properties`.
`hls.allowed-origins` controls CORS for `/hls/**` (default `http://localhost:5173`).
`api.allowed-origins` controls CORS for `/api/**` (default `http://localhost:5173`).
`/health` includes basic HLS directory readability/writability info.

See root `README.md` for full run instructions.
