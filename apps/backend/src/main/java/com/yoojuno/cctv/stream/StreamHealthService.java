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

@Service
public class StreamHealthService {
    @Value("${hls.path:./hls}")
    private String hlsPath;

    @Value("${streams.live-threshold-seconds:12}")
    private long liveThresholdSeconds;

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

    private StreamHealth healthForStream(String streamId) {
        Path manifestPath = Path.of(hlsPath).resolve(streamId + ".m3u8").toAbsolutePath().normalize();
        boolean exists = Files.isRegularFile(manifestPath);
        if (!exists) {
            return new StreamHealth(streamId, false, false, 0, -1);
        }

        try {
            FileTime fileTime = Files.getLastModifiedTime(manifestPath);
            long lastModifiedEpochMs = fileTime.toMillis();
            long ageSeconds = Math.max(0, (Instant.now().toEpochMilli() - lastModifiedEpochMs) / 1000);
            boolean live = ageSeconds <= liveThresholdSeconds;
            return new StreamHealth(streamId, live, true, lastModifiedEpochMs, ageSeconds);
        } catch (IOException ignored) {
            return new StreamHealth(streamId, false, true, 0, -1);
        }
    }

    public record StreamHealth(
            String id,
            boolean live,
            boolean manifestExists,
            long lastModifiedEpochMs,
            long manifestAgeSeconds
    ) {
    }
}
