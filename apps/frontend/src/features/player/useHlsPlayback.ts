import { useEffect, useState } from "react";
import type HlsType from "hls.js";
import type { PlaybackMetrics, PlaybackStatus } from "../../types";
import { computeLatencySeconds, getBufferedSeconds, getDroppedFrames } from "../../utils/hls";
import {
  FATAL_RELOAD_BASE_DELAY_MS,
  MAX_FATAL_RELOADS,
  STALL_WATCHDOG_INTERVAL_MS,
  STALL_WATCHDOG_TRIGGER_MS,
  MAX_STALL_RECOVERY_ATTEMPTS,
  LATENCY_SOFT_CATCHUP_SEC,
  LATENCY_HARD_SEEK_SEC,
  LIVE_EDGE_BACKOFF_SEC,
  CATCHUP_PLAYBACK_RATE,
} from "./useHlsPlaybackConstants";
import { decideFatalHlsErrorAction, MAX_FATAL_RELOADS as POLICY_MAX_FATAL_RELOADS } from "./hlsErrorPolicy";

interface UseHlsPlaybackParams {
  manifestUrl: string;
  videoElement: HTMLVideoElement | null;
}

interface UseHlsPlaybackResult {
  status: PlaybackStatus;
  errorMessage: string | null;
  metrics: PlaybackMetrics;
  reconnect: () => void;
}

const INITIAL_METRICS: PlaybackMetrics = {
  latencySec: null,
  bufferSec: 0,
  droppedFrames: 0,
  stallCount: 0,
  retryCount: 0,
};

