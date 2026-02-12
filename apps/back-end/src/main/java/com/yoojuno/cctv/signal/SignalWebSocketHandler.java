package com.yoojuno.cctv.signal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.io.IOException;
import java.util.Map;
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
    // client session id -> gateway session id (for watch session routing)
    private final Map<String, String> clientGateways = new ConcurrentHashMap<>();

    // expose an immutable view for REST controllers
    public Map<String, String> getRegisteredStreams() {
        return Map.copyOf(streamGateways);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        WebSocketSession decoratedSession = new ConcurrentWebSocketSessionDecorator(session, 10_000, 512 * 1024);
        sessions.put(session.getId(), decoratedSession);
        logger.info("WebSocket connected: {}", session.getId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, org.springframework.web.socket.CloseStatus status) throws Exception {
        sessions.remove(session.getId());
        // remove gateway registrations and client->gateway routes involving this session
        streamGateways.entrySet().removeIf(e -> e.getValue().equals(session.getId()));
        clientGateways.remove(session.getId());
        clientGateways.entrySet().removeIf(e -> e.getValue().equals(session.getId()));
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
        if (!node.isObject()) {
            logger.warn("Ignoring non-object JSON message from {}", session.getId());
            return;
        }
        String type = node.has("type") ? node.get("type").asText() : null;
        if (type == null || type.isBlank()) {
            logger.warn("Missing message type from {}", session.getId());
            return;
        }

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
        JsonNode streamsNode = node.get("streams");
        if (!node.has("role") || !"gateway".equals(node.get("role").asText()) || streamsNode == null || !streamsNode.isArray()) {
            logger.warn("Invalid register payload from {}", session.getId());
            return;
        }

        for (JsonNode s : streamsNode) {
            String streamId = s.asText();
            if (streamId == null || streamId.isBlank()) {
                continue;
            }
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

    private void handleWatch(WebSocketSession session, JsonNode node) throws IOException {
        // message: {type: "watch", sessionId: "client-uuid", streamId: "camera1"}
        String streamId = readText(node, "streamId");
        if (streamId == null) {
            sendToSession(session, mapper.createObjectNode().put("type", "error").put("message", "missing streamId"));
            return;
        }

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

        // keep explicit client->gateway mapping for answer/ice forwarding
        clientGateways.put(session.getId(), gatewaySessionId);

        // forward the watch request to the gateway and include the client's session id so gateway can reply
        ObjectNode forward = mapper.createObjectNode();
        forward.put("type", "watch");
        forward.put("streamId", streamId);
        forward.put("clientSessionId", session.getId());
        if (node.has("sessionId")) {
            forward.set("sessionId", node.get("sessionId"));
        }
        sendToSession(gatewaySession, forward);
        logger.info("Forwarded watch request from client {} to gateway {} for stream {}", session.getId(), gatewaySessionId, streamId);
    }

    private void forwardToSession(WebSocketSession sender, JsonNode node) throws IOException {
        boolean senderIsGateway = streamGateways.containsValue(sender.getId());

        if (senderIsGateway) {
            // Gateway -> Client
            String clientId = readText(node, "clientSessionId");
            if (clientId == null) {
                logger.warn("Gateway {} message missing clientSessionId", sender.getId());
                return;
            }
            WebSocketSession client = sessions.get(clientId);
            if (client != null && client.isOpen()) {
                sendToSession(client, node);
            } else {
                logger.info("Target client {} is not connected", clientId);
                clientGateways.remove(clientId);
            }
            return;
        }

        // Client -> Gateway
        String gatewayId = readText(node, "gatewaySessionId");
        if (gatewayId == null) {
            gatewayId = clientGateways.get(sender.getId());
        }
        if (gatewayId == null) {
            sendToSession(sender, mapper.createObjectNode().put("type", "error").put("message", "gateway session not found"));
            return;
        }

        WebSocketSession gateway = sessions.get(gatewayId);
        if (gateway == null || !gateway.isOpen()) {
            clientGateways.remove(sender.getId());
            sendToSession(sender, mapper.createObjectNode().put("type", "error").put("message", "gateway disconnected"));
            return;
        }

        ObjectNode forward = node.deepCopy();
        forward.put("gatewaySessionId", gatewayId);
        if (!forward.has("clientSessionId")) {
            forward.put("clientSessionId", sender.getId());
        }
        sendToSession(gateway, forward);
    }

    private void sendToSession(WebSocketSession session, JsonNode msg) throws IOException {
        if (session != null && session.isOpen()) {
            session.sendMessage(new TextMessage(msg.toString()));
        }
    }

    private static String readText(JsonNode node, String fieldName) {
        if (node == null || fieldName == null || !node.has(fieldName) || node.get(fieldName).isNull()) {
            return null;
        }
        String value = node.get(fieldName).asText();
        return (value == null || value.isBlank()) ? null : value;
    }
}
