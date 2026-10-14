package com.yoojuno.cctv.device;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class DeviceTokenRegistryTest {
    @TempDir
    Path directory;

    @Test
    void persistsOnlyTokenDigestsAndRestoresThemAfterRestart() throws Exception {
        DeviceTokenRegistry registry = registry();
        String token = registry.issueToken("cam_01.v1");
        assertThat(token.matches("[a-f0-9]{64}")).isTrue();
        assertThat(registry.authenticateAndActivate("cam_01.v1", token)).isEqualTo(DeviceTokenRegistry.AuthenticationResult.ACTIVATED);
        assertThat(registry.authenticates("cam_01.v1", token)).isTrue();
        assertThat(registry.authenticates("another-camera", token)).isFalse();
        assertThat(Files.readString(path()).contains(token)).isFalse();
        assertThat(registry().authenticates("cam_01.v1", token)).isTrue();
        if (Files.getFileStore(path()).supportsFileAttributeView("posix")) {
            assertThat(Files.getPosixFilePermissions(path())).isEqualTo(PosixFilePermissions.fromString("rw-------"));
        }
    }

    @Test
    void onlyActivatingAReplacementInvalidatesThePreviousCredential() throws Exception {
        DeviceTokenRegistry registry = registry();
        String previous = registry.issueToken("mystream");
        registry.authenticateAndActivate("mystream", previous);
        String replacement = registry.issueToken("mystream");
        assertThat(registry.authenticates("mystream", previous)).isTrue();
        assertThat(registry.authenticates("mystream", replacement)).isFalse();
        assertThat(registry.authenticateAndActivate("mystream", replacement)).isEqualTo(DeviceTokenRegistry.AuthenticationResult.ACTIVATED);
        assertThat(registry.authenticates("mystream", previous)).isFalse();
        assertThat(registry.authenticates("mystream", replacement)).isTrue();
        assertThat(registry.authenticates("mystream", null)).isFalse();
    }

    @Test
    void persistsProfilesAndOnlyIncrementsRevisionForChangedSettings() throws Exception {
        DeviceTokenRegistry registry = registry();
        DeviceSettings settings = registry.updateSettings("mystream", 8, DeviceSettings.FrameSize.SVGA, 25, false);
        assertThat(settings.revision()).isEqualTo(1);
        assertThat(registry.updateSettings("mystream", 8, DeviceSettings.FrameSize.SVGA, 25, false)).isEqualTo(settings);
        String token = registry.issueToken("mystream");
        DeviceTokenRegistry restarted = registry();
        assertThat(restarted.settings("mystream")).isEqualTo(settings);
        assertThat(restarted.authenticateAndActivate("mystream", token)).isEqualTo(DeviceTokenRegistry.AuthenticationResult.ACTIVATED);
        assertThat(restarted.settings("not-provisioned")).isEqualTo(DeviceSettings.defaults());
    }

    @Test
    void pendingCredentialsExpireWithoutRevokingTheActiveCamera() throws Exception {
        Instant now = Instant.parse("2026-10-14T00:00:00Z");
        DeviceTokenRegistry registry = registry(Clock.fixed(now, ZoneOffset.UTC), 600);
        String active = registry.issueToken("mystream");
        registry.authenticateAndActivate("mystream", active);
        String pending = registry.issueToken("mystream");
        DeviceTokenRegistry expired = registry(Clock.fixed(now.plusSeconds(601), ZoneOffset.UTC));
        assertThat(expired.authenticateAndActivate("mystream", pending)).isEqualTo(DeviceTokenRegistry.AuthenticationResult.INVALID);
        assertThat(expired.authenticates("mystream", active)).isTrue();
        assertThat(Files.readString(path())).doesNotContain("pending-token-hash");
    }

    @Test
    void defaultPendingCredentialsSurviveDelayedRemoteInstallation() throws Exception {
        Instant now = Instant.parse("2026-10-14T00:00:00Z");
        DeviceTokenRegistry registry = registry(Clock.fixed(now, ZoneOffset.UTC));
        String pending = registry.issueToken("mystream");
        DeviceTokenRegistry installedLater = registry(Clock.fixed(now.plusSeconds(86400), ZoneOffset.UTC));
        assertThat(installedLater.authenticateAndActivate("mystream", pending)).isEqualTo(DeviceTokenRegistry.AuthenticationResult.ACTIVATED);
    }

    @Test
    void aNewPendingCredentialReplacesOnlyTheEarlierPendingOne() throws Exception {
        DeviceTokenRegistry registry = registry();
        String active = registry.issueToken("mystream");
        registry.authenticateAndActivate("mystream", active);
        String olderPending = registry.issueToken("mystream");
        String newest = registry.issueToken("mystream");
        assertThat(registry.authenticates("mystream", active)).isTrue();
        assertThat(registry.authenticateAndActivate("mystream", olderPending)).isEqualTo(DeviceTokenRegistry.AuthenticationResult.INVALID);
        assertThat(registry.authenticateAndActivate("mystream", newest)).isEqualTo(DeviceTokenRegistry.AuthenticationResult.ACTIVATED);
    }

    private DeviceTokenRegistry registry() throws Exception {
        return registry(Clock.systemUTC());
    }

    private DeviceTokenRegistry registry(Clock clock) throws Exception {
        return registry(clock, 0);
    }

    private DeviceTokenRegistry registry(Clock clock, long ttl) throws Exception {
        DeviceTokenRegistry registry = new DeviceTokenRegistry(clock);
        ReflectionTestUtils.setField(registry, "pendingTokenTtlSeconds", ttl);
        ReflectionTestUtils.setField(registry, "registryPath", path().toString());
        registry.load();
        return registry;
    }

    private Path path() {
        return directory.resolve("device-registry.properties");
    }
}
