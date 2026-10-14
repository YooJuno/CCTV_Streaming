import { useMemo, useRef, useState } from "react";
import { buildManifestUrl } from "../utils/hls";
import useHlsPlayback from "../features/player/useHlsPlayback";
import StatusBadge from "./StatusBadge";

export default function HlsPlayer({ streamId }: { streamId: string }) {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const manifestUrl = useMemo(() => buildManifestUrl(
    (import.meta.env.VITE_HLS_BASE_URL || "/hls").replace(/\/$/, ""),
    streamId,
    import.meta.env.VITE_HLS_URL,
  ), [streamId]);
  const { status, errorMessage, metrics, reconnect } = useHlsPlayback({ manifestUrl, videoElement });
  const waiting = status === "loading" || status === "buffering" || status === "network retry";

  const fullscreen = async () => {
    try {
      setFullscreenError(null);
      if (stage.current?.requestFullscreen) {
        await stage.current.requestFullscreen();
      } else {
        const safariVideo = videoElement as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
        if (safariVideo?.webkitEnterFullscreen) safariVideo.webkitEnterFullscreen();
        else setFullscreenError("이 브라우저에서는 영상의 기본 전체 화면 버튼을 사용해 주세요.");
      }
    } catch {
      setFullscreenError("전체 화면을 열지 못했습니다. 영상의 기본 버튼을 사용해 주세요.");
    }
  };

  return (
    <div className="hls-player">
      <div className="video-stage" ref={stage}>
        <video ref={setVideoElement} className="hls-video" controls muted playsInline crossOrigin="use-credentials" aria-label={`${streamId} 실시간 영상`} />
        {waiting ? <div className="video-loading" role="status"><span className="loading-spinner" />{status === "loading" ? "영상 연결 중" : "영상 연결을 기다리고 있습니다"}</div> : null}
      </div>
      <div className="hls-toolbar">
        <StatusBadge status={status} />
        <div className="player-actions">
          <button type="button" className="btn ghost" onClick={reconnect}>다시 연결</button>
          <button type="button" className="btn ghost" onClick={() => void fullscreen()}>전체 화면</button>
        </div>
      </div>
      {errorMessage || fullscreenError ? <p className="player-error" role="status">{errorMessage || fullscreenError}</p> : null}
      <details className="player-details">
        <summary>재생 진단</summary>
        <div className="metrics-grid">
          <div><span className="metric-label">라이브 지연</span><span className="metric-value">{metrics.latencySec === null ? "—" : `${metrics.latencySec.toFixed(1)}초`}</span></div>
          <div><span className="metric-label">영상 버퍼</span><span className="metric-value">{metrics.bufferSec.toFixed(1)}초</span></div>
          <div><span className="metric-label">누락 프레임</span><span className="metric-value">{metrics.droppedFrames}</span></div>
          <div><span className="metric-label">멈춤 / 재시도</span><span className="metric-value">{metrics.stallCount} / {metrics.retryCount}</span></div>
        </div>
        <p className="manifest-text">{manifestUrl}</p>
        <p className="metrics-footnote">라이브 지연은 플레이리스트 기준이며, 카메라 촬영부터 화면까지의 전체 지연과 다를 수 있습니다.</p>
      </details>
    </div>
  );
}
