package com.yoojuno.cctv.controller;

import com.yoojuno.cctv.device.DeviceTokenRegistry;
import com.yoojuno.cctv.api.device.DeviceController;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterAll;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {
        "auth.jwt.secret=test-jwt-secret-should-be-32-bytes-minimum",
        "auth.users=viewer:{plain}viewer123:mystream",
        "streams.catalog=mystream:Entrance;forbidden:Restricted",
        "devices.ingest-public-base-url=https://camera.example/cctv"
})
@AutoConfigureMockMvc
class DeviceControllerTest {
    private static final Path DIRECTORY = createDirectory();

    @Autowired
    MockMvc mockMvc;
    @Autowired
    DeviceTokenRegistry registry;

    @Test
    void provisioningResponseLogsRedactTheDeviceCredential() {
        String output = new DeviceController.ProvisionResponse("mystream", "test-credential-sentinel", "https://camera.example/video").toString();
        assertThat(output).contains("[REDACTED]").doesNotContain("test-credential-sentinel");
    }

    @DynamicPropertySource
    static void registryPath(DynamicPropertyRegistry properties) {
        properties.add("devices.registry-path", () -> DIRECTORY.resolve("registry.properties").toString());
    }

    @AfterAll
    static void cleanup() throws IOException {
        try (var paths = Files.walk(DIRECTORY)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    @Test
    void requiresAuthenticationBeforeProvisioning() throws Exception {
        mockMvc.perform(post("/api/devices/provision").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"streamId\":\"mystream\"}"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/devices/server-info")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/live/mystream/status")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/live/mystream/stream.mjpeg")).andExpect(status().isUnauthorized());
    }

    @Test
    void usesTheConfiguredPublicBaseForInstallerDiscovery() throws Exception {
        mockMvc.perform(get("/api/devices/server-info").cookie(login()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.serverUrl").value("https://camera.example/cctv"))
                .andExpect(jsonPath("$.requiresConfiguration").value(false));
    }

    @Test
    void onlyProvisionsExistingAuthorizedStreams() throws Exception {
        Cookie cookie = login();
        for (String endpoint : new String[]{"status", "stream.mjpeg"}) {
            mockMvc.perform(get("/api/live/forbidden/" + endpoint).cookie(cookie)).andExpect(status().isForbidden());
            mockMvc.perform(get("/api/live/unlisted/" + endpoint).cookie(cookie)).andExpect(status().isNotFound());
        }
        mockMvc.perform(get("/api/live/mystream/status").cookie(cookie)).andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(false));
        mockMvc.perform(post("/api/devices/provision").cookie(cookie).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"streamId\":\"forbidden\"}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/devices/provision").cookie(cookie).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"streamId\":\"unlisted\"}"))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/devices/provision").cookie(cookie).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"streamId\":\"mystream\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.streamId").value("mystream"))
                .andExpect(jsonPath("$.deviceToken").isString())
                .andExpect(jsonPath("$.ingestUrl").value("https://camera.example/cctv/api/devices/mystream/video"));
    }

    @Test
    void validatesProfilesAndEnforcesStreamPermissions() throws Exception {
        Cookie cookie = login();
        mockMvc.perform(get("/api/devices/mystream/settings").cookie(cookie))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").isNumber());
        mockMvc.perform(put("/api/devices/forbidden/settings").cookie(cookie).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fps\":8,\"frameSize\":\"VGA\",\"jpegQuality\":20,\"adaptive\":true}"))
                .andExpect(status().isForbidden());
        for (String invalid : new String[]{
                "{\"fps\":13,\"frameSize\":\"VGA\",\"jpegQuality\":20,\"adaptive\":true}",
                "{\"fps\":6,\"frameSize\":\"INVALID\",\"jpegQuality\":20,\"adaptive\":true}",
                "{\"fps\":6,\"frameSize\":\"VGA\",\"jpegQuality\":9,\"adaptive\":true}",
                "{\"fps\":6,\"frameSize\":\"VGA\",\"jpegQuality\":20}"}) {
            mockMvc.perform(put("/api/devices/mystream/settings").cookie(cookie).contentType(MediaType.APPLICATION_JSON).content(invalid))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isString());
        }
    }

    @Test
    void deviceTokensReadTheirOwnProfileAndCannotReadAnotherStream() throws Exception {
        String token = registry.issueToken("mystream");
        mockMvc.perform(put("/api/devices/mystream/settings").cookie(login()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fps\":8,\"frameSize\":\"SVGA\",\"jpegQuality\":25,\"adaptive\":false}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.fps").value(8));
        mockMvc.perform(get("/api/devices/mystream/config").header("X-Device-Token", token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.fps").value(8))
                .andExpect(jsonPath("$.frameSize").value("SVGA")).andExpect(jsonPath("$.revision").isNumber());
        mockMvc.perform(get("/api/devices/forbidden/config").header("X-Device-Token", token))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/devices/mystream/config")).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/devices/mystream/video").contentType(MediaType.APPLICATION_OCTET_STREAM)
                        .content(new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xd9}))
                .andExpect(status().isUnauthorized());
    }

    private Cookie login() throws Exception {
        return mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("CCTV_AUTH");
    }

    private static Path createDirectory() {
        try {
            return Files.createTempDirectory("device-controller-test-");
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
