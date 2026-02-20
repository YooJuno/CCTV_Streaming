import type { PlaybackStatus } from "../types";

interface StatusBadgeProps {
  status: PlaybackStatus;
}

function statusClassName(status: PlaybackStatus): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("playing")) return "ok";
  if (normalized.includes("ready")) return "ready";
  if (normalized.includes("loading") || normalized.includes("buffering") || normalized.includes("retry")) {
    return "warn";
  }
  if (normalized.includes("error") || normalized.includes("fatal") || normalized.includes("unsupported")) {
    return "error";
  }
  return "neutral";
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge ${statusClassName(status)}`}>Status: {status}</span>;
}
