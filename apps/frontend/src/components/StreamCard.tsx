import { useState } from "react";
import type { StreamHealth, StreamInfo } from "../types";
import HlsPlayer from "./HlsPlayer";

interface StreamCardProps {
  stream: StreamInfo;
  health?: StreamHealth;
  liveThresholdSeconds: number;
}

export default function StreamCard({ stream, health, liveThresholdSeconds }: StreamCardProps) {
  const [active, setActive] = useState(false);
  const liveState = health ? (health.live ? "LIVE" : "OFFLINE") : "CHECKING";
  const liveClass = health ? (health.live ? "live" : "offline") : "checking";

  const placeholderText = health
    ? health.live
      ? "Stream is ready. Press Start to play."
      : `Stream is offline. Start MJPEG->HLS pipeline and wait up to ${liveThresholdSeconds || 12}s.`
    : "Checking stream health...";

  return (
    <article className="stream-card">
      <header className="stream-card-header">
        <div>
          <h3>{stream.name}</h3>
          <p className="stream-id">
            {stream.id} <span className={`stream-live-pill ${liveClass}`}>{liveState}</span>
          </p>
        </div>
        <button type="button" className={`btn ${active ? "danger" : "secondary"}`} onClick={() => setActive((v) => !v)}>
          {active ? "Stop" : "Start"}
        </button>
      </header>

      {active ? (
        <HlsPlayer streamId={stream.id} />
      ) : (
        <div className="stream-placeholder">{placeholderText}</div>
      )}
    </article>
  );
}
