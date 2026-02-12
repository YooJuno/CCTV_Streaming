import { describe, expect, it } from "vitest";
import { buildManifestUrl, computeLatencySeconds } from "./hls";

describe("hls utils", () => {
  it("builds encoded manifest url", () => {
    const url = buildManifestUrl("http://localhost:8080/hls", "cam 1/2");
    expect(url).toBe("http://localhost:8080/hls/cam%201%2F2.m3u8");
  });

  it("uses override url when provided", () => {
    const url = buildManifestUrl("http://localhost:8080/hls", "mystream", "http://cdn/live.m3u8");
    expect(url).toBe("http://cdn/live.m3u8");
  });

  it("computes latency from live edge", () => {
    expect(computeLatencySeconds(100, 98.2)).toBeCloseTo(1.8, 2);
    expect(computeLatencySeconds(undefined, 98.2)).toBeNull();
  });
});
