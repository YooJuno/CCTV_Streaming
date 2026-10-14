package com.yoojuno.cctv.device;

import com.yoojuno.cctv.stream.StreamIds;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;

/** Stores token digests and camera profiles; plaintext credentials are returned only when issued. */
@Service
public class DeviceTokenRegistry {
    @Value("${devices.registry-path:./device-registry.properties}")
    private String registryPath;

    @Value("${devices.pending-token-ttl-seconds:0}")
    private long pendingTokenTtlSeconds;

    private final SecureRandom random = new SecureRandom();
    private final Clock clock;
    private final Map<String, DeviceRecord> devices = new LinkedHashMap<>();
    private Path path;

    public DeviceTokenRegistry() {
        this(Clock.systemUTC());
    }

    DeviceTokenRegistry(Clock clock) {
        this.clock = clock;
    }

    @PostConstruct
    public synchronized void load() throws IOException {
        if (pendingTokenTtlSeconds < 0) {
            throw new IllegalStateException("Device pending token TTL must be zero or positive.");
        }
        path = Path.of(registryPath).toAbsolutePath().normalize();
        devices.clear();
        if (!Files.exists(path)) {
            return;
        }
        securePermissions(path);
        Properties stored = new Properties();
        try (var input = Files.newInputStream(path)) {
            stored.load(input);
        }
        Set<String> streamIds = new TreeSet<>();
        for (String key : stored.stringPropertyNames()) {
            if (!key.startsWith("device.") || key.lastIndexOf('.') <= "device.".length()) {
                throw new IOException("Invalid device registry entry.");
            }
            streamIds.add(key.substring("device.".length(), key.lastIndexOf('.')));
        }
        try {
            for (String streamId : streamIds) {
                StreamIds.requireValid(streamId);
                String prefix = "device." + streamId + ".";
                String hash = stored.getProperty(prefix + "token-hash");
                String pendingHash = stored.getProperty(prefix + "pending-token-hash");
                long pendingExpiresAt = Long.parseLong(stored.getProperty(prefix + "pending-expiry-epoch-ms", "0"));
                if ((hash != null && !hash.matches("[a-f0-9]{64}"))
                        || (pendingHash != null && (!pendingHash.matches("[a-f0-9]{64}") || pendingExpiresAt < 0))) {
                    throw new IllegalArgumentException("Invalid token digest.");
                }
                DeviceSettings defaults = DeviceSettings.defaults();
                int fps = Integer.parseInt(stored.getProperty(prefix + "fps", Integer.toString(defaults.fps())));
                int quality = Integer.parseInt(stored.getProperty(prefix + "jpegQuality", Integer.toString(defaults.jpegQuality())));
                long revision = Long.parseLong(stored.getProperty(prefix + "revision", "0"));
                String adaptive = stored.getProperty(prefix + "adaptive", "true");
                if (fps < 1 || fps > 12 || quality < 10 || quality > 40 || revision < 0
                        || !(adaptive.equals("true") || adaptive.equals("false"))) {
                    throw new IllegalArgumentException("Invalid camera profile.");
                }
                DeviceSettings settings = new DeviceSettings(fps,
                        DeviceSettings.FrameSize.valueOf(stored.getProperty(prefix + "frameSize", defaults.frameSize().name())),
                        quality, Boolean.parseBoolean(adaptive), revision);
                devices.put(streamId, new DeviceRecord(hash, pendingHash, pendingExpiresAt, settings));
            }
        } catch (IllegalArgumentException | IllegalStateException exception) {
            // Do not include registry contents or token digests in the startup exception.
            throw new IOException("Invalid device registry configuration.");
        }
    }

    public synchronized String issueToken(String streamId) throws IOException {
        StreamIds.requireValid(streamId);
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = HexFormat.of().formatHex(bytes);
        DeviceRecord existing = devices.get(streamId);
        Map<String, DeviceRecord> updated = new LinkedHashMap<>(devices);
        updated.put(streamId, new DeviceRecord(existing == null ? null : existing.tokenHash(), digest(token),
                pendingTokenTtlSeconds == 0 ? 0 : clock.instant().plusSeconds(pendingTokenTtlSeconds).toEpochMilli(), settings(streamId)));
        persist(updated);
        return token;
    }

    public synchronized boolean authenticates(String streamId, String token) {
        DeviceRecord device = devices.get(streamId);
        return device != null && matches(device.tokenHash(), token);
    }

