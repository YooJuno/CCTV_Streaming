package com.yoojuno.cctv.api.auth;

import com.yoojuno.cctv.api.auth.dto.LoginRequest;
import com.yoojuno.cctv.api.common.ErrorResponse;
import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.auth.LoginAttemptService;
import com.yoojuno.cctv.domain.auth.AuthFacadeService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
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

import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final AuthFacadeService authFacadeService;
    private final LoginAttemptService loginAttemptService;
    private final AuthApiMapper authApiMapper;

    @Value("${auth.jwt.cookie-name:CCTV_AUTH}")
    private String authCookieName;

    @Value("${auth.jwt.cookie-secure:false}")
    private boolean authCookieSecure;

    @Value("${auth.jwt.cookie-same-site:Lax}")
    private String authCookieSameSite;

    public AuthController(
            AuthFacadeService authFacadeService,
            LoginAttemptService loginAttemptService,
            AuthApiMapper authApiMapper
    ) {
        this.authFacadeService = authFacadeService;
        this.loginAttemptService = loginAttemptService;
        this.authApiMapper = authApiMapper;
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
        String clientAddress = httpRequest.getRemoteAddr();
        if (loginAttemptService.isBlocked(request.username(), clientAddress)) {
            long retryAfter = loginAttemptService.retryAfterSeconds(request.username(), clientAddress);
            log.warn("Login blocked after repeated failures. user={}, client={}", request.username(), clientAddress);
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .header(HttpHeaders.RETRY_AFTER, Long.toString(retryAfter))
                    .body(ErrorResponse.of("too many failed attempts, retry in " + retryAfter + "s"));
        }

        Optional<AuthFacadeService.LoginResult> loginResult = authFacadeService.login(request.username(), request.password());
        if (loginResult.isEmpty()) {
            loginAttemptService.recordFailure(request.username(), clientAddress);
            log.warn("Login failed. user={}, client={}", request.username(), clientAddress);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ErrorResponse.of("invalid credentials"));
        }
        loginAttemptService.recordSuccess(request.username(), clientAddress);

        AuthFacadeService.LoginResult result = loginResult.get();
        ResponseCookie cookie = buildAccessTokenCookie(result.token(), authFacadeService.expirationSeconds());
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .body(authApiMapper.toAuthResponse(result.session()));
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ErrorResponse.of("unauthorized"));
        }

        return ResponseEntity.ok(authApiMapper.toAuthResponse(authFacadeService.sessionFor(user)));
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
}
