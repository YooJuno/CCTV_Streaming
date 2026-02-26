package com.yoojuno.cctv.api.system.dto;

import com.yoojuno.cctv.stream.StreamHealthService;

import java.util.List;

public record SystemHealthResponse(
        long generatedAtEpochMs,
        String username,
        HlsStorageStatusResponse hlsStorage,
        StreamHealthSummaryResponse streams,
        List<StreamHealthService.StreamHealth> streamDetails,
        List<String> recommendations
) {
}
