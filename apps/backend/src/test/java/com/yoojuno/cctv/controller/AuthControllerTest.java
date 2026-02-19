package com.yoojuno.cctv.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "auth.jwt.secret=test-jwt-secret-should-be-32-bytes-minimum",
        "auth.users=admin:{plain}admin123:*;viewer:{plain}viewer123:mystream"
})
@AutoConfigureMockMvc
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void loginSetsAuthCookieAndReturnsAllowedStreams() throws Exception {
        String body = """
                {
                  "username": "admin",
                  "password": "admin123"
                }
                """;

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("CCTV_AUTH=")))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("HttpOnly")))
                .andExpect(jsonPath("$.username").value("admin"))
                .andExpect(jsonPath("$.streams").isArray());
    }

    @Test
    void streamsRequiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/streams"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void streamsReturnsAuthorizedListWithAuthCookie() throws Exception {
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

        mockMvc.perform(get("/api/streams")
                        .cookie(authCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.streams").isArray());
    }

    @Test
    void streamHealthReturnsLiveMetadataWithAuthCookie() throws Exception {
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

        mockMvc.perform(get("/api/streams/health")
                        .cookie(authCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.streams").isArray())
                .andExpect(jsonPath("$.streams[0].state").isString())
                .andExpect(jsonPath("$.streams[0].reason").isString())
                .andExpect(jsonPath("$.liveThresholdSeconds").isNumber())
                .andExpect(jsonPath("$.recommendedPollMs").isNumber())
                .andExpect(jsonPath("$.generatedAtEpochMs").isNumber());
    }

    @Test
    void logoutClearsAuthCookie() throws Exception {
        mockMvc.perform(post("/api/auth/logout"))
                .andExpect(status().isOk())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("CCTV_AUTH=")))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
    }
}
