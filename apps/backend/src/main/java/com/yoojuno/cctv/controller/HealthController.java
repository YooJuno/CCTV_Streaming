package com.yoojuno.cctv.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class HealthController {
    @Value("${hls.path:./hls}")
    private String hlsPath;

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Path resolved = Path.of(hlsPath).toAbsolutePath().normalize();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "UP");
        body.put("hlsExists", Files.exists(resolved));
        body.put("hlsReadable", Files.isReadable(resolved));
        body.put("hlsWritable", Files.isWritable(resolved));
        return ResponseEntity.ok(body);
    }
}
