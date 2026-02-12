import React, { useState } from "react";
import HlsPlayer from "./HlsPlayer";

const DEFAULT_STREAM_ID = import.meta.env.VITE_STREAM_ID || "mystream";

export default function App() {
  const [streaming, setStreaming] = useState(false);
  const [streamIdInput, setStreamIdInput] = useState(DEFAULT_STREAM_ID);
  const [streamId, setStreamId] = useState(DEFAULT_STREAM_ID);

  function toggleStreaming() {
    setStreaming((s) => !s);
  }

  function onSubmitStream(event) {
    event.preventDefault();
    const next = streamIdInput.trim();
    setStreamId(next || DEFAULT_STREAM_ID);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>CCTV Streaming</h1>
        <p className="subtitle">RTSP to HLS test page (React + Vite)</p>
      </header>

      <main>
        <form className="stream-form" onSubmit={onSubmitStream}>
          <label htmlFor="stream-id" className="stream-label">
            Stream ID
          </label>
          <input
            id="stream-id"
            className="stream-input"
            value={streamIdInput}
            onChange={(event) => setStreamIdInput(event.target.value)}
            placeholder="mystream"
          />
          <button type="submit" className="btn secondary">
            Apply
          </button>
        </form>

        <section className="player">
          {streaming ? <HlsPlayer streamId={streamId} /> : <div className="placeholder">Stream is stopped.</div>}
        </section>

        <div className="controls controls-row">
          <div className="stream-meta">Current stream: {streamId}</div>
          <button onClick={toggleStreaming} className="btn">
            {streaming ? "Stop" : "Start"}
          </button>
        </div>
      </main>

      <footer className="footer">Sample page for local development.</footer>
    </div>
  );
}
