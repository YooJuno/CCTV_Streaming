package com.yoojuno.cctv.api.system.dto;

import java.util.Map;

public record StreamHealthSummaryResponse(
        int total,
        int live,
        int starting,
        int stale,
        int offline,
        int error,
        Map<String, Long> reasons
) {
}
