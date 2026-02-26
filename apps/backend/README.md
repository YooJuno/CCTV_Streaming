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

## Package Structure

- `com.yoojuno.cctv.api.auth|stream|system`: REST controllers + DTO + mappers
- `com.yoojuno.cctv.domain.auth|stream|system`: domain orchestration/services
- `com.yoojuno.cctv.auth|stream|config`: auth/filter and core stream infrastructure

API contract is fixed in [`docs/api/API_CONTRACT.md`](../../docs/api/API_CONTRACT.md).

## Run tests

```bash
cd apps/backend
./gradlew test
```

## Notes

`hls.path` can be configured in `apps/backend/src/main/resources/application.properties`.
`hls.allowed-origins` controls CORS for `/hls/**` (origin patterns).
`api.allowed-origins` controls CORS for `/api/**` (origin patterns).
Default CORS is intentionally strict (`localhost/127.0.0.1:5174`).
If you access frontend from another host/IP, set `API_ALLOWED_ORIGINS` and `HLS_ALLOWED_ORIGINS`.
`AUTH_JWT_SECRET` and `AUTH_USERS` must be configured before startup.
`/health` includes basic HLS directory readability/writability info.

See root `README.md` for full run instructions.
