import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaybackMetrics, PlaybackStatus } from "../types";
import { buildManifestUrl, computeLatencySeconds, getBufferedSeconds, getDroppedFrames } from "../utils/hls";
import StatusBadge from "./StatusBadge";
import type HlsType from "hls.js";

interface HlsPlayerProps {
  streamId: string;
  token: string;
}

const MAX_NETWORK_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 500;

const INITIAL_METRICS: PlaybackMetrics = {
  latencySec: null,
  bufferSec: 0,
  droppedFrames: 0,
  stallCount: 0,
  retryCount: 0,
};

export default function HlsPlayer({ streamId, token }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PlaybackMetrics>(INITIAL_METRICS);

  const manifestUrl = useMemo(() => {
    const baseUrl = import.meta.env.VITE_HLS_BASE_URL || "http://localhost:8080/hls";
    const overrideUrl = import.meta.env.VITE_HLS_URL;
    return buildManifestUrl(baseUrl, streamId, overrideUrl);
  }, [streamId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return undefined;
    }

    let disposed = false;
    let hls: HlsType | null = null;
    let hlsCtor: typeof import("hls.js").default | null = null;
    let retryTimer: number | null = null;
    let statsTimer: number | null = null;
    let retryCount = 0;
    let stallCount = 0;

    setStatus("loading");
    setErrorMessage(null);
    setMetrics(INITIAL_METRICS);

    const clearRetryTimer = () => {
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const updateMetrics = () => {
      if (disposed || !video) {
        return;
      }
      const latency = computeLatencySeconds(hls?.liveSyncPosition ?? null, video.currentTime);
      const bufferSec = getBufferedSeconds(video);
      const droppedFrames = getDroppedFrames(video);
      setMetrics((prev) => ({
        ...prev,
        latencySec: latency,
        bufferSec,
        droppedFrames,
        stallCount,
        retryCount,
      }));
    };

    const markWaiting = () => {
      stallCount += 1;
      setStatus("buffering");
      updateMetrics();
    };
    const markPlaying = () => {
      setStatus("playing");
      updateMetrics();
    };
    const markVideoError = () => {
      setStatus("video error");
      setErrorMessage("Video element reported an error.");
      updateMetrics();
    };

    const cleanupVideo = () => {
      video.removeEventListener("waiting", markWaiting);
      video.removeEventListener("playing", markPlaying);
      video.removeEventListener("error", markVideoError);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const tryPlay = () => {
      video.play().then(() => setStatus("playing")).catch(() => setStatus("ready"));
    };

    const buildAuthHeaders = (headers?: HeadersInit) => {
      const next = new Headers(headers);
      next.set("Authorization", `Bearer ${token}`);
      return next;
    };

    video.addEventListener("waiting", markWaiting);
    video.addEventListener("playing", markPlaying);
    video.addEventListener("error", markVideoError);
    statsTimer = window.setInterval(updateMetrics, 1000);

    const initHls = async () => {
      const module = await import("hls.js");
      if (disposed) {
        return;
      }
      hlsCtor = module.default;
      if (!hlsCtor.isSupported()) {
        setStatus("hls unsupported");
        setErrorMessage("This browser does not support authenticated HLS playback.");
        return;
      }
      const ctor = hlsCtor;

      hls = new ctor({
        lowLatencyMode: true,
        backBufferLength: 90,
        liveSyncDurationCount: 3,
        maxLiveSyncPlaybackRate: 1.5,
        xhrSetup: (xhr) => {
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        },
        fetchSetup: (context, initParams) =>
          new Request(context.url, {
            ...initParams,
            headers: buildAuthHeaders(initParams?.headers),
          }),
      });

      hls.loadSource(manifestUrl);
      hls.attachMedia(video);

      hls.on(ctor.Events.MANIFEST_PARSED, () => {
        retryCount = 0;
        setStatus("ready");
        setErrorMessage(null);
        tryPlay();
        updateMetrics();
      });

      hls.on(ctor.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          return;
        }
        const httpCode = data.response?.code;

        if (data.type === ctor.ErrorTypes.NETWORK_ERROR && (httpCode === 401 || httpCode === 403)) {
          setStatus("fatal error");
          setErrorMessage("Unauthorized while loading HLS. Please sign in again.");
          hls?.destroy();
          hls = null;
          return;
        }

        if (data.type === ctor.ErrorTypes.NETWORK_ERROR && httpCode === 404) {
          setStatus("fatal error");
          setErrorMessage("HLS stream is not generated yet (404). Start the FFmpeg pipeline first.");
          hls?.destroy();
          hls = null;
          return;
        }

        const shouldRetryNetwork = data.type === ctor.ErrorTypes.NETWORK_ERROR && retryCount < MAX_NETWORK_RETRIES && (!httpCode || httpCode >= 500);
        if (shouldRetryNetwork) {
          retryCount += 1;
          setStatus("network retry");
          const codeSuffix = httpCode ? ` (HTTP ${httpCode})` : "";
          setErrorMessage(`Network issue detected${codeSuffix}. Retrying (${retryCount}/${MAX_NETWORK_RETRIES})...`);
          setMetrics((prev) => ({ ...prev, retryCount }));
          clearRetryTimer();
          retryTimer = window.setTimeout(() => {
            if (!disposed && hls) {
              hls.startLoad();
            }
          }, RETRY_BASE_DELAY_MS * retryCount);
          return;
        }
        if (data.type === ctor.ErrorTypes.MEDIA_ERROR) {
          setStatus("media recovery");
          setErrorMessage("Media decode issue detected. Attempting recovery...");
          hls?.recoverMediaError();
          return;
        }
        setStatus("fatal error");
        const codeSuffix = httpCode ? ` (HTTP ${httpCode})` : "";
        setErrorMessage((data.details || "Fatal playback error.") + codeSuffix);
        hls?.destroy();
        hls = null;
      });
    };

    void initHls();

    return () => {
      disposed = true;
      clearRetryTimer();
      if (statsTimer) {
        window.clearInterval(statsTimer);
      }
      if (hls) {
        hls.destroy();
        hls = null;
      }
      hlsCtor = null;
      cleanupVideo();
    };
  }, [manifestUrl, token]);

  return (
    <div className="hls-player">
      <video ref={videoRef} className="hls-video" controls playsInline crossOrigin="anonymous" />

      <div className="hls-toolbar">
        <StatusBadge status={status} />
        <span className="meta-pill">{streamId}</span>
      </div>

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

      <p className="manifest-text">{manifestUrl}</p>
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </div>
  );
}
