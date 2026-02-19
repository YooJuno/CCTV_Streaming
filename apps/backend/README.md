# Back End (Spring Boot)

Provides cookie-based JWT auth, stream authorization, health checks, and HLS static files.

## Endpoints

- Health: `/health`
- Auth login: `POST /api/auth/login`
- Auth logout: `POST /api/auth/logout`
- Current user: `GET /api/auth/me`
- Authorized streams: `GET /api/streams`
- Stream health: `GET /api/streams/health`
- System health: `GET /api/system/health`
- HLS: `/hls/{streamId}.m3u8` (auth cookie required)

`/api/streams/health`는 각 스트림마다 `state(LIVE/STARTING/STALE/OFFLINE/ERROR)`와
`reason` 코드를 함께 반환해 장애 원인 분류에 바로 사용할 수 있습니다.

`/api/system/health`는 스트림 헬스에 더해 HLS 디렉터리 상태(읽기/쓰기/파일 개수)와
권장 조치(recommendations)를 함께 반환합니다.

`hls.path` can be configured in `apps/backend/src/main/resources/application.properties`.
`hls.allowed-origins` controls CORS for `/hls/**` (origin patterns).
`api.allowed-origins` controls CORS for `/api/**` (origin patterns).
Default CORS is intentionally strict (`localhost/127.0.0.1:5174`).
If you access frontend from another host/IP, set `API_ALLOWED_ORIGINS` and `HLS_ALLOWED_ORIGINS`.
`AUTH_JWT_SECRET` and `AUTH_USERS` must be configured before startup.
`/health` includes basic HLS directory readability/writability info.

See root `README.md` for full run instructions.
