import React, { useEffect, useRef, useState } from "react";

export default function HlsPlayer({ streamId = "mystream" }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let disposed = false;

    const baseUrl = import.meta.env.VITE_HLS_BASE_URL || "http://localhost:8080/hls";
    const url = import.meta.env.VITE_HLS_URL || `${baseUrl}/${streamId}.m3u8`;

    setStatus("loading");

    const cleanupVideo = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().then(() => setStatus("playing")).catch(() => setStatus("loaded"));
      return () => {
        disposed = true;
        cleanupVideo();
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
          video.play().then(() => setStatus("playing")).catch(() => setStatus("loaded"));
        });

        hls.on(Hls.Events.ERROR, () => {
          setStatus("error");
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
      cleanupVideo();
    };
  }, [streamId]);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <video ref={videoRef} controls playsInline style={{ width: "100%", background: "#000" }} />
      <div style={{ textAlign: "center", marginTop: 8, color: "#6b7280" }}>{status}</div>
    </div>
  );
}
