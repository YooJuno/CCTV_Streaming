# API Contract (v1, Stable)

This document defines the API/response fields that must remain backward compatible.

## Live camera playback

Both endpoints require the dashboard JWT cookie and permission for a registered camera.
Unlisted IDs return `404`; a registered camera outside the user's allowed streams returns `403`.

### `GET /api/live/{streamId}/stream.mjpeg`

- Streams `multipart/x-mixed-replace; boundary=cctv-frame` with `image/jpeg` parts.
- Each part includes `Content-Length`, `X-Frame-Sequence`, and `X-Frame-Received-At` (server receipt epoch milliseconds).
- Delivers the latest complete JPEG instead of maintaining a per-viewer backlog. Camera padding is stripped before publication.
- Returns `503` if a fresh frame does not become available within five seconds; returns `429` when live-viewer capacity is reached.
- Uses `Cache-Control: no-store, no-cache, must-revalidate` and `X-Accel-Buffering: no`.
- Terminates after five seconds without a new frame or when the viewer's JWT expires. Disconnecting releases the viewer slot.
- Existing frame-size and two-megapixel limits protect the relay. Native JPEG playback needs no HLS segment buffer.

### `GET /api/live/{streamId}/status`

- `connected: boolean`: the publisher has received a frame within five seconds.
- `frameAgeMs: number`: elapsed time since the latest server receipt, or `-1` when none is available.
- `receivedFps: number`: measured incoming frame rate over a recent five-second window.
- `bytesPerSecond: number`: measured JPEG payload bytes per second, excluding transport overhead.
- `sequence: number`: frame sequence within the server lifetime; increases across camera reconnects.

These are server receipt metrics, not camera-to-screen latency measurements.

## Auth

### `POST /api/auth/login`

- Request JSON:
  - `username: string` (nonblank, at most 128 characters)
  - `password: string` (nonblank, at most 1024 characters)
- Success JSON:
  - `expiresInSeconds: number`
  - `username: string`
  - `displayName: string`
  - `streams: Array<{ id: string, name: string }>`
- Error JSON:
  - `error: string`
- `429 Too Many Requests` after `auth.login.max-attempts` failures for the same
  username + client address, or `auth.login.max-attempts-per-ip` failures from one
  client address across usernames, within `auth.login.lockout-seconds`. Carries a
  `Retry-After` header (seconds) and the usual `error` body. A successful login
  clears the username + address counter. The address-wide counter expires after
  the lockout window. The combined in-memory counters retain at most
  `auth.login.max-tracked-entries` entries and evict the least recently used entry
  at capacity. Limits use the server-observed remote address.
- Invalid or oversized fields return `400` with the usual `error` body.

### `GET /api/auth/me`

- Success JSON:
  - `expiresInSeconds: number`
  - `username: string`
  - `displayName: string`
  - `streams: Array<{ id: string, name: string }>`
- Error JSON:
  - `error: string`

### `POST /api/auth/logout`

- Success JSON:
  - `status: "logged out"`

`expiresInSeconds` from `/me` is the remaining lifetime of the current JWT.
Login returns the lifetime of the newly issued token. Reading `/me` does not
extend the token.

## Devices

### `GET /api/devices/server-info`

Requires a dashboard login. Returns `{ "serverUrl": string, "requiresConfiguration": boolean }`.
It prefers the configured public API base, then the current non-loopback origin,
then a site-local IPv4 address on an active interface with the actual server port
and context path. If no usable address can be suggested, `serverUrl` is empty and
`requiresConfiguration` is true. A LAN suggestion is editable and does not verify
reachability from the camera's network.

### `POST /api/devices/provision`

Requires a user auth cookie or Bearer JWT and an existing authorized catalog
stream. Request JSON: `{ "streamId": "mystream" }`.

Success JSON: `{ "streamId": string, "deviceToken": string, "ingestUrl": string }`.
The device token is a random 64-character lowercase hexadecimal credential.
It is returned only at issuance; the registry stores its SHA-256 digest.
Provisioning stages one replacement credential and preserves
the active camera credential. The first successful device config or video
authentication activates the replacement and stops the old upload. Failed USB
installation leaves the active camera credential usable; another provisioning
replaces only the pending credential. Existing camera settings are preserved.
Pending credentials remain valid until replacement or activation by default so
USB setup can precede deployment to another location. Set
`DEVICE_PENDING_TOKEN_TTL_SECONDS` to a positive number to expire pending
credentials after that many seconds; zero disables expiration.
The URL uses `DEVICE_INGEST_PUBLIC_BASE_URL` when
configured, otherwise the request origin and context path.

### `POST /api/devices/{streamId}/video`

