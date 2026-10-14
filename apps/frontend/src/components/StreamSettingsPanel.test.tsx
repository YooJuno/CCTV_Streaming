import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQueryClientWrapper,
  createTestQueryClient,
} from "../test/queryClientWrapper";
import StreamSettingsPanel from "./StreamSettingsPanel";

vi.mock("../api/client", () => ({
  fetchStreamSettings: vi.fn(),
  updateStreamSettings: vi.fn(),
}));
import { fetchStreamSettings, updateStreamSettings } from "../api/client";
const mockFetch = vi.mocked(fetchStreamSettings);
const mockUpdate = vi.mocked(updateStreamSettings);
const sample = {
  fps: 6,
  frameSize: "VGA" as const,
  jpegQuality: 20,
  adaptive: true,
  revision: 1,
};
function renderSettings() {
  return render(<StreamSettingsPanel streamId="cam-a" />, {
    wrapper: createQueryClientWrapper(createTestQueryClient()),
  });
}

describe("StreamSettingsPanel", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(sample);
    mockUpdate.mockResolvedValue({ ...sample, fps: 10, revision: 2 });
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("loads the actual values and sends edited settings for the selected camera", async () => {
    renderSettings();
    const fps = await screen.findByLabelText("송출 FPS");
    expect(fps).toHaveValue("6");
    expect(screen.getByLabelText("영상 해상도")).toHaveValue("VGA");
    expect(screen.getByRole("button", { name: "설정 저장" })).toBeDisabled();
    fireEvent.change(fps, { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("영상 해상도"), {
      target: { value: "SVGA" },
    });
    fireEvent.change(screen.getByLabelText("영상 화질"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith("cam-a", {
        fps: 10,
        frameSize: "SVGA",
        jpegQuality: 10,
        adaptive: false,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "장치가 서버에 연결되어 있으면 약 10초 내 적용",
    );
  });

  it("preserves edits on a failed save and allows retry", async () => {
    mockUpdate.mockRejectedValueOnce(
      new Error("HTTP 503: 서버 연결이 지연됩니다."),
    );
    renderSettings();
    fireEvent.change(await screen.findByLabelText("송출 FPS"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("503");
    expect(screen.getByLabelText("송출 FPS")).toHaveValue("10");
    expect(screen.getByRole("button", { name: "설정 저장" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "설정을 저장했습니다",
    );
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("reports validation errors without claiming settings were saved", async () => {
    mockUpdate.mockRejectedValueOnce(
      new Error("HTTP 400: 지원하지 않는 영상 설정입니다."),
    );
    renderSettings();
    const quality = await screen.findByLabelText("영상 화질");
    expect(quality).toHaveAttribute("min", "10");
    expect(quality).toHaveAttribute("max", "40");
    fireEvent.change(quality, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("400");
    expect(screen.queryByText(/설정을 저장했습니다/)).not.toBeInTheDocument();
  });
});
