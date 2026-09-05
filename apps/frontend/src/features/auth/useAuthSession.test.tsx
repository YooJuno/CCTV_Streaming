import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useAuthSession from "./useAuthSession";
import { createQueryClientWrapper, createTestQueryClient } from "../../test/queryClientWrapper";
import type { AuthResponse } from "../../types";

vi.mock("../../api/client", () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

import { fetchMe, login, logout } from "../../api/client";

const mockFetchMe = vi.mocked(fetchMe);
const mockLogin = vi.mocked(login);
const mockLogout = vi.mocked(logout);

const SAMPLE_AUTH_RESPONSE: AuthResponse = {
  expiresInSeconds: 3600,
  username: "admin",
  displayName: "Admin",
  streams: [{ id: "cam-a", name: "Cam A" }],
};

describe("useAuthSession", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("restores session on startup", async () => {
    mockFetchMe.mockResolvedValue(SAMPLE_AUTH_RESPONSE);
    const client = createTestQueryClient();

    const { result } = renderHook(() => useAuthSession(), {
      wrapper: createQueryClientWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.restoringSession).toBe(false);
    });

    expect(result.current.session).toEqual({
      username: "admin",
      displayName: "Admin",
    });
    expect(result.current.authError).toBeNull();
  });

  it("does not set auth error for unauthorized restore failures", async () => {
    mockFetchMe.mockRejectedValue(new Error("HTTP 401: unauthorized"));
    const client = createTestQueryClient();

    const { result } = renderHook(() => useAuthSession(), {
      wrapper: createQueryClientWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.restoringSession).toBe(false);
    });

    expect(result.current.session).toBeNull();
    expect(result.current.authError).toBeNull();
  });

  it("surfaces network restore failures", async () => {
    mockFetchMe.mockRejectedValue(new Error("Network down"));
    const client = createTestQueryClient();

    const { result } = renderHook(() => useAuthSession(), {
      wrapper: createQueryClientWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.restoringSession).toBe(false);
    });

    expect(result.current.session).toBeNull();
    expect(result.current.authError).toBe("Network down");
  });

  it("logs in and logs out", async () => {
    mockFetchMe.mockRejectedValue(new Error("HTTP 401: unauthorized"));
    mockLogin.mockResolvedValue({
      ...SAMPLE_AUTH_RESPONSE,
      username: "viewer",
      displayName: "Viewer",
    });
    mockLogout.mockResolvedValue(undefined);
    const client = createTestQueryClient();

    const { result } = renderHook(() => useAuthSession(), {
      wrapper: createQueryClientWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.restoringSession).toBe(false);
    });

    await act(async () => {
      await result.current.login("viewer", "viewer123");
    });

    expect(result.current.session).toEqual({
      username: "viewer",
      displayName: "Viewer",
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.session).toBeNull();
  });
});
