package com.yoojuno.cctv.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Set;
import java.util.regex.Pattern;

@Component
public class StreamAccessFilter extends OncePerRequestFilter {
    private static final Pattern SEGMENT_SUFFIX = Pattern.compile("_(\\d+)$");

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String path = request.getRequestURI();
        if (path == null || !path.startsWith("/hls/")) {
            filterChain.doFilter(request, response);
            return;
        }

        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            writeJsonError(response, HttpServletResponse.SC_UNAUTHORIZED, "unauthorized");
            return;
        }

        String streamId = extractStreamId(path);
        if (streamId == null || streamId.isBlank()) {
            filterChain.doFilter(request, response);
            return;
        }

        Set<String> allowed = user.allowedStreams();
        if (allowed.contains("*") || allowed.contains(streamId)) {
            filterChain.doFilter(request, response);
            return;
        }

        writeJsonError(response, HttpServletResponse.SC_FORBIDDEN, "stream access denied");
    }

    static String extractStreamId(String requestPath) {
        if (requestPath == null || !requestPath.startsWith("/hls/")) {
            return null;
        }
        String relative = requestPath.substring("/hls/".length());
        if (relative.isBlank()) {
            return null;
        }
        String fileName = relative;
        int slashIndex = fileName.lastIndexOf('/');
        if (slashIndex >= 0) {
            fileName = fileName.substring(slashIndex + 1);
        }
        int dotIndex = fileName.lastIndexOf('.');
        if (dotIndex > 0) {
            fileName = fileName.substring(0, dotIndex);
        }
        return SEGMENT_SUFFIX.matcher(fileName).replaceFirst("");
    }

    private static void writeJsonError(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"" + message + "\"}");
    }
}