export default function useHlsPlayback({ manifestUrl, videoElement }: UseHlsPlaybackParams): UseHlsPlaybackResult {
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PlaybackMetrics>(INITIAL_METRICS);
  const [connectionVersion, setConnectionVersion] = useState(0);

  useEffect(() => {
    const video = videoElement;
    if (!video) {
      return undefined;
    }

    let disposed = false;
    let hls: HlsType | null = null;
    let manifestParsed = false;
    let retryTimer: number | null = null;
    let statsTimer: number | null = null;
    let stallWatchdogTimer: number | null = null;
    let retryCount = 0;
    let notFoundRetryCount = 0;
    let stallCount = 0;
    // `hls === null` is ambiguous: it means both "native HLS playback" and "the instance was
    // destroyed by a fatal error". Only the first should be reloaded through the video element.
    let usingNativeHls = false;
    let fatalReloadCount = 0;
    let mediaRecoveryCount = 0;
    let stallRecoveryAttempts = 0;
    let lastVideoTime = 0;
    let lastProgressAtMs = Date.now();

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
      const latency = typeof hls?.latency === "number" && Number.isFinite(hls.latency)
        ? hls.latency
        : computeLatencySeconds(hls?.liveSyncPosition ?? null, video.currentTime);
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

    const markProgress = () => {
      lastVideoTime = video.currentTime;
      lastProgressAtMs = Date.now();
      stallRecoveryAttempts = 0;
    };

    const syncToLiveEdge = () => {
      if (disposed || !video || !hls || video.paused || video.seeking) {
        return;
      }
      const liveSyncPosition = hls.liveSyncPosition;
      if (typeof liveSyncPosition !== "number" || !Number.isFinite(liveSyncPosition)) {
        if (video.playbackRate !== 1) {
          video.playbackRate = 1;
        }
        return;
      }
      const latency = liveSyncPosition - video.currentTime;
      if (!Number.isFinite(latency) || latency < 0) {
        if (video.playbackRate !== 1) {
          video.playbackRate = 1;
        }
        return;
      }

      if (latency >= LATENCY_HARD_SEEK_SEC) {
        const targetTime = Math.max(0, liveSyncPosition - LIVE_EDGE_BACKOFF_SEC);
        if (targetTime > video.currentTime + 0.25) {
          video.currentTime = targetTime;
          markProgress();
        }
      }

      if (latency >= LATENCY_SOFT_CATCHUP_SEC) {
        if (video.playbackRate !== CATCHUP_PLAYBACK_RATE) {
          video.playbackRate = CATCHUP_PLAYBACK_RATE;
        }
      } else if (video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
    };

    const markWaiting = () => {
      stallCount += 1;
      setStatus("buffering");
      updateMetrics();
    };

    const markPlaying = () => {
      markProgress();
      setStatus("playing");
      // hls.js re-emits MANIFEST_PARSED only for a fresh loadSource, so a stream recovered by
      // startLoad() would otherwise keep its stale error text and never give back its retry
      // budget -- a few transient blips would permanently exhaust MAX_NETWORK_RETRIES.
      setErrorMessage(null);
      retryCount = 0;
      notFoundRetryCount = 0;
      mediaRecoveryCount = 0;
      fatalReloadCount = 0;
      updateMetrics();
    };

    const markVideoError = () => {
      setStatus("video error");
      setErrorMessage("영상을 재생하지 못했습니다. 다시 연결해 주세요.");
      updateMetrics();
    };

    const stopWatchdog = () => {
      if (stallWatchdogTimer !== null) {
        window.clearInterval(stallWatchdogTimer);
        stallWatchdogTimer = null;
      }
    };

    const cleanupVideo = () => {
      video.removeEventListener("waiting", markWaiting);
      video.removeEventListener("playing", markPlaying);
      video.removeEventListener("error", markVideoError);
      video.playbackRate = 1;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const tryPlay = () => {
      // Teardown itself rejects this promise (cleanupVideo pauses the element), so an unguarded
      // handler would land after the replacement effect had already set its own status.
      video.play()
        .then(() => {
          if (!disposed) {
            setStatus("playing");
          }
        })
        .catch(() => {
          if (!disposed) {
            setStatus("ready");
          }
        });
    };

    const scheduleReload = (delayMs: number, message: string) => {
      setStatus("network retry");
      setErrorMessage(message);
      setMetrics((prev) => ({ ...prev, retryCount: retryCount + notFoundRetryCount }));
      clearRetryTimer();
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (!disposed && hls) {
          // startLoad resumes segments only after a playlist has been parsed.
          // A first-manifest 404 must issue a new manifest request.
          if (manifestParsed) {
            hls.startLoad();
          } else {
            hls.loadSource(manifestUrl);
          }
        }
      }, delayMs);
    };

    const scheduleFullReload = (delayMs: number, message: string) => {
      setStatus("network retry");
      setErrorMessage(message);
      clearRetryTimer();
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (disposed) {
          return;
        }
        if (hls) {
          hls.destroy();
          hls = null;
        }
        stallRecoveryAttempts = 0;
        markProgress();
        void initHls().catch(() => {
          if (!disposed) {
            setStatus("fatal error");
            setErrorMessage("플레이어를 다시 불러오지 못했습니다. 다시 연결해 주세요.");
          }
        });
      }, delayMs);
    };

    video.addEventListener("waiting", markWaiting);
    video.addEventListener("playing", markPlaying);
    video.addEventListener("error", markVideoError);

    statsTimer = window.setInterval(() => {
      updateMetrics();
      syncToLiveEdge();
    }, 1000);

    stallWatchdogTimer = window.setInterval(() => {
      if (disposed) {
        return;
      }
      // A recovery is already scheduled. Re-entering here would cancel it via clearRetryTimer()
      // and burn another slot of the reload budget every second.
      if (retryTimer !== null) {
        return;
      }
      if (video.paused || video.ended) {
        markProgress();
        return;
      }

      const currentTime = video.currentTime;
      if (!Number.isFinite(currentTime)) {
        return;
      }

      if (Math.abs(currentTime - lastVideoTime) > 0.05) {
        markProgress();
        return;
      }

      if (Date.now() - lastProgressAtMs < STALL_WATCHDOG_TRIGGER_MS) {
        return;
      }

      stallCount += 1;
      updateMetrics();
      stallRecoveryAttempts += 1;

      const bufferedSec = getBufferedSeconds(video);
      if (hls && stallRecoveryAttempts <= MAX_STALL_RECOVERY_ATTEMPTS) {
        setStatus("network retry");
        setErrorMessage(
          `영상 연결을 복구하고 있습니다. (${stallRecoveryAttempts}/${MAX_STALL_RECOVERY_ATTEMPTS})`,
        );
        if (bufferedSec < 0.2) {
          hls.startLoad();
        } else {
          hls.recoverMediaError();
        }
        void video.play().catch(() => {});
        lastProgressAtMs = Date.now();
        return;
      }

      if (usingNativeHls && stallRecoveryAttempts <= MAX_STALL_RECOVERY_ATTEMPTS) {
        setStatus("network retry");
        setErrorMessage(
          `영상을 다시 불러오고 있습니다. (${stallRecoveryAttempts}/${MAX_STALL_RECOVERY_ATTEMPTS})`,
        );
        const src = manifestUrl;
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.src = src;
        void video.play().catch(() => {
          if (!disposed) {
            setStatus("ready");
          }
        });
        lastProgressAtMs = Date.now();
        return;
      }

      if (!hls && !usingNativeHls) {
        // A fatal error already tore the player down and explained why. Leave that message up.
        stopWatchdog();
        return;
      }

      if (hls && fatalReloadCount < MAX_FATAL_RELOADS) {
        fatalReloadCount += 1;
        const delayMs = Math.min(15000, FATAL_RELOAD_BASE_DELAY_MS * fatalReloadCount);
        lastProgressAtMs = Date.now();
        scheduleFullReload(
          delayMs,
          `플레이어를 다시 연결하고 있습니다. (${fatalReloadCount}/${MAX_FATAL_RELOADS})`,
        );
        return;
      }

      stopWatchdog();
      setStatus("fatal error");
      setErrorMessage("영상이 계속 멈추고 있습니다. 카메라 연결을 확인한 뒤 다시 연결해 주세요.");
    }, STALL_WATCHDOG_INTERVAL_MS);

    const initHls = async () => {
      manifestParsed = false;
      const module = (await import("hls.js/dist/hls.light.mjs")) as typeof import("hls.js");
      if (disposed) {
        return;
      }
      const ctor = module.default;
      if (!ctor.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          usingNativeHls = true;
          video.src = manifestUrl;
          setStatus("ready");
          setErrorMessage(null);
          tryPlay();
          return;
        }
        setStatus("hls unsupported");
        setErrorMessage("이 브라우저에서 영상을 재생할 수 없습니다. 최신 Chrome 또는 Safari를 사용해 주세요.");
        return;
      }

      hls = new ctor({
        lowLatencyMode: false,
        backBufferLength: 30,
        startPosition: -1,
        startFragPrefetch: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxBufferLength: 24,
        maxMaxBufferLength: 48,
        maxLiveSyncPlaybackRate: 1.2,
        nudgeMaxRetry: 8,
        manifestLoadingTimeOut: 20000,
        levelLoadingTimeOut: 20000,
        fragLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,
        fragLoadingMaxRetry: 6,
        xhrSetup: (xhr) => {
          xhr.withCredentials = true;
        },
        fetchSetup: (context, initParams) =>
          new Request(context.url, {
            ...initParams,
            credentials: "include",
          }),
      });

      hls.on(ctor.Events.MANIFEST_PARSED, () => {
        manifestParsed = true;
        retryCount = 0;
        notFoundRetryCount = 0;
        setStatus("ready");
        setErrorMessage(null);
        markProgress();
        tryPlay();
        updateMetrics();
      });

      hls.on(ctor.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          return;
        }

        const decision = decideFatalHlsErrorAction(
          {
            type: data.type,
            httpCode: data.response?.code,
            details: data.details,
          },
          {
            retryCount,
            notFoundRetryCount,
            fatalReloadCount,
            mediaRecoveryCount,
          },
        );

        if (decision.kind === "unauthorized") {
          setStatus("fatal error");
          setErrorMessage("영상 접근 권한을 확인할 수 없습니다. 다시 로그인해 주세요.");
          hls?.destroy();
          hls = null;
          return;
        }

        if (decision.kind === "not-found-retry") {
          notFoundRetryCount = decision.nextNotFoundRetryCount;
          scheduleReload(decision.delayMs, decision.message);
          return;
        }

        if (decision.kind === "not-found-fatal") {
          setStatus("fatal error");
          setErrorMessage(decision.message);
          hls?.destroy();
          hls = null;
          return;
        }

        if (decision.kind === "network-retry") {
          retryCount = decision.nextRetryCount;
          scheduleReload(decision.delayMs, decision.message);
          return;
        }

        if (decision.kind === "network-full-reload") {
          fatalReloadCount = Math.min(decision.nextFatalReloadCount, POLICY_MAX_FATAL_RELOADS);
          scheduleFullReload(decision.delayMs, decision.message);
          return;
        }

        if (decision.kind === "media-recovery") {
          mediaRecoveryCount = decision.nextMediaRecoveryCount;
          setStatus("media recovery");
          setErrorMessage(decision.message);
          hls?.recoverMediaError();
          return;
        }

        if (decision.kind === "media-full-reload") {
          fatalReloadCount = Math.min(decision.nextFatalReloadCount, POLICY_MAX_FATAL_RELOADS);
          scheduleFullReload(decision.delayMs, decision.message);
          return;
        }

        if (decision.kind === "media-fatal") {
          setStatus("fatal error");
          setErrorMessage(decision.message);
          hls?.destroy();
          hls = null;
          return;
        }

        setStatus("fatal error");
        setErrorMessage(decision.message);
        hls?.destroy();
        hls = null;
      });
      hls.attachMedia(video);
      hls.loadSource(manifestUrl);
    };

    const connect = () => {
      void initHls().catch(() => {
        if (!disposed) {
          setStatus("fatal error");
          setErrorMessage("플레이어를 불러오지 못했습니다. 네트워크를 확인하고 다시 연결해 주세요.");
        }
      });
    };
    connect();

    return () => {
      disposed = true;
      clearRetryTimer();
      if (statsTimer) {
        window.clearInterval(statsTimer);
      }
      if (stallWatchdogTimer) {
        window.clearInterval(stallWatchdogTimer);
      }
      if (hls) {
        hls.destroy();
        hls = null;
      }
      cleanupVideo();
    };
  }, [manifestUrl, videoElement, connectionVersion]);

  return {
    status,
    errorMessage,
    metrics,
    reconnect: () => setConnectionVersion((version) => version + 1),
  };
}
