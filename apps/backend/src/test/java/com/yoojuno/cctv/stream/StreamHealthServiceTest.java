package com.yoojuno.cctv.stream;

import com.yoojuno.cctv.model.StreamInfo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class StreamHealthServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void returnsOfflineWhenManifestIsMissing() {
        StreamHealthService service = newService(tempDir, 12, 2);
        StreamHealthService.StreamHealth health = healthFor(service, "mystream");

        assertThat(health.live()).isFalse();
        assertThat(health.manifestExists()).isFalse();
        assertThat(health.state()).isEqualTo(StreamHealthService.StreamState.OFFLINE);
        assertThat(health.reason()).isEqualTo("MANIFEST_MISSING");
    }

    @Test
    void returnsStartingWhenManifestHasNoSegments() throws Exception {
        Path manifest = tempDir.resolve("mystream.m3u8");
        Files.writeString(manifest, "#EXTM3U\n#EXT-X-TARGETDURATION:1\n");

        StreamHealthService service = newService(tempDir, 12, 2);
        StreamHealthService.StreamHealth health = healthFor(service, "mystream");

        assertThat(health.live()).isFalse();
        assertThat(health.state()).isEqualTo(StreamHealthService.StreamState.STARTING);
        assertThat(health.reason()).isEqualTo("MANIFEST_NO_SEGMENTS");
        assertThat(health.segmentCount()).isZero();
    }

    @Test
    void returnsStaleWhenManifestIsTooOld() throws Exception {
        Path manifest = tempDir.resolve("mystream.m3u8");
        Path segment1 = tempDir.resolve("mystream_00001.ts");
        Path segment2 = tempDir.resolve("mystream_00002.ts");
        Files.write(segment1, new byte[]{1, 2, 3});
        Files.write(segment2, new byte[]{4, 5, 6});
        Files.writeString(manifest, """
                #EXTM3U
                #EXT-X-TARGETDURATION:1
                #EXTINF:1.0,
                mystream_00001.ts
                #EXTINF:1.0,
                mystream_00002.ts
                """);
        Files.setLastModifiedTime(manifest, FileTime.from(Instant.now().minusSeconds(30)));

        StreamHealthService service = newService(tempDir, 3, 2);
        StreamHealthService.StreamHealth health = healthFor(service, "mystream");

        assertThat(health.live()).isFalse();
        assertThat(health.state()).isEqualTo(StreamHealthService.StreamState.STALE);
        assertThat(health.reason()).isEqualTo("MANIFEST_STALE");
        assertThat(health.segmentCount()).isEqualTo(2);
    }

    @Test
    void returnsLiveWhenManifestIsFreshAndSegmentsAreReady() throws Exception {
        Path manifest = tempDir.resolve("mystream.m3u8");
        Path segment1 = tempDir.resolve("mystream_00001.ts");
        Path segment2 = tempDir.resolve("mystream_00002.ts");
        Files.write(segment1, new byte[]{1, 2, 3});
        Files.write(segment2, new byte[]{4, 5, 6});
        Files.writeString(manifest, """
                #EXTM3U
                #EXT-X-TARGETDURATION:1
                #EXTINF:1.0,
                mystream_00001.ts
                #EXTINF:1.0,
                mystream_00002.ts
                """);

        StreamHealthService service = newService(tempDir, 20, 2);
        StreamHealthService.StreamHealth health = healthFor(service, "mystream");

        assertThat(health.live()).isTrue();
        assertThat(health.state()).isEqualTo(StreamHealthService.StreamState.LIVE);
        assertThat(health.reason()).isEqualTo("OK");
        assertThat(health.latestSegmentExists()).isTrue();
    }

    private static StreamHealthService newService(Path hlsDir, long thresholdSeconds, int minSegments) {
        StreamHealthService service = new StreamHealthService();
        ReflectionTestUtils.setField(service, "hlsPath", hlsDir.toString());
        ReflectionTestUtils.setField(service, "liveThresholdSeconds", thresholdSeconds);
        ReflectionTestUtils.setField(service, "liveMinSegments", minSegments);
        ReflectionTestUtils.setField(service, "recommendedPollMs", 4000L);
        return service;
    }

    private static StreamHealthService.StreamHealth healthFor(StreamHealthService service, String streamId) {
        return service.healthForStreams(List.of(new StreamInfo(streamId, "Test Stream"))).get(0);
    }
}
