package com.yoojuno.cctv.device;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class DeviceIngestServiceTest {
    @TempDir
    Path directory;

    @Test
    void rejectsInvalidTokensBeforeCreatingAConverter() throws Exception {
        DeviceTokenRegistry registry = registry();
        DeviceIngestService service = service(registry, 1, 8);
        assertThatThrownBy(() -> service.ingest("mystream", "wrong", jpeg()))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
        assertThat(directory.resolve("hls")).doesNotExist();
    }

    @Test
    void releasesResourcesAfterRejectingAnOversizedFrame() throws Exception {
        DeviceTokenRegistry registry = registry();
        String token = registry.issueToken("mystream");
        DeviceIngestService service = service(registry, 1, 8);
        byte[] oversized = {(byte) 0xff, (byte) 0xd8, 1, 2, 3, 4, 5, 6, 7, (byte) 0xff, (byte) 0xd9};
        assertThatThrownBy(() -> service.ingest("mystream", token, new ByteArrayInputStream(oversized)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThat(service.ingest("mystream", token, jpeg()).frames()).isEqualTo(1);
        service.shutdown();
    }

    @Test
    void limitsConcurrentStreamsAndStopsTheOldSessionWhenATokenRotates() throws Exception {
        DeviceTokenRegistry registry = registry();
        String token = registry.issueToken("mystream");
        String otherToken = registry.issueToken("another");
        DeviceIngestService service = service(registry, 1, 8);
        BlockingInput input = new BlockingInput();
        var executor = Executors.newSingleThreadExecutor();
        try {
            var oldUpload = executor.submit(() -> service.ingest("mystream", token, input));
            assertThat(input.reading.await(5, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> service.ingest("another", otherToken, jpeg()))
                    .isInstanceOfSatisfying(ResponseStatusException.class,
                            exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS));
            String replacement = registry.issueToken("mystream");
            service.stop("mystream");
            assertThatThrownBy(() -> oldUpload.get(5, TimeUnit.SECONDS)).hasCauseInstanceOf(ResponseStatusException.class);
            assertThat(service.ingest("mystream", replacement, jpeg()).frames()).isEqualTo(1);
        } finally {
            service.shutdown();
            executor.shutdownNow();
        }
    }

    @Test
    void allowsOnlyOnePublisherForEachStream() throws Exception {
        DeviceTokenRegistry registry = registry();
        String token = registry.issueToken("mystream");
        DeviceIngestService service = service(registry, 2, 8);
        BlockingInput input = new BlockingInput();
        var executor = Executors.newSingleThreadExecutor();
        try {
            var first = executor.submit(() -> service.ingest("mystream", token, input));
            assertThat(input.reading.await(5, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> service.ingest("mystream", token, jpeg()))
                    .isInstanceOfSatisfying(ResponseStatusException.class,
                            exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
            service.stop("mystream");
            assertThatThrownBy(() -> first.get(5, TimeUnit.SECONDS)).hasCauseInstanceOf(ResponseStatusException.class);
        } finally {
            service.shutdown();
            executor.shutdownNow();
        }
    }

    private DeviceTokenRegistry registry() throws IOException {
        DeviceTokenRegistry registry = new DeviceTokenRegistry();
        ReflectionTestUtils.setField(registry, "registryPath", directory.resolve("registry.properties").toString());
        registry.load();
        return registry;
    }

    private DeviceIngestService service(DeviceTokenRegistry registry, int maxConcurrent, long frameLimit) throws IOException {
        assumeTrue(Files.getFileStore(directory).supportsFileAttributeView("posix"), "POSIX converter fixture");
        Path converter = directory.resolve("fake-converter.sh");
        Files.writeString(converter, "#!/bin/sh\nexec cat >/dev/null\n");
        Files.setPosixFilePermissions(converter, PosixFilePermissions.fromString("rwx------"));
        DeviceIngestService service = new DeviceIngestService(registry, new LiveFrameHub());
        ReflectionTestUtils.setField(service, "hlsPath", directory.resolve("hls").toString());
        ReflectionTestUtils.setField(service, "ffmpegBin", converter.toString());
        ReflectionTestUtils.setField(service, "maxConcurrent", maxConcurrent);
        ReflectionTestUtils.setField(service, "maxFrameBytes", frameLimit);
        ReflectionTestUtils.setField(service, "hlsTime", 2.0);
        ReflectionTestUtils.setField(service, "processExitTimeout", 5L);
        service.initialize();
        return service;
    }

    private static InputStream jpeg() {
        return new ByteArrayInputStream(new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xd9});
    }

    private static final class BlockingInput extends InputStream {
        private final CountDownLatch reading = new CountDownLatch(1);
        private final CountDownLatch closed = new CountDownLatch(1);

        @Override
        public int read() throws IOException {
            reading.countDown();
            try {
                closed.await();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            }
            throw new IOException("Upload closed.");
        }

        @Override
        public void close() {
            closed.countDown();
        }
    }
}
