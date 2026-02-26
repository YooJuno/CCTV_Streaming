package com.yoojuno.cctv.api.system;

import com.yoojuno.cctv.api.common.ErrorResponse;
import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.domain.system.SystemHealthQueryService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/system")
public class SystemHealthController {
    private final SystemHealthQueryService systemHealthQueryService;
    private final SystemHealthApiMapper systemHealthApiMapper;

    public SystemHealthController(
            SystemHealthQueryService systemHealthQueryService,
            SystemHealthApiMapper systemHealthApiMapper
    ) {
        this.systemHealthQueryService = systemHealthQueryService;
        this.systemHealthApiMapper = systemHealthApiMapper;
    }

    @GetMapping("/health")
    public ResponseEntity<?> systemHealth(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ErrorResponse.of("unauthorized"));
        }

        return ResponseEntity.ok(systemHealthApiMapper.toResponse(systemHealthQueryService.query(user)));
    }
}
