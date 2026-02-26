import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useHealthPolling, { computeNextPollDelayMs } from "./useHealthPolling";
import { createQueryClientWrapper, createTestQueryClient } from "../../test/queryClientWrapper";
import type { AuthSession, StreamsHealthResponse, SystemHealthResponse } from "../../types";

vi.mock("../../api/client", () => ({
  fetchStreamHealth: vi.fn(),
  fetchSystemHealth: vi.fn(),
}));

import { fetchStreamHealth, fetchSystemHealth } from "../../api/client";

const mockFetchStreamHealth = vi.mocked(fetchStreamHealth);
const mockFetchSystemHealth = vi.mocked(fetchSystemHealth);

const SESSION: AuthSession = {
  username: "viewer",
  displayName: "Viewer",
};

const STREAM_HEALTH_RESPONSE: StreamsHealthResponse = {
  streams: [
    {
      id: "mystream",
      live: true,
      manifestExists: true,
      lastModifiedEpochMs: Date.now(),
      manifestAgeSeconds: 0,
      state: "LIVE",
      reason: "OK",
      segmentCount: 3,
      targetDurationSeconds: 1,
      endList: false,
      latestSegmentExists: true,
      latestSegmentSizeBytes: 1024,
    },
  ],
  liveThresholdSeconds: 12,
  recommendedPollMs: 2000,
  generatedAtEpochMs: Date.now(),
};

const SYSTEM_HEALTH_RESPONSE: SystemHealthResponse = {
  generatedAtEpochMs: Date.now(),
  username: "viewer",
  hlsStorage: {
    path: "/tmp/hls",
    exists: true,
    readable: true,
    writable: true,
    manifestCount: 1,
    segmentCount: 3,
  },
  streams: {
    total: 1,
    live: 1,
    starting: 0,
    stale: 0,
    offline: 0,
    error: 0,
    reasons: {
      OK: 1,
    },
  },
  streamDetails: STREAM_HEALTH_RESPONSE.streams,
  recommendations: ["All authorized streams are healthy."],
};

describe("useHealthPolling", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("updates stream health and poll interval", async () => {
    mockFetchStreamHealth.mockResolvedValue(STREAM_HEALTH_RESPONSE);
    mockFetchSystemHealth.mockResolvedValue(SYSTEM_HEALTH_RESPONSE);
    const client = createTestQueryClient();

    const { result } = renderHook(() => useHealthPolling(SESSION), {
      wrapper: createQueryClientWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.streamHealthById.mystream).toBeDefined();
    });

    expect(result.current.liveThresholdSeconds).toBe(12);
    expect(result.current.healthPollMs).toBe(2000);
    expect(result.current.healthWarning).toBeNull();
  });

  it("reports delayed warning after polling failure", async () => {
    mockFetchStreamHealth.mockRejectedValue(new Error("network timeout"));
    mockFetchSystemHealth.mockResolvedValue(SYSTEM_HEALTH_RESPONSE);
    const client = createTestQueryClient();

    const { result } = renderHook(() => useHealthPolling(SESSION), {
      wrapper: createQueryClientWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.healthWarning).toContain("Health polling delayed");
    });

    expect(result.current.healthWarning).toContain("8.0s");
    expect(result.current.healthWarning).toContain("network timeout");
  });

  it("computes delay with visibility multiplier", () => {
    expect(computeNextPollDelayMs(4000, 0, "visible")).toBe(4000);
    expect(computeNextPollDelayMs(4000, 1, "visible")).toBe(8000);
    expect(computeNextPollDelayMs(4000, 1, "hidden")).toBe(16000);
    expect(computeNextPollDelayMs(4000, 10, "hidden")).toBe(30000);
  });
});
