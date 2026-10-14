package com.yoojuno.cctv.auth;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * In-memory brute-force guard for {@code POST /api/auth/login}.
 *
 * Counts failures per username+address and per address. The shared LRU cache has a fixed
 * maximum size, and each lookup expires its own entry without scanning the whole cache.
 */
@Service
public class LoginAttemptService {
    @Value("${auth.login.max-attempts:10}")
    private int maxAttempts;

    @Value("${auth.login.lockout-seconds:300}")
    private long lockoutSeconds;

    @Value("${auth.login.max-attempts-per-ip:50}")
    private int maxAttemptsPerIp = 50;

    @Value("${auth.login.max-tracked-entries:10000}")
    private int maxTrackedEntries = 10000;

    private final Clock clock;
    private final Map<AttemptKey, Attempts> attemptsByKey = new LinkedHashMap<>(16, 0.75f, true);

    public LoginAttemptService() {
        this(Clock.systemUTC());
    }

    LoginAttemptService(Clock clock) {
        this.clock = clock;
    }

    @PostConstruct
    void validateConfiguration() {
        if (maxAttempts < 1 || maxAttemptsPerIp < 1 || lockoutSeconds < 1 || maxTrackedEntries < 2) {
            throw new IllegalStateException("Login limits must be positive and max-tracked-entries must be at least 2.");
        }
    }

    public synchronized boolean isBlocked(String username, String clientAddress) {
        Instant now = clock.instant();
        return isBlocked(activeAttempts(userKey(username, clientAddress), now), maxAttempts)
                || isBlocked(activeAttempts(addressKey(clientAddress), now), maxAttemptsPerIp);
    }

    public synchronized long retryAfterSeconds(String username, String clientAddress) {
        Instant now = clock.instant();
        return Math.max(
                remainingLockout(activeAttempts(userKey(username, clientAddress), now), maxAttempts, now),
                remainingLockout(activeAttempts(addressKey(clientAddress), now), maxAttemptsPerIp, now));
    }

    public synchronized void recordFailure(String username, String clientAddress) {
        Instant now = clock.instant();
        recordFailure(userKey(username, clientAddress), now);
        // Touch the address entry last so rotating usernames cannot evict this active guard.
        recordFailure(addressKey(clientAddress), now);
    }

    public synchronized void recordSuccess(String username, String clientAddress) {
        attemptsByKey.remove(userKey(username, clientAddress));
        // A valid account must not let an attacker reset the address-wide failure count.
    }

    private Attempts activeAttempts(AttemptKey key, Instant now) {
        Attempts attempts = attemptsByKey.get(key);
        if (attempts != null && !now.isBefore(attempts.lastFailureAt.plusSeconds(lockoutSeconds))) {
            attemptsByKey.remove(key);
            return null;
        }
        return attempts;
    }

    private void recordFailure(AttemptKey key, Instant now) {
        Attempts attempts = activeAttempts(key, now);
        if (attempts == null) {
            attempts = new Attempts();
            attemptsByKey.put(key, attempts);
        }
        attempts.count = Math.min(Integer.MAX_VALUE - 1, attempts.count) + 1;
        attempts.lastFailureAt = now;
        if (attemptsByKey.size() > maxTrackedEntries) {
            var oldest = attemptsByKey.keySet().iterator();
            oldest.next();
            oldest.remove();
        }
    }

    private static boolean isBlocked(Attempts attempts, int limit) {
        return attempts != null && attempts.count >= limit;
    }

    private long remainingLockout(Attempts attempts, int limit, Instant now) {
        return isBlocked(attempts, limit)
                ? Math.max(1, lockoutSeconds - Duration.between(attempts.lastFailureAt, now).getSeconds()) : 0;
    }

    private static AttemptKey userKey(String username, String clientAddress) {
        return new AttemptKey(username == null ? "" : username.trim(), address(clientAddress));
    }

    private static AttemptKey addressKey(String clientAddress) {
        return new AttemptKey(null, address(clientAddress));
    }

    private static String address(String clientAddress) {
        return clientAddress == null ? "" : clientAddress;
    }

    private record AttemptKey(String username, String clientAddress) {
    }

    private static final class Attempts {
        private int count;
        private Instant lastFailureAt;
    }
}
