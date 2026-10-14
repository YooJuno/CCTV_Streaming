import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("../api/client", () => ({
  buildLiveStreamUrl: (id: string, resource: string) => `/api/live/${id}/${resource}`,
  fetchLiveStatus: mocks.status,
}));
import MjpegPlayer from "./MjpegPlayer";

const connected = { connected: true, frameAgeMs: 50, receivedFps: 6, bytesPerSecond: 40960, sequence: 1 };
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

describe("MjpegPlayer", () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.status.mockReset().mockResolvedValue(connected); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("keeps a live image under StrictMode and aborts requests when playback stops", async () => {
    const view = render(<StrictMode><MjpegPlayer streamId="camera" /></StrictMode>);
    await flush();
    const image = screen.getByRole("img");
    expect(image.getAttribute("src")).toMatch(/^\/api\/live\/camera\/stream.mjpeg/);
    fireEvent.load(image);
    expect(screen.getByText("재생 중")).toBeInTheDocument();
    expect(screen.getByText("40.0 KB/s")).toBeInTheDocument();
    const signals = mocks.status.mock.calls.map(call => call[1] as AbortSignal);
    view.unmount();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(image.hasAttribute("src")).toBe(false);
  });

  it("reconnects a failed image and cancels scheduled retries on unmount", async () => {
    const view = render(<MjpegPlayer streamId="camera" />);
    await flush();
    const firstSource = screen.getByRole("img").getAttribute("src");
    fireEvent.error(screen.getByRole("img"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole("img").getAttribute("src")).not.toBe(firstSource);
    fireEvent.error(screen.getByRole("img"));
    view.unmount();
    const calls = mocks.status.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.status).toHaveBeenCalledTimes(calls);
  });

  it("stops automatic image reconnects after access is denied", async () => {
    mocks.status.mockRejectedValue(new Error("HTTP 403: stream access denied"));
    render(<MjpegPlayer streamId="camera" />);
    fireEvent.error(screen.getByRole("img"));
    await flush();
    expect(screen.getByRole("img")).not.toHaveAttribute("src");
    expect(screen.getByText(/영상 접근 권한을 확인/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(mocks.status).toHaveBeenCalledTimes(1);
  });

  it("clears healthy indicators when the status server becomes unreachable", async () => {
    mocks.status.mockResolvedValueOnce(connected).mockRejectedValue(new Error("network failure"));
    render(<MjpegPlayer streamId="camera" />);
    await flush();
    fireEvent.load(screen.getByRole("img"));
    expect(screen.getByText("재생 중")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByText("재생 중")).not.toBeInTheDocument();
    expect(screen.getByText(/영상 서버에 연결할 수 없습니다/)).toBeInTheDocument();
  });
});
