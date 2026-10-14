import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useHealthPolling, { computeNextPollDelayMs } from "./useHealthPolling";
import useSystemHealthQuery from "../system/useSystemHealthQuery";
import { createQueryClientWrapper, createTestQueryClient } from "../../test/queryClientWrapper";
import type { AuthSession, StreamHealth, SystemHealthResponse } from "../../types";

vi.mock("../../api/client", () => ({
  fetchSystemHealth: vi.fn(),
}));

import { fetchSystemHealth } from "../../api/client";

const mockFetchSystemHealth = vi.mocked(fetchSystemHealth);

const SESSION: AuthSession = {
  username: "viewer",
  displayName: "Viewer",
};

const STREAM_DETAILS: StreamHealth[] = [
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
];

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
  streamDetails: STREAM_DETAILS,
  liveThresholdSeconds: 12,
  recommendedPollMs: 2000,
  recommendations: ["All authorized streams are healthy."],
};

describe("useHealthPolling", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("updates stream health and poll interval", async () => {
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
    // One request per tick: /api/system/health already carries the per-stream details.
    expect(mockFetchSystemHealth).toHaveBeenCalledTimes(1);
  });

  it("reports delayed warning after polling failure", async () => {
    mockFetchSystemHealth.mockRejectedValue(new Error("network timeout"));
    const client = createTestQueryClient();

    const { result } = renderHook(() => useHealthPolling(SESSION), {
      wrapper: createQueryClientWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.healthWarning).toContain("상태 갱신이 지연되고 있습니다");
    });

    expect(result.current.healthWarning).toContain("8초");
    expect(result.current.healthWarning).toContain("network timeout");
  });

  it("computes delay with visibility multiplier", () => {
    expect(computeNextPollDelayMs(4000, 0, "visible")).toBe(4000);
    expect(computeNextPollDelayMs(4000, 1, "visible")).toBe(8000);
    expect(computeNextPollDelayMs(4000, 1, "hidden")).toBe(16000);
    expect(computeNextPollDelayMs(4000, 10, "hidden")).toBe(30000);
  });

  it("clears previously healthy indicators when the next status request fails", async () => {
    mockFetchSystemHealth.mockResolvedValueOnce({ ...SYSTEM_HEALTH_RESPONSE, recommendedPollMs: 1000 }).mockRejectedValue(new Error("server unavailable"));
    const { result } = renderHook(() => ({ health: useHealthPolling(SESSION), system: useSystemHealthQuery(SESSION) }), { wrapper: createQueryClientWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.health.streamHealthById.mystream?.live).toBe(true));
    expect(result.current.system.hlsStorage?.exists).toBe(true);
    await waitFor(() => expect(result.current.health.healthWarning).toContain("server unavailable"), { timeout: 2500 });
    expect(result.current.health.streamHealthById).toEqual({});
    expect(result.current.system.hlsStorage).toBeNull();
    expect(result.current.system.systemRecommendations).toEqual([]);
  });
});
