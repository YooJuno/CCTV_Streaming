import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  request: vi.fn(),
  close: vi.fn(),
  flash: vi.fn(),
  fetchStreams: vi.fn(),
  serverInfo: vi.fn(),
  provision: vi.fn(),
  requestPort: vi.fn(),
}));
vi.mock("../api/client", () => ({
  fetchStreams: mocks.fetchStreams,
  fetchDeviceServerInfo: mocks.serverInfo,
  provisionDevice: mocks.provision,
}));
vi.mock("../features/device/serialDevice", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../features/device/serialDevice")>();
  return {
    ...actual,
    flashDevice: mocks.flash,
    SerialDeviceSession: class {
      open = mocks.open;
      request = mocks.request;
      close = mocks.close;
    },
  };
});
import DeviceInstaller from "./DeviceInstaller";

const status = {
  type: "cctv.response",
  requestId: "test",
  ok: true,
  firmwareVersion: "1.0.0",
  wifiConnected: false,
  publishing: false,
};
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function fillConnectionFields() {
  fireEvent.click(screen.getByRole("button", { name: "USB 장치 연결" }));
  await flush();
  fireEvent.change(screen.getByLabelText("Wi-Fi 이름 (SSID)"), {
    target: { value: "camera-wifi" },
  });
  fireEvent.change(screen.getByLabelText("Wi-Fi 비밀번호", { exact: true }), {
    target: { value: "camera-password" },
  });
  fireEvent.change(screen.getByLabelText(/^서버 주소/), {
    target: { value: "https://camera.example.test" },
  });
  fireEvent.change(screen.getByLabelText("포트"), { target: { value: "" } });
}
async function connectedInstaller() {
  const rendered = render(<DeviceInstaller />);
  await flush();
  await fillConnectionFields();
  return rendered;
}
function submitSettingsForm() {
  const button = screen.getByRole("button", {
    name: "설정 저장하고 서버에 연결",
  });
  const form = button.closest("form");
  if (!form) throw new Error("Installer settings form was not rendered");
  fireEvent.submit(form);
}

const secureDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "isSecureContext",
);
const serialDescriptor = Object.getOwnPropertyDescriptor(navigator, "serial");
describe("DeviceInstaller workflow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "serial", {
      value: { requestPort: mocks.requestPort },
      configurable: true,
    });
    mocks.requestPort.mockResolvedValue({});
    mocks.fetchStreams.mockResolvedValue({
      streams: [{ id: "mystream", name: "정문" }],
    });
    mocks.serverInfo.mockResolvedValue({
      serverUrl: "https://camera.example.test",
      requiresConfiguration: false,
    });
    mocks.open.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.provision.mockResolvedValue({
      streamId: "mystream",
      deviceToken: "a".repeat(64),
      ingestUrl: "https://camera.example.test/api/devices/mystream/video",
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.resetAllMocks();
    if (secureDescriptor)
      Object.defineProperty(window, "isSecureContext", secureDescriptor);
    else Reflect.deleteProperty(window, "isSecureContext");
    if (serialDescriptor)
      Object.defineProperty(navigator, "serial", serialDescriptor);
    else Reflect.deleteProperty(navigator, "serial");
  });

  it("does not rotate the server key when firmware preflight fails", async () => {
    mocks.request.mockRejectedValueOnce(new Error("장치가 응답하지 않습니다."));
    await connectedInstaller();
    fireEvent.click(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    );
    await advance(1000);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "장치가 응답하지 않습니다",
    );
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalled();
    expect(screen.queryByText(/설치 완료\. 카메라가/)).not.toBeInTheDocument();
  });

  it("does not report success when the device refuses to store configuration", async () => {
    mocks.request
      .mockResolvedValueOnce(status)
      .mockRejectedValueOnce(new Error("NVS 설정 저장 실패"));
    await connectedInstaller();
    fireEvent.click(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    );
    await advance(1000);
    expect(mocks.provision).toHaveBeenCalledWith("mystream");
    expect(mocks.request).toHaveBeenLastCalledWith(
      "cctv.configure",
      expect.objectContaining({
        ssid: "camera-wifi",
        password: "camera-password",
        deviceToken: "a".repeat(64),
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("NVS 설정 저장 실패");
    expect(
      screen.queryByText(/설정 저장 완료|설치 완료\. 카메라가/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    ).toBeEnabled();
  });

  it("waits for device publishing status before completing installation", async () => {
    mocks.request
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce({
        ...status,
        wifiConnected: true,
        publishing: true,
      });
    await connectedInstaller();
    fireEvent.click(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    );
    await advance(1000);
    expect(
      screen.getByText(/설정 저장 완료\. Wi-Fi와 서버 연결을 확인/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/설치 완료\. 카메라가/)).not.toBeInTheDocument();
    await advance(2100);
    expect(
      screen.getByText(/설치 완료\. 카메라가 서버로 영상을/),
    ).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledTimes(3);
  });

  it("closes a USB session opened after unmount and avoids provisioning", async () => {
    let finishOpen: () => void = () => {};
    mocks.open.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve;
        }),
    );
    mocks.request.mockResolvedValue(status);
    const rendered = await connectedInstaller();
    fireEvent.click(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    );
    await flush();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    rendered.unmount();
    await act(async () => {
      finishOpen();
      await Promise.resolve();
    });
    await advance(1000);
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not write device credentials when provisioning finishes after unmount", async () => {
    let finishProvision: (value: {
      streamId: string;
      deviceToken: string;
      ingestUrl: string;
    }) => void = () => {};
    mocks.provision.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishProvision = resolve;
        }),
    );
    mocks.request.mockResolvedValue(status);
    const rendered = await connectedInstaller();
    fireEvent.click(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    );
    await advance(1000);
    expect(mocks.provision).toHaveBeenCalledTimes(1);
    rendered.unmount();
    await act(async () => {
      finishProvision({
        streamId: "mystream",
        deviceToken: "a".repeat(64),
        ingestUrl: "https://camera.example.test/api/devices/mystream/video",
      });
      await Promise.resolve();
    });
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith("cctv.status");
  });
  it("rejects loopback server addresses before changing the server key", async () => {
    await connectedInstaller();
    fireEvent.change(screen.getByLabelText(/^서버 주소/), {
      target: { value: "http://127.0.0.1:8081" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    );
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "localhost는 사용할 수 없습니다",
    );
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("offers only registered camera ids instead of a freeform id field", async () => {
    mocks.fetchStreams.mockResolvedValueOnce({
      streams: [
        { id: "mystream", name: "정문" },
        { id: "parking-east", name: "동측 주차장" },
      ],
    });
    await connectedInstaller();
    const picker = screen.getByRole("combobox", { name: "카메라 ID" });
    const options = within(picker).getAllByRole("option");
    expect(
      options.map((option) => (option as HTMLOptionElement).value),
    ).toEqual(["mystream", "parking-east"]);
    expect(
      screen.queryByRole("textbox", { name: "카메라 ID" }),
    ).not.toBeInTheDocument();
    expect(
      within(picker).queryByRole("option", { name: /esp32cam/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "esp32cam" } });
    submitSettingsForm();
    await flush();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("defaults to the first accessible camera and provisions that id in a custom catalog", async () => {
    mocks.fetchStreams.mockResolvedValueOnce({
      streams: [
        { id: "esp32cam", name: "설치할 카메라" },
        { id: "rear-gate", name: "후문" },
      ],
    });
    mocks.provision.mockResolvedValueOnce({
      streamId: "esp32cam",
      deviceToken: "a".repeat(64),
      ingestUrl: "https://camera.example.test/api/devices/esp32cam/video",
    });
    mocks.request
      .mockResolvedValueOnce(status)
      .mockRejectedValueOnce(new Error("stop after verifying selected id"));
    await connectedInstaller();
    expect(screen.getByRole("combobox", { name: "카메라 ID" })).toHaveValue(
      "esp32cam",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    );
    await advance(1000);
    expect(mocks.provision).toHaveBeenCalledWith("esp32cam");
    expect(mocks.request).toHaveBeenLastCalledWith(
      "cctv.configure",
      expect.objectContaining({ streamId: "esp32cam" }),
    );
  });

  it("blocks configuration while the registered camera catalog is still loading", async () => {
    let finishCatalog: (value: {
      streams: Array<{ id: string; name: string }>;
    }) => void = () => {};
    mocks.fetchStreams.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCatalog = resolve;
        }),
    );
    render(<DeviceInstaller />);
    await flush();
    await fillConnectionFields();
    expect(screen.getByRole("combobox", { name: "카메라 ID" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    ).toBeDisabled();
    submitSettingsForm();
    await flush();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
    await act(async () => {
      finishCatalog({
        streams: [{ id: "camera-ready", name: "준비된 카메라" }],
      });
      await Promise.resolve();
    });
    expect(screen.getByRole("combobox", { name: "카메라 ID" })).toHaveValue(
      "camera-ready",
    );
    expect(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    ).toBeEnabled();
  });

  it("blocks USB configuration on catalog fetch failure and recovers after retry", async () => {
    mocks.fetchStreams
      .mockRejectedValueOnce(new Error("HTTP 503: catalog unavailable"))
      .mockResolvedValueOnce({
        streams: [{ id: "recovered-camera", name: "복구된 카메라" }],
      });
    render(<DeviceInstaller />);
    await flush();
    await fillConnectionFields();
    expect(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "등록된 카메라 목록을 불러오지 못했습니다. 다시 시도해 주세요.",
    );
    submitSettingsForm();
    await flush();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "카메라 목록 다시 불러오기",
      }),
    );
    await flush();
    expect(screen.getByRole("combobox", { name: "카메라 ID" })).toHaveValue(
      "recovered-camera",
    );
    expect(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    ).toBeEnabled();
    expect(mocks.fetchStreams).toHaveBeenCalledTimes(2);
  });

  it("explains an empty catalog and recovers when a registered camera becomes available", async () => {
    mocks.fetchStreams
      .mockResolvedValueOnce({ streams: [] })
      .mockResolvedValueOnce({
        streams: [{ id: "new-camera", name: "새 카메라" }],
      });
    render(<DeviceInstaller />);
    await flush();
    await fillConnectionFields();
    expect(screen.getByRole("combobox", { name: "카메라 ID" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "이 계정에 등록된 카메라가 없습니다. 서버의 카메라 목록과 계정 권한을 확인해 주세요.",
      ),
    ).toBeInTheDocument();
    submitSettingsForm();
    await flush();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "카메라 목록 다시 불러오기",
      }),
    );
    await flush();
    expect(screen.getByRole("combobox", { name: "카메라 ID" })).toHaveValue(
      "new-camera",
    );
    expect(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    ).toBeEnabled();
    expect(mocks.fetchStreams).toHaveBeenCalledTimes(2);
  });

  it("reports an actionable catalog error on provision 404 without leaving a saving message", async () => {
    mocks.fetchStreams
      .mockResolvedValueOnce({
        streams: [{ id: "mystream", name: "이전 카메라" }],
      })
      .mockResolvedValueOnce({
        streams: [{ id: "esp32cam", name: "현재 등록된 카메라" }],
      });
    mocks.request.mockResolvedValueOnce(status);
    mocks.provision.mockRejectedValueOnce(
      new Error("HTTP 404: stream is not in the catalog"),
    );
    await connectedInstaller();
    fireEvent.click(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    );
    await advance(1000);
    expect(mocks.provision).toHaveBeenCalledWith("mystream");
    expect(mocks.fetchStreams).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("combobox", { name: "카메라 ID" })).toHaveValue(
      "esp32cam",
    );
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent(
      "선택한 카메라가 서버에 등록되어 있지 않습니다. 카메라 목록을 다시 불러온 뒤 선택해 주세요.",
    );
    expect(
      screen.queryByText("장치에 네트워크 설정을 저장하고 있습니다."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/설정 저장 완료|설치 완료\. 카메라가/),
    ).not.toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith("cctv.status");
    expect(mocks.close).toHaveBeenCalled();
    expect(screen.queryByText("연결 확인 중…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    ).toBeInTheDocument();
  });
  it("shows a rejected upload in Korean without reporting completion after the polling deadline", async () => {
    const raw =
      "Upload rejected by server; verify device token and stream registration";
    mocks.request.mockResolvedValue({
      ...status,
      wifiConnected: true,
      publishing: false,
      publishMessage: raw,
    });
    await connectedInstaller();
    fireEvent.click(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    );
    await advance(1000);
    const publisher = screen.getByRole("status", { name: "서버 송출 상태" });
    expect(publisher).toHaveTextContent(
      "서버가 영상 업로드를 거절했습니다. 서버의 영상 수신 상태를 확인해 주세요.",
    );
    expect(publisher).toHaveClass("error");
    expect(publisher).not.toHaveClass("success");
    expect(publisher).not.toHaveTextContent(/token|연결 키/);
    await advance(30000);
    const feedback = screen.getByText(/^설정은 저장되었습니다\./);
    expect(feedback).toHaveTextContent(
      "서버가 영상 업로드를 거절했습니다. 서버의 영상 수신 상태를 확인해 주세요.",
    );
    expect(feedback).not.toHaveTextContent("Wi-Fi 이름과 서버 주소");
    expect(feedback.closest(".installer-feedback")).toHaveClass("error");
    expect(screen.queryByText(/설치 완료\. 카메라가/)).not.toBeInTheDocument();
    expect(screen.getByText("연결 확인").closest("li")).not.toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(mocks.request).toHaveBeenCalledTimes(17);
    expect(
      screen.getByRole("button", { name: "설정 저장하고 서버에 연결" }),
    ).toBeEnabled();
    expect(screen.getByText(raw)).not.toBeVisible();
    fireEvent.click(screen.getByText("펌웨어 진단 원문"));
    expect(screen.getByText(raw)).toBeVisible();
  });

  it("labels connection progress as pending and keeps the success tone for actual publishing", async () => {
    mocks.request.mockResolvedValueOnce({
      ...status,
      wifiConnected: true,
      publishing: false,
      publishMessage: "Connecting to upload server",
    });
    await connectedInstaller();
    fireEvent.click(
      screen.getByRole("button", { name: "이미 설치된 장치의 연결 상태 확인" }),
    );
    await advance(1000);
    const publisher = screen.getByRole("status", { name: "서버 송출 상태" });
    expect(publisher).toHaveTextContent("영상 서버에 연결하고 있습니다.");
    expect(publisher).toHaveClass("pending");
    expect(publisher).not.toHaveClass("success");
    mocks.request.mockResolvedValueOnce({
      ...status,
      wifiConnected: true,
      publishing: true,
      publishMessage: "Sending video to server",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "이미 설치된 장치의 연결 상태 확인" }),
    );
    await flush();
    expect(publisher).toHaveTextContent("영상 전송 중");
    expect(publisher).toHaveClass("success");
    expect(
      screen
        .getByText("카메라가 서버로 영상을 보내고 있습니다.")
        .closest(".installer-feedback"),
    ).toHaveClass("success");
  });
});
