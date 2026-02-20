import type { AuthResponse, StreamsHealthResponse, StreamsResponse, SystemHealthResponse } from "../types";

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
  try {
    return await fetch(input, {
      credentials: "include",
      ...init,
    });
  } catch {
    const configuredBase = API_BASE_URL || window.location.origin;
    throw new Error(`Network error: cannot reach backend (configured base: ${configuredBase})`);
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

export async function fetchStreamHealth(): Promise<StreamsHealthResponse> {
  const response = await fetchOrThrow(`${API_BASE_URL}/api/streams/health`, {
    method: "GET",
  });
  return parseJsonOrThrow<StreamsHealthResponse>(response);
}

export async function fetchSystemHealth(): Promise<SystemHealthResponse> {
  const response = await fetchOrThrow(`${API_BASE_URL}/api/system/health`, {
    method: "GET",
  });
  return parseJsonOrThrow<SystemHealthResponse>(response);
}
