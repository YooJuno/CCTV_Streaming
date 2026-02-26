package com.yoojuno.cctv.domain.system;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.domain.stream.StreamQueryService;
import com.yoojuno.cctv.model.StreamInfo;
import com.yoojuno.cctv.stream.StreamHealthService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

@Service
public class SystemHealthQueryService {
    @Value("${hls.path:./hls}")
    private String hlsPath;

    private final StreamQueryService streamQueryService;

    public SystemHealthQueryService(StreamQueryService streamQueryService) {
        this.streamQueryService = streamQueryService;
    }

    public SystemHealthSnapshot query(AuthenticatedUser user) {
        List<StreamInfo> streams = streamQueryService.authorizedStreams(user);
        List<StreamHealthService.StreamHealth> streamDetails = streamQueryService.streamHealthSnapshot(user).streams();
        HlsStorageStatus hlsStorage = resolveHlsStorageStatus();
        StreamHealthSummary streamSummary = summarize(streamDetails);
        List<String> recommendations = buildRecommendations(streams, streamSummary, hlsStorage);

        return new SystemHealthSnapshot(
                Instant.now().toEpochMilli(),
                user.username(),
                hlsStorage,
                streamSummary,
                streamDetails,
                recommendations
        );
    }

    private HlsStorageStatus resolveHlsStorageStatus() {
        Path resolved = Path.of(hlsPath).toAbsolutePath().normalize();
        boolean exists = Files.exists(resolved);
        boolean readable = Files.isReadable(resolved);
        boolean writable = Files.isWritable(resolved);
        long manifestCount = 0;
        long segmentCount = 0;

        if (exists && Files.isDirectory(resolved) && readable) {
            try (Stream<Path> files = Files.list(resolved)) {
                for (Path path : files.toList()) {
                    String fileName = path.getFileName() == null ? "" : path.getFileName().toString().toLowerCase();
                    if (fileName.endsWith(".m3u8")) {
                        manifestCount++;
                    } else if (fileName.endsWith(".ts") || fileName.endsWith(".m4s")) {
                        segmentCount++;
                    }
                }
            } catch (IOException ignored) {
                // keep counts as-is
            }
        }

        return new HlsStorageStatus(
                resolved.toString(),
                exists,
                readable,
                writable,
                manifestCount,
                segmentCount
        );
    }

    private static StreamHealthSummary summarize(List<StreamHealthService.StreamHealth> streamDetails) {
        int live = 0;
        int starting = 0;
        int stale = 0;
        int offline = 0;
        int error = 0;
        Map<String, Long> reasons = new LinkedHashMap<>();

        for (StreamHealthService.StreamHealth health : streamDetails) {
            switch (health.state()) {
                case LIVE -> live++;
                case STARTING -> starting++;
                case STALE -> stale++;
                case OFFLINE -> offline++;
                case ERROR -> error++;
            }
            reasons.put(health.reason(), reasons.getOrDefault(health.reason(), 0L) + 1);
        }

        return new StreamHealthSummary(
                streamDetails.size(),
                live,
                starting,
                stale,
                offline,
                error,
                Map.copyOf(reasons)
        );
    }

    private static List<String> buildRecommendations(
            List<StreamInfo> streams,
            StreamHealthSummary summary,
            HlsStorageStatus hlsStorage
    ) {
        Set<String> output = new LinkedHashSet<>();

        if (!hlsStorage.exists()) {
            output.add("HLS directory is missing. Create it and verify hls.path configuration.");
        }
        if (!hlsStorage.readable()) {
            output.add("HLS directory is not readable. Check filesystem permissions.");
        }
        if (!hlsStorage.writable()) {
            output.add("HLS directory is not writable. Converter cannot publish segments.");
        }
        if (streams.isEmpty()) {
            output.add("No authorized streams for this account. Verify AUTH_USERS stream assignments.");
        }

        if (summary.total() > 0 && summary.live() == summary.total()) {
            output.add("All authorized streams are healthy.");
            return new ArrayList<>(output);
        }

        Map<String, Long> reasons = summary.reasons();
        if (reasons.containsKey("MANIFEST_MISSING")) {
            String streamId = streams.isEmpty() ? "mystream" : streams.get(0).id();
            output.add("Manifest missing. Start converter: MJPEG_URL=http://<device-ip>:81/stream STREAM_ID=" + streamId + " ./scripts/mjpeg_to_hls.sh");
        }
        if (reasons.containsKey("MANIFEST_STALE")) {
            output.add("Manifest is stale. Check camera connectivity and restart converter if needed.");
        }
        if (reasons.containsKey("SEGMENT_MISSING") || reasons.containsKey("SEGMENT_EMPTY")) {
            output.add("Segment files are broken or missing. Restart converter and inspect ffmpeg logs.");
        }
        if (reasons.containsKey("MANIFEST_UNREADABLE")) {
            output.add("Backend cannot read manifests. Check hls.path and directory ownership.");
        }

        if (output.isEmpty()) {
            output.add("Stream check in progress. Wait a few seconds and refresh health.");
        }
        return new ArrayList<>(output);
    }

    public record SystemHealthSnapshot(
            long generatedAtEpochMs,
            String username,
            HlsStorageStatus hlsStorage,
            StreamHealthSummary streams,
            List<StreamHealthService.StreamHealth> streamDetails,
            List<String> recommendations
    ) {
    }

    public record HlsStorageStatus(
            String path,
            boolean exists,
            boolean readable,
            boolean writable,
            long manifestCount,
            long segmentCount
    ) {
    }

    public record StreamHealthSummary(
            int total,
            int live,
            int starting,
            int stale,
            int offline,
            int error,
            Map<String, Long> reasons
    ) {
    }
}
