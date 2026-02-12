import React, { useEffect, useRef, useState } from "react";

const isDebug = () => {
  const raw = import.meta.env.VITE_DEBUG_WEBRTC;
  return raw === "1" || raw === "true";
};

export default function StreamPlayer({
  streamId = "mystream",
  signalingUrl = "ws://localhost:8080/signal",
  initialMuted = true,
  showStatus = true,
}) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const lastFrameAtRef = useRef(null);
  const containerRef = useRef(null);
  const isMutedRef = useRef(true);
  const clientSessionRef = useRef(null);
  const gatewaySessionRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [iceStatus, setIceStatus] = useState("new");
  const [playbackState, setPlaybackState] = useState("idle");
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [lastFrameDelta, setLastFrameDelta] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const applyMute = (mutedValue) => {
    isMutedRef.current = mutedValue;
    if (videoRef.current) {
      videoRef.current.muted = mutedValue;
      videoRef.current.defaultMuted = mutedValue;
      videoRef.current.volume = mutedValue ? 0 : 1;
    }
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !mutedValue;
      });
    }
  };

  useEffect(() => {
    applyMute(initialMuted);
    setIsMuted(initialMuted);
  }, [initialMuted]);

  useEffect(() => {
    let mounted = true;

    async function start() {
      const debug = isDebug();
      const log = debug ? (...args) => console.log(...args) : () => {};
      const warn = debug ? (...args) => console.warn(...args) : () => {};
      const error = debug ? (...args) => console.error(...args) : () => {};
      let reconnectScheduled = false;
      let reconnectTimer = null;
      let stopped = false;

      setStatus("connecting");
      const iceServers = (() => {
        const raw = import.meta.env.VITE_ICE_SERVERS;
        if (!raw) {
          return [{ urls: "stun:stun.l.google.com:19302" }];
        }
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
          return [parsed];
        } catch (err) {
          return [{ urls: raw }];
        }
      })();
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      pc.ontrack = (e) => {
        log("ontrack", e);
        try {
          const stream = (e.streams && e.streams[0]) || streamRef.current || new MediaStream();
          streamRef.current = stream;
          if (!e.streams || e.streams.length === 0) {
            stream.addTrack(e.track);
          }
          if (e.track && e.track.kind === "audio") {
            e.track.enabled = !isMutedRef.current;
          }
          if (!mounted) return;
          if (videoRef.current) {
            if (videoRef.current.srcObject !== stream) {
              videoRef.current.srcObject = stream;
            }
            applyMute(isMutedRef.current);
            videoRef.current
              .play()
              .then(() => log("video play started"))
              .catch((err) => warn("video play failed", err));
          }
        } catch (err) {
          error("ontrack handler error", err);
        }
      };

      pc.onconnectionstatechange = () => {
        log("pc.connectionState", pc.connectionState);
        if (!mounted) return;
        setStatus(pc.connectionState);
      };

      pc.oniceconnectionstatechange = () => {
        log("pc.iceConnectionState", pc.iceConnectionState);
        if (!mounted) return;
        setIceStatus(pc.iceConnectionState);
      };

      const recvInterval = debug
        ? setInterval(() => {
            try {
              const r = pc.getReceivers();
              log(
                "Receivers:",
                r.map((rr) => ({ kind: rr.track && rr.track.kind, id: rr.track && rr.track.id }))
              );
            } catch (err) {
              warn("Failed to get receivers", err);
            }
          }, 2000)
        : null;

      const ws = new WebSocket(signalingUrl);
      wsRef.current = ws;

      const scheduleReconnect = () => {
        if (!mounted || stopped || reconnectScheduled) {
          return;
        }
        reconnectScheduled = true;
        setStatus("reconnecting");
        reconnectTimer = setTimeout(() => {
          if (!mounted || stopped) {
            return;
          }
          setReconnectAttempt((value) => value + 1);
        }, 1500);
      };

      ws.onopen = () => {
        log("ws open");
        setStatus("connected");
        ws.send(JSON.stringify({ type: "watch", streamId }));
      };

      ws.onmessage = async (ev) => {
        log("ws message", ev.data);
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "offer") {
            clientSessionRef.current = msg.clientSessionId;
            gatewaySessionRef.current = msg.gatewaySessionId || null;
            await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const answerMessage = {
              type: "answer",
              sdp: answer.sdp,
              clientSessionId: msg.clientSessionId,
            };
            if (msg.gatewaySessionId) {
              answerMessage.gatewaySessionId = msg.gatewaySessionId;
            }
            ws.send(
              JSON.stringify(answerMessage)
            );
          } else if (msg.type === "ice" && msg.candidate) {
            try {
              await pc.addIceCandidate(msg.candidate);
            } catch (e) {
              warn(e);
            }
          } else if (msg.type === "error") {
            setStatus("error: " + (msg.message || ""));
          }
        } catch (err) {
          error(err);
        }
      };

      ws.onclose = () => {
        if (!mounted || stopped) {
          return;
        }
        setStatus("ws-closed");
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (!mounted || stopped) {
          return;
        }
        setStatus("ws-error");
        scheduleReconnect();
      };

      pc.onicecandidate = (e) => {
        log("Local ICE candidate", e.candidate);
        if (e.candidate && ws.readyState === WebSocket.OPEN && clientSessionRef.current) {
          const iceMessage = {
            type: "ice",
            candidate: e.candidate,
            clientSessionId: clientSessionRef.current,
          };
          if (gatewaySessionRef.current) {
            iceMessage.gatewaySessionId = gatewaySessionRef.current;
          }
          ws.send(
            JSON.stringify(iceMessage)
          );
        }
      };

      // cleanup on unmount
      const video = videoRef.current;
      let frameTimer = null;
      let rafId = null;

      const updateFrame = () => {
        lastFrameAtRef.current = Date.now();
      };

      const onFullscreenChange = () => {
        const el = document.fullscreenElement;
        setIsFullscreen(Boolean(el && containerRef.current && el === containerRef.current));
      };

      document.addEventListener("fullscreenchange", onFullscreenChange);

      if (video) {
        const onPlaying = () => {
          setPlaybackState("playing");
          setStatus((s) => (s === "connected" ? "playing" : s));
        };
        const onWaiting = () => {
          setPlaybackState("buffering");
          setStatus((s) => (s === "playing" ? "buffering" : s));
        };
        const onPause = () => setPlaybackState("paused");
        video.addEventListener("playing", onPlaying);
        video.addEventListener("waiting", onWaiting);
        video.addEventListener("pause", onPause);

        if (typeof video.requestVideoFrameCallback === "function") {
          const onFrame = () => {
            updateFrame();
            rafId = video.requestVideoFrameCallback(onFrame);
          };
          rafId = video.requestVideoFrameCallback(onFrame);
        } else {
          frameTimer = setInterval(() => {
            if (video.readyState >= 2) updateFrame();
          }, 500);
        }

        const deltaTimer = setInterval(() => {
          const ts = lastFrameAtRef.current;
          if (ts) {
            setLastFrameDelta(Math.round((Date.now() - ts) / 1000));
          }
        }, 1000);

        const cleanupVideo = () => {
          video.removeEventListener("playing", onPlaying);
          video.removeEventListener("waiting", onWaiting);
          video.removeEventListener("pause", onPause);
          clearInterval(deltaTimer);
          if (frameTimer) clearInterval(frameTimer);
          if (rafId && typeof video.cancelVideoFrameCallback === "function") {
            video.cancelVideoFrameCallback(rafId);
          }
        };

        return () => {
          stopped = true;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          document.removeEventListener("fullscreenchange", onFullscreenChange);
          cleanupVideo();
          mounted = false;
          if (recvInterval) clearInterval(recvInterval);
          if (ws) {
            ws.close();
          }
          if (pc) {
            pc.getSenders().forEach((s) => s.track && s.track.stop());
            pc.close();
          }
          if (wsRef.current === ws) wsRef.current = null;
          if (pcRef.current === pc) pcRef.current = null;
          streamRef.current = null;
          lastFrameAtRef.current = null;
          if (videoRef.current) videoRef.current.srcObject = null;
        };
      }

      return () => {
        stopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        mounted = false;
        if (recvInterval) clearInterval(recvInterval);
        if (ws) {
          ws.close();
        }
        if (pc) {
          pc.getSenders().forEach((s) => s.track && s.track.stop());
          pc.close();
        }
        if (wsRef.current === ws) wsRef.current = null;
        if (pcRef.current === pc) pcRef.current = null;
        streamRef.current = null;
        lastFrameAtRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
      };
    }

    const cleanupPromise = start();

    return () => {
      mounted = false;
      // ensure cleanup runs
      if (cleanupPromise && typeof cleanupPromise.then === "function") {
        cleanupPromise.then((fn) => fn && fn());
      }
    };
  }, [streamId, signalingUrl, reconnectAttempt]);

  return (
    <div className="player-card" ref={containerRef}>
      <video ref={videoRef} autoPlay playsInline muted={isMuted} style={{ width: "100%", background: "#000" }} />
      {showStatus && (
        <div className="status-bar">
          <span className={`status-pill ${String(status).replace(/[^a-z0-9]/gi, "_")}`}>{status}</span>
          <span className="status-pill ice">ice:{iceStatus}</span>
          <span className={`status-pill ${playbackState}`}>play:{playbackState}</span>
          <span className="status-meta">last frame: {lastFrameDelta === null ? "-" : `${lastFrameDelta}s`}</span>
        </div>
      )}
      <div className="control-bar">
        <button type="button" className="btn secondary" onClick={() => videoRef.current && videoRef.current.play()}>
          Play
        </button>
        <button type="button" className="btn secondary" onClick={() => videoRef.current && videoRef.current.pause()}>
          Pause
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setIsMuted((v) => {
              const next = !v;
              applyMute(next);
              return next;
            });
          }}
        >
          {isMuted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            const el = containerRef.current;
            if (!el) return;
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else if (el.requestFullscreen) {
              el.requestFullscreen();
            }
          }}
        >
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </button>
      </div>
    </div>
  );
}
