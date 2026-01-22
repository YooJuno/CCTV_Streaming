import React, { useEffect, useRef, useState } from "react";

export default function HlsPlayer({ streamId = "mystream" }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const baseUrl = import.meta.env.VITE_HLS_BASE_URL || "http://localhost:8080/hls";
    const url = import.meta.env.VITE_HLS_URL || `${baseUrl}/${streamId}.m3u8`;

    setStatus("loading");

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().then(() => setStatus("playing")).catch(() => setStatus("loaded"));
      return () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }

    if (!window.Hls) {
      setStatus("hls.js not loaded");
      return undefined;
    }

    const hls = new window.Hls({
      lowLatencyMode: true,
      backBufferLength: 120,
    });
    hlsRef.current = hls;
    hls.loadSource(url);
    hls.attachMedia(video);

    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      video.play().then(() => setStatus("playing")).catch(() => setStatus("loaded"));
    });

    hls.on(window.Hls.Events.ERROR, () => {
      setStatus("error");
    });

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [streamId]);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <video ref={videoRef} controls playsInline style={{ width: "100%", background: "#000" }} />
      <div style={{ textAlign: "center", marginTop: 8, color: "#6b7280" }}>{status}</div>
    </div>
  );
}
