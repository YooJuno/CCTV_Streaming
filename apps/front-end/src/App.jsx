import React, { useMemo, useState } from "react";
import StreamPlayer from "./StreamPlayer";

export default function App() {
  const [streaming, setStreaming] = useState(false);

  const signalingUrl = useMemo(() => import.meta.env.VITE_SIGNAL_URL || "ws://localhost:8080/signal", []);
  const streamId = "mystream";

  function toggleStreaming() {
    setStreaming((s) => !s);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>CCTV Streaming</h1>
        <p className="subtitle">간단한 테스트 페이지 (React + Vite)</p>
      </header>

      <main>
        <section className="player">
          {streaming ? <StreamPlayer streamId={streamId} signalingUrl={signalingUrl} muted={false} /> : <div className="placeholder">스트림이 정지 상태입니다</div>}
        </section>

        <div className="controls">
          <button onClick={toggleStreaming} className="btn">
            {streaming ? "중지" : "시작"}
          </button>
        </div>
      </main>

      <footer className="footer">현재 샘플 페이지입니다 — macOS에서 개발을 시작하세요.</footer>
    </div>
  );
}
