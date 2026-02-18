package com.yoojuno.cctv.auth;

import java.util.Set;

public record AuthenticatedUser(
        String username,
        String displayName,
        Set<String> allowedStreams
) {
}
