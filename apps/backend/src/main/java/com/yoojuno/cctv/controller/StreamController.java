package com.yoojuno.cctv.controller;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.model.StreamInfo;
import com.yoojuno.cctv.stream.StreamCatalogService;
import com.yoojuno.cctv.stream.StreamHealthService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class StreamController {
    private final StreamCatalogService streamCatalogService;
    private final StreamHealthService streamHealthService;

    public StreamController(StreamCatalogService streamCatalogService, StreamHealthService streamHealthService) {
        this.streamCatalogService = streamCatalogService;
        this.streamHealthService = streamHealthService;
    }

    @GetMapping("/streams")
    public ResponseEntity<?> streams(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "unauthorized"));
        }
        List<StreamInfo> streams = streamCatalogService.forAllowedStreamIds(user.allowedStreams());
        return ResponseEntity.ok(new StreamsResponse(streams));
    }

    @GetMapping("/streams/health")
    public ResponseEntity<?> streamHealth(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "unauthorized"));
        }
        List<StreamInfo> streams = streamCatalogService.forAllowedStreamIds(user.allowedStreams());
        List<StreamHealthService.StreamHealth> health = streamHealthService.healthForStreams(streams);
        return ResponseEntity.ok(new StreamsHealthResponse(health, streamHealthService.liveThresholdSeconds()));
    }

    public record StreamsResponse(List<StreamInfo> streams) {
    }

    public record StreamsHealthResponse(
            List<StreamHealthService.StreamHealth> streams,
            long liveThresholdSeconds
    ) {
    }
}
