package com.yoojuno.cctv.device;

import com.yoojuno.cctv.stream.StreamIds;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/** One streaming HTTP upload feeds one FFmpeg process, without retaining the request body. */
@Service
public class DeviceIngestService {
    private static final Logger log = LoggerFactory.getLogger(DeviceIngestService.class);
    private final DeviceTokenRegistry registry;
    private final LiveFrameHub liveFrames;
    private final Map<String, Session> active = new ConcurrentHashMap<>();

    @Value("${hls.path:./hls}")
    private String hlsPath;
    @Value("${devices.ffmpeg-bin:ffmpeg}")
    private String ffmpegBin;
    @Value("${devices.max-concurrent-ingests:8}")
    private int maxConcurrent;
    @Value("${devices.max-frame-bytes:2097152}")
    private long maxFrameBytes;
    @Value("${devices.max-inter-frame-padding-bytes:65536}")
    private long maxInterFramePaddingBytes = 65536;
    @Value("${devices.hls-time-seconds:2}")
    private double hlsTime;
    @Value("${devices.process-exit-timeout-seconds:5}")
    private long processExitTimeout;

    private Semaphore slots;

    public DeviceIngestService(DeviceTokenRegistry registry, LiveFrameHub liveFrames) {
        this.registry = registry;
        this.liveFrames = liveFrames;
    }

    @PostConstruct
    public void initialize() {
        if (maxConcurrent < 1 || maxFrameBytes < 4 || maxInterFramePaddingBytes < 0
                || !Double.isFinite(hlsTime) || hlsTime <= 0 || processExitTimeout < 1) {
            throw new IllegalStateException("Invalid device ingest limits.");
        }
        slots = new Semaphore(maxConcurrent);
    }

