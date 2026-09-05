package com.yoojuno.cctv.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class StreamPathParsingTest {

    @Test
    void resolvesOwningStreamForManifestAndSegments() {
        assertThat(StreamAccessFilter.extractStreamId("/hls/mystream.m3u8")).isEqualTo("mystream");
        assertThat(StreamAccessFilter.extractStreamId("/hls/mystream_00012.ts")).isEqualTo("mystream");
        assertThat(StreamAccessFilter.extractStreamId("/hls/camera-a_00123.m4s")).isEqualTo("camera-a");
        assertThat(StreamAccessFilter.extractStreamId("/hls/cam_01.m3u8")).isEqualTo("cam_01");
        assertThat(StreamAccessFilter.extractStreamId("/hls/cam_01_00007.ts")).isEqualTo("cam_01");
    }

    @Test
    void rejectsNestedPathsSoAuthorizationCoversTheWholePath() {
        // Previously only the last path segment was inspected, so a user allowed on "mystream"
        // could reach any nested file that happened to be named mystream.m3u8.
        assertThat(StreamAccessFilter.extractStreamId("/hls/private/mystream.m3u8")).isNull();
        assertThat(StreamAccessFilter.extractStreamId("/hls/sub/path/camera-a_00123.m4s")).isNull();
    }

    @Test
    void rejectsUnexpectedFileNames() {
        assertThat(StreamAccessFilter.extractStreamId("/hls/")).isNull();
        assertThat(StreamAccessFilter.extractStreamId("/hls/mystream")).isNull();
        assertThat(StreamAccessFilter.extractStreamId("/hls/application.properties")).isNull();
        assertThat(StreamAccessFilter.extractStreamId("/hls/.env")).isNull();
        assertThat(StreamAccessFilter.extractStreamId("/api/streams")).isNull();
    }
}
