package com.yoojuno.cctv.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class StreamAccessFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(StreamAccessFilter.class);
    private static final String HLS_PREFIX = "/hls/";

    /**
     * Files the converter publishes: {@code <streamId>.m3u8} for the manifest and
     * {@code <streamId>_<index>.<ext>} for segments. Stream ids are restricted to a safe
     * character set so no path separator or traversal sequence can reach the resource handler.
     */
    private static final Pattern MANIFEST_NAME = Pattern.compile("^([A-Za-z0-9][A-Za-z0-9._-]*)\\.m3u8$");
    private static final Pattern SEGMENT_NAME =
            Pattern.compile("^([A-Za-z0-9][A-Za-z0-9._-]*?)_\\d+\\.(?:ts|m4s|mp4|aac|vtt)$");

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String path = request.getRequestURI();
        if (path == null || !path.startsWith(HLS_PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }

        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            writeJsonError(response, HttpServletResponse.SC_UNAUTHORIZED, "unauthorized");
            return;
        }

        String streamId = extractStreamId(path);
        if (streamId == null) {
            log.warn("Rejected malformed HLS path. user={}, path={}", user.username(), path);
            writeJsonError(response, HttpServletResponse.SC_FORBIDDEN, "invalid stream path");
            return;
        }

        Set<String> allowed = user.allowedStreams();
        if (allowed.contains("*") || allowed.contains(streamId)) {
            filterChain.doFilter(request, response);
            return;
        }

        log.warn("Denied HLS access. user={}, path={}, streamId={}, allowed={}",
                user.username(), path, streamId, allowed);
        writeJsonError(response, HttpServletResponse.SC_FORBIDDEN, "stream access denied");
    }

    /**
     * Resolves the stream id that owns {@code requestPath}, or {@code null} when the path is not a
     * plain {@code /hls/<file>} request for a manifest or segment. Nested paths are rejected: the
     * authorization decision must cover the whole path, not just its last segment.
     */
    static String extractStreamId(String requestPath) {
        if (requestPath == null || !requestPath.startsWith(HLS_PREFIX)) {
            return null;
        }
        String fileName = requestPath.substring(HLS_PREFIX.length());
        if (fileName.isBlank() || fileName.indexOf('/') >= 0 || fileName.indexOf('\\') >= 0) {
            return null;
        }

        Matcher manifest = MANIFEST_NAME.matcher(fileName);
        if (manifest.matches()) {
            return manifest.group(1);
        }
        Matcher segment = SEGMENT_NAME.matcher(fileName);
        if (segment.matches()) {
            return segment.group(1);
        }
        return null;
    }

    private static void writeJsonError(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"error\":\"" + message + "\"}");
    }
}
