package com.yoojuno.cctv.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class StreamPathParsingTest {

    @Test
    void parsesManifestAndSegmentNames() {
        assertThat(StreamAccessFilter.extractStreamId("/hls/mystream.m3u8")).isEqualTo("mystream");
        assertThat(StreamAccessFilter.extractStreamId("/hls/mystream_00012.ts")).isEqualTo("mystream_00012");
        assertThat(StreamAccessFilter.extractStreamId("/hls/sub/path/camera-a_00123.m4s")).isEqualTo("camera-a_00123");
        assertThat(StreamAccessFilter.extractStreamId("/hls/cam_01.m3u8")).isEqualTo("cam_01");
    }
}
