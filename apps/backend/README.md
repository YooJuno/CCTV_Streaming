# Back End (Spring Boot)

Provides cookie-based JWT auth, stream authorization, health checks, and HLS static files.

## Endpoints

- Health: `/health`
- Auth login: `POST /api/auth/login`
- Auth logout: `POST /api/auth/logout`
- Current user: `GET /api/auth/me`
- Authorized streams: `GET /api/streams`
- Stream health: `GET /api/streams/health`
- HLS: `/hls/{streamId}.m3u8` (auth cookie required)

`hls.path` can be configured in `apps/backend/src/main/resources/application.properties`.
`hls.allowed-origins` controls CORS for `/hls/**` (origin patterns).
`api.allowed-origins` controls CORS for `/api/**` (origin patterns).
`AUTH_JWT_SECRET` and `AUTH_USERS` must be configured before startup.
`/health` includes basic HLS directory readability/writability info.

See root `README.md` for full run instructions.
