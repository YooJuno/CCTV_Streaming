package com.yoojuno.cctv.api.system.dto;

public record HlsStorageStatusResponse(
        String path,
        boolean exists,
        boolean readable,
        boolean writable,
        long manifestCount,
        long segmentCount
) {
}
