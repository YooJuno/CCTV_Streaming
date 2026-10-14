/// <reference types="w3c-web-serial" />

export interface DeviceSettings {
  ssid: string;
  password: string;
  serverUrl: string;
  streamId: string;
  deviceToken?: string;
  serverCaPem?: string;
}

export interface DeviceStatus {
  type: "cctv.response";
  requestId: string;
  ok: boolean;
  message?: string;
  configured?: boolean;
  wifiConnected?: boolean;
  ip?: string;
  streamUrl?: string;
  firmwareVersion?: string;
  publishing?: boolean;
  publishMessage?: string;
}

export function validateDeviceSettings(settings: DeviceSettings): string | null {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  if (bytes(settings.ssid) < 1 || bytes(settings.ssid) > 32) return "Wi-Fi 이름은 1~32바이트로 입력해 주세요.";
  if (/[\x00-\x1f\x7f]/.test(settings.ssid + settings.password)) return "Wi-Fi 이름과 비밀번호에 줄바꿈이나 제어 문자를 사용할 수 없습니다.";
  if (settings.password && (bytes(settings.password) < 8 || bytes(settings.password) > 63)) return "Wi-Fi 비밀번호는 8~63바이트로 입력해 주세요. 공개 네트워크는 비워 두세요.";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(settings.streamId)) return "카메라 ID는 영문·숫자로 시작하는 64자 이내의 영문, 숫자, 점, 밑줄, 하이픈으로 입력해 주세요.";
  if (settings.deviceToken && !/^[a-fA-F0-9]{64}$/.test(settings.deviceToken)) return "장치 연결 키가 올바르지 않습니다. 설정을 다시 저장해 주세요.";
  if (settings.serverCaPem && (bytes(settings.serverCaPem) > 4096 || !settings.serverCaPem.includes("-----BEGIN CERTIFICATE-----"))) return "서버 인증서는 PEM 형식의 4096바이트 이내 인증서를 입력해 주세요.";
  try {
    const url = new URL(settings.serverUrl);
    if (["localhost", "0.0.0.0", "[::1]"].includes(url.hostname) || /^127\./.test(url.hostname) || url.hostname.endsWith(".localhost")) return "카메라가 접속할 수 있는 서버의 IP 또는 도메인을 입력해 주세요. localhost는 사용할 수 없습니다.";
    if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password || /[\s\x00-\x1f]/.test(settings.serverUrl) || bytes(settings.serverUrl) > 512) throw new Error();
  } catch {
    return "서버 주소는 올바른 HTTP 또는 HTTPS 주소로 입력해 주세요.";
  }
  return null;
}

interface PendingRequest {
  resolve: (response: DeviceStatus) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The device receives credentials directly over USB; they never go to the web server. */
export class SerialDeviceSession {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readTask: Promise<void> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private pending = new Map<string, PendingRequest>();
  private closed = false;

  constructor(private readonly port: SerialPort) {}

