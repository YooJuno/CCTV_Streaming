import { useState } from "react";
import type { StreamHealth, StreamInfo } from "../types";
import HlsPlayer from "./HlsPlayer";
import MjpegPlayer from "./MjpegPlayer";
import StreamSettingsPanel from "./StreamSettingsPanel";

interface StreamCardProps {
  stream: StreamInfo;
  health?: StreamHealth;
  liveThresholdSeconds: number;
}

export function streamStateLabel(health?: StreamHealth): string {
  if (!health) return "확인 중";
  return {
    LIVE: "정상",
    STARTING: "준비 중",
    STALE: "업데이트 지연",
    OFFLINE: "오프라인",
    ERROR: "오류",
  }[health.state];
}
export function streamStateTone(health?: StreamHealth): string {
  if (!health) return "checking";
  if (health.state === "LIVE") return "live";
  if (["STARTING", "STALE"].includes(health.state)) return "attention";
  return "offline";
}
export function guidanceFromHealth(
  health: StreamHealth | undefined,
  liveThresholdSeconds: number,
): { title: string; detail: string } {
  if (!health)
    return {
      title: "카메라 상태를 확인하고 있습니다",
      detail: "연결 상태가 확인되면 이곳에 표시됩니다.",
    };
  switch (health.reason) {
    case "OK":
      return {
        title: "실시간 영상을 확인하세요",
        detail: "영상 시작을 누르면 이 카메라의 실시간 화면이 연결됩니다.",
      };
    case "MANIFEST_NO_SEGMENTS":
      return {
        title: "첫 영상을 준비하고 있습니다",
        detail:
          "장비가 연결되었습니다. 첫 영상 조각이 생성될 때까지 잠시 기다려 주세요.",
      };
    case "INSUFFICIENT_SEGMENTS":
      return {
        title: "영상 연결을 준비하고 있습니다",
        detail: "안정적인 재생을 위한 영상 데이터를 모으고 있습니다.",
      };
    case "MANIFEST_STALE":
      return {
        title: "영상 업데이트가 지연되었습니다",
        detail: `최근 ${liveThresholdSeconds || 12}초 동안 새 영상이 없습니다. 장비 네트워크와 변환 프로세스를 확인하세요.`,
      };
    case "SEGMENT_MISSING":
      return {
        title: "영상 파일을 찾을 수 없습니다",
        detail:
          "영상 목록과 저장된 파일이 일치하지 않습니다. 변환 프로세스와 저장소를 확인하세요.",
      };
    case "SEGMENT_EMPTY":
      return {
        title: "영상 데이터가 비어 있습니다",
        detail: "장비 영상 입력과 인코더 상태를 확인하세요.",
      };
    case "ENDLIST_PRESENT":
      return {
        title: "영상 송출이 종료되었습니다",
        detail: "장비 연결을 확인하고 영상 변환 프로세스를 다시 시작하세요.",
      };
    case "MANIFEST_UNREADABLE":
      return {
        title: "영상 목록에 접근할 수 없습니다",
        detail: "서버의 영상 저장소 읽기 권한을 확인하세요.",
      };
    case "MANIFEST_MISSING":
      return {
        title: "아직 영상이 연결되지 않았습니다",
        detail: "장비 설치에서 연결 정보를 확인하고 영상 변환을 시작하세요.",
      };
    default:
      return {
        title: streamStateLabel(health),
        detail: "장비 연결과 영상 변환 프로세스를 확인하세요.",
      };
  }
}

