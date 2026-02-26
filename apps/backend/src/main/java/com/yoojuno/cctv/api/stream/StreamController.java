package com.yoojuno.cctv.api.stream;

import com.yoojuno.cctv.api.common.ErrorResponse;
import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.domain.stream.StreamQueryService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class StreamController {
    private final StreamQueryService streamQueryService;
    private final StreamApiMapper streamApiMapper;

    public StreamController(StreamQueryService streamQueryService, StreamApiMapper streamApiMapper) {
        this.streamQueryService = streamQueryService;
        this.streamApiMapper = streamApiMapper;
    }

    @GetMapping("/streams")
    public ResponseEntity<?> streams(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ErrorResponse.of("unauthorized"));
        }

        return ResponseEntity.ok(streamApiMapper.toStreamsResponse(streamQueryService.authorizedStreams(user)));
    }

    @GetMapping("/streams/health")
    public ResponseEntity<?> streamHealth(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ErrorResponse.of("unauthorized"));
        }

        return ResponseEntity.ok(streamApiMapper.toStreamsHealthResponse(streamQueryService.streamHealthSnapshot(user)));
    }
}
