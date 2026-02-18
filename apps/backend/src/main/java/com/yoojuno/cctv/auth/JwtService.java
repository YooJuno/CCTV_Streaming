package com.yoojuno.cctv.auth;

import jakarta.annotation.PostConstruct;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Set;

@Service
public class JwtService {
    @Value("${auth.jwt.secret:}")
    private String secret;

    @Value("${auth.jwt.expiration-seconds:3600}")
    private long expirationSeconds;

    private SecretKey cachedSigningKey;

    @PostConstruct
    void initSigningKey() {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("auth.jwt.secret is empty. Configure AUTH_JWT_SECRET.");
        }
        if ("change-this-jwt-secret-to-a-long-random-value".equals(secret)) {
            throw new IllegalStateException("auth.jwt.secret uses placeholder value. Set a real secret.");
        }
        this.cachedSigningKey = createSigningKey(secret);
    }

    public String issueToken(AuthenticatedUser user) {
        Instant now = Instant.now();
        Instant expiry = now.plusSeconds(expirationSeconds);
        return Jwts.builder()
                .subject(user.username())
                .claim("displayName", user.displayName())
                .claim("streams", List.copyOf(user.allowedStreams()))
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiry))
                .signWith(signingKey())
                .compact();
    }

    public AuthenticatedUser parseToken(String token) {
        Jws<Claims> parsed = Jwts.parser()
                .verifyWith(signingKey())
                .build()
                .parseSignedClaims(token);
        Claims claims = parsed.getPayload();
        String username = claims.getSubject();
        String displayName = claims.get("displayName", String.class);
        Object streamsClaim = claims.get("streams");
        Set<String> streamSet = parseStreamsClaim(streamsClaim);
        return new AuthenticatedUser(
                username,
                displayName == null || displayName.isBlank() ? username : displayName,
                streamSet
        );
    }

    public long expirationSeconds() {
        return expirationSeconds;
    }

    private SecretKey signingKey() {
        return cachedSigningKey;
    }

    private static SecretKey createSigningKey(String secret) {
        // Treat long secrets as raw text; if the secret looks base64, decode it.
        byte[] keyBytes;
        if (looksLikeBase64(secret)) {
            try {
                keyBytes = Decoders.BASE64.decode(secret);
            } catch (IllegalArgumentException e) {
                keyBytes = secret.getBytes(StandardCharsets.UTF_8);
            }
        } else {
            keyBytes = secret.getBytes(StandardCharsets.UTF_8);
        }
        return Keys.hmacShaKeyFor(normalizeKeyLength(keyBytes));
    }

    private static boolean looksLikeBase64(String value) {
        if (value == null || value.length() < 32) {
            return false;
        }
        return value.matches("^[A-Za-z0-9+/=]+$");
    }

    private static Set<String> parseStreamsClaim(Object claim) {
        if (!(claim instanceof List<?> rawList)) {
            return Set.of();
        }
        return rawList.stream()
                .filter(item -> item instanceof String)
                .map(String.class::cast)
                .filter(value -> !value.isBlank())
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    private static byte[] normalizeKeyLength(byte[] bytes) {
        // HS256 requires >= 32 bytes.
        if (bytes.length >= 32) {
            return bytes;
        }
        if (bytes.length == 0) {
            bytes = "default-jwt-secret-change-me".getBytes(StandardCharsets.UTF_8);
        }
        byte[] normalized = new byte[32];
        for (int i = 0; i < normalized.length; i++) {
            normalized[i] = bytes[i % bytes.length];
        }
        return normalized;
    }
}
