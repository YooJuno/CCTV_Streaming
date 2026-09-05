package com.yoojuno.cctv.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory brute-force guard for {@code POST /api/auth/login}.
 *
 * <p>The dashboard is routinely exposed on a public IP (see {@code scripts/dev-up.sh}), and the
 * login endpoint is the only unauthenticated write path, so unlimited password guessing is the
 * cheapest way in. Attempts are counted per username+client address; the counter resets on a
 * successful login and expires after the lockout window.
 */
@Service
public class LoginAttemptService {
    @Value("${auth.login.max-attempts:10}")
    private int maxAttempts;

    @Value("${auth.login.lockout-seconds:300}")
    private long lockoutSeconds;

    private final Map<String, Attempts> attemptsByKey = new ConcurrentHashMap<>();

    public boolean isBlocked(String username, String clientAddress) {
        Attempts attempts = attemptsByKey.get(key(username, clientAddress));
        if (attempts == null) {
            return false;
        }
        if (isExpired(attempts)) {
            attemptsByKey.remove(key(username, clientAddress), attempts);
            return false;
        }
        return attempts.count.get() >= maxAttempts;
    }

    public long retryAfterSeconds(String username, String clientAddress) {
        Attempts attempts = attemptsByKey.get(key(username, clientAddress));
        if (attempts == null) {
            return 0;
        }
        long elapsed = Duration.between(attempts.lastFailureAt, Instant.now()).getSeconds();
        return Math.max(1, lockoutSeconds - elapsed);
    }

    public void recordFailure(String username, String clientAddress) {
        String key = key(username, clientAddress);
        Attempts attempts = attemptsByKey.compute(key, (ignored, current) ->
                current == null || isExpired(current) ? new Attempts() : current);
        attempts.count.incrementAndGet();
        attempts.lastFailureAt = Instant.now();
        evictExpiredEntries();
    }

    public void recordSuccess(String username, String clientAddress) {
        attemptsByKey.remove(key(username, clientAddress));
    }

    private boolean isExpired(Attempts attempts) {
        return Duration.between(attempts.lastFailureAt, Instant.now()).getSeconds() >= lockoutSeconds;
    }

    /** Keeps the map from growing without bound when attackers rotate usernames or addresses. */
    private void evictExpiredEntries() {
        if (attemptsByKey.size() < 1000) {
            return;
        }
        attemptsByKey.values().removeIf(this::isExpired);
    }

    private static String key(String username, String clientAddress) {
        return (username == null ? "" : username.trim()) + "@" + (clientAddress == null ? "" : clientAddress);
    }

    private static final class Attempts {
        private final AtomicInteger count = new AtomicInteger();
        private volatile Instant lastFailureAt = Instant.now();
    }
}
