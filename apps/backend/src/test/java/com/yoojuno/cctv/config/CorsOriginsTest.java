package com.yoojuno.cctv.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CorsOriginsTest {
    @ParameterizedTest
    @ValueSource(strings = {"*", "https://*", "http://*", "https://*.example.com", "https://camera.example:[*]", " "})
    void rejectsWildcardAndEmptyCredentialedOrigins(String origin) {
        assertThatThrownBy(() -> CorsOrigins.validate("api.allowed-origins", new String[]{origin}))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void keepsExplicitOriginsAndTrimsWhitespace() {
        assertThat(CorsOrigins.validate("hls.allowed-origins", new String[]{" https://camera.example ", ""}))
                .containsExactly("https://camera.example");
    }
}
