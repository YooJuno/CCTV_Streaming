export function buildManifestUrl(baseUrl: string, streamId: string, overrideUrl?: string): string {
  if (overrideUrl && overrideUrl.trim()) {
    return overrideUrl.trim();
  }
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const safeStreamId = encodeURIComponent(streamId.trim() || "mystream");
  return `${normalizedBase}/${safeStreamId}.m3u8`;
}

export function getBufferedSeconds(video: HTMLVideoElement): number {
  const current = video.currentTime;
  const ranges = video.buffered;
  if (!ranges || ranges.length === 0) {
    return 0;
  }
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (current >= start && current <= end) {
      return Math.max(0, end - current);
    }
  }
  return 0;
}

export function getDroppedFrames(video: HTMLVideoElement): number {
  const quality = video.getVideoPlaybackQuality?.();
  if (quality && typeof quality.droppedVideoFrames === "number") {
    return quality.droppedVideoFrames;
  }
  const legacy = (video as HTMLVideoElement & { webkitDroppedFrameCount?: number }).webkitDroppedFrameCount;
  return typeof legacy === "number" ? legacy : 0;
}

export function computeLatencySeconds(liveEdgeTime: number | null | undefined, currentTime: number): number | null {
  if (typeof liveEdgeTime !== "number" || !Number.isFinite(liveEdgeTime)) {
    return null;
  }
  if (!Number.isFinite(currentTime)) {
    return null;
  }
  return Math.max(0, liveEdgeTime - currentTime);
}
