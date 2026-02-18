package com.yoojuno.cctv.controller;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.model.StreamInfo;
import com.yoojuno.cctv.stream.StreamCatalogService;
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

    public StreamController(StreamCatalogService streamCatalogService) {
        this.streamCatalogService = streamCatalogService;
    }

    @GetMapping("/streams")
    public ResponseEntity<?> streams(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "unauthorized"));
        }
        List<StreamInfo> streams = streamCatalogService.forAllowedStreamIds(user.allowedStreams());
        return ResponseEntity.ok(new StreamsResponse(streams));
    }

    public record StreamsResponse(List<StreamInfo> streams) {
    }
}
