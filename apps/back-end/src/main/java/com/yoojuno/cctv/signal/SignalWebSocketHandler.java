package com.yoojuno.cctv.signal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Component
public class SignalWebSocketHandler extends TextWebSocketHandler {
    private static final Logger logger = LoggerFactory.getLogger(SignalWebSocketHandler.class);
    private final ObjectMapper mapper = new ObjectMapper();

    // All connected sessions
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    // streamId -> gateway session id (assume one gateway per stream for simplicity)
    private final Map<String, String> streamGateways = new ConcurrentHashMap<>();

    // expose an immutable view for REST controllers
    public Map<String, String> getRegisteredStreams() {
        return Map.copyOf(streamGateways);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        sessions.put(session.getId(), session);
        logger.info("WebSocket connected: {}", session.getId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, org.springframework.web.socket.CloseStatus status) throws Exception {
        sessions.remove(session.getId());
        // remove gateway registrations
        streamGateways.entrySet().removeIf(e -> e.getValue().equals(session.getId()));
        logger.info("WebSocket disconnected: {}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode node;
        try {
            node = mapper.readTree(message.getPayload());
        } catch (Exception e) {
            logger.warn("Invalid JSON from {}: {}", session.getId(), e.getMessage());
            return;
        }
        String type = node.has("type") ? node.get("type").asText() : null;

        switch (type) {
            case "register":
                handleRegister(session, node);
                break;
            case "watch":
                handleWatch(session, node);
                break;
            case "offer":
            case "answer":
            case "ice":
                forwardToSession(session, node);
                break;
            default:
                logger.debug("Unhandled message type: {}", type);
                break;
        }
    }

    private void handleRegister(WebSocketSession session, JsonNode node) {
        // message: {type: "register", role: "gateway", streams: ["camera1"]}
        if (node.has("role") && "gateway".equals(node.get("role").asText()) && node.has("streams")) {
            for (JsonNode s : node.get("streams")) {
                String streamId = s.asText();
                streamGateways.put(streamId, session.getId());
                logger.info("Registered stream {} -> gateway {}", streamId, session.getId());
            }

            // send back a registration confirmation that includes the gateway's session id
            try {
                sendToSession(session, mapper.createObjectNode().put("type", "registered").put("gatewaySessionId", session.getId()));
            } catch (IOException e) {
                logger.warn("Failed to send registering confirmation to gateway {}", session.getId(), e);
            }
        }
    }

    private void handleWatch(WebSocketSession session, JsonNode node) throws IOException {
        // message: {type: "watch", sessionId: "client-uuid", streamId: "camera1"}
        String streamId = node.has("streamId") ? node.get("streamId").asText() : null;
        if (streamId == null) return;

        String gatewaySessionId = streamGateways.get(streamId);
        if (gatewaySessionId == null) {
            // no gateway for stream => respond with error
            sendToSession(session, mapper.createObjectNode().put("type", "error").put("message", "no gateway for stream"));
            logger.info("Watch request for {} failed - no gateway", streamId);
            return;
        }

        WebSocketSession gatewaySession = sessions.get(gatewaySessionId);
        if (gatewaySession == null) {
            sendToSession(session, mapper.createObjectNode().put("type", "error").put("message", "gateway disconnected"));
            logger.info("Watch request for {} failed - gateway disconnected", streamId);
            return;
        }

        // forward the watch request to the gateway and include the client's session id so gateway can reply
        ((com.fasterxml.jackson.databind.node.ObjectNode) node).put("clientSessionId", session.getId());
        gatewaySession.sendMessage(new TextMessage(node.toString()));
        logger.info("Forwarded watch request from client {} to gateway {} for stream {}", session.getId(), gatewaySessionId, streamId);
    }

    private void forwardToSession(WebSocketSession sender, JsonNode node) throws IOException {
        boolean senderIsGateway = streamGateways.containsValue(sender.getId());

        if (senderIsGateway) {
            // Gateway -> Client
            if (node.has("clientSessionId")) {
                String clientId = node.get("clientSessionId").asText();
                WebSocketSession client = sessions.get(clientId);
                if (client != null && client.isOpen()) {
                    client.sendMessage(new TextMessage(node.toString()));
                }
            }
            return;
        }

        // Client -> Gateway
        if (node.has("gatewaySessionId")) {
            String gatewayId = node.get("gatewaySessionId").asText();
            WebSocketSession gateway = sessions.get(gatewayId);
            if (gateway != null && gateway.isOpen()) {
                gateway.sendMessage(new TextMessage(node.toString()));
            }
        }
    }

    private void sendToSession(WebSocketSession session, JsonNode msg) throws IOException {
        if (session != null && session.isOpen()) {
            session.sendMessage(new TextMessage(msg.toString()));
        }
    }
}
