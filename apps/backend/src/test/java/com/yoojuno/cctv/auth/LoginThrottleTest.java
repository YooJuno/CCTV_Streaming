package com.yoojuno.cctv.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "auth.jwt.secret=test-jwt-secret-should-be-32-bytes-minimum",
        "auth.users=admin:{plain}admin123:*;viewer:{plain}viewer123:mystream",
        "auth.login.max-attempts=3",
        "auth.login.lockout-seconds=300"
})
@AutoConfigureMockMvc
class LoginThrottleTest {

    private static final String WRONG_PASSWORD = """
            {
              "username": "throttled-user",
              "password": "wrong-password"
            }
            """;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void blocksFurtherAttemptsAfterRepeatedFailures() throws Exception {
        for (int attempt = 0; attempt < 3; attempt++) {
            mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(WRONG_PASSWORD))
                    .andExpect(status().isUnauthorized());
        }

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(WRONG_PASSWORD))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"));
    }
}
