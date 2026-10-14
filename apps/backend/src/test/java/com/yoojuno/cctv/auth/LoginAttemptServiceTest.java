package com.yoojuno.cctv.auth;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class LoginAttemptServiceTest {
    @Test
    void blocksOneAddressEvenWhenUsernamesRotate() {
        LoginAttemptService service = service(new MutableClock(), 3, 32);
        for (int index = 0; index < 3; index++) {
            service.recordFailure("unknown-" + index, "127.0.0.1");
        }
        assertThat(service.isBlocked("another-user", "127.0.0.1")).isTrue();
        assertThat(service.retryAfterSeconds("another-user", "127.0.0.1")).isEqualTo(300);
        assertThat(service.isBlocked("another-user", "127.0.0.2")).isFalse();
    }

    @Test
    void successfulLoginClearsTheUserCounterWithoutResettingAddressFailures() {
        LoginAttemptService service = service(new MutableClock(), 4, 32);
        for (int index = 0; index < 3; index++) {
            service.recordFailure("viewer", "127.0.0.1");
        }
        assertThat(service.isBlocked("viewer", "127.0.0.1")).isTrue();
        service.recordSuccess("viewer", "127.0.0.1");
        assertThat(service.isBlocked("viewer", "127.0.0.1")).isFalse();
        service.recordFailure("another-user", "127.0.0.1");
        service.recordSuccess("another-user", "127.0.0.1");
        assertThat(service.isBlocked("viewer", "127.0.0.1")).isTrue();
    }

    @Test
    void expiresFailuresAndReportsTheRemainingLockout() {
        MutableClock clock = new MutableClock();
        LoginAttemptService service = service(clock, 3, 32);
        for (int index = 0; index < 3; index++) {
            service.recordFailure("viewer", "127.0.0.1");
        }
        clock.now = clock.now.plusSeconds(299);
        assertThat(service.retryAfterSeconds("viewer", "127.0.0.1")).isEqualTo(1);
        clock.now = clock.now.plusSeconds(1);
        assertThat(service.isBlocked("viewer", "127.0.0.1")).isFalse();
        assertThat(service.retryAfterSeconds("viewer", "127.0.0.1")).isZero();
    }

    @Test
    void boundsTheCombinedCacheWhenAddressesAndUsernamesRotate() {
        LoginAttemptService service = service(new MutableClock(), 50, 128);
        for (int index = 0; index < 1200; index++) {
            service.recordFailure("unknown-" + index, "192.0.2." + index);
        }
        Map<?, ?> entries = (Map<?, ?>) ReflectionTestUtils.getField(service, "attemptsByKey");
        assertThat(entries).hasSize(128);
    }

    @Test
    void rotatingUsernamesDoesNotEvictTheActiveAddressGuardAtCapacity() {
        LoginAttemptService service = service(new MutableClock(), 5, 2);
        for (int index = 0; index < 5; index++) {
            service.recordFailure("unknown-" + index, "127.0.0.1");
        }
        assertThat(service.isBlocked("another-user", "127.0.0.1")).isTrue();
    }

    private static LoginAttemptService service(Clock clock, int addressLimit, int capacity) {
        LoginAttemptService service = new LoginAttemptService(clock);
        ReflectionTestUtils.setField(service, "maxAttempts", 3);
        ReflectionTestUtils.setField(service, "lockoutSeconds", 300L);
        ReflectionTestUtils.setField(service, "maxAttemptsPerIp", addressLimit);
        ReflectionTestUtils.setField(service, "maxTrackedEntries", capacity);
        service.validateConfiguration();
        return service;
    }

    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-10-14T00:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