Requires `X-Device-Token` for that stream and `Content-Type: application/octet-stream`.
The request body is a continuous concatenation of complete JPEG images;
HTTP chunked transfer is supported. This is a device credential endpoint and
does not use a dashboard login cookie. A completed upload returns
`{ "status": "completed", "frames": number }`.

JPEG header segments use their declared lengths, so APP/COM payloads containing
marker-like bytes remain valid. Camera padding and stale tail bytes between
images are discarded before FFmpeg; each gap is bounded by
`DEVICE_MAX_INTER_FRAME_PADDING_BYTES` (65536 by default). Bodies without a
complete JPEG, incomplete images, oversized frames and excessive gap data are
rejected.

The server streams bytes to FFmpeg and publishes authorized HLS files. It
accepts one active upload per stream and at most eight uploads by default.
`409` means that stream already has a publisher; `429` means server capacity is
occupied; `401` means an invalid or rotated device credential. Invalid or
incomplete JPEG data returns `400`; unavailable conversion/storage returns
`503`. JPEG frames are limited to 2 MiB by default and decoded images to 2 MP.
Reconnects preserve the playlist and advance segment numbers with a
discontinuity marker so existing viewers can continue playback.

### `GET /api/devices/{streamId}/settings`
### `PUT /api/devices/{streamId}/settings`

Require a dashboard user authorized for the catalog stream. GET can return
defaults before a device is provisioned. PUT requires all four fields:

```json
{ "fps": 6, "frameSize": "VGA", "jpegQuality": 20, "adaptive": true }
```

`fps` is an integer from 1 to 12. `frameSize` is `QVGA`, `CIF`, `VGA` or `SVGA`.
`jpegQuality` is an integer from 10 to 40 (lower values mean higher quality).
`adaptive` is a boolean. Both responses include those four fields and
`revision: number`, starting at zero. Changing settings increments the revision;
saving identical settings preserves it. Settings and token digests persist in
`DEVICE_REGISTRY_PATH`, defaulting to `./device-registry.properties`.

### `GET /api/devices/{streamId}/config`

Requires `X-Device-Token` and returns the same settings response. Firmware polls
this endpoint, applies changed revisions and reconnects its upload when needed.
The FFmpeg output FPS uses the profile in effect when a new upload starts.

## Streams

### `GET /api/streams`

- Success JSON:
  - `streams: Array<{ id: string, name: string }>`
- Error JSON:
  - `error: string`

### `GET /api/streams/health`

- Success JSON:
  - `streams: Array<StreamHealth>`
  - `liveThresholdSeconds: number`
  - `recommendedPollMs: number`
  - `generatedAtEpochMs: number`

`StreamHealth` fields:
- `id: string`
- `live: boolean`
- `manifestExists: boolean`
- `lastModifiedEpochMs: number`
- `manifestAgeSeconds: number`
- `state: "LIVE" | "STARTING" | "STALE" | "OFFLINE" | "ERROR"`
- `reason: string`
- `segmentCount: number`
- `targetDurationSeconds: number`
- `endList: boolean`
- `latestSegmentExists: boolean`
- `latestSegmentSizeBytes: number`

All referenced local segments must exist and be nonempty before `LIVE` is
reported. A manifest older than the live threshold is `STALE` even if it never
published enough segments to finish `STARTING`. `ENDLIST_PRESENT` is `OFFLINE`.
The latest-segment fields describe the last reference only.

Stream IDs are 1 to 64 characters, start with an ASCII letter or digit, and
contain only ASCII letters, digits, `.`, `_` and `-`. Invalid configured IDs fail
backend startup so catalog entries and HLS permissions use safe filename rules.

## System

### `GET /api/system/health`

- Success JSON:
  - `generatedAtEpochMs: number`
  - `username: string`
  - `hlsStorage: HlsStorage`
  - `streams: StreamHealthSummary`
  - `streamDetails: Array<StreamHealth>`
  - `liveThresholdSeconds: number`
  - `recommendedPollMs: number`
  - `recommendations: string[]`

This response is a superset of `GET /api/streams/health`: it carries the same per-stream
details plus the polling hints, so a client can stay current with one request per tick
instead of making the backend scan the HLS directory twice.

`HlsStorage` fields:
- `path: string`
- `exists: boolean`
- `readable: boolean`
- `writable: boolean`
- `manifestCount: number`
- `segmentCount: number`

`StreamHealthSummary` fields:
- `total: number`
- `live: number`
- `starting: number`
- `stale: number`
- `offline: number`
- `error: number`
- `reasons: Record<string, number>`

## Health

### `GET /health`

- Success JSON:
  - `status: "UP"`
  - `hlsExists: boolean`
  - `hlsReadable: boolean`
  - `hlsWritable: boolean`
