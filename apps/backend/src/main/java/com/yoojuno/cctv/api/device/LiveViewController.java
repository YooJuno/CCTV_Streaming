package com.yoojuno.cctv.api.device;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.device.LiveFrameHub;
import com.yoojuno.cctv.stream.StreamCatalogService;
import com.yoojuno.cctv.stream.StreamIds;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

@RestController
@RequestMapping("/api/live")
public class LiveViewController {
    private final LiveFrameHub frames;
    private final StreamCatalogService catalog;

    public LiveViewController(LiveFrameHub frames, StreamCatalogService catalog) {
        this.frames = frames;
        this.catalog = catalog;
    }

    @GetMapping("/{streamId}/status")
    public LiveFrameHub.Status status(@PathVariable String streamId, Authentication authentication) {
        authorize(streamId, authentication);
        return frames.status(streamId);
    }

    @GetMapping("/{streamId}/stream.mjpeg")
    public void stream(@PathVariable String streamId, Authentication authentication, HttpServletResponse response)
            throws IOException {
        AuthenticatedUser user = authorize(streamId, authentication);
        if (!frames.acquireViewer()) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "live viewer capacity reached");
        try {
            LiveFrameHub.Frame frame = frames.await(streamId, -1, 5000);
            if (frame == null) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "camera is not sending video");
            response.setContentType("multipart/x-mixed-replace; boundary=cctv-frame");
            response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            response.setHeader("X-Accel-Buffering", "no");
            var output = response.getOutputStream();
            long lastFrame = System.nanoTime();
            while (user.expiresAt() == null || Instant.now().isBefore(user.expiresAt())) {
                if (frame != null) {
                    String headers = "--cctv-frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + frame.jpeg().length
                            + "\r\nX-Frame-Sequence: " + frame.sequence()
                            + "\r\nX-Frame-Received-At: " + frame.receivedAtEpochMs() + "\r\n\r\n";
                    output.write(headers.getBytes(StandardCharsets.US_ASCII));
                    output.write(frame.jpeg());
                    output.write(new byte[]{'\r', '\n'});
                    response.flushBuffer();
                    lastFrame = System.nanoTime();
                }
                if (System.nanoTime() - lastFrame > 5_000_000_000L) break;
                long sequence = frame == null ? -1 : frame.sequence();
                // Keep the last sent sequence across idle waits to avoid repeating an old frame.
                do {
                    frame = frames.await(streamId, sequence, 1000);
                    if (System.nanoTime() - lastFrame > 5_000_000_000L) break;
                } while (frame == null && (user.expiresAt() == null || Instant.now().isBefore(user.expiresAt())));
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        } catch (IOException exception) {
            if (!response.isCommitted()) throw exception;
            // The browser closes this connection when playback stops or navigation changes.
        } finally {
            frames.releaseViewer();
        }
    }

    private AuthenticatedUser authorize(String streamId, Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "unauthorized");
        }
        try { StreamIds.requireValid(streamId); }
        catch (IllegalStateException exception) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid stream id"); }
        if (catalog.all().stream().noneMatch(stream -> stream.id().equals(streamId))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "stream is not in the catalog");
        }
        if (!user.allowedStreams().contains("*") && !user.allowedStreams().contains(streamId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "stream access denied");
        }
        return user;
    }
}