    public void authenticate(String streamId, String token) {
        validateId(streamId);
        try {
            DeviceTokenRegistry.AuthenticationResult result = registry.authenticateAndActivate(streamId, token);
            if (result == DeviceTokenRegistry.AuthenticationResult.INVALID) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid device token");
            }
            if (result == DeviceTokenRegistry.AuthenticationResult.ACTIVATED) {
                stop(streamId);
            }
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "device registry unavailable");
        }
    }

    public IngestResult ingest(String streamId, String token, InputStream input) {
        authenticate(streamId, token);
        if (!slots.tryAcquire()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "device ingest capacity reached");
        }
        Session session = new Session(input);
        if (active.putIfAbsent(streamId, session) != null) {
            slots.release();
            throw new ResponseStatusException(HttpStatus.CONFLICT, "stream already has an active device");
        }
        try {
            Path directory = Path.of(hlsPath).toAbsolutePath().normalize();
            Files.createDirectories(directory);
            authenticate(streamId, token);
            session.liveProducer = liveFrames.open(streamId);
            int fps = registry.settings(streamId).fps();
            Process process = new ProcessBuilder(command(directory, streamId, fps))
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            session.attach(process);
            Thread errors = new Thread(() -> drain(process.getErrorStream()), "device-ffmpeg-stderr");
            errors.setDaemon(true);
            errors.start();
            long frames;
            try (OutputStream pipe = process.getOutputStream()) {
                frames = copyFrames(streamId, token, session, input, pipe);
            }
            if (!process.waitFor(processExitTimeout, TimeUnit.SECONDS)) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "video converter did not finish");
            }
            if (process.exitValue() != 0) {
                log.warn("Device video converter failed. streamId={}, exitCode={}", streamId, process.exitValue());
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "video converter failed");
            }
            return new IngestResult("completed", frames);
        } catch (IOException exception) {
            if (session.stopped || !registry.authenticates(streamId, token)) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "device token was rotated");
            }
            if (session.process == null) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "video converter or HLS storage unavailable");
            }
            if (exception instanceof JpegStreamFramer.InvalidJpegException invalid) {
                log.warn("Device JPEG rejected. streamId={}, code={}, bytesRead={}, frameBytes={}, completeFrames={}, previousByte={}, currentByte={}",
                        streamId, invalid.code, invalid.bytesRead, invalid.frameBytes, invalid.frames, invalid.previous, invalid.current);
            } else {
                String message = exception.getMessage();
                String code = "I/O_ERROR";
                if (message != null) {
                    if (message.contains("Broken pipe")) code = "BROKEN_PIPE";
                    else if (message.contains("Connection reset")) code = "CONNECTION_RESET";
                    else if (message.contains("timed out")) code = "TIMEOUT";
                    else if (message.contains("Stream closed")) code = "STREAM_CLOSED";
                }
                log.warn("Device video upload stopped. streamId={}, code={}, exceptionType={}", streamId, code, exception.getClass().getSimpleName());
            }
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid or interrupted JPEG stream");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "device ingest interrupted");
        } finally {
            session.stop();
            active.remove(streamId, session);
            slots.release();
        }
    }

    public void stop(String streamId) {
        Session session = active.get(streamId);
        if (session != null) {
            session.stop();
        }
    }

    @PreDestroy
    @EventListener(ContextClosedEvent.class)
    public void shutdown() {
        active.values().forEach(Session::stop);
    }

    private List<String> command(Path directory, String streamId, int fps) {
        return List.of(ffmpegBin, "-hide_banner", "-loglevel", "warning", "-nostdin", "-y",
                "-fflags", "+discardcorrupt", "-probesize", "32", "-analyzeduration", "0",
                "-use_wallclock_as_timestamps", "1", "-max_pixels", "2073600", "-f", "mjpeg", "-i", "pipe:0",
                "-an", "-r", Integer.toString(fps), "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
                "-pix_fmt", "yuv420p", "-profile:v", "baseline", "-level", "3.1", "-b:v", "500k", "-maxrate", "650k",
                "-bufsize", "1000k", "-fps_mode", "cfr", "-g", Integer.toString(fps), "-keyint_min", Integer.toString(fps),
                "-sc_threshold", "0", "-f", "hls", "-hls_time", Double.toString(hlsTime), "-hls_list_size", "6",
                "-hls_start_number_source", "epoch",
                "-hls_flags", "delete_segments+append_list+discont_start+program_date_time+independent_segments+omit_endlist+temp_file",
                "-hls_segment_filename", directory.resolve(streamId + "_%05d.ts").toString(),
                directory.resolve(streamId + ".m3u8").toString());
    }

    private long copyFrames(String streamId, String token, Session session, InputStream input, OutputStream pipe) throws IOException {
        byte[] buffer = new byte[8192];
        ByteArrayOutputStream frame = new ByteArrayOutputStream(8192);
        OutputStream tee = new OutputStream() {
            @Override public void write(int value) throws IOException { frame.write(value); pipe.write(value); }
            @Override public void write(byte[] bytes, int offset, int length) throws IOException {
                frame.write(bytes, offset, length);
                pipe.write(bytes, offset, length);
            }
            @Override public void flush() throws IOException { pipe.flush(); }
        };
        JpegStreamFramer framer = new JpegStreamFramer(maxFrameBytes, maxInterFramePaddingBytes, tee, () -> {
            byte[] jpeg = frame.toByteArray();
            if (LiveFrameHub.viewableJpeg(jpeg)) session.liveProducer.publish(jpeg);
            frame.reset();
        });
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (session.stopped || !registry.authenticates(streamId, token)) {
                throw new IOException("Device authorization changed.");
            }
            framer.accept(buffer, count);
            framer.flush();
        }
        return framer.finish();
    }

    private static void drain(InputStream errors) {
        try (errors) {
            errors.transferTo(OutputStream.nullOutputStream());
        } catch (IOException ignored) {
            // Converter shutdown closes the stream. Stderr may contain untrusted camera data.
        }
    }

    private static void validateId(String streamId) {
        try {
            StreamIds.requireValid(streamId);
        } catch (IllegalStateException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid stream id");
        }
    }

    public record IngestResult(String status, long frames) {
    }

    private static final class Session {
        private final InputStream input;
        private volatile Process process;
        private volatile boolean stopped;
        private volatile LiveFrameHub.Producer liveProducer;

        private Session(InputStream input) {
            this.input = input;
        }

        private synchronized void attach(Process process) {
            this.process = process;
            if (stopped) {
                process.destroyForcibly();
            }
        }

        private synchronized void stop() {
            stopped = true;
            if (liveProducer != null) liveProducer.close();
            if (process != null && process.isAlive()) {
                process.destroy();
                try {
                    if (!process.waitFor(2, TimeUnit.SECONDS)) {
                        process.destroyForcibly();
                    }
                } catch (InterruptedException exception) {
                    process.destroyForcibly();
                    Thread.currentThread().interrupt();
                }
            }
            try {
                input.close();
            } catch (IOException ignored) {
                // The client may have already disconnected.
            }
        }
    }
}