    public synchronized AuthenticationResult authenticateAndActivate(String streamId, String token) throws IOException {
        DeviceRecord device = devices.get(streamId);
        if (device == null) {
            return AuthenticationResult.INVALID;
        }
        if (device.pendingTokenHash() != null && device.pendingExpiresAtMillis() > 0 && clock.millis() >= device.pendingExpiresAtMillis()) {
            Map<String, DeviceRecord> updated = new LinkedHashMap<>(devices);
            device = new DeviceRecord(device.tokenHash(), null, 0, device.settings());
            updated.put(streamId, device);
            persist(updated);
        }
        if (matches(device.tokenHash(), token)) {
            return AuthenticationResult.ACTIVE;
        }
        if (!matches(device.pendingTokenHash(), token)) {
            return AuthenticationResult.INVALID;
        }
        Map<String, DeviceRecord> updated = new LinkedHashMap<>(devices);
        updated.put(streamId, new DeviceRecord(device.pendingTokenHash(), null, 0, device.settings()));
        persist(updated);
        return AuthenticationResult.ACTIVATED;
    }

    public synchronized DeviceSettings settings(String streamId) {
        DeviceRecord device = devices.get(streamId);
        return device == null ? DeviceSettings.defaults() : device.settings();
    }

    public synchronized DeviceSettings updateSettings(String streamId, int fps, DeviceSettings.FrameSize frameSize,
                                                      int quality, boolean adaptive) throws IOException {
        StreamIds.requireValid(streamId);
        if (fps < 1 || fps > 12 || quality < 10 || quality > 40 || frameSize == null) {
            throw new IllegalArgumentException("Invalid camera profile.");
        }
        DeviceSettings current = settings(streamId);
        if (current.fps() == fps && current.frameSize() == frameSize && current.jpegQuality() == quality
                && current.adaptive() == adaptive) {
            return current;
        }
        DeviceSettings updatedSettings = new DeviceSettings(fps, frameSize, quality, adaptive, Math.addExact(current.revision(), 1));
        DeviceRecord existing = devices.get(streamId);
        Map<String, DeviceRecord> updated = new LinkedHashMap<>(devices);
        updated.put(streamId, new DeviceRecord(existing == null ? null : existing.tokenHash(),
                existing == null ? null : existing.pendingTokenHash(), existing == null ? 0 : existing.pendingExpiresAtMillis(), updatedSettings));
        persist(updated);
        return updatedSettings;
    }

    private void persist(Map<String, DeviceRecord> updated) throws IOException {
        Files.createDirectories(path.getParent());
        Path temporary = Files.createTempFile(path.getParent(), ".device-registry-", ".tmp");
        try {
            securePermissions(temporary);
            Properties stored = new Properties();
            for (var entry : updated.entrySet()) {
                String prefix = "device." + entry.getKey() + ".";
                DeviceRecord device = entry.getValue();
                if (device.tokenHash() != null) {
                    stored.setProperty(prefix + "token-hash", device.tokenHash());
                }
                if (device.pendingTokenHash() != null) {
                    stored.setProperty(prefix + "pending-token-hash", device.pendingTokenHash());
                    stored.setProperty(prefix + "pending-expiry-epoch-ms", Long.toString(device.pendingExpiresAtMillis()));
                }
                DeviceSettings settings = device.settings();
                stored.setProperty(prefix + "fps", Integer.toString(settings.fps()));
                stored.setProperty(prefix + "frameSize", settings.frameSize().name());
                stored.setProperty(prefix + "jpegQuality", Integer.toString(settings.jpegQuality()));
                stored.setProperty(prefix + "adaptive", Boolean.toString(settings.adaptive()));
                stored.setProperty(prefix + "revision", Long.toString(settings.revision()));
            }
            try (var output = Files.newOutputStream(temporary)) {
                stored.store(output, "CCTV device registry: token digests and camera settings");
            }
            try {
                Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException exception) {
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
            }
            devices.clear();
            devices.putAll(updated);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static void securePermissions(Path path) throws IOException {
        if (Files.getFileStore(path).supportsFileAttributeView("posix")) {
            Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
        } else {
            var file = path.toFile();
            if (!file.setReadable(false, false) || !file.setWritable(false, false)
                    || !file.setReadable(true, true) || !file.setWritable(true, true)) {
                throw new IOException("Cannot protect device registry permissions.");
            }
        }
    }

    private static String digest(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable.");
        }
    }

    private static boolean matches(String hash, String token) {
        return hash != null && token != null && !token.isBlank() && token.length() <= 128
                && MessageDigest.isEqual(HexFormat.of().parseHex(hash), HexFormat.of().parseHex(digest(token)));
    }

    public enum AuthenticationResult {
        ACTIVE, ACTIVATED, INVALID
    }

    private record DeviceRecord(String tokenHash, String pendingTokenHash, long pendingExpiresAtMillis, DeviceSettings settings) {
    }
}
