# API Contract (v1, Stable)

This document defines the API/response fields that must remain backward compatible.

## Auth

### `POST /api/auth/login`

- Request JSON:
  - `username: string`
  - `password: string`
- Success JSON:
  - `expiresInSeconds: number`
  - `username: string`
  - `displayName: string`
  - `streams: Array<{ id: string, name: string }>`
- Error JSON:
  - `error: string`

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

## System

### `GET /api/system/health`

- Success JSON:
  - `generatedAtEpochMs: number`
  - `username: string`
  - `hlsStorage: HlsStorage`
  - `streams: StreamHealthSummary`
  - `streamDetails: Array<StreamHealth>`
  - `recommendations: string[]`

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