export default function StreamCard({
  stream,
  health,
  liveThresholdSeconds,
}: StreamCardProps) {
  const [active, setActive] = useState(false);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [playback, setPlayback] = useState<"live" | "hls">("live");
  const tone = streamStateTone(health);
  const guidance = guidanceFromHealth(health, liveThresholdSeconds);
  const manifestAgeText =
    health && health.manifestAgeSeconds >= 0
      ? `${health.manifestAgeSeconds}초 전`
      : "미확인";
  const titleId = `camera-${encodeURIComponent(stream.id)}`;
  return (
    <article
      className={`stream-card tone-${tone}${active ? " is-playing" : ""}`}
      aria-labelledby={titleId}
    >
      <header className="stream-card-header">
        <div className="camera-heading">
          <span className="camera-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <rect
                x="3"
                y="6"
                width="13"
                height="12"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="m16 10 5-3v10l-5-3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          </span>
          <div>
            <h3 id={titleId}>{stream.name}</h3>
            <p className="stream-id">{stream.id}</p>
          </div>
        </div>
        <span className={`stream-live-pill ${tone}`}>
          <span className="status-dot" aria-hidden="true" />
          {streamStateLabel(health)}
        </span>
      </header>
      <div className="playback-selector" role="group" aria-label={`${stream.name} 재생 방식`}>
        <button type="button" className={playback === "live" ? "selected" : ""} aria-pressed={playback === "live"} onClick={() => setPlayback("live")}>실시간</button>
        <button type="button" className={playback === "hls" ? "selected" : ""} aria-pressed={playback === "hls"} onClick={() => setPlayback("hls")}>호환 재생</button>
        <span>{playback === "live" ? "최신 화면 바로 보기" : "수초 지연 · 기존 LAN 송출 지원"}</span>
      </div>
      {active ? (
        playback === "live" ? <MjpegPlayer streamId={stream.id} /> : <HlsPlayer streamId={stream.id} />
      ) : (
        <div className={`stream-placeholder ${tone}`}>
          <div className="placeholder-topline" aria-hidden="true">
            <span>{stream.id}</span>
            <span className="viewfinder-dot" />
          </div>
          <div className="placeholder-symbol" aria-hidden="true">
            {tone === "live" ? (
              <svg viewBox="0 0 32 32" fill="none">
                <circle
                  cx="16"
                  cy="16"
                  r="13"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path d="m13 10 9 6-9 6V10Z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 32 32" fill="none">
                <rect
                  x="4"
                  y="8"
                  width="17"
                  height="16"
                  rx="4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="m21 13 7-4v14l-7-4M6 5l20 22"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            )}
          </div>
          <p className="stream-placeholder-title">{guidance.title}</p>
          <p className="stream-placeholder-text">{guidance.detail}</p>
          <div className="viewfinder-corner top-left" />
          <div className="viewfinder-corner top-right" />
          <div className="viewfinder-corner bottom-left" />
          <div className="viewfinder-corner bottom-right" />
        </div>
      )}
      <div className="stream-card-footer">
        <div className="stream-update">
          <span className="status-dot" aria-hidden="true" />
          목록 갱신 <strong>{manifestAgeText}</strong>
        </div>
        <button
          type="button"
          className={`btn compact ${active ? "stop-button" : "ghost"}`}
          aria-label={`${stream.name} ${active ? "영상 중지" : "영상 시작"}`}
          onClick={() => setActive((value) => !value)}
        >
          <span aria-hidden="true">{active ? "■" : "▷"}</span>
          {active ? "영상 중지" : "영상 시작"}
        </button>
      </div>
      <details className="stream-diagnostics">
        <summary>
          연결 상세 <span aria-hidden="true">＋</span>
        </summary>
        <dl>
          <div>
            <dt>영상 목록</dt>
            <dd>
              {health ? (health.manifestExists ? "감지됨" : "없음") : "확인 중"}
            </dd>
          </div>
          <div>
            <dt>영상 조각</dt>
            <dd>{health ? `${health.segmentCount}개` : "—"}</dd>
          </div>
          <div>
            <dt>최근 영상 파일</dt>
            <dd>
              {health
                ? health.latestSegmentExists
                  ? "확인됨"
                  : "미감지"
                : "—"}
            </dd>
          </div>
        </dl>
        {health && !health.live ? (
          <p className="diagnostic-guidance">{guidance.detail}</p>
        ) : null}
      </details>
      <details
        className="stream-settings"
        onToggle={(event) => {
          if (event.currentTarget.open) setSettingsOpened(true);
        }}
      >
        <summary>
          송출 설정 <span aria-hidden="true">＋</span>
        </summary>
        {settingsOpened ? <StreamSettingsPanel streamId={stream.id} /> : null}
      </details>
    </article>
  );
}
