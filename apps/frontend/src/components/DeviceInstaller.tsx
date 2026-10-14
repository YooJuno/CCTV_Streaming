import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDeviceServerInfo, fetchStreams, provisionDevice } from "../api/client";
import { flashDevice, SerialDeviceSession, validateDeviceSettings, type DeviceSettings, type DeviceStatus } from "../features/device/serialDevice";
import type { StreamInfo } from "../types";
import "../styles/installer.css";

type Stage = "connect" | "install" | "configure" | "complete";
const STAGES: Array<{ id: Stage; title: string; detail: string }> = [
  { id: "connect", title: "장치 연결", detail: "USB 포트 선택" },
  { id: "install", title: "펌웨어 설치", detail: "ESP32-CAM 준비" },
  { id: "configure", title: "네트워크 설정", detail: "Wi-Fi와 서버 연결" },
  { id: "complete", title: "연결 확인", detail: "카메라 상태 확인" },
];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "장치 연결을 확인하고 다시 시도해 주세요.";
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

type PublishTone = "success" | "pending" | "error";
interface PublishState { tone: PublishTone; text: string }
const PUBLISH_MESSAGES: Record<string, PublishState> = {
  "Waiting for configuration": { tone: "pending", text: "장치 설정을 기다리고 있습니다." },
  "Waiting for Wi-Fi and server configuration": { tone: "pending", text: "Wi-Fi와 서버 설정을 확인하고 연결을 기다리고 있습니다." },
  "Waiting for time synchronization for HTTPS": { tone: "pending", text: "HTTPS 연결을 위해 장치 시간을 동기화하고 있습니다." },
  "Connecting to upload server": { tone: "pending", text: "영상 서버에 연결하고 있습니다." },
  "Server connection failed; verify address, port, and HTTPS certificate": { tone: "error", text: "서버에 연결하지 못했습니다. 주소·포트와 HTTPS 인증서를 확인하세요." },
  "Waiting for camera access; reconnecting": { tone: "pending", text: "카메라 사용 준비 후 서버에 다시 연결합니다." },
  "Camera capture unavailable; retrying": { tone: "error", text: "카메라 영상을 가져오지 못해 다시 시도하고 있습니다. 장치의 카메라 연결을 확인하세요." },
  "Sending video to server": { tone: "pending", text: "서버 송출 상태를 확인하고 있습니다." },
  "Upload connection interrupted; reconnecting": { tone: "pending", text: "영상 업로드 연결이 끊어져 다시 연결하고 있습니다." },
  "Reconnecting with updated configuration": { tone: "pending", text: "변경된 설정으로 서버에 다시 연결하고 있습니다." },
  "Unable to start publishing tasks": { tone: "error", text: "장치에서 영상 송출을 시작하지 못했습니다. 장치를 재시작하고 다시 확인하세요." },
};
function publishState(status: DeviceStatus): PublishState {
  if (status.publishing === true) return { tone: "success", text: "영상 전송 중" };
  const raw = typeof status.publishMessage === "string" ? status.publishMessage.trim() : "";
  if (raw?.startsWith("Upload rejected by server")) {
    const httpCode = raw.match(/HTTP\s*(\d{3})/i)?.[1];
    return { tone: "error", text: `서버가 영상 업로드를 거절했습니다. 서버의 영상 수신 상태를 확인해 주세요.${httpCode ? ` (HTTP ${httpCode})` : ""}` };
  }
  if (raw && Object.hasOwn(PUBLISH_MESSAGES, raw)) return PUBLISH_MESSAGES[raw];
  if (raw) return { tone: /rejected|failed|failure|unavailable|denied|error/i.test(raw) ? "error" : "pending", text: raw };
  return { tone: "pending", text: status.wifiConnected ? "Wi-Fi 연결 완료. 서버 송출을 기다리고 있습니다." : "장치의 Wi-Fi 연결을 기다리고 있습니다." };
}

