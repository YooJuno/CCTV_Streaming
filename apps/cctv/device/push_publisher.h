#pragma once

// Included after the camera helpers. Network tasks own snapshots; serial updates
// replace configuration under config_mutex and invalidate active upload sessions.
static DeviceConfig snapshotDeviceConfig(uint32_t &generation) {
  xSemaphoreTake(config_mutex, portMAX_DELAY);
  DeviceConfig snapshot = device_config;
  generation = config_generation.load();
  xSemaphoreGive(config_mutex);
  return snapshot;
}

struct PublishAddress {
  String host;
  String authority;
  String path;
  uint16_t port;
  bool secure;
};

static PublishAddress publishAddress(const String &url) {
  PublishAddress address;
  address.secure = url.startsWith("https://");
  String rest = url.substring(address.secure ? 8 : 7);
  int slash = rest.indexOf('/');
  address.authority = slash < 0 ? rest : rest.substring(0, slash);
  address.path = slash < 0 ? "" : rest.substring(slash);
  while (address.path.endsWith("/")) {
    address.path.remove(address.path.length() - 1);
  }
  int colon = address.authority.startsWith("[") ? address.authority.indexOf(':', address.authority.indexOf(']') + 1) : address.authority.indexOf(':');
  address.host = colon < 0 ? address.authority : address.authority.substring(0, colon);
  if (address.host.startsWith("[")) {
    address.host = address.host.substring(1, address.host.length() - 1);
  }
  address.port = colon < 0 ? (address.secure ? 443 : 80) : address.authority.substring(colon + 1).toInt();
  return address;
}

static void configureTlsClient(WiFiClientSecure &client, const DeviceConfig &config) {
  client.setTimeout(3);
  client.setHandshakeTimeout(5);
  if (config.server_ca_pem.isEmpty()) {
    client.setCACertBundle(x509_crt_bundle_start);
  } else {
    client.setCACert(config.server_ca_pem.c_str());
  }
}

static bool writeUploadBytes(WiFiClient &client, const uint8_t *data, size_t length) {
  size_t offset = 0;
  uint32_t started = millis();
  while (offset < length && client.connected() && WiFi.status() == WL_CONNECTED) {
    size_t amount = length - offset;
    if (amount > 1024) {
      amount = 1024;
    }
    size_t written = client.write(data + offset, amount);
    if (written == 0 && millis() - started > 3000) {
      return false;
    }
    offset += written;
    if (written == 0) {
      vTaskDelay(pdMS_TO_TICKS(10));
    }
  }
  return offset == length;
}

