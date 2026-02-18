import { useState } from "react";
import type { StreamInfo } from "../types";
import HlsPlayer from "./HlsPlayer";

interface StreamCardProps {
  stream: StreamInfo;
  token: string;
}

export default function StreamCard({ stream, token }: StreamCardProps) {
  const [active, setActive] = useState(false);

  return (
    <article className="stream-card">
      <header className="stream-card-header">
        <div>
          <h3>{stream.name}</h3>
          <p className="stream-id">{stream.id}</p>
        </div>
        <button type="button" className={`btn ${active ? "danger" : "secondary"}`} onClick={() => setActive((v) => !v)}>
          {active ? "Stop" : "Start"}
        </button>
      </header>

      {active ? (
        <HlsPlayer streamId={stream.id} token={token} />
      ) : (
        <div className="stream-placeholder">Stream is stopped.</div>
      )}
    </article>
  );
}