  async open() {
    if (this.closed) throw new Error("장치 연결 작업을 종료했습니다.");
    await this.port.open({ baudRate: 115200 });
    if (this.closed) {
      await this.port.close().catch(() => {});
      throw new Error("장치 연결 작업을 종료했습니다.");
    }
    try {
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      if (this.closed) throw new Error("장치 연결 작업을 종료했습니다.");
      this.reader = this.port.readable?.getReader() ?? null;
      if (!this.reader) throw new Error("USB 포트를 읽을 수 없습니다.");
      this.readTask = this.readLines();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async request(type: "cctv.configure" | "cctv.status", settings?: DeviceSettings): Promise<DeviceStatus> {
    if (this.closed || !this.port.writable) throw new Error("장치 연결이 끊어졌습니다. 다시 연결해 주세요.");
    const requestId = crypto.randomUUID();
    const response = new Promise<DeviceStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("장치가 응답하지 않습니다. 공통 펌웨어를 설치하고 GPIO0을 해제한 뒤 리셋해 주세요."));
      }, 6000);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    const writing = (async () => {
      const writer = this.port.writable!.getWriter();
      this.writer = writer;
      try {
        await writer.write(new TextEncoder().encode(`${JSON.stringify({ type, requestId, ...settings })}\n`));
      } finally {
        writer.releaseLock();
        if (this.writer === writer) this.writer = null;
      }
    })();
    void writing.catch(() => {
      const entry = this.pending.get(requestId);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        entry.reject(new Error("장치에 설정을 전달하지 못했습니다. USB 연결을 확인해 주세요."));
      }
    });
    // Attach to both promises immediately. A stalled USB write must not hide the
    // response deadline or produce an unhandled timeout rejection.
    const [, result] = await Promise.all([writing, response]);
    return result;
  }

  private async readLines() {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!this.closed && this.reader) {
        const { done, value } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        if (buffer.length > 16384) buffer = "";
        for (const line of lines) {
          try {
            const data = JSON.parse(line.trim()) as DeviceStatus;
            if (data.type !== "cctv.response" || typeof data.requestId !== "string" || typeof data.ok !== "boolean") continue;
            const entry = this.pending.get(data.requestId);
            if (!entry) continue;
            clearTimeout(entry.timer);
            this.pending.delete(data.requestId);
            if (data.ok) entry.resolve(data);
            else entry.reject(new Error(data.message || "장치가 설정을 저장하지 못했습니다."));
          } catch {
            // Ignore firmware boot logs. Never display or persist raw serial data.
          }
        }
      }
    } catch {
      // A cable disconnect ends the pending requests below.
    } finally {
      this.reader?.releaseLock();
      this.reader = null;
      if (!this.closed) this.rejectPending("장치 연결이 끊어졌습니다. USB 케이블을 확인해 주세요.");
      this.closed = true;
    }
  }

  private rejectPending(message: string) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    this.pending.clear();
  }

  async close() {
    this.closed = true;
    this.rejectPending("장치 연결을 종료했습니다.");
    if (this.writer) {
      const writer = this.writer;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([writer.abort().catch(() => {}), new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); })]);
      clearTimeout(timer);
      try { writer.releaseLock(); } catch { /* A disconnected OS driver may still own the write. */ }
      this.writer = null;
    }
    await this.reader?.cancel().catch(() => {});
    await this.readTask;
    await this.port.close().catch(() => {});
  }
}

export interface FirmwareManifest {
  name: string;
  version: string;
  sha256?: string;
  builds: Array<{ chipFamily: string; parts: Array<{ path: string; offset: number; sha256?: string }> }>;
}

export async function flashDevice(port: SerialPort, onProgress: (percent: number) => void) {
  const manifestUrl = new URL("/firmware/manifest.json", window.location.origin);
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) throw new Error("설치할 펌웨어가 준비되지 않았습니다. 서버에서 공통 펌웨어 빌드를 실행해 주세요.");
  const manifest = await manifestResponse.json() as FirmwareManifest;
  const build = manifest.builds?.find((item) => item.chipFamily === "ESP32");
  if (!build?.parts.length) throw new Error("ESP32-CAM 설치 파일을 찾을 수 없습니다.");
  const fileArray = await Promise.all(build.parts.map(async (part) => {
    const assetUrl = new URL(part.path, manifestUrl);
    if (assetUrl.origin !== manifestUrl.origin || !Number.isInteger(part.offset) || part.offset < 0) throw new Error("펌웨어 설치 정보가 올바르지 않습니다.");
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error("펌웨어 파일을 내려받지 못했습니다. 다시 시도해 주세요.");
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length < 100 || data.length > 4 * 1024 * 1024) throw new Error("펌웨어 파일 크기가 올바르지 않습니다.");
    const expectedHash = part.sha256 || (build.parts.length === 1 ? manifest.sha256 : undefined);
    if (expectedHash) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== expectedHash.toLowerCase()) throw new Error("펌웨어 파일이 손상되었습니다. 파일을 다시 빌드하거나 내려받아 주세요.");
    }
    return { data, address: part.offset };
  }));
  const { ESPLoader, Transport } = await import("esptool-js");
  const transport = new Transport(port, false);
  try {
    const loader = new ESPLoader({ transport, baudrate: 115200, romBaudrate: 115200, debugLogging: false });
    await loader.main();
    if (loader.chip?.CHIP_NAME !== "ESP32") throw new Error("이 펌웨어는 AI Thinker ESP32-CAM 전용입니다. 연결된 칩 종류를 확인해 주세요.");
    const allBytes = fileArray.reduce((sum, file) => sum + file.data.length, 0);
    await loader.writeFlash({ fileArray, flashMode: "dio", flashFreq: "40m", flashSize: "4MB", eraseAll: false, compress: true, reportProgress: (index, written, total) => {
      const completedBytes = fileArray.slice(0, index).reduce((sum, file) => sum + file.data.length, 0);
      const currentBytes = Math.min(1, total > 0 ? written / total : 0) * (fileArray[index]?.data.length ?? 0);
      onProgress(Math.min(100, Math.round((completedBytes + currentBytes) / allBytes * 100)));
    } });
    await loader.after("hard_reset");
    return manifest.version;
  } finally {
    await transport.disconnect().catch(() => {});
  }
}
