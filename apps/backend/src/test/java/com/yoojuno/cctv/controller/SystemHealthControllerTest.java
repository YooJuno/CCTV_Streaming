package com.yoojuno.cctv.controller;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "auth.jwt.secret=test-jwt-secret-should-be-32-bytes-minimum",
        "auth.users=admin:{plain}admin123:*;viewer:{plain}viewer123:mystream"
})
@AutoConfigureMockMvc
class SystemHealthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void requiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/system/health"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void returnsAggregatedHealth() throws Exception {
        Cookie authCookie = login("admin", "admin123");

        mockMvc.perform(get("/api/system/health")
                        .cookie(authCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.generatedAtEpochMs").isNumber())
                .andExpect(jsonPath("$.username").value("admin"))
                .andExpect(jsonPath("$.hlsStorage.path").isString())
                .andExpect(jsonPath("$.hlsStorage.exists").isBoolean())
                .andExpect(jsonPath("$.streams.total").isNumber())
                .andExpect(jsonPath("$.streams.reasons").isMap())
                .andExpect(jsonPath("$.streamDetails").isArray())
                .andExpect(jsonPath("$.recommendations").isArray());
    }

    private Cookie login(String username, String password) throws Exception {
        String body = """
                {
                  "username": "%s",
                  "password": "%s"
                }
                """.formatted(username, password);

        MvcResult loginResult = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn();

        Cookie authCookie = loginResult.getResponse().getCookie("CCTV_AUTH");
        assertThat(authCookie).isNotNull();
        return authCookie;
    }
}
