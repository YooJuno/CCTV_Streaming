import React, { useMemo, useState } from "react";
import StreamPlayer from "./StreamPlayer";

export default function App() {
  const [streaming, setStreaming] = useState(false);

  const signalingUrl = useMemo(
    () => import.meta.env.VITE_SIGNAL_URL || "ws://localhost:8080/signal",
    []
  );
  const streamId = "mystream";

  function toggleStreaming() {
    setStreaming((s) => !s);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>CCTV Streaming</h1>
        <p className="subtitle">Quick test page (React + Vite)</p>
      </header>

      <main>
        <section className="player">
          {streaming ? (
            <StreamPlayer streamId={streamId} signalingUrl={signalingUrl} initialMuted={false} />
          ) : (
            <div className="placeholder">Stream is stopped.</div>
          )}
        </section>

        <div className="controls">
          <button onClick={toggleStreaming} className="btn">
            {streaming ? "Stop" : "Start"}
          </button>
        </div>
      </main>

      <footer className="footer">Sample page for local development.</footer>
    </div>
  );
}
