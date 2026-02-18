package com.yoojuno.cctv.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class StreamPathParsingTest {

    @Test
    void parsesManifestAndSegmentNames() {
        assertThat(StreamAccessFilter.extractStreamId("/hls/mystream.m3u8")).isEqualTo("mystream");
        assertThat(StreamAccessFilter.extractStreamId("/hls/mystream_00012.ts")).isEqualTo("mystream");
        assertThat(StreamAccessFilter.extractStreamId("/hls/sub/path/camera-a_00123.m4s")).isEqualTo("camera-a");
    }
}
