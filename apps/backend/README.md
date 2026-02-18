# Back End (Spring Boot)

Provides JWT auth, stream authorization, health checks, and HLS static files.

## Endpoints

- Health: `/health`
- Auth login: `POST /api/auth/login`
- Current user: `GET /api/auth/me`
- Authorized streams: `GET /api/streams`
- HLS: `/hls/{streamId}.m3u8` (JWT required)

`hls.path` can be configured in `apps/backend/src/main/resources/application.properties`.
`hls.allowed-origins` controls CORS for `/hls/**` (origin patterns).
`api.allowed-origins` controls CORS for `/api/**` (origin patterns).
`/health` includes basic HLS directory readability/writability info.

See root `README.md` for full run instructions.
