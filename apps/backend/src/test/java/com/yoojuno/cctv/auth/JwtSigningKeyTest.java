package com.yoojuno.cctv.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtSigningKeyTest {

    @Test
    void rejectsSecretsShorterThanTheHs256Minimum() {
        // Padding a short secret up to 32 bytes would keep its original entropy while
        // making the key look strong, so startup must fail loudly instead.
        assertThatThrownBy(() -> JwtService.createSigningKey("short-secret"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("too short");
    }

    @Test
    void acceptsSecretsAtOrAboveTheMinimum() {
        assertThat(JwtService.createSigningKey("a-sufficiently-long-development-secret")).isNotNull();
    }

    @Test
    void acceptsBase64EncodedSecrets() {
        String base64 = java.util.Base64.getEncoder().encodeToString(new byte[48]);
        assertThat(JwtService.createSigningKey(base64)).isNotNull();
    }
}
