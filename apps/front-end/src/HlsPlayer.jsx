import React, { useEffect, useRef, useState } from "react";

export default function HlsPlayer({ streamId = "mystream" }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [manifestUrl, setManifestUrl] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let disposed = false;

    const baseUrl = import.meta.env.VITE_HLS_BASE_URL || "http://localhost:8080/hls";
    const safeStreamId = encodeURIComponent(String(streamId).trim() || "mystream");
    const url = import.meta.env.VITE_HLS_URL || `${baseUrl}/${safeStreamId}.m3u8`;
    setManifestUrl(url);

    setStatus("loading");

    const cleanupVideoElement = () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("error", onVideoError);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const onPlaying = () => setStatus("playing");
    const onWaiting = () => setStatus("buffering");
    const onVideoError = () => setStatus("video error");
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("error", onVideoError);

    const tryAutoplay = () => {
      video.play().then(() => setStatus("playing")).catch(() => setStatus("ready"));
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      tryAutoplay();
      return () => {
        disposed = true;
        cleanupVideoElement();
      };
    }

    (async () => {
      try {
        const hlsModule = await import("hls.js");
        const Hls = hlsModule.default;
        if (disposed) return;
        if (!Hls || !Hls.isSupported()) {
          setStatus("hls unsupported");
          return;
        }

        const hls = new Hls({
          lowLatencyMode: true,
          backBufferLength: 120,
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStatus("ready");
          tryAutoplay();
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data || !data.fatal) {
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setStatus("network retry");
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            setStatus("media recovery");
            hls.recoverMediaError();
            return;
          }
          setStatus("fatal error");
          hls.destroy();
          hlsRef.current = null;
        });
      } catch (error) {
        if (!disposed) {
          setStatus("hls load failed");
        }
      }
    })();

    return () => {
      disposed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      cleanupVideoElement();
    };
  }, [streamId]);

  return (
    <div className="hls-panel">
      <video ref={videoRef} className="hls-video" controls playsInline crossOrigin="anonymous" />
      <div className="hls-info">
        <span className="hls-status">Status: {status}</span>
        <span className="hls-url">{manifestUrl}</span>
      </div>
    </div>
  );
}
