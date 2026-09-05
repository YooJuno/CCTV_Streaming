package com.yoojuno.cctv.api.stream.dto;

import com.yoojuno.cctv.model.StreamInfo;

import java.util.List;

public record StreamsResponse(List<StreamInfo> streams) {
}
