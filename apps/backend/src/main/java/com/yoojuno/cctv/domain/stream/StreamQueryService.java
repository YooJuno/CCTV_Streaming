package com.yoojuno.cctv.domain.stream;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.model.StreamInfo;
import com.yoojuno.cctv.stream.StreamCatalogService;
import com.yoojuno.cctv.stream.StreamHealthService;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

@Service
public class StreamQueryService {
    private final StreamCatalogService streamCatalogService;
    private final StreamHealthService streamHealthService;

    public StreamQueryService(StreamCatalogService streamCatalogService, StreamHealthService streamHealthService) {
        this.streamCatalogService = streamCatalogService;
        this.streamHealthService = streamHealthService;
    }

    public List<StreamInfo> authorizedStreams(AuthenticatedUser user) {
        return streamCatalogService.forAllowedStreamIds(user.allowedStreams());
    }

    public StreamHealthSnapshot streamHealthSnapshot(AuthenticatedUser user) {
        List<StreamInfo> streams = authorizedStreams(user);
        List<StreamHealthService.StreamHealth> health = streamHealthService.healthForStreams(streams);
        return new StreamHealthSnapshot(
                health,
                streamHealthService.liveThresholdSeconds(),
                streamHealthService.recommendedPollMs(),
                Instant.now().toEpochMilli()
        );
    }

    public record StreamHealthSnapshot(
            List<StreamHealthService.StreamHealth> streams,
            long liveThresholdSeconds,
            long recommendedPollMs,
            long generatedAtEpochMs
    ) {
    }
}
