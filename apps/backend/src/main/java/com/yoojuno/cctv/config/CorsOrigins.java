package com.yoojuno.cctv.config;

import java.util.Arrays;
import java.util.List;

/** Shared validation for the credentialed CORS allow-lists. */
final class CorsOrigins {
    private CorsOrigins() {
    }

    /**
     * Rejects allow-lists that would let any site read authenticated responses.
     *
     * <p>Both CORS registrations send credentials, and {@code allowedOriginPatterns} happily accepts
     * {@code *} — which reflects the caller's own Origin back with
     * {@code Access-Control-Allow-Credentials: true}. That would let any page a signed-in operator
     * visits read the camera feed, so fail at startup rather than serve it.
     */
    static String[] validate(String propertyName, String[] origins) {
        if (origins == null || origins.length == 0) {
            throw new IllegalStateException(propertyName + " is empty. Configure at least one allowed origin.");
        }
        List<String> wildcards = Arrays.stream(origins)
                .map(String::trim)
                .filter(origin -> origin.equals("*") || origin.equals("*/*") || origin.startsWith("*."))
                .toList();
        if (!wildcards.isEmpty()) {
            throw new IllegalStateException(propertyName + " contains wildcard origin(s) " + wildcards
                    + ". Credentialed CORS requires explicit origins, e.g. http://192.168.0.10:5174");
        }
        return Arrays.stream(origins).map(String::trim).filter(origin -> !origin.isEmpty()).toArray(String[]::new);
    }
}
