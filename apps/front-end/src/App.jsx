import React, { useState, useRef } from "react";

export default function App() {
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState("idle");
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const videoRef = useRef(null);
  const gatewayRef = useRef(null);
  const clientIdRef = useRef(null);

  async function start() {
    setStatus("connecting");

    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current && gatewayRef.current && clientIdRef.current) {
        wsRef.current.send(
          JSON.stringify({ type: "ice", candidate: e.candidate, gatewaySessionId: gatewayRef.current, clientSessionId: clientIdRef.current })
        );
      }
    };

    pc.ontrack = (e) => {
      if (videoRef.current) {
        videoRef.current.srcObject = e.streams[0];
      }
    };

    const ws = new WebSocket("ws://localhost:8080/signal");
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      ws.send(JSON.stringify({ type: "watch", streamId: "mystream" }));
    };

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const t = msg.type;
        if (t === "offer") {
          // gateway sends: {type: 'offer', clientSessionId: '...', sdp: '...', gatewaySessionId: '...'}
          gatewayRef.current = msg.gatewaySessionId;
          clientIdRef.current = msg.clientSessionId;
          const desc = { type: "offer", sdp: msg.sdp };
          await pc.setRemoteDescription(desc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(
            JSON.stringify({ type: "answer", sdp: answer.sdp, gatewaySessionId: msg.gatewaySessionId, clientSessionId: msg.clientSessionId })
          );
          setStatus("streaming");
          setStreaming(true);
        } else if (t === "ice") {
          if (msg.candidate) {
            try {
              await pc.addIceCandidate(msg.candidate);
            } catch (err) {
              console.warn("Failed to add remote ICE candidate", err);
            }
          }
        } else if (t === "error") {
          setStatus("error: " + (msg.message || ""));
        }
      } catch (err) {
        console.error(err);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      stop();
    };

    ws.onerror = (e) => {
      console.error(e);
      setStatus("ws error");
    };
  }

  function stop() {
    setStreaming(false);
    setStatus("stopped");

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.getSenders().forEach((s) => s.track && s.track.stop());
      pcRef.current.close();
      pcRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  function toggleStreaming() {
    if (streaming) {
      stop();
    } else {
      start();
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>CCTV Streaming</h1>
        <p className="subtitle">간단한 테스트 페이지 (React + Vite)</p>
      </header>

      <main>
        <section className="player">
          <video ref={videoRef} className="video" autoPlay playsInline controls={false} />
        </section>

        <div className="controls">
          <button onClick={toggleStreaming} className="btn">
            {streaming ? "중지" : "시작"}
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: 10, color: "#6b7280" }}>{status}</div>
      </main>

      <footer className="footer">현재 샘플 페이지입니다 — macOS에서 개발을 시작하세요.</footer>
    </div>
  );
}