static void publisherTask(void *) {
  uint32_t retry_ms = 1000;
  while (true) {
    uint32_t generation;
    DeviceConfig config = snapshotDeviceConfig(generation);
    if (WiFi.status() != WL_CONNECTED || config.server_url.isEmpty() || config.device_token.length() != 64) {
      publish_message.store("Waiting for Wi-Fi and server configuration");
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    PublishAddress address = publishAddress(config.server_url);
    if (address.secure && time(nullptr) < 1700000000) {
      publish_message.store("Waiting for time synchronization for HTTPS");
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    WiFiClient plain_client;
    WiFiClientSecure secure_client;
    WiFiClient *client = address.secure ? static_cast<WiFiClient *>(&secure_client) : &plain_client;
    plain_client.setTimeout(3);
    publish_message.store("Connecting to upload server");
    bool connected;
    if (address.secure) {
      // Bundle setup mutates library globals; serialize TLS handshakes with config polls.
      xSemaphoreTake(tls_mutex, portMAX_DELAY);
      configureTlsClient(secure_client, config);
      connected = secure_client.connect(address.host.c_str(), address.port, 5000);
      xSemaphoreGive(tls_mutex);
    } else {
      connected = plain_client.connect(address.host.c_str(), address.port, 5000);
    }
    if (!connected) {
      publish_message.store("Server connection failed; verify address, port, and HTTPS certificate");
      vTaskDelay(pdMS_TO_TICKS(retry_ms));
      retry_ms = retry_ms < 8000 ? retry_ms * 2 : 15000;
      continue;
    }
    String headers = "POST " + address.path + "/api/devices/" + config.stream_id + "/video HTTP/1.1\r\nHost: " + address.authority +
        "\r\nX-Device-Token: " + config.device_token +
        "\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
    bool healthy = writeUploadBytes(*client, reinterpret_cast<const uint8_t *>(headers.c_str()), headers.length());
    publisher_claims_camera.store(healthy);
    bool owns_camera = healthy && xSemaphoreTake(stream_client_mutex, pdMS_TO_TICKS(1500)) == pdTRUE;
    healthy = healthy && owns_camera;
    if (!owns_camera) publish_message.store("Waiting for camera access; reconnecting");
    String response_line;
    uint8_t capture_failures = 0;
    bool response_seen = false;
    // The server returns 200 only at upload EOF. Send JPEGs immediately after headers.
    while (healthy && client->connected() && WiFi.status() == WL_CONNECTED && generation == config_generation.load()) {
      while (client->available() > 0 && !response_seen) {
        char ch = static_cast<char>(client->read());
        if (ch == '\n') {
          if (response_line.startsWith("HTTP/")) {
            int space = response_line.indexOf(' ');
            int status = space >= 0 ? response_line.substring(space + 1).toInt() : 0;
            if (status >= 300 || status == 0) {
              publish_message.store("Upload rejected by server; verify device token and stream registration");
              healthy = false;
            }
            if (status >= 200) {
              response_seen = true;
            }
          }
          response_line = "";
        } else if (response_line.length() < 256) {
          response_line += ch;
        }
      }
      if (!healthy) {
        break;
      }
      JpegFrame frame;
      if (!captureJpegFrame(frame)) {
        publish_message.store("Camera capture unavailable; retrying");
        if (++capture_failures >= STREAM_CAPTURE_FAILURE_LIMIT) {
          (void)recoverCamera("publisher capture failures");
          capture_failures = 0;
        }
        vTaskDelay(pdMS_TO_TICKS(30));
        continue;
      }
      capture_failures = 0;
      char chunk_header[24];
      int header_length = snprintf(chunk_header, sizeof(chunk_header), "%x\r\n", static_cast<unsigned int>(frame.len));
      healthy = header_length > 0 && writeUploadBytes(*client, reinterpret_cast<const uint8_t *>(chunk_header), header_length) &&
          writeUploadBytes(*client, frame.buf, frame.len) && writeUploadBytes(*client, reinterpret_cast<const uint8_t *>("\r\n"), 2);
      releaseJpegFrame(frame);
      if (healthy) {
        publishing.store(true);
        publish_message.store("Sending video to server");
        retry_ms = 1000;
      } else {
        publish_message.store("Upload connection interrupted; reconnecting");
      }
      vTaskDelay(pdMS_TO_TICKS(stream_min_frame_interval_ms));
    }
    publishing.store(false);
    if (healthy && client->connected()) {
      (void)writeUploadBytes(*client, reinterpret_cast<const uint8_t *>("0\r\n\r\n"), 5);
    }
    client->stop();
    if (owns_camera) {
      xSemaphoreGive(stream_client_mutex);
    }
    publisher_claims_camera.store(false);
    bool reconfigured = generation != config_generation.load();
    if (healthy) {
      publish_message.store(reconfigured ? "Reconnecting with updated configuration" : "Upload connection interrupted; reconnecting");
    }
    vTaskDelay(pdMS_TO_TICKS(reconfigured ? 100 : retry_ms));
    if (!reconfigured) {
      retry_ms = retry_ms < 8000 ? retry_ms * 2 : 15000;
    }
  }
}

class BoundedConfigResponse : public Stream {
 public:
  String body;
  size_t write(uint8_t byte) override { return write(&byte, 1); }
  size_t write(const uint8_t *bytes, size_t length) override {
    if (body.length() + length > 2048) return 0;
    return body.concat(reinterpret_cast<const char *>(bytes), length) ? length : 0;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};

static bool parseRemoteProfile(cJSON *json, RemoteProfile &profile) {
  cJSON *fps = cJSON_GetObjectItemCaseSensitive(json, "fps");
  cJSON *quality = cJSON_GetObjectItemCaseSensitive(json, "jpegQuality");
  cJSON *adaptive = cJSON_GetObjectItemCaseSensitive(json, "adaptive");
  cJSON *revision = cJSON_GetObjectItemCaseSensitive(json, "revision");
  const char *size = jsonString(json, "frameSize");
  if (!cJSON_IsNumber(fps) || fps->valueint < 1 || fps->valueint > 12 || fps->valuedouble != fps->valueint ||
      !cJSON_IsNumber(quality) || quality->valueint < 10 || quality->valueint > 40 || quality->valuedouble != quality->valueint ||
      !cJSON_IsBool(adaptive) || !cJSON_IsNumber(revision) || revision->valuedouble < 0 || revision->valuedouble > 4294967295.0 || size == nullptr) {
    return false;
  }
  if (strcmp(size, "QVGA") == 0) profile.frame_size = FRAMESIZE_QVGA;
  else if (strcmp(size, "CIF") == 0) profile.frame_size = FRAMESIZE_CIF;
  else if (strcmp(size, "VGA") == 0) profile.frame_size = FRAMESIZE_VGA;
  else if (strcmp(size, "SVGA") == 0) profile.frame_size = FRAMESIZE_SVGA;
  else return false;
  profile.fps = fps->valueint;
  profile.jpeg_quality = quality->valueint;
  profile.adaptive = cJSON_IsTrue(adaptive);
  profile.revision = static_cast<uint32_t>(revision->valuedouble);
  return revision->valuedouble == profile.revision;
}

static void remoteProfileTask(void *) {
  while (true) {
    uint32_t generation;
    DeviceConfig config = snapshotDeviceConfig(generation);
    if (WiFi.status() == WL_CONNECTED && !config.server_url.isEmpty() && config.device_token.length() == 64) {
      PublishAddress address = publishAddress(config.server_url);
      if (!address.secure || time(nullptr) >= 1700000000) {
        WiFiClient plain_client;
        WiFiClientSecure secure_client;
        WiFiClient *client = address.secure ? static_cast<WiFiClient *>(&secure_client) : &plain_client;
        bool locked = !address.secure || xSemaphoreTake(tls_mutex, pdMS_TO_TICKS(6000)) == pdTRUE;
        if (locked) {
          if (address.secure) configureTlsClient(secure_client, config);
          HTTPClient http;
          String url = config.server_url;
          while (url.endsWith("/")) url.remove(url.length() - 1);
          url += "/api/devices/" + config.stream_id + "/config";
          http.setConnectTimeout(3000);
          http.setTimeout(3000);
          if (http.begin(*client, url)) {
            http.addHeader("X-Device-Token", config.device_token);
            int status = http.GET();
            if (status == 200 && http.getSize() <= 2048) {
              BoundedConfigResponse response;
              int received = http.writeToStream(&response);
              cJSON *json = received >= 0 ? cJSON_Parse(response.body.c_str()) : nullptr;
              RemoteProfile profile;
              if (json != nullptr && parseRemoteProfile(json, profile)) {
                xSemaphoreTake(config_mutex, portMAX_DELAY);
                if (generation == config_generation.load() && (!has_remote_profile || profile.revision != remote_profile.revision)) {
                  remote_profile = profile;
                  has_remote_profile = true;
                  remote_profile_pending = true;
                }
                xSemaphoreGive(config_mutex);
              }
              cJSON_Delete(json);
            }
            http.end();
          }
          if (address.secure) xSemaphoreGive(tls_mutex);
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10000));
  }
}
