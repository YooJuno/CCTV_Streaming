import type { PlaybackStatus } from "../types";

interface StatusBadgeProps {
  status: PlaybackStatus;
}
const STATUS_LABELS: Record<PlaybackStatus, string> = {
  idle: "재생 대기",
  loading: "영상 연결 중",
  ready: "재생 준비",
  playing: "재생 중",
  buffering: "버퍼링 중",
  "network retry": "다시 연결 중",
  "media recovery": "영상 복구 중",
  "hls unsupported": "재생 미지원",
  "video error": "영상 오류",
  "fatal error": "연결 실패",
};
function statusClassName(status: PlaybackStatus): string {
  if (status === "playing") return "ok";
  if (status === "ready") return "ready";
  if (
    ["loading", "buffering", "network retry", "media recovery"].includes(status)
  )
    return "warn";
  if (["video error", "fatal error", "hls unsupported"].includes(status))
    return "error";
  return "neutral";
}
export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge ${statusClassName(status)}`} role="status">
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
