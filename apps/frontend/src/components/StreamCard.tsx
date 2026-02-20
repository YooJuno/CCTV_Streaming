import { useState } from "react";
import type { StreamHealth, StreamInfo } from "../types";
import HlsPlayer from "./HlsPlayer";

interface StreamCardProps {
  stream: StreamInfo;
  health?: StreamHealth;
  liveThresholdSeconds: number;
}

function guidanceFromHealth(health: StreamHealth, liveThresholdSeconds: number): string {
  switch (health.reason) {
    case "OK":
      return "Stream is healthy. Press Start to play.";
    case "MANIFEST_NO_SEGMENTS":
      return "Pipeline connected but first segment is not ready yet.";
    case "INSUFFICIENT_SEGMENTS":
      return "Stream is warming up. Waiting for enough HLS segments.";
    case "MANIFEST_STALE":
      return `Manifest is stale. No update within ${liveThresholdSeconds || 12}s.`;
    case "SEGMENT_MISSING":
      return "Manifest points to a segment that does not exist.";
    case "SEGMENT_EMPTY":
      return "Latest segment file is empty. Encoder may be unstable.";
    case "ENDLIST_PRESENT":
      return "Stream ended (playlist has ENDLIST). Restart converter.";
    case "MANIFEST_UNREADABLE":
      return "Manifest cannot be read by backend. Check permissions.";
    case "MANIFEST_MISSING":
      return "Manifest not found. Start MJPEG to HLS converter first.";
    default:
      return "Checking stream health...";
  }
}

function statePillClass(health?: StreamHealth): string {
  if (!health) {
    return "checking";
  }
  if (health.state === "LIVE") {
    return "live";
  }
  if (health.state === "STARTING") {
    return "starting";
  }
  if (health.state === "ERROR") {
    return "error";
  }
  return "offline";
}

export default function StreamCard({ stream, health, liveThresholdSeconds }: StreamCardProps) {
  const [active, setActive] = useState(false);
  const liveState = health ? health.state : "CHECKING";
  const liveClass = statePillClass(health);
  const cardTone = health ? (health.state === "LIVE" ? "tone-live" : health.state === "STARTING" ? "tone-starting" : "tone-offline") : "tone-checking";
  const placeholderText = health ? guidanceFromHealth(health, liveThresholdSeconds) : "Checking stream health...";

  const manifestAgeText =
    health && health.manifestAgeSeconds >= 0 ? `${health.manifestAgeSeconds}s ago` : "Not detected";
  const commandHint = `MJPEG_URL=http://<device-ip>:81/stream STREAM_ID=${stream.id} ./scripts/mjpeg_to_hls.sh`;
  const showCommandHint = !health || !health.live;

  return (
    <article className={`stream-card ${cardTone}`}>
      <header className="stream-card-header">
        <div>
          <h3>{stream.name}</h3>
          <p className="stream-id">
            {stream.id} <span className={`stream-live-pill ${liveClass}`}>{liveState}</span>
          </p>
          <div className="stream-meta-row">
            <span className="stream-meta-pill">Manifest: {health?.manifestExists ? "YES" : "NO"}</span>
            <span className="stream-meta-pill">Segments: {health?.segmentCount ?? "-"}</span>
            <span className="stream-meta-pill">Updated: {manifestAgeText}</span>
          </div>
        </div>
        <button type="button" className={`btn ${active ? "danger" : "ghost"}`} onClick={() => setActive((v) => !v)}>
          {active ? "Stop" : "Start"}
        </button>
      </header>

      {active ? (
        <HlsPlayer streamId={stream.id} />
      ) : (
        <div className="stream-placeholder">
          <p className="stream-placeholder-text">{placeholderText}</p>
          {showCommandHint ? <code className="stream-command-hint">{commandHint}</code> : null}
        </div>
      )}
    </article>
  );
}
