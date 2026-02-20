package com.yoojuno.cctv.stream;

import com.yoojuno.cctv.model.StreamInfo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Service
public class StreamHealthService {
    @Value("${hls.path:./hls}")
    private String hlsPath;

    @Value("${streams.live-threshold-seconds:12}")
    private long liveThresholdSeconds;

    @Value("${streams.live-min-segments:2}")
    private int liveMinSegments;

    @Value("${streams.health-poll-ms:4000}")
    private long recommendedPollMs;

    public List<StreamHealth> healthForStreams(List<StreamInfo> streams) {
        List<StreamHealth> result = new ArrayList<>();
        for (StreamInfo stream : streams) {
            result.add(healthForStream(stream.id()));
        }
        return result;
    }

    public long liveThresholdSeconds() {
        return liveThresholdSeconds;
    }

    public long recommendedPollMs() {
        return Math.max(1000, recommendedPollMs);
    }

    private StreamHealth healthForStream(String streamId) {
        Path manifestPath = Path.of(hlsPath).resolve(streamId + ".m3u8").toAbsolutePath().normalize();
        boolean exists = Files.isRegularFile(manifestPath);
        if (!exists) {
            return new StreamHealth(streamId, false, false, 0, -1, StreamState.OFFLINE, "MANIFEST_MISSING", 0, 0, false, false, -1);
        }

        try {
            FileTime fileTime = Files.getLastModifiedTime(manifestPath);
            long lastModifiedEpochMs = fileTime.toMillis();
            long ageSeconds = Math.max(0, (Instant.now().toEpochMilli() - lastModifiedEpochMs) / 1000);
            ManifestSnapshot snapshot = readManifestSnapshot(manifestPath);

            if (snapshot.segmentCount() == 0) {
                return new StreamHealth(streamId, false, true, lastModifiedEpochMs, ageSeconds, StreamState.STARTING, "MANIFEST_NO_SEGMENTS",
                        snapshot.segmentCount(), snapshot.targetDurationSeconds(), snapshot.endList(), snapshot.latestSegmentExists(), snapshot.latestSegmentSizeBytes());
            }
            if (snapshot.endList()) {
                return new StreamHealth(streamId, false, true, lastModifiedEpochMs, ageSeconds, StreamState.OFFLINE, "ENDLIST_PRESENT",
                        snapshot.segmentCount(), snapshot.targetDurationSeconds(), snapshot.endList(), snapshot.latestSegmentExists(), snapshot.latestSegmentSizeBytes());
            }
            if (snapshot.segmentCount() < liveMinSegments) {
                return new StreamHealth(streamId, false, true, lastModifiedEpochMs, ageSeconds, StreamState.STARTING, "INSUFFICIENT_SEGMENTS",
                        snapshot.segmentCount(), snapshot.targetDurationSeconds(), snapshot.endList(), snapshot.latestSegmentExists(), snapshot.latestSegmentSizeBytes());
            }
            if (ageSeconds > liveThresholdSeconds) {
                return new StreamHealth(streamId, false, true, lastModifiedEpochMs, ageSeconds, StreamState.STALE, "MANIFEST_STALE",
                        snapshot.segmentCount(), snapshot.targetDurationSeconds(), snapshot.endList(), snapshot.latestSegmentExists(), snapshot.latestSegmentSizeBytes());
            }
            if (snapshot.latestSegmentLocal() && !snapshot.latestSegmentExists()) {
                return new StreamHealth(streamId, false, true, lastModifiedEpochMs, ageSeconds, StreamState.STALE, "SEGMENT_MISSING",
                        snapshot.segmentCount(), snapshot.targetDurationSeconds(), snapshot.endList(), snapshot.latestSegmentExists(), snapshot.latestSegmentSizeBytes());
            }
            if (snapshot.latestSegmentLocal() && snapshot.latestSegmentSizeBytes() == 0) {
                return new StreamHealth(streamId, false, true, lastModifiedEpochMs, ageSeconds, StreamState.STALE, "SEGMENT_EMPTY",
                        snapshot.segmentCount(), snapshot.targetDurationSeconds(), snapshot.endList(), snapshot.latestSegmentExists(), snapshot.latestSegmentSizeBytes());
            }

            return new StreamHealth(streamId, true, true, lastModifiedEpochMs, ageSeconds, StreamState.LIVE, "OK",
                    snapshot.segmentCount(), snapshot.targetDurationSeconds(), snapshot.endList(), snapshot.latestSegmentExists(), snapshot.latestSegmentSizeBytes());
        } catch (IOException e) {
            return new StreamHealth(streamId, false, true, 0, -1, StreamState.ERROR, "MANIFEST_UNREADABLE", 0, 0, false, false, -1);
        }
    }

    private ManifestSnapshot readManifestSnapshot(Path manifestPath) throws IOException {
        List<String> lines = Files.readAllLines(manifestPath);
        boolean endList = false;
        int segmentCount = 0;
        double targetDurationSeconds = 0;
        String latestSegmentRef = null;

        for (String rawLine : lines) {
            String line = rawLine == null ? "" : rawLine.trim();
            if (line.isEmpty()) {
                continue;
            }
            if (line.startsWith("#EXT-X-TARGETDURATION:")) {
                targetDurationSeconds = parsePositiveNumber(line.substring("#EXT-X-TARGETDURATION:".length()));
                continue;
            }
            if ("#EXT-X-ENDLIST".equals(line)) {
                endList = true;
                continue;
            }
            if (!line.startsWith("#")) {
                segmentCount += 1;
                latestSegmentRef = line;
            }
        }

        if (latestSegmentRef == null) {
            return new ManifestSnapshot(endList, segmentCount, targetDurationSeconds, false, false, -1);
        }

        if (looksLikeExternalUri(latestSegmentRef)) {
            return new ManifestSnapshot(endList, segmentCount, targetDurationSeconds, false, true, -1);
        }

        Path manifestDir = manifestPath.getParent() == null ? Path.of(".") : manifestPath.getParent();
        Path segmentPath = manifestDir.resolve(latestSegmentRef).normalize();
        boolean exists = Files.isRegularFile(segmentPath);
        long size = exists ? Files.size(segmentPath) : -1;
        return new ManifestSnapshot(endList, segmentCount, targetDurationSeconds, true, exists, size);
    }

    private static boolean looksLikeExternalUri(String value) {
        String normalized = value.toLowerCase(Locale.ROOT);
        return normalized.startsWith("http://")
                || normalized.startsWith("https://")
                || normalized.startsWith("rtsp://");
    }

    private static double parsePositiveNumber(String raw) {
        try {
            double value = Double.parseDouble(raw.trim());
            return value < 0 ? 0 : value;
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private record ManifestSnapshot(
            boolean endList,
            int segmentCount,
            double targetDurationSeconds,
            boolean latestSegmentLocal,
            boolean latestSegmentExists,
            long latestSegmentSizeBytes
    ) {
    }

    public enum StreamState {
        LIVE,
        STARTING,
        STALE,
        OFFLINE,
        ERROR
    }

    public record StreamHealth(
            String id,
            boolean live,
            boolean manifestExists,
            long lastModifiedEpochMs,
            long manifestAgeSeconds,
            StreamState state,
            String reason,
            int segmentCount,
            double targetDurationSeconds,
            boolean endList,
            boolean latestSegmentExists,
            long latestSegmentSizeBytes
    ) {
    }
}
