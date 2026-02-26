import { useMemo, useState } from "react";
import type { PlaybackMetrics, PlaybackStatus } from "../types";
import { buildManifestUrl } from "../utils/hls";
import useHlsPlayback from "../features/player/useHlsPlayback";
import StatusBadge from "./StatusBadge";

interface HlsPlayerProps {
  streamId: string;
}

interface MetricsBoardProps {
  metrics: PlaybackMetrics;
}

function MetricsBoard({ metrics }: MetricsBoardProps) {
  return (
    <div className="metrics-grid">
      <div>
        <span className="metric-label">Latency</span>
        <span className="metric-value">{metrics.latencySec === null ? "-" : `${metrics.latencySec.toFixed(1)}s`}</span>
      </div>
      <div>
        <span className="metric-label">Buffer</span>
        <span className="metric-value">{metrics.bufferSec.toFixed(1)}s</span>
      </div>
      <div>
        <span className="metric-label">Dropped</span>
        <span className="metric-value">{metrics.droppedFrames}</span>
      </div>
      <div>
        <span className="metric-label">Stalls</span>
        <span className="metric-value">{metrics.stallCount}</span>
      </div>
      <div>
        <span className="metric-label">Retries</span>
        <span className="metric-value">{metrics.retryCount}</span>
      </div>
    </div>
  );
}

interface ToolbarProps {
  status: PlaybackStatus;
  streamId: string;
}

function Toolbar({ status, streamId }: ToolbarProps) {
  return (
    <div className="hls-toolbar">
      <StatusBadge status={status} />
      <span className="meta-pill">{streamId}</span>
    </div>
  );
}

export default function HlsPlayer({ streamId }: HlsPlayerProps) {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const manifestUrl = useMemo(() => {
    const baseUrl = (import.meta.env.VITE_HLS_BASE_URL || "/hls").replace(/\/$/, "");
    const overrideUrl = import.meta.env.VITE_HLS_URL;
    return buildManifestUrl(baseUrl, streamId, overrideUrl);
  }, [streamId]);

  const { status, errorMessage, metrics } = useHlsPlayback({
    manifestUrl,
    videoElement,
  });

  return (
    <div className="hls-player">
      <video ref={setVideoElement} className="hls-video" controls playsInline crossOrigin="anonymous" />
      <Toolbar status={status} streamId={streamId} />
      <MetricsBoard metrics={metrics} />
      <p className="manifest-text">{manifestUrl}</p>
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </div>
  );
}
