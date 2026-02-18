package com.yoojuno.cctv.controller;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.auth.JwtService;
import com.yoojuno.cctv.auth.UserAccountService;
import com.yoojuno.cctv.model.StreamInfo;
import com.yoojuno.cctv.stream.StreamCatalogService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final UserAccountService userAccountService;
    private final StreamCatalogService streamCatalogService;
    private final JwtService jwtService;

    public AuthController(
            UserAccountService userAccountService,
            StreamCatalogService streamCatalogService,
            JwtService jwtService
    ) {
        this.userAccountService = userAccountService;
        this.streamCatalogService = streamCatalogService;
        this.jwtService = jwtService;
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@Valid @RequestBody LoginRequest request) {
        Optional<AuthenticatedUser> user = userAccountService.authenticate(request.username(), request.password());
        if (user.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "invalid credentials"));
        }
        AuthenticatedUser authenticatedUser = user.get();
        String token = jwtService.issueToken(authenticatedUser);
        List<StreamInfo> streams = streamCatalogService.forAllowedStreamIds(authenticatedUser.allowedStreams());
        return ResponseEntity.ok(new AuthResponse(
                token,
                "Bearer",
                jwtService.expirationSeconds(),
                authenticatedUser.username(),
                authenticatedUser.displayName(),
                streams
        ));
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "unauthorized"));
        }
        List<StreamInfo> streams = streamCatalogService.forAllowedStreamIds(user.allowedStreams());
        return ResponseEntity.ok(new MeResponse(user.username(), user.displayName(), streams));
    }

    public record LoginRequest(
            @NotBlank String username,
            @NotBlank String password
    ) {
    }

    public record AuthResponse(
            String accessToken,
            String tokenType,
            long expiresInSeconds,
            String username,
            String displayName,
            List<StreamInfo> streams
    ) {
    }

    public record MeResponse(
            String username,
            String displayName,
            List<StreamInfo> streams
    ) {
    }
}
