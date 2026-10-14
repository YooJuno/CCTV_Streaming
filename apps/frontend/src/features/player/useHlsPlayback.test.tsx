import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useHlsPlayback from "./useHlsPlayback";

interface TestPlayer {
  handlers: Map<string, (event: string, data?: unknown) => void>;
  loadSource: ReturnType<typeof vi.fn>;
  startLoad: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}
const { instances } = vi.hoisted(() => ({ instances: [] as TestPlayer[] }));
vi.mock("hls.js/dist/hls.light.mjs", () => ({ default: class {
  static isSupported = () => true;
  static Events = { MANIFEST_PARSED: "parsed", ERROR: "error" };
  handlers = new Map();
  loadSource = vi.fn(); startLoad = vi.fn(); destroy = vi.fn(); attachMedia = vi.fn(); recoverMediaError = vi.fn();
  constructor() { instances.push(this); }
  on(event: string, handler: unknown) { this.handlers.set(event, handler); }
} }));

describe("HLS playback recovery", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("reloads the first missing manifest and recovers when it becomes available", async () => {
    const video = document.createElement("video");
    const { result, unmount } = renderHook(() => useHlsPlayback({ manifestUrl: "/hls/camera.m3u8", videoElement: video }));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(instances.length).toBe(1);
    act(() => instances[0].handlers.get("error")?.("error", { fatal: true, type: "networkError", response: { code: 404 } }));
    expect(result.current.status).toBe("network retry");
    await act(async () => { vi.advanceTimersByTime(501); });
    expect(instances[0].loadSource).toHaveBeenCalledTimes(2);
    expect(instances[0].startLoad).not.toHaveBeenCalled();
    await act(async () => { instances[0].handlers.get("parsed")?.("parsed"); });
    expect(result.current.errorMessage).toBeNull();
    unmount();
    expect(instances[0].destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a pending retry when the viewer closes the stream", async () => {
    const video = document.createElement("video");
    const { unmount } = renderHook(() => useHlsPlayback({ manifestUrl: "/hls/camera.m3u8", videoElement: video }));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(instances.length).toBe(1);
    act(() => instances[0].handlers.get("error")?.("error", { fatal: true, type: "networkError", response: { code: 404 } }));
    unmount();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(instances[0].loadSource).toHaveBeenCalledTimes(1);
    expect(instances[0].destroy).toHaveBeenCalledOnce();
  });
});
