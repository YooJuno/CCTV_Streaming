import { describe, expect, it, vi } from "vitest";
import { SerialDeviceSession, validateDeviceSettings } from "./serialDevice";

const settings = { ssid: "test-wifi", password: "test-password", streamId: "mystream", serverUrl: "https://camera.example.test" };

function serialPort(respond: (request: Record<string, unknown>, send: (line: string) => void) => void) {
  let receive: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({ start(controller) { receive = controller; } });
  const send = (line: string) => receive.enqueue(new TextEncoder().encode(line));
  const port = {
    readable,
    writable: new WritableStream<Uint8Array>({ write(data) { respond(JSON.parse(new TextDecoder().decode(data)), send); } }),
    open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), setSignals: vi.fn().mockResolvedValue(undefined),
  };
  return port as unknown as SerialPort;
}

describe("USB device provisioning", () => {
  it("receives a matched JSON response amidst boot logs and split serial lines", async () => {
    const port = serialPort((request, send) => {
      send("rst:0x1 booting\n{\"type\":\"unrelated\"}\n");
      const line = JSON.stringify({ type: "cctv.response", requestId: request.requestId, ok: true, wifiConnected: true, ip: "192.0.2.7" });
      send(line.slice(0, 16)); send(line.slice(16) + "\r\n");
    });
    const session = new SerialDeviceSession(port);
    await session.open();
    expect(await session.request("cctv.status")).toMatchObject({ ok: true, wifiConnected: true, ip: "192.0.2.7" });
    await session.close();
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("surfaces device validation errors instead of reporting saved settings", async () => {
    const port = serialPort((request, send) => send(JSON.stringify({ type: "cctv.response", requestId: request.requestId, ok: false, message: "invalid settings" }) + "\n"));
    const session = new SerialDeviceSession(port);
    await session.open();
    await expect(session.request("cctv.configure", settings)).rejects.toThrow("invalid settings");
    await session.close();
  });

  it("rejects in-flight operations when the USB session closes", async () => {
    const session = new SerialDeviceSession(serialPort(() => {}));
    await session.open();
    const pending = session.request("cctv.status");
    const assertion = expect(pending).rejects.toThrow("장치 연결을 종료했습니다");
    await session.close();
    await assertion;
  });

  it("validates UTF-8 SSID length, device ids, and server credentials", () => {
    expect(validateDeviceSettings(settings)).toBeNull();
    expect(validateDeviceSettings({ ...settings, ssid: "가".repeat(11) })).toContain("32바이트");
    expect(validateDeviceSettings({ ...settings, streamId: "../../private" })).toContain("카메라 ID");
    expect(validateDeviceSettings({ ...settings, serverUrl: "https://user:secret@example.test" })).toContain("서버 주소");
    expect(validateDeviceSettings({ ...settings, password: "" })).toBeNull();
  });

  it("closes a port whose asynchronous open completes after the session was cancelled", async () => {
    const port = serialPort(() => {});
    let finishOpen!: () => void;
    vi.mocked(port.open).mockImplementation(() => new Promise<void>((resolve) => { finishOpen = resolve; }));
    const session = new SerialDeviceSession(port);
    const opening = session.open();
    const assertion = expect(opening).rejects.toThrow("연결 작업을 종료했습니다");
    await session.close();
    finishOpen();
    await assertion;
    expect(port.setSignals).not.toHaveBeenCalled();
    expect(port.close).toHaveBeenCalledTimes(2);
  });

  it("times out even when a USB driver stops resolving writes", async () => {
    vi.useFakeTimers();
    let finishWrite!: () => void;
    const port = {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>({ write() { return new Promise<void>((resolve) => { finishWrite = resolve; }); } }),
      open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), setSignals: vi.fn().mockResolvedValue(undefined),
    } as unknown as SerialPort;
    const session = new SerialDeviceSession(port);
    try {
      await session.open();
      const response = session.request("cctv.status");
      const assertion = expect(response).rejects.toThrow("장치가 응답하지 않습니다");
      await vi.advanceTimersByTimeAsync(6001);
      await assertion;
      finishWrite();
      await vi.advanceTimersByTimeAsync(1);
      await session.close();
    } finally { vi.useRealTimers(); }
  });
});
