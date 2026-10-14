# Back End (Spring Boot)

Provides cookie-based JWT auth, stream authorization, live MJPEG relay, health checks, and HLS static files.

Uses Java 17, Spring Boot 4.1.1 and the bundled Gradle 8.14.4 wrapper.

## Endpoints

- Health: `/health`
- Auth login: `POST /api/auth/login`
- Auth logout: `POST /api/auth/logout`
- Current user: `GET /api/auth/me`
- Authorized streams: `GET /api/streams`
- Stream health: `GET /api/streams/health`
- System health: `GET /api/system/health`
- HLS: `/hls/{streamId}.m3u8` (auth cookie required)
- Device provisioning: `POST /api/devices/provision` (authorized dashboard user)
- Camera profiles: `GET/PUT /api/devices/{streamId}/settings` (authorized dashboard user)
- Device profiles: `GET /api/devices/{streamId}/config` (`X-Device-Token`)
- Camera push: `POST /api/devices/{streamId}/video` (raw JPEG images, `X-Device-Token`)
- Live viewing: `GET /api/live/{streamId}/stream.mjpeg` (JWT cookie and camera permission)
- Live receipt metrics: `GET /api/live/{streamId}/status` (JWT cookie and camera permission)

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
`hls.allowed-origins` controls CORS for `/hls/**` (explicit origins).
`api.allowed-origins` controls CORS for `/api/**` (explicit origins).
Default CORS is intentionally strict (`localhost/127.0.0.1:5174`).
If you access frontend from another host/IP, set `API_ALLOWED_ORIGINS` and `HLS_ALLOWED_ORIGINS`.
Wildcard origins are rejected because these endpoints allow credentialed requests.
`AUTH_JWT_SECRET` and `AUTH_USERS` must be configured before startup.
`/health` includes basic HLS directory readability/writability info.

See root `README.md` for full run instructions.

The push receiver needs FFmpeg in `PATH` or a configured `FFMPEG_BIN`. For a
camera on another network, set `DEVICE_INGEST_PUBLIC_BASE_URL` to the public API
base, including any context path. Keep `DEVICE_REGISTRY_PATH` on persistent
storage; it contains token digests and camera profiles and uses owner-only
permissions. Reprovisioning stages a replacement while preserving the active
camera credential. The new camera's first config/video authentication activates
it. Pending credentials do not expire by default; set
`DEVICE_PENDING_TOKEN_TTL_SECONDS` to a positive lifetime to require expiration.
Proxy request buffering must be disabled for continuous
uploads. FFmpeg integration tests run when the binary is available.

`AUTH_LOGIN_MAX_ATTEMPTS_PER_IP` defaults to 50; `AUTH_LOGIN_MAX_TRACKED_ENTRIES`
defaults to 10000. `STREAMS_CATALOG` overrides the default camera list. Device
upload limits can be adjusted with `DEVICE_MAX_CONCURRENT_INGESTS` (8),
`DEVICE_MAX_FRAME_BYTES` (2097152), `DEVICE_HLS_TIME_SECONDS` (2) and
`DEVICE_PROCESS_EXIT_TIMEOUT_SECONDS` (5).

Live viewing keeps one latest frame per camera and skips a slow viewer's backlog.
Set `DEVICE_MAX_LIVE_VIEWERS` to adjust the default global limit of 24 live viewers.
Disable reverse-proxy response buffering for `/api/live/*/stream.mjpeg` so each frame
is forwarded as it arrives. Both native live viewing and HLS reuse the same camera upload.
The receiver removes bounded camera padding between JPEG frames; configure its
gap limit with `DEVICE_MAX_INTER_FRAME_PADDING_BYTES` (65536 by default).
JPEG metadata containing marker bytes is parsed by segment length. Passwords
and device credentials are redacted from DTO diagnostic strings; Spring Web
logging defaults to INFO.
