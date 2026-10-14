package com.yoojuno.cctv.auth;

import java.util.Set;
import java.time.Instant;

public record AuthenticatedUser(
        String username,
        String displayName,
        Set<String> allowedStreams,
        Instant expiresAt
) {
    public AuthenticatedUser(String username, String displayName, Set<String> allowedStreams) {
        this(username, displayName, allowedStreams, null);
    }
}
