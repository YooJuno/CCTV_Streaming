import type { AuthResponse, StreamsResponse } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

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

export async function login(username: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
  return parseJsonOrThrow<AuthResponse>(response);
}

export async function fetchStreams(token: string): Promise<StreamsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/streams`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return parseJsonOrThrow<StreamsResponse>(response);
}
