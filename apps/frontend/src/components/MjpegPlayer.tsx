import { useEffect, useMemo, useRef, useState } from "react";
import { buildLiveStreamUrl, fetchLiveStatus, type LiveStreamStatus } from "../api/client";
import StatusBadge from "./StatusBadge";

export default function MjpegPlayer({ streamId }: { streamId: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const retry = useRef<number | null>(null);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [fatal, setFatal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<LiveStreamStatus | null>(null);
  const source = useMemo(() => `${buildLiveStreamUrl(streamId, "stream.mjpeg")}?connection=${Date.now()}-${version}`, [streamId, version]);

  useEffect(() => {
    let active = true;
    let polling = false;
    const controller = new AbortController();
    setLoaded(false);
    setFatal(false);
    setError(null);
    setMetrics(null);
    if (image.current && image.current.getAttribute("src") !== source) image.current.src = source;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const status = await fetchLiveStatus(streamId, controller.signal);
        if (!active) return;
        setMetrics(status);
        if (status.connected) {
          setError(null);
          if (image.current?.naturalWidth) setLoaded(true);
        } else {
          setError("새 영상을 기다리고 있습니다. 장비의 서버 송출 상태를 확인해 주세요.");
          if (image.current?.naturalWidth && retry.current === null) {
            retry.current = window.setTimeout(() => { retry.current = null; setVersion(value => value + 1); }, 2000);
          }
        }
      } catch (cause) {
        if (!active) return;
        const message = cause instanceof Error ? cause.message : "서버에 연결할 수 없습니다.";
        setMetrics(null);
        if (/HTTP (401|403)/.test(message)) {
          setFatal(true);
          setError("영상 접근 권한을 확인해 주세요. 로그인이 만료되었다면 다시 로그인하세요.");
          controller.abort();
          if (retry.current !== null) window.clearTimeout(retry.current);
          retry.current = null;
          image.current?.removeAttribute("src");
        } else setError("영상 서버에 연결할 수 없습니다. 잠시 후 다시 확인합니다.");
      } finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => { if (!controller.signal.aborted) void poll(); }, 2000);
    const currentImage = image.current;
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      if (retry.current !== null) window.clearTimeout(retry.current);
      retry.current = null;
      currentImage?.removeAttribute("src");
    };
  }, [streamId, version, source]);

  const imageFailed = () => {
    if (fatal) return;
    setLoaded(false);
    setError("영상을 다시 연결하고 있습니다. 카메라의 서버 송출을 확인해 주세요.");
    if (retry.current === null) retry.current = window.setTimeout(() => { retry.current = null; setVersion(value => value + 1); }, 2000);
  };
  const reconnect = () => setVersion(value => value + 1);
  const fullscreen = async () => {
    try { await stage.current?.requestFullscreen(); }
    catch { setError("전체 화면을 열지 못했습니다. 브라우저의 전체 화면 기능을 사용해 주세요."); }
  };

  return <div className="hls-player mjpeg-player">
    <div className="video-stage" ref={stage}>
      <img key={source} ref={image} src={fatal ? undefined : source} className="hls-video live-image" alt={`${streamId} 실시간 영상`} onLoad={() => setLoaded(true)} onError={imageFailed} />
      {!loaded ? <div className="video-loading" role="status"><span className="loading-spinner" />영상 연결 중</div> : null}
    </div>
    <div className="hls-toolbar"><StatusBadge status={fatal ? "fatal error" : loaded && metrics?.connected ? "playing" : "network retry"} /><div className="player-actions"><button type="button" className="btn ghost" onClick={reconnect}>다시 연결</button><button type="button" className="btn ghost" onClick={() => void fullscreen()}>전체 화면</button></div></div>
    {error ? <p className="player-error" role="status">{error}</p> : null}
    <details className="player-details"><summary>재생 진단</summary><div className="metrics-grid">
      <div><span className="metric-label">카메라 수신 FPS</span><span className="metric-value">{metrics?.connected ? metrics.receivedFps.toFixed(1) : "—"}</span></div>
      <div><span className="metric-label">카메라 전송량</span><span className="metric-value">{metrics?.connected ? `${(metrics.bytesPerSecond / 1024).toFixed(1)} KB/s` : "—"}</span></div>
      <div><span className="metric-label">최근 프레임 수신</span><span className="metric-value">{metrics && metrics.frameAgeMs >= 0 ? `${metrics.frameAgeMs}ms 전` : "—"}</span></div>
      <div><span className="metric-label">재연결</span><span className="metric-value">{version}</span></div>
    </div><p className="metrics-footnote">서버에 도착한 최신 프레임을 바로 재생합니다. 수신 통계는 카메라 촬영부터 화면까지의 전체 지연을 나타내지 않습니다.</p></details>
  </div>;
}
