package com.yoojuno.cctv.api.stream;

import com.yoojuno.cctv.api.stream.dto.StreamsHealthResponse;
import com.yoojuno.cctv.api.stream.dto.StreamsResponse;
import com.yoojuno.cctv.domain.stream.StreamQueryService;
import com.yoojuno.cctv.model.StreamInfo;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class StreamApiMapper {
    public StreamsResponse toStreamsResponse(List<StreamInfo> streams) {
        return new StreamsResponse(streams);
    }

    public StreamsHealthResponse toStreamsHealthResponse(StreamQueryService.StreamHealthSnapshot snapshot) {
        return new StreamsHealthResponse(
                snapshot.streams(),
                snapshot.liveThresholdSeconds(),
                snapshot.recommendedPollMs(),
                snapshot.generatedAtEpochMs()
        );
    }
}
