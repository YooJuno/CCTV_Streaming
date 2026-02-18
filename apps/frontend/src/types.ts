export interface StreamInfo {
  id: string;
  name: string;
}

export interface AuthResponse {
  expiresInSeconds: number;
  username: string;
  displayName: string;
  streams: StreamInfo[];
}

export interface StreamsResponse {
  streams: StreamInfo[];
}

export interface StreamHealth {
  id: string;
  live: boolean;
  manifestExists: boolean;
  lastModifiedEpochMs: number;
  manifestAgeSeconds: number;
  state: "LIVE" | "STARTING" | "STALE" | "OFFLINE" | "ERROR";
  reason: string;
  segmentCount: number;
  targetDurationSeconds: number;
  endList: boolean;
  latestSegmentExists: boolean;
  latestSegmentSizeBytes: number;
}

export interface StreamsHealthResponse {
  streams: StreamHealth[];
  liveThresholdSeconds: number;
  recommendedPollMs: number;
  generatedAtEpochMs: number;
}

export interface AuthSession {
  username: string;
  displayName: string;
}

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "buffering"
  | "network retry"
  | "media recovery"
  | "hls unsupported"
  | "video error"
  | "fatal error";

export interface PlaybackMetrics {
  latencySec: number | null;
  bufferSec: number;
  droppedFrames: number;
  stallCount: number;
  retryCount: number;
}
