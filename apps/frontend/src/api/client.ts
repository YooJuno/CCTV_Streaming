import type { AuthResponse, DeviceProvisionResponse, StreamSettings, StreamsResponse, SystemHealthResponse } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "")
  : "";

interface ApiError {
  error?: string;
  message?: string;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let details = "";
  try {
    const data = (await response.json()) as ApiError;
    details = data.error || data.message || "";
  } catch {
    // ignore non-json error body
  }

  const suffix = details ? `: ${details}` : "";
  throw new Error(`HTTP ${response.status}${suffix}`);
}

async function fetchOrThrow(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init?.signal?.aborted) controller.abort();
  else init?.signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(input, {
      credentials: "include",
      signal: controller.signal,
      ...init,
    });
  } catch {
    throw new Error(controller.signal.aborted ? "서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요." : "서버에 연결할 수 없습니다. 네트워크 연결을 확인해 주세요.");
  } finally {
    window.clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  }
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const response = await fetchOrThrow(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
  return parseJsonOrThrow<AuthResponse>(response);
}

export async function fetchMe(): Promise<AuthResponse> {
  const response = await fetchOrThrow(`${API_BASE_URL}/api/auth/me`, {
    method: "GET",
  });
  return parseJsonOrThrow<AuthResponse>(response);
}

export async function logout(): Promise<void> {
  const response = await fetchOrThrow(`${API_BASE_URL}/api/auth/logout`, {
    method: "POST",
  });
  if (!response.ok) {
    await parseJsonOrThrow(response);
  }
}

export async function fetchStreams(): Promise<StreamsResponse> {
  const response = await fetchOrThrow(`${API_BASE_URL}/api/streams`, {
    method: "GET",
  });
  return parseJsonOrThrow<StreamsResponse>(response);
}

export interface LiveStreamStatus {
  connected: boolean;
  frameAgeMs: number;
  receivedFps: number;
  bytesPerSecond: number;
  sequence: number;
}

export function buildLiveStreamUrl(streamId: string, resource: "stream.mjpeg" | "status"): string {
  return `${API_BASE_URL}/api/live/${encodeURIComponent(streamId)}/${resource}`;
}

export async function fetchLiveStatus(streamId: string, signal?: AbortSignal): Promise<LiveStreamStatus> {
  return parseJsonOrThrow(await fetchOrThrow(buildLiveStreamUrl(streamId, "status"), { signal }));
}

export async function fetchSystemHealth(): Promise<SystemHealthResponse> {
  const response = await fetchOrThrow(`${API_BASE_URL}/api/system/health`, {
    method: "GET",
  });
  return parseJsonOrThrow<SystemHealthResponse>(response);
}

export async function provisionDevice(streamId: string): Promise<DeviceProvisionResponse> {
  return parseJsonOrThrow(await fetchOrThrow(`${API_BASE_URL}/api/devices/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ streamId }),
  }));
}

export async function fetchDeviceServerInfo(): Promise<{ serverUrl: string; requiresConfiguration: boolean }> {
  return parseJsonOrThrow(await fetchOrThrow(`${API_BASE_URL}/api/devices/server-info`));
}

export async function fetchStreamSettings(streamId: string): Promise<StreamSettings> {
  return parseJsonOrThrow(await fetchOrThrow(`${API_BASE_URL}/api/devices/${encodeURIComponent(streamId)}/settings`));
}

export async function updateStreamSettings(streamId: string, settings: Omit<StreamSettings, "revision">): Promise<StreamSettings> {
  return parseJsonOrThrow(await fetchOrThrow(`${API_BASE_URL}/api/devices/${encodeURIComponent(streamId)}/settings`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fps: settings.fps, frameSize: settings.frameSize, jpegQuality: settings.jpegQuality, adaptive: settings.adaptive }),
  }));
}
