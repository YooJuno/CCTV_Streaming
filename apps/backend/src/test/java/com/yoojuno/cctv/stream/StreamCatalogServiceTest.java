package com.yoojuno.cctv.stream;

import com.yoojuno.cctv.model.StreamInfo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class StreamCatalogServiceTest {
    @ParameterizedTest
    @ValueSource(strings = {"cam/one", "../secret", "카메라", ".camera", "cam space", ":Empty"})
    void refusesStreamIdsThatCannotBeAuthorizedAsHlsFilenames(String streamId) {
        StreamCatalogService service = new StreamCatalogService();
        ReflectionTestUtils.setField(service, "streamCatalogRaw", streamId);
        assertThatThrownBy(service::load).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void acceptsSafeFilenamePrefixesAndPreservesNames() {
        StreamCatalogService service = new StreamCatalogService();
        ReflectionTestUtils.setField(service, "streamCatalogRaw", "cam_01:Entrance;cam-02.v1:Lobby");
        service.load();
        assertThat(service.all()).containsExactly(new StreamInfo("cam_01", "Entrance"), new StreamInfo("cam-02.v1", "Lobby"));
    }
}
