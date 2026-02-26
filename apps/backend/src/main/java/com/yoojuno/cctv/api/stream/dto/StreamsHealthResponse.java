package com.yoojuno.cctv.api.stream.dto;

import com.yoojuno.cctv.stream.StreamHealthService;

import java.util.List;

public record StreamsHealthResponse(
        List<StreamHealthService.StreamHealth> streams,
        long liveThresholdSeconds,
        long recommendedPollMs,
        long generatedAtEpochMs
) {
}