export default function DeviceInstaller() {
  const [stage, setStage] = useState<Stage>("connect");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(false);
  const [boardConfirmed, setBoardConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("USB 케이블로 ESP32-CAM을 컴퓨터에 연결해 주세요.");
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [serverAddress, setServerAddress] = useState(() => import.meta.env.VITE_API_BASE_URL || (["localhost", "127.0.0.1"].includes(window.location.hostname) ? "" : window.location.origin));
  const [serverPort, setServerPort] = useState(() => import.meta.env.VITE_API_BASE_URL ? "" : ["localhost", "127.0.0.1"].includes(window.location.hostname) ? "8081" : window.location.port);
  const [streamId, setStreamId] = useState("");
  const [serverCaPem, setServerCaPem] = useState("");
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(true);
  const [streamsError, setStreamsError] = useState<string | null>(null);
  const port = useRef<SerialPort | null>(null);
  const session = useRef<SerialDeviceSession | null>(null);
  const alive = useRef(true);
  const serverEdited = useRef(false);
  const supported = typeof navigator !== "undefined" && "serial" in navigator && window.isSecureContext;
  const registeredCamera = !streamsLoading && !streamsError && streams.some((item) => item.id === streamId);
  const publisher = device ? publishState(device) : null;
  const feedbackTone = stage === "complete" && device?.publishing === true ? "success" : !busy && publisher && message ? publisher.tone : "neutral";

  const loadStreams = useCallback(async () => {
    setStreamsLoading(true);
    setStreamsError(null);
    try {
      const { streams: items } = await fetchStreams();
      if (!alive.current) return;
      setStreams(items);
      setStreamId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
    } catch {
      if (!alive.current) return;
      setStreams([]);
      setStreamId("");
      setStreamsError("등록된 카메라 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (alive.current) setStreamsLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void fetchDeviceServerInfo().then((info) => {
      if (!alive.current || serverEdited.current || !info.serverUrl) return;
      const url = new URL(info.serverUrl);
      setServerAddress(url.toString().replace(/\/$/, ""));
      setServerPort(url.port);
    }).catch(() => {});
    void loadStreams();
    return () => {
      alive.current = false;
      void session.current?.close();
      session.current = null;
    };
  }, [loadStreams]);

  useEffect(() => {
    if (!busy) return;
    const preventLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [busy]);

  const selectDevice = async () => {
    setBusy(true);
    try {
      setError(null);
      // Keep requestPort inside the button's user gesture.
      const nextPort = await navigator.serial.requestPort();
      if (!alive.current) return;
      await session.current?.close();
      if (!alive.current) return;
      session.current = null;
      port.current = nextPort;
      setSelected(true);
      setDevice(null);
      setStage("install");
      setMessage("장치가 선택되었습니다. 처음 설치하거나 기존 펌웨어를 업데이트할 수 있습니다.");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotFoundError") return;
      setError("USB 장치를 선택하지 못했습니다. 케이블과 다른 시리얼 프로그램을 확인해 주세요.");
    } finally { if (alive.current) setBusy(false); }
  };

  const install = async () => {
    if (!port.current || !boardConfirmed) return;
    setStage("install"); setBusy(true); setError(null); setProgress(0);
    setMessage("펌웨어를 설치하고 있습니다. USB 케이블을 연결한 상태로 기다려 주세요.");
    try {
      await session.current?.close(); session.current = null;
      const version = await flashDevice(port.current, (value) => { if (alive.current) setProgress(value); });
      if (!alive.current) return;
      setStage("configure");
      setMessage(`펌웨어 ${version} 설치 완료. GPIO0과 GND 연결을 해제하고 리셋한 뒤 네트워크 설정을 저장해 주세요.`);
    } catch (cause) {
      if (alive.current) setError(`${errorMessage(cause)} 부트 모드(GPIO0–GND 연결 후 리셋)를 확인해 주세요.`);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const openSession = async () => {
    if (!port.current) throw new Error("먼저 USB 장치를 선택해 주세요.");
    if (!session.current) {
      const next = new SerialDeviceSession(port.current);
      session.current = next;
      await next.open();
      if (!alive.current) { await next.close(); throw new Error("장치 연결 작업을 종료했습니다."); }
      await pause(900);
    }
    if (!alive.current || !session.current) throw new Error("장치 연결 작업을 종료했습니다.");
    return session.current;
  };

  const checkConnection = async () => {
    setBusy(true); setError(null);
    try {
      const connection = await openSession();
      const status = await connection.request("cctv.status");
      if (!alive.current) return;
      setDevice(status);
      if (status.publishing === true) setStage("complete");
      else setStage("configure");
      setMessage(status.publishing === true ? "카메라가 서버로 영상을 보내고 있습니다." : publishState(status).text);
    } catch (cause) {
      if (alive.current) setError(errorMessage(cause));
      await session.current?.close(); session.current = null;
    } finally { if (alive.current) setBusy(false); }
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!registeredCamera) {
      setMessage("");
      setError("등록된 카메라를 선택해 주세요.");
      return;
    }
    let settings: DeviceSettings;
    try {
      const url = new URL(/^https?:\/\//.test(serverAddress) ? serverAddress : `https://${serverAddress}`);
      if (serverPort) {
        const portNumber = Number(serverPort);
        if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) throw new Error("서버 포트는 1~65535 사이로 입력해 주세요.");
        url.port = serverPort;
      }
      url.hash = ""; url.search = "";
      settings = { ssid, password, streamId: streamId.trim(), serverUrl: url.toString().replace(/\/$/, ""), serverCaPem: serverCaPem.trim() };
      const validation = validateDeviceSettings(settings);
      if (validation) throw new Error(validation);
    } catch (cause) { setMessage(""); setError(errorMessage(cause)); return; }
    setBusy(true); setError(null); setMessage("장치에 네트워크 설정을 저장하고 있습니다.");
    try {
      const connection = await openSession();
      // Verify the application firmware responds before rotating the server's device key.
      const firmware = await connection.request("cctv.status");
      if (typeof firmware.publishing !== "boolean") throw new Error("이 장치의 펌웨어는 서버 송출을 지원하지 않습니다. 공통 펌웨어를 먼저 업데이트해 주세요.");
      if (!alive.current) return;
      const provisioned = await provisionDevice(settings.streamId).catch((cause: unknown) => {
        if (errorMessage(cause).startsWith("HTTP 404")) {
          void loadStreams();
          throw new Error("선택한 카메라가 서버에 등록되어 있지 않습니다. 카메라 목록을 다시 불러온 뒤 선택해 주세요.");
        }
        throw cause;
      });
      if (!alive.current) return;
      settings.deviceToken = provisioned.deviceToken;
      const result = await connection.request("cctv.configure", settings);
      if (!alive.current) return;
      setDevice(result); setPassword(""); setStage("configure");
      setMessage("설정 저장 완료. Wi-Fi와 서버 연결을 확인하고 있습니다.");
      let latestStatus = result;
      for (let attempt = 0; attempt < 15 && alive.current; attempt++) {
        await pause(2000);
        if (!alive.current) return;
        const status = await connection.request("cctv.status");
        if (!alive.current) return;
        latestStatus = status;
        setDevice(status);
        if (status.publishing === true) {
          setStage("complete"); setMessage("설치 완료. 카메라가 서버로 영상을 보내고 있습니다.");
          return;
        }
      }
      if (!alive.current) return;
      setMessage(`설정은 저장되었습니다. ${publishState(latestStatus).text} 연결 상태를 다시 확인해 주세요.`);
    } catch (cause) {
      if (alive.current) { setMessage(""); setError(errorMessage(cause)); }
      await session.current?.close(); session.current = null;
    } finally { if (alive.current) setBusy(false); }
  };

  const disconnect = async () => {
    await session.current?.close(); session.current = null;
    port.current = null; setSelected(false); setDevice(null); setStage("connect");
    setMessage("장치 연결을 종료했습니다. 저장된 설정은 장치에 유지됩니다.");
  };

  return (
    <div className="installer-panel">
      <div className="installer-intro"><span className="eyebrow">DEVICE SETUP</span><h2>카메라를 연결할 준비</h2><p>USB로 펌웨어를 설치하고 Wi-Fi에 연결하세요. 카메라는 지정한 서버로 영상을 보냅니다.</p></div>
      <ol className="installer-steps" aria-label="장비 설치 단계">{STAGES.map((item, index) => <li key={item.id} className={`installer-step ${stage === item.id ? "current" : ""}`} aria-current={stage === item.id ? "step" : undefined}><span>{index + 1}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div></li>)}</ol>
      {!supported ? <div className="installer-note" role="status"><strong>USB 설치를 지원하는 환경이 필요합니다.</strong><p>컴퓨터의 Chrome 또는 Edge에서 HTTPS 사이트나 localhost로 접속해 주세요. 일반 HTTP IP 주소에서는 장치 연결 기능이 제한됩니다.</p></div> : null}
      <div className="installer-workspace">
        <section className="installer-card">
          <div className="installer-card-heading"><span className="section-number">01</span><div><h3>USB 장치</h3><p>AI Thinker ESP32-CAM 전용 펌웨어</p></div></div>
          <div className={`installer-status ${selected ? "connected" : ""}`}><span className="status-dot" /><span>{selected ? "USB 장치 선택됨" : "연결할 장치를 선택하세요"}</span></div>
          <div className="installer-actions"><button className="btn primary" type="button" onClick={() => void selectDevice()} disabled={!supported || busy}>{selected ? "다른 장치 선택" : "USB 장치 연결"}</button>{selected ? <button className="btn ghost" type="button" onClick={() => void disconnect()} disabled={busy}>연결 해제</button> : null}</div>
          <label className="installer-checkbox"><input type="checkbox" checked={boardConfirmed} onChange={(event) => setBoardConfirmed(event.target.checked)} disabled={busy} /><span>AI Thinker ESP32-CAM 보드를 연결했습니다.</span></label>
          <button className="btn install-button" type="button" onClick={() => void install()} disabled={!selected || !boardConfirmed || busy}>{busy && stage === "install" ? `설치 중 ${progress}%` : "펌웨어 설치 / 업데이트"}</button>
          {busy && stage === "install" ? <progress className="flash-progress" value={progress} max={100} aria-label="펌웨어 설치 진행률" /> : null}
          <details className="installer-help"><summary>부트 모드가 필요한 보드인가요?</summary><p>USB-UART 어댑터를 사용하는 보드는 GPIO0과 GND를 연결하고 RST 버튼을 누른 뒤 설치하세요. 설치 후 연결을 해제하고 다시 리셋하세요. 다른 시리얼 모니터는 종료해 주세요.</p></details>
          <button className="installer-link" type="button" onClick={() => void checkConnection()} disabled={!selected || busy}>이미 설치된 장치의 연결 상태 확인</button>
        </section>
        <section className="installer-card">
          <div className="installer-card-heading"><span className="section-number">02</span><div><h3>Wi-Fi와 영상 서버</h3><p>설정은 USB로 장치에 직접 저장됩니다.</p></div></div>
          <form className="installer-form" onSubmit={(event) => void saveSettings(event)}>
            <label className="form-field"><span>Wi-Fi 이름 (SSID)</span><input value={ssid} onChange={(event) => setSsid(event.target.value)} autoComplete="off" placeholder="연결할 2.4GHz Wi-Fi 이름" required disabled={busy} /></label>
            <label className="form-field"><span>Wi-Fi 비밀번호</span><div className="installer-password"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" placeholder="공개 네트워크는 비워 두세요" disabled={busy} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Wi-Fi 비밀번호 숨기기" : "Wi-Fi 비밀번호 표시"}>{showPassword ? "숨김" : "표시"}</button></div></label>
            <div className="installer-server-fields"><label className="form-field"><span>서버 주소</span><input aria-label="서버 주소" value={serverAddress} onChange={(event) => { serverEdited.current = true; setServerAddress(event.target.value); }} placeholder="https://camera.example.com" required disabled={busy} /><small>감지된 주소는 같은 Wi-Fi에서 사용할 수 있습니다. 원격 설치에는 외부에서 접속할 서버 주소를 입력하세요.</small></label><label className="form-field"><span>포트</span><input type="number" min="1" max="65535" value={serverPort} onChange={(event) => { serverEdited.current = true; setServerPort(event.target.value); }} placeholder="기본" disabled={busy} /></label></div>
            <div className="installer-catalog">
              <label className="form-field"><span>카메라 선택</span><select aria-label="카메라 ID" value={streamId} onChange={(event) => setStreamId(event.target.value)} required disabled={busy || streamsLoading || !streams.length}>{!streamId ? <option value="">{streamsLoading ? "카메라 목록을 불러오는 중…" : "등록된 카메라 없음"}</option> : null}{streams.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}</select><small>이 계정에 등록된 카메라를 선택하세요. 같은 ID의 새 장치가 서버에 연결되면 기존 카메라 연결이 교체됩니다.</small></label>
              {streamsError ? <p className="installer-catalog-message" role="status">{streamsError}</p> : !streamsLoading && !streams.length ? <p className="installer-catalog-message" role="status">이 계정에 등록된 카메라가 없습니다. 서버의 카메라 목록과 계정 권한을 확인해 주세요.</p> : null}
              {streamsError || (!streamsLoading && !streams.length) ? <button className="installer-link" type="button" onClick={() => void loadStreams()} disabled={busy || streamsLoading}>카메라 목록 다시 불러오기</button> : null}
            </div>
            <details className="installer-help"><summary>고급 설정 · 사용자 지정 인증서</summary><label className="form-field"><span>서버 CA 인증서 (선택)</span><textarea rows={4} value={serverCaPem} onChange={(event) => setServerCaPem(event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" disabled={busy} /><small>일반 공인 인증서는 기본 인증서 목록을 사용합니다. 사설 인증서를 쓰는 서버에만 CA 인증서를 입력하세요.</small></label></details>
            <button type="submit" className="btn primary" disabled={!selected || busy || !registeredCamera}>{busy && stage !== "install" ? "연결 확인 중…" : "설정 저장하고 서버에 연결"}</button>
          </form>
        </section>
      </div>
      {message ? <div className={`installer-feedback ${feedbackTone}`} aria-live="polite"><span className="status-dot" /><p>{message}</p></div> : null}
      {error ? <div className="installer-error" role="alert">{error}</div> : null}
      {device && publisher ? <>
        <div className="installer-result">
          <div className={device.wifiConnected === true ? "success" : "pending"}><small>Wi-Fi</small><strong>{device.wifiConnected === true ? "연결됨" : "연결 대기"}</strong></div>
          <div className={`installer-publish-state ${publisher.tone}`} role="status" aria-label="서버 송출 상태"><small>서버 송출</small><strong>{publisher.text}</strong></div>
          <div><small>카메라 IP</small><strong>{device.ip && device.ip !== "0.0.0.0" ? device.ip : "—"}</strong></div>
          <div><small>펌웨어</small><strong>{device.firmwareVersion || "—"}</strong></div>
        </div>
        {device.publishMessage ? <details className="installer-device-diagnostics"><summary>펌웨어 진단 원문</summary><code>{device.publishMessage}</code></details> : null}
      </> : null}
      <p className="installer-footnote">Wi-Fi 비밀번호는 웹 서버로 보내거나 브라우저에 저장하지 않습니다. 외부에서 사용할 서버 주소는 카메라 네트워크에서도 접속할 수 있어야 합니다.</p>
    </div>
  );
}
