package com.yoojuno.cctv.api.system;

import com.yoojuno.cctv.api.system.dto.HlsStorageStatusResponse;
import com.yoojuno.cctv.api.system.dto.StreamHealthSummaryResponse;
import com.yoojuno.cctv.api.system.dto.SystemHealthResponse;
import com.yoojuno.cctv.domain.system.SystemHealthQueryService;
import org.springframework.stereotype.Component;

@Component
public class SystemHealthApiMapper {
    public SystemHealthResponse toResponse(SystemHealthQueryService.SystemHealthSnapshot snapshot) {
        return new SystemHealthResponse(
                snapshot.generatedAtEpochMs(),
                snapshot.username(),
                toHlsStorageStatusResponse(snapshot.hlsStorage()),
                toStreamHealthSummaryResponse(snapshot.streams()),
                snapshot.streamDetails(),
                snapshot.recommendations()
        );
    }

    private static HlsStorageStatusResponse toHlsStorageStatusResponse(SystemHealthQueryService.HlsStorageStatus status) {
        return new HlsStorageStatusResponse(
                status.path(),
                status.exists(),
                status.readable(),
                status.writable(),
                status.manifestCount(),
                status.segmentCount()
        );
    }

    private static StreamHealthSummaryResponse toStreamHealthSummaryResponse(SystemHealthQueryService.StreamHealthSummary summary) {
        return new StreamHealthSummaryResponse(
                summary.total(),
                summary.live(),
                summary.starting(),
                summary.stale(),
                summary.offline(),
                summary.error(),
                summary.reasons()
        );
    }
}
