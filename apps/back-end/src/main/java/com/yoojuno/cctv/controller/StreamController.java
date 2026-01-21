package com.yoojuno.cctv.controller;

import com.yoojuno.cctv.signal.SignalWebSocketHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class StreamController {
    private final SignalWebSocketHandler handler;

    public StreamController(SignalWebSocketHandler handler) {
        this.handler = handler;
    }

    @GetMapping("/streams")
    public Map<String, String> streams() {
        return handler.getRegisteredStreams();
    }
}
