package com.yoojuno.cctv.auth;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
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
    @Value("${auth.users:admin:admin123:*}")
    private String usersRaw;

    private final Map<String, UserRecord> users = new LinkedHashMap<>();

    @PostConstruct
    public void load() {
        users.clear();
        if (usersRaw == null || usersRaw.isBlank()) {
            users.put("admin", new UserRecord("admin", "admin", "admin123", Set.of("*")));
            return;
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
            String password = parts[1].trim();
            String streamsRaw = parts[2].trim();

            if (username.isBlank() || password.isBlank() || streamsRaw.isBlank()) {
                continue;
            }

            Set<String> streams = parseStreams(streamsRaw);
            users.put(username, new UserRecord(username, username, password, streams));
        }

        if (users.isEmpty()) {
            users.put("admin", new UserRecord("admin", "admin", "admin123", Set.of("*")));
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
        if (!user.password().equals(password)) {
            return Optional.empty();
        }
        return Optional.of(user.toAuthenticatedUser());
    }

    public Optional<AuthenticatedUser> findByUsername(String username) {
        if (username == null) {
            return Optional.empty();
        }
        UserRecord user = users.get(username.trim());
        if (user == null) {
            return Optional.empty();
        }
        return Optional.of(user.toAuthenticatedUser());
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

    private record UserRecord(String username, String displayName, String password, Set<String> streams) {
        private AuthenticatedUser toAuthenticatedUser() {
            return new AuthenticatedUser(username, displayName, Set.copyOf(streams));
        }
    }
}
