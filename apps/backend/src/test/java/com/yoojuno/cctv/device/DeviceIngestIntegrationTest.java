package com.yoojuno.cctv.device;

import com.yoojuno.cctv.model.StreamInfo;
import com.yoojuno.cctv.stream.StreamHealthService;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "auth.jwt.secret=test-jwt-secret-should-be-32-bytes-minimum",
        "auth.users=viewer:{plain}viewer123:mystream",
        "devices.hls-time-seconds=1"
})
class DeviceIngestIntegrationTest {
    private static final Path DIRECTORY = createDirectory();
    private static final String FFMPEG = System.getenv().getOrDefault("FFMPEG_BIN", "ffmpeg");

    @LocalServerPort
    int port;
    @Autowired
    DeviceTokenRegistry registry;
    @Autowired
    StreamHealthService health;

    @DynamicPropertySource
    static void paths(DynamicPropertyRegistry properties) {
        properties.add("devices.registry-path", () -> DIRECTORY.resolve("registry.properties").toString());
        properties.add("hls.path", () -> DIRECTORY.resolve("hls").toString());
        properties.add("devices.ffmpeg-bin", () -> FFMPEG);
    }

    @AfterAll
    static void cleanup() throws IOException {
        try (var paths = Files.walk(DIRECTORY)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    @Test
    void acceptsAChunkedJpegUploadAndProducesPlayableAuthorizedHls() throws Exception {
        assumeTrue(ffmpegAvailable(), "Install ffmpeg to run device ingest integration coverage.");
        String token = registry.issueToken("mystream");
        byte[] jpeg = jpeg();
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        HttpRequest request = HttpRequest.newBuilder(uri("/api/devices/mystream/video"))
                .timeout(Duration.ofSeconds(20)).header("X-Device-Token", token)
                .header("Content-Type", "application/octet-stream")
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new PacedJpegs(jpeg, 24))).build();
        HttpResponse<String> upload = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(upload.statusCode()).isEqualTo(200);
        assertThat(upload.body()).contains("\"frames\":24");
        Path manifest = DIRECTORY.resolve("hls/mystream.m3u8");
        assertThat(manifest).isRegularFile();
        assertThat(health.healthForStreams(List.of(new StreamInfo("mystream", "test"))).get(0).live()).isTrue();
        String segmentName = Files.readAllLines(manifest).stream().filter(line -> !line.isBlank() && !line.startsWith("#")).findFirst().orElseThrow();
        Process decode = new ProcessBuilder(FFMPEG, "-hide_banner", "-loglevel", "error", "-i", manifest.getParent().resolve(segmentName).toString(),
                "-frames:v", "1", "-f", "null", "-")
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try {
            assertThat(decode.waitFor(10, TimeUnit.SECONDS)).isTrue();
            assertThat(decode.exitValue()).isZero();
        } finally {
            if (decode.isAlive()) {
                decode.destroyForcibly();
            }
        }

        long originalSequence = mediaSequence(manifest);
        HttpRequest reconnect = HttpRequest.newBuilder(uri("/api/devices/mystream/video"))
                .timeout(Duration.ofSeconds(20)).header("X-Device-Token", token)
                .header("Content-Type", "application/octet-stream")
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new PacedJpegs(jpeg, 24))).build();
        assertThat(client.send(reconnect, HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(200);
        assertThat(mediaSequence(manifest)).isGreaterThan(originalSequence);
        assertThat(Files.readString(manifest)).contains("#EXT-X-DISCONTINUITY");

        HttpResponse<String> login = client.send(HttpRequest.newBuilder(uri("/api/auth/login"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"username\":\"viewer\",\"password\":\"viewer123\"}")).build(),
                HttpResponse.BodyHandlers.ofString());
        String cookie = login.headers().firstValue("Set-Cookie").orElseThrow().split(";", 2)[0];
        HttpResponse<String> hls = client.send(HttpRequest.newBuilder(uri("/hls/mystream.m3u8"))
                        .header("Cookie", cookie).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertThat(hls.statusCode()).isEqualTo(200);
        assertThat(hls.body()).contains("#EXTM3U", "mystream_");
        assertThat(client.send(HttpRequest.newBuilder(uri("/hls/mystream.m3u8")).GET().build(),
                HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(401);
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private static long mediaSequence(Path manifest) throws IOException {
        return Files.readAllLines(manifest).stream().filter(line -> line.startsWith("#EXT-X-MEDIA-SEQUENCE:"))
                .map(line -> Long.parseLong(line.substring("#EXT-X-MEDIA-SEQUENCE:".length())))
                .findFirst().orElseThrow();
    }

    private static byte[] jpeg() throws IOException {
        BufferedImage image = new BufferedImage(160, 120, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                image.setRGB(x, y, ((x * 255 / 160) << 16) | (y * 255 / 120));
            }
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(image, "jpeg", output);
        byte[] original = output.toByteArray();
        ByteArrayOutputStream padded = new ByteArrayOutputStream();
        padded.write(original, 0, 2);
        padded.write(new byte[]{(byte) 0xff, (byte) 0xfe, 0, 6, 0x11, (byte) 0xff, (byte) 0xd9, 0x22});
        padded.write(original, 2, original.length - 2);
        padded.write(new byte[64]);
        return padded.toByteArray();
    }

    private static boolean ffmpegAvailable() {
        try {
            Process process = new ProcessBuilder(FFMPEG, "-version").redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            boolean finished = process.waitFor(5, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
            }
            return finished && process.exitValue() == 0;
        } catch (IOException | InterruptedException exception) {
            return false;
        }
    }

    private static Path createDirectory() {
        try {
            return Files.createTempDirectory("device-ingest-test-");
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static final class PacedJpegs extends InputStream {
        private final byte[] jpeg;
        private int remaining;
        private int offset;

        private PacedJpegs(byte[] jpeg, int frames) {
            this.jpeg = jpeg;
            remaining = frames;
        }

        @Override
        public int read(byte[] buffer, int start, int length) throws IOException {
            if (remaining == 0) {
                return -1;
            }
            if (offset == 0) {
                try {
                    Thread.sleep(170);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Interrupted test frame source.");
                }
            }
            int count = Math.min(length, jpeg.length - offset);
            System.arraycopy(jpeg, offset, buffer, start, count);
            offset += count;
            if (offset == jpeg.length) {
                remaining--;
                offset = 0;
            }
            return count;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            return read(one, 0, 1) == -1 ? -1 : one[0] & 0xff;
        }
    }
}
