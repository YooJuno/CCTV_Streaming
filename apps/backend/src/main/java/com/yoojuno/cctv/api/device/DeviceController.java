package com.yoojuno.cctv.api.device;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.device.DeviceIngestService;
import com.yoojuno.cctv.device.DeviceSettings;
import com.yoojuno.cctv.device.DeviceTokenRegistry;
import com.yoojuno.cctv.stream.StreamCatalogService;
import com.yoojuno.cctv.stream.StreamIds;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.URI;
import java.util.Collections;
import java.util.Comparator;

@RestController
@RequestMapping("/api/devices")
public class DeviceController {
    private final DeviceTokenRegistry registry;
    private final DeviceIngestService ingest;
    private final StreamCatalogService catalog;

    @Value("${devices.ingest-public-base-url:}")
    private String publicBaseUrl;

    public DeviceController(DeviceTokenRegistry registry, DeviceIngestService ingest, StreamCatalogService catalog) {
        this.registry = registry;
        this.ingest = ingest;
        this.catalog = catalog;
    }

    @GetMapping("/server-info")
    public ServerInfoResponse serverInfo(HttpServletRequest request, Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "unauthorized");
        }
        if (publicBaseUrl != null && !publicBaseUrl.isBlank()) {
            String configured = publicBaseUrl.trim().replaceAll("/+$", "");
            return usableBase(configured) ? new ServerInfoResponse(configured, false) : new ServerInfoResponse("", true);
        }
        if (!loopback(request.getServerName())) {
            String current = ServletUriComponentsBuilder.fromCurrentContextPath().build().toUriString();
            if (usableBase(current)) {
                return new ServerInfoResponse(current, false);
            }
        }
        try {
            var interfaces = NetworkInterface.getNetworkInterfaces();
            if (interfaces != null) {
                for (NetworkInterface network : Collections.list(interfaces).stream()
                        .sorted(Comparator.comparingInt(DeviceController::interfacePriority)).toList()) {
                    if (!network.isUp() || network.isLoopback() || network.isVirtual()) {
                        continue;
                    }
                    for (var address : Collections.list(network.getInetAddresses())) {
                        if (address instanceof Inet4Address && address.isSiteLocalAddress() && !address.isLoopbackAddress()) {
                            int port = request.getLocalPort() > 0 ? request.getLocalPort() : 8081;
                            String base = request.getScheme() + "://" + address.getHostAddress() + ":" + port + request.getContextPath();
                            return new ServerInfoResponse(base, false);
                        }
                    }
                }
            }
        } catch (SocketException ignored) {
            // The operator can supply a reachable public address when interface discovery is unavailable.
        }
        return new ServerInfoResponse("", true);
    }

    @PostMapping("/provision")
    public ProvisionResponse provision(@Valid @RequestBody ProvisionRequest request, Authentication authentication) {
        authorized(request.streamId(), authentication);
        try {
            String token = registry.issueToken(request.streamId());
            String base = publicBaseUrl == null || publicBaseUrl.isBlank()
                    ? ServletUriComponentsBuilder.fromCurrentContextPath().build().toUriString()
                    : publicBaseUrl.replaceAll("/+$", "");
            return new ProvisionResponse(request.streamId(), token, base + "/api/devices/" + request.streamId() + "/video");
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "device registry unavailable");
        }
    }

    @GetMapping("/{streamId}/settings")
    public DeviceSettings settings(@PathVariable String streamId, Authentication authentication) {
        authorized(streamId, authentication);
        return registry.settings(streamId);
    }

    @PutMapping("/{streamId}/settings")
    public DeviceSettings settings(@PathVariable String streamId, @Valid @RequestBody SettingsRequest request,
                                   Authentication authentication) {
        authorized(streamId, authentication);
        try {
            return registry.updateSettings(streamId, request.fps(), request.frameSize(), request.jpegQuality(), request.adaptive());
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "device registry unavailable");
        }
    }

    @GetMapping("/{streamId}/config")
    public DeviceSettings config(@PathVariable String streamId,
                                 @RequestHeader(value = "X-Device-Token", required = false) String token) {
        ingest.authenticate(streamId, token);
        return registry.settings(streamId);
    }

    @PostMapping(value = "/{streamId}/video", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public DeviceIngestService.IngestResult video(@PathVariable String streamId,
            @RequestHeader(value = "X-Device-Token", required = false) String token, HttpServletRequest request) throws IOException {
        return ingest.ingest(streamId, token, request.getInputStream());
    }

    private void authorized(String streamId, Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "unauthorized");
        }
        try {
            StreamIds.requireValid(streamId);
        } catch (IllegalStateException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid stream id");
        }
        if (catalog.all().stream().noneMatch(stream -> stream.id().equals(streamId))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "stream is not in the catalog");
        }
        if (!user.allowedStreams().contains("*") && !user.allowedStreams().contains(streamId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "stream access denied");
        }
    }

    public record ProvisionRequest(@NotBlank @Size(max = 64) String streamId) {
    }

    public record ProvisionResponse(String streamId, String deviceToken, String ingestUrl) {
        @Override
        public String toString() {
            return "ProvisionResponse[streamId=" + streamId + ", deviceToken=[REDACTED], ingestUrl=" + ingestUrl + "]";
        }
    }

    public record ServerInfoResponse(String serverUrl, boolean requiresConfiguration) {
    }

    public record SettingsRequest(@Min(1) @Max(12) int fps, @NotNull DeviceSettings.FrameSize frameSize,
                                  @Min(10) @Max(40) int jpegQuality, @NotNull Boolean adaptive) {
    }

    private static boolean usableBase(String base) {
        try {
            URI uri = URI.create(base);
            return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    && uri.getHost() != null && !loopback(uri.getHost()) && uri.getUserInfo() == null
                    && uri.getQuery() == null && uri.getFragment() == null;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static boolean loopback(String host) {
        if (host == null) {
            return true;
        }
        String normalized = host.toLowerCase(java.util.Locale.ROOT).replace("[", "").replace("]", "");
        return normalized.equals("localhost") || normalized.endsWith(".localhost") || normalized.equals("localhost.localdomain")
                || normalized.startsWith("127.") || normalized.equals("0.0.0.0") || normalized.equals("::")
                || normalized.equals("::1") || normalized.equals("0:0:0:0:0:0:0:1");
    }

    private static int interfacePriority(NetworkInterface network) {
        return network.getName().equals("en0") ? 0 : network.getName().startsWith("en") ? 1
                : network.getName().startsWith("eth") || network.getName().startsWith("wlan") ? 2 : 3;
    }
}
