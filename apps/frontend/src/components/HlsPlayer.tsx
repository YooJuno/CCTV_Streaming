import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaybackMetrics, PlaybackStatus } from "../types";
import { buildManifestUrl, computeLatencySeconds, getBufferedSeconds, getDroppedFrames } from "../utils/hls";
import StatusBadge from "./StatusBadge";
import type HlsType from "hls.js";

interface HlsPlayerProps {
  streamId: string;
}

const MAX_NETWORK_RETRIES = 5;
const MAX_NOT_FOUND_RETRIES = 40;
const RETRY_BASE_DELAY_MS = 500;
const MAX_FATAL_RELOADS = 6;
const FATAL_RELOAD_BASE_DELAY_MS = 1500;
const MAX_MEDIA_RECOVERIES = 3;

const INITIAL_METRICS: PlaybackMetrics = {
  latencySec: null,
  bufferSec: 0,
  droppedFrames: 0,
  stallCount: 0,
  retryCount: 0,
};

export default function HlsPlayer({ streamId }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PlaybackMetrics>(INITIAL_METRICS);

  const manifestUrl = useMemo(() => {
    const baseUrl = (import.meta.env.VITE_HLS_BASE_URL || "/hls").replace(/\/$/, "");
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
    let retryTimer: number | null = null;
    let statsTimer: number | null = null;
    let retryCount = 0;
    let notFoundRetryCount = 0;
    let stallCount = 0;
    let fatalReloadCount = 0;
    let mediaRecoveryCount = 0;

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
        retryCount: retryCount + notFoundRetryCount,
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

    const scheduleReload = (delayMs: number, message: string) => {
      setStatus("network retry");
      setErrorMessage(message);
      setMetrics((prev) => ({ ...prev, retryCount: retryCount + notFoundRetryCount }));
      clearRetryTimer();
      retryTimer = window.setTimeout(() => {
        if (!disposed && hls) {
          hls.startLoad();
        }
      }, delayMs);
    };

    const scheduleFullReload = (delayMs: number, message: string) => {
      setStatus("network retry");
      setErrorMessage(message);
      clearRetryTimer();
      retryTimer = window.setTimeout(() => {
        if (disposed) {
          return;
        }
        if (hls) {
          hls.destroy();
          hls = null;
        }
        void initHls();
      }, delayMs);
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
      const ctor = module.default;
      if (!ctor.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = manifestUrl;
          setStatus("ready");
          setErrorMessage(null);
          tryPlay();
          return;
        }
        setStatus("hls unsupported");
        setErrorMessage("This browser does not support authenticated HLS playback.");
        return;
      }

      hls = new ctor({
        lowLatencyMode: true,
        backBufferLength: 90,
        liveSyncDurationCount: 3,
        maxLiveSyncPlaybackRate: 1.5,
        xhrSetup: (xhr) => {
          xhr.withCredentials = true;
        },
        fetchSetup: (context, initParams) =>
          new Request(context.url, {
            ...initParams,
            credentials: "include",
          }),
      });

      hls.loadSource(manifestUrl);
      hls.attachMedia(video);

      hls.on(ctor.Events.MANIFEST_PARSED, () => {
        retryCount = 0;
        notFoundRetryCount = 0;
        fatalReloadCount = 0;
        mediaRecoveryCount = 0;
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
          if (notFoundRetryCount < MAX_NOT_FOUND_RETRIES) {
            notFoundRetryCount += 1;
            const delayMs = Math.min(5000, RETRY_BASE_DELAY_MS * notFoundRetryCount);
            scheduleReload(delayMs, `HLS stream is not generated yet (404). Waiting for pipeline... (${notFoundRetryCount}/${MAX_NOT_FOUND_RETRIES})`);
            return;
          }
          setStatus("fatal error");
          setErrorMessage("HLS stream is not generated yet (404). Start the FFmpeg pipeline first.");
          hls?.destroy();
          hls = null;
          return;
        }

        const shouldRetryNetwork = data.type === ctor.ErrorTypes.NETWORK_ERROR && retryCount < MAX_NETWORK_RETRIES && (!httpCode || httpCode >= 500);
        if (shouldRetryNetwork) {
          retryCount += 1;
          const codeSuffix = httpCode ? ` (HTTP ${httpCode})` : "";
          scheduleReload(RETRY_BASE_DELAY_MS * retryCount, `Network issue detected${codeSuffix}. Retrying (${retryCount}/${MAX_NETWORK_RETRIES})...`);
          return;
        }
        if (data.type === ctor.ErrorTypes.NETWORK_ERROR && fatalReloadCount < MAX_FATAL_RELOADS) {
          fatalReloadCount += 1;
          const codeSuffix = httpCode ? ` (HTTP ${httpCode})` : "";
          const delayMs = Math.min(15000, FATAL_RELOAD_BASE_DELAY_MS * fatalReloadCount);
          scheduleFullReload(delayMs, `Persistent network issue${codeSuffix}. Reinitializing player (${fatalReloadCount}/${MAX_FATAL_RELOADS})...`);
          return;
        }
        if (data.type === ctor.ErrorTypes.MEDIA_ERROR) {
          if (mediaRecoveryCount < MAX_MEDIA_RECOVERIES) {
            mediaRecoveryCount += 1;
            setStatus("media recovery");
            setErrorMessage(`Media decode issue detected. Attempting recovery (${mediaRecoveryCount}/${MAX_MEDIA_RECOVERIES})...`);
            hls?.recoverMediaError();
            return;
          }
          if (fatalReloadCount < MAX_FATAL_RELOADS) {
            fatalReloadCount += 1;
            const delayMs = Math.min(15000, FATAL_RELOAD_BASE_DELAY_MS * fatalReloadCount);
            scheduleFullReload(delayMs, `Media recovery limit reached. Reinitializing player (${fatalReloadCount}/${MAX_FATAL_RELOADS})...`);
            return;
          }
        }
        if (data.type === ctor.ErrorTypes.MEDIA_ERROR) {
          setStatus("fatal error");
          setErrorMessage("Media decode failed repeatedly. Please restart stream source.");
          hls?.destroy();
          hls = null;
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
      cleanupVideo();
    };
  }, [manifestUrl]);

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
