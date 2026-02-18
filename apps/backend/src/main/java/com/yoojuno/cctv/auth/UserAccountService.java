package com.yoojuno.cctv.auth;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Service
public class UserAccountService {
    private static final Logger log = LoggerFactory.getLogger(UserAccountService.class);

    @Value("${auth.users:}")
    private String usersRaw;

    private final PasswordEncoder passwordEncoder;
    private final Map<String, UserRecord> users = new LinkedHashMap<>();

    public UserAccountService(PasswordEncoder passwordEncoder) {
        this.passwordEncoder = passwordEncoder;
    }

    @PostConstruct
    public void load() {
        users.clear();
        if (usersRaw == null || usersRaw.isBlank()) {
            throw new IllegalStateException("auth.users is empty. Configure AUTH_USERS with hashed credentials.");
        }

        String[] entries = usersRaw.split(";");
        for (String entry : entries) {
            if (entry == null || entry.isBlank()) {
                continue;
            }

            String[] parts = entry.split(":", 3);
            if (parts.length < 3) {
                continue;
            }

            String username = parts[0].trim();
            String passwordSpec = parts[1].trim();
            String streamsRaw = parts[2].trim();

            if (username.isBlank() || passwordSpec.isBlank() || streamsRaw.isBlank()) {
                continue;
            }

            Set<String> streams = parseStreams(streamsRaw);
            if (isLegacyPlaintext(passwordSpec)) {
                log.warn("User '{}' is configured with plain password. Use {bcrypt}<hash> format.", username);
            }
            users.put(username, new UserRecord(username, username, passwordSpec, streams));
        }

        if (users.isEmpty()) {
            throw new IllegalStateException("No valid users parsed from auth.users.");
        }
    }

    public Optional<AuthenticatedUser> authenticate(String username, String password) {
        if (username == null || password == null) {
            return Optional.empty();
        }
        UserRecord user = users.get(username.trim());
        if (user == null) {
            return Optional.empty();
        }
        if (!user.matches(password, passwordEncoder)) {
            return Optional.empty();
        }
        return Optional.of(user.toAuthenticatedUser());
    }

    private static boolean isLegacyPlaintext(String passwordSpec) {
        return !passwordSpec.startsWith("{plain}")
                && !passwordSpec.startsWith("{bcrypt}")
                && !passwordSpec.startsWith("$2a$")
                && !passwordSpec.startsWith("$2b$")
                && !passwordSpec.startsWith("$2y$");
    }

    private static Set<String> parseStreams(String raw) {
        if (raw == null || raw.isBlank()) {
            return Collections.emptySet();
        }
        Set<String> values = new LinkedHashSet<>();
        Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isBlank())
                .forEach(values::add);
        return values;
    }

    private record UserRecord(String username, String displayName, String passwordSpec, Set<String> streams) {
        private boolean matches(String rawPassword, PasswordEncoder passwordEncoder) {
            if (passwordSpec.startsWith("{plain}")) {
                return passwordSpec.substring("{plain}".length()).equals(rawPassword);
            }
            if (passwordSpec.startsWith("{bcrypt}")) {
                return passwordEncoder.matches(rawPassword, passwordSpec.substring("{bcrypt}".length()));
            }
            if (passwordSpec.startsWith("$2a$") || passwordSpec.startsWith("$2b$") || passwordSpec.startsWith("$2y$")) {
                return passwordEncoder.matches(rawPassword, passwordSpec);
            }
            return passwordSpec.equals(rawPassword);
        }

        private AuthenticatedUser toAuthenticatedUser() {
            return new AuthenticatedUser(username, displayName, Set.copyOf(streams));
        }
    }
}
