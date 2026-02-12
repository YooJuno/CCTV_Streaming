export interface StreamInfo {
  id: string;
  name: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  username: string;
  displayName: string;
  streams: StreamInfo[];
}

export interface StreamsResponse {
  streams: StreamInfo[];
}

export interface AuthSession {
  token: string;
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
  | "hls load failed"
  | "video error"
  | "fatal error";

export interface PlaybackMetrics {
  latencySec: number | null;
  bufferSec: number;
  droppedFrames: number;
  stallCount: number;
  retryCount: number;
}
