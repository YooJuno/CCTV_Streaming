package com.yoojuno.cctv.controller;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.auth.JwtService;
import com.yoojuno.cctv.auth.LoginAttemptService;
import com.yoojuno.cctv.auth.UserAccountService;
import com.yoojuno.cctv.model.StreamInfo;
import com.yoojuno.cctv.stream.StreamCatalogService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
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
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final UserAccountService userAccountService;
    private final LoginAttemptService loginAttemptService;
    private final StreamCatalogService streamCatalogService;
    private final JwtService jwtService;
    @Value("${auth.jwt.cookie-name:CCTV_AUTH}")
    private String authCookieName;
    @Value("${auth.jwt.cookie-secure:false}")
    private boolean authCookieSecure;
    @Value("${auth.jwt.cookie-same-site:Lax}")
    private String authCookieSameSite;

    public AuthController(
            UserAccountService userAccountService,
            LoginAttemptService loginAttemptService,
            StreamCatalogService streamCatalogService,
            JwtService jwtService
    ) {
        this.userAccountService = userAccountService;
        this.loginAttemptService = loginAttemptService;
        this.streamCatalogService = streamCatalogService;
        this.jwtService = jwtService;
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
        String clientAddress = httpRequest.getRemoteAddr();
        if (loginAttemptService.isBlocked(request.username(), clientAddress)) {
            long retryAfter = loginAttemptService.retryAfterSeconds(request.username(), clientAddress);
            log.warn("Login blocked after repeated failures. user={}, client={}", request.username(), clientAddress);
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .header(HttpHeaders.RETRY_AFTER, Long.toString(retryAfter))
                    .body(Map.of("error", "too many failed attempts, retry in " + retryAfter + "s"));
        }

        Optional<AuthenticatedUser> user = userAccountService.authenticate(request.username(), request.password());
        if (user.isEmpty()) {
            loginAttemptService.recordFailure(request.username(), clientAddress);
            log.warn("Login failed. user={}, client={}", request.username(), clientAddress);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "invalid credentials"));
        }
        loginAttemptService.recordSuccess(request.username(), clientAddress);
        AuthenticatedUser authenticatedUser = user.get();
        String token = jwtService.issueToken(authenticatedUser);
        List<StreamInfo> streams = streamCatalogService.forAllowedStreamIds(authenticatedUser.allowedStreams());
        ResponseCookie cookie = buildAccessTokenCookie(token, jwtService.expirationSeconds());
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .body(new AuthResponse(
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
        return ResponseEntity.ok(new MeResponse(jwtService.expirationSeconds(), user.username(), user.displayName(), streams));
    }

    @PostMapping("/logout")
    public ResponseEntity<Map<String, String>> logout() {
        ResponseCookie clearCookie = buildAccessTokenCookie("", 0);
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, clearCookie.toString())
                .body(Map.of("status", "logged out"));
    }

    private ResponseCookie buildAccessTokenCookie(String token, long maxAgeSeconds) {
        return ResponseCookie.from(authCookieName, token)
                .httpOnly(true)
                .secure(authCookieSecure)
                .sameSite(authCookieSameSite)
                .path("/")
                .maxAge(maxAgeSeconds)
                .build();
    }

    public record LoginRequest(
            @NotBlank String username,
            @NotBlank String password
    ) {
    }

    public record AuthResponse(
            long expiresInSeconds,
            String username,
            String displayName,
            List<StreamInfo> streams
    ) {
    }

    public record MeResponse(
            long expiresInSeconds,
            String username,
            String displayName,
            List<StreamInfo> streams
    ) {
    }
}
