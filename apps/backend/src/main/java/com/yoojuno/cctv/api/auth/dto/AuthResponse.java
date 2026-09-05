package com.yoojuno.cctv.api.auth.dto;

import com.yoojuno.cctv.model.StreamInfo;

import java.util.List;

public record AuthResponse(
        long expiresInSeconds,
        String username,
        String displayName,
        List<StreamInfo> streams
) {
}
