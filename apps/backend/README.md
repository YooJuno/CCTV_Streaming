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

`/api/streams/health`는 각 스트림마다 `state(LIVE/STARTING/STALE/OFFLINE/ERROR)`와
`reason` 코드를 함께 반환해 장애 원인 분류에 바로 사용할 수 있습니다.

`hls.path` can be configured in `apps/backend/src/main/resources/application.properties`.
`hls.allowed-origins` controls CORS for `/hls/**` (origin patterns).
`api.allowed-origins` controls CORS for `/api/**` (origin patterns).
`AUTH_JWT_SECRET` and `AUTH_USERS` must be configured before startup.
`/health` includes basic HLS directory readability/writability info.

See root `README.md` for full run instructions.
