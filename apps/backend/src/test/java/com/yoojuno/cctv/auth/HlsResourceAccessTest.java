package com.yoojuno.cctv.auth;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "auth.jwt.secret=test-jwt-secret-should-be-32-bytes-minimum",
        "auth.users=viewer:{plain}viewer123:mystream"
})
@AutoConfigureMockMvc
class HlsResourceAccessTest {
    private static final Path HLS_DIRECTORY = createDirectory();
    private static final String MANIFEST = "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nmystream_00001.ts\n";

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void hlsPath(DynamicPropertyRegistry registry) {
        registry.add("hls.path", HLS_DIRECTORY::toString);
    }

    @BeforeAll
    static void publishFiles() throws IOException {
        Files.writeString(HLS_DIRECTORY.resolve("mystream.m3u8"), MANIFEST);
        Files.writeString(HLS_DIRECTORY.resolve("forbidden-stream.m3u8"), MANIFEST);
        Files.write(HLS_DIRECTORY.resolve("mystream_00001.ts"), new byte[]{1, 2, 3});
    }

    @AfterAll
    static void removeFiles() throws IOException {
        try (var paths = Files.walk(HLS_DIRECTORY)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    @Test
    void servesAuthorizedManifestAndSegmentFiles() throws Exception {
        Cookie cookie = login();
        mockMvc.perform(get("/hls/mystream.m3u8").cookie(cookie))
                .andExpect(status().isOk()).andExpect(content().string(MANIFEST));
        mockMvc.perform(get("/hls/mystream_00001.ts").cookie(cookie))
                .andExpect(status().isOk()).andExpect(content().bytes(new byte[]{1, 2, 3}));
    }

    @Test
    void servesAuthorizedFilesWithAContextPath() throws Exception {
        mockMvc.perform(get("/cctv/hls/mystream.m3u8").contextPath("/cctv").cookie(login()))
                .andExpect(status().isOk()).andExpect(content().string(MANIFEST));
    }

    @Test
    void deniesExistingFilesOutsideTheUsersStreamPermissions() throws Exception {
        mockMvc.perform(get("/cctv/hls/forbidden-stream.m3u8").contextPath("/cctv").cookie(login()))
                .andExpect(status().isForbidden());
    }

    @Test
    void requiresAuthenticationForExistingManifestFiles() throws Exception {
        mockMvc.perform(get("/hls/mystream.m3u8")).andExpect(status().isUnauthorized());
    }

    @Test
    void allowsAnExplicitCredentialedPreflightWithoutAnAuthCookie() throws Exception {
        mockMvc.perform(options("/hls/mystream.m3u8")
                        .header("Origin", "http://localhost:5174")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5174"))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
    }

    private Cookie login() throws Exception {
        return mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("CCTV_AUTH");
    }

    private static Path createDirectory() {
        try {
            return Files.createTempDirectory("cctv-hls-test-");
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
