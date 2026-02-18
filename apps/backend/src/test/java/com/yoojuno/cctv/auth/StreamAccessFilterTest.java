package com.yoojuno.cctv.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class StreamAccessFilterTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void deniesStreamThatIsNotInUserPermissionList() throws Exception {
        String body = """
                {
                  "username": "viewer",
                  "password": "viewer123"
                }
                """;

        MvcResult loginResult = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn();

        jakarta.servlet.http.Cookie authCookie = loginResult.getResponse().getCookie("CCTV_AUTH");
        org.assertj.core.api.Assertions.assertThat(authCookie).isNotNull();

        mockMvc.perform(get("/hls/forbidden-stream.m3u8")
                        .cookie(authCookie))
                .andExpect(status().isForbidden());
    }
}
