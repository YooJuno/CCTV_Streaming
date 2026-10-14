#include <Arduino.h>
#include "esp_camera.h"
#include <WiFi.h>
#include <Preferences.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "cJSON.h"
#include "esp_http_server.h"
#include "img_converters.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <cstring>
#include <cctype>
#include <atomic>
#include <ctime>

// Wi-Fi credentials live in wifi_secrets.h, which is git-ignored.
// Copy wifi_secrets.example.h to wifi_secrets.h and edit it before flashing.
#if !defined(CCTV_FACTORY_BUILD) && __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#endif

#ifndef WIFI_SSID
#define WIFI_SSID "YOUR_WIFI_SSID"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#endif

static const char *FIRMWARE_VERSION = "1.0.0";
static const size_t SERIAL_REQUEST_LIMIT = 8192;
extern const uint8_t x509_crt_bundle_start[] asm("_binary_x509_crt_bundle_start");

struct DeviceConfig {
  String ssid;
  String password;
  String server_url;
  String stream_id = "mystream";
  String device_token;
  String server_ca_pem;
};

static DeviceConfig device_config;
static String serial_request;
static bool serial_request_overflow = false;
static bool wifi_reconfigure_pending = false;
static uint32_t wifi_attempt_started_ms = 0;
static SemaphoreHandle_t config_mutex = nullptr;
static SemaphoreHandle_t tls_mutex = nullptr;
static std::atomic<uint32_t> config_generation{0};
static std::atomic<bool> publishing{false};
static std::atomic<bool> publisher_claims_camera{false};
static std::atomic<const char *> publish_message{"Waiting for configuration"};
static bool ntp_started = false;

struct RemoteProfile {
  uint8_t fps = 8;
  framesize_t frame_size = FRAMESIZE_CIF;
  int jpeg_quality = 13;
  bool adaptive = true;
  uint32_t revision = 0;
};
static RemoteProfile remote_profile;
static bool has_remote_profile = false;
static bool remote_profile_pending = false;
static std::atomic<uint32_t> applied_revision{0};
static std::atomic<uint8_t> actual_fps{6};
static std::atomic<int> actual_frame_size{FRAMESIZE_CIF};
static std::atomic<int> actual_jpeg_quality{15};
static std::atomic<bool> actual_adaptive{true};

static const uint32_t WIFI_CONNECT_TIMEOUT_MS = 20000;
static const uint32_t WIFI_RETRY_DELAY_MS = 3000;
static const uint32_t WIFI_RECONNECT_INTERVAL_MS = 7000;
static const uint8_t WIFI_MAX_RECONNECT_FAILURES = 10;

static const uint32_t CAMERA_RECOVERY_COOLDOWN_MS = 3000;
static const uint8_t STREAM_CAPTURE_FAILURE_LIMIT = 15;

enum class StreamProfile : uint8_t {
  PROFILE_HIGH,
  PROFILE_BALANCED,
  PROFILE_RESILIENT,
};

static const uint8_t STREAM_HIGH_FPS = 8;
static const uint8_t STREAM_BALANCED_FPS = 6;
static const uint8_t STREAM_RESILIENT_FPS = 4;
static const framesize_t STREAM_HIGH_FRAME_SIZE = FRAMESIZE_CIF;
static const framesize_t STREAM_BALANCED_FRAME_SIZE = FRAMESIZE_CIF;
static const framesize_t STREAM_RESILIENT_FRAME_SIZE = FRAMESIZE_QVGA;
static const int STREAM_HIGH_JPEG_QUALITY = 13;
static const int STREAM_BALANCED_JPEG_QUALITY = 15;
static const int STREAM_RESILIENT_JPEG_QUALITY = 20;
static const int RSSI_RESILIENT_THRESHOLD = -78;
static const int RSSI_BALANCED_THRESHOLD = -68;
static const uint32_t STREAM_PROFILE_EVAL_INTERVAL_MS = 5000;
static volatile uint32_t stream_min_frame_interval_ms = 1000 / STREAM_BALANCED_FPS;
static const size_t STREAM_PAYLOAD_CHUNK_SIZE = 1024;
static const uint8_t STREAM_RECV_WAIT_TIMEOUT_SECONDS = 5;
static const uint8_t STREAM_SEND_WAIT_TIMEOUT_SECONDS = 3;

// AI Thinker pin map
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22
#define LED_GPIO_NUM       4

static const char *STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=frame";
static const char *STREAM_BOUNDARY = "\r\n--frame\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static const char *INDEX_HTML =
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>ESP32-CAM Stream</title>"
    "<style>body{font-family:Arial;margin:24px;color:#111;}"
    "img{max-width:100%;border:1px solid #ddd;border-radius:8px;}"
    "code{background:#f3f4f6;padding:2px 6px;border-radius:4px;}</style>"
    "</head><body><h1>ESP32-CAM Stream</h1>"
    "<p>Stream URL: <code>http://DEVICE_IP:81/stream</code></p>"
    "<p>Health URL: <code>http://DEVICE_IP/health</code></p>"
    "<img id='stream' alt='stream'>"
    "<script>const host=location.hostname;"
    "document.getElementById('stream').src=`http://${host}:81/stream`;"
    "</script></body></html>";

struct JpegFrame {
  camera_fb_t *fb;
  uint8_t *buf;
  size_t len;
  bool must_free;
};

static httpd_handle_t index_httpd = nullptr;
static httpd_handle_t stream_httpd = nullptr;
static SemaphoreHandle_t camera_mutex = nullptr;
static SemaphoreHandle_t stream_client_mutex = nullptr;

static bool camera_initialized = false;
static bool wifi_connected_once = false;
static uint8_t wifi_reconnect_failures = 0;
static uint32_t last_wifi_reconnect_attempt_ms = 0;
static uint32_t last_camera_recovery_ms = 0;
static StreamProfile active_stream_profile = StreamProfile::PROFILE_BALANCED;
static uint32_t last_stream_profile_eval_ms = 0;

static bool hasWiFiConfig() {
  return !device_config.ssid.isEmpty();
}

static bool hasControlCharacters(const String &value) {
  for (size_t i = 0; i < value.length(); ++i) {
    if (static_cast<uint8_t>(value[i]) < 0x20 || value[i] == 0x7f) {
      return true;
    }
  }
  return false;
}

static bool validStreamId(const String &value) {
  if (value.isEmpty() || value.length() > 64 || !isalnum(static_cast<unsigned char>(value[0]))) {
    return false;
  }
  for (size_t i = 1; i < value.length(); ++i) {
    unsigned char ch = static_cast<unsigned char>(value[i]);
    if (!isalnum(ch) && ch != '.' && ch != '_' && ch != '-') {
      return false;
    }
  }
  return true;
}

static bool validServerUrl(const String &value) {
  if (value.isEmpty() || value.length() > 512 || hasControlCharacters(value)) {
    return false;
  }
  size_t prefix_length = value.startsWith("https://") ? 8 : value.startsWith("http://") ? 7 : 0;
  if (prefix_length == 0 || value.length() <= prefix_length) {
    return false;
  }
  for (size_t i = prefix_length; i < value.length(); ++i) {
    if (value[i] == ' ' || value[i] == '@' || value[i] == '\\' || value[i] == '?' || value[i] == '#') {
      return false;
    }
  }
  String authority = value.substring(prefix_length);
  int slash = authority.indexOf('/');
  if (slash >= 0) {
    authority = authority.substring(0, slash);
  }
  if (authority.isEmpty() || authority.indexOf('?') >= 0 || authority.indexOf('#') >= 0) {
    return false;
  }
  // Browser validation also applies; accept DNS/IPv4 and bracketed IPv6 with an optional port.
  int port_separator = authority.startsWith("[") ? authority.indexOf(':', authority.indexOf(']') + 1) : authority.indexOf(':');
  if (authority.startsWith("[") && authority.indexOf(']') <= 1) {
    return false;
  }
  String host = port_separator < 0 ? authority : authority.substring(0, port_separator);
  if (host.isEmpty()) {
    return false;
  }
  if (host.startsWith("[")) {
    if (!host.endsWith("]")) return false;
    for (size_t i = 1; i + 1 < host.length(); ++i) {
      if (!isxdigit(static_cast<unsigned char>(host[i])) && host[i] != ':' && host[i] != '.') return false;
    }
  } else {
    for (size_t i = 0; i < host.length(); ++i) {
      if (!isalnum(static_cast<unsigned char>(host[i])) && host[i] != '.' && host[i] != '-') return false;
    }
  }
  if (port_separator >= 0) {
    String port = authority.substring(port_separator + 1);
    if (port.isEmpty() || port.length() > 5) {
      return false;
    }
    for (size_t i = 0; i < port.length(); ++i) {
      if (!isdigit(static_cast<unsigned char>(port[i]))) {
        return false;
      }
    }
    if (port.toInt() < 1 || port.toInt() > 65535) {
      return false;
    }
  }
  return true;
}

static const char *jsonString(cJSON *object, const char *key) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
  return cJSON_IsString(item) ? item->valuestring : nullptr;
}

static bool readConfig(cJSON *object, DeviceConfig &config) {
  const char *ssid = jsonString(object, "ssid");
  const char *password = jsonString(object, "password");
  const char *server_url = jsonString(object, "serverUrl");
  const char *stream_id = jsonString(object, "streamId");
  const char *device_token = jsonString(object, "deviceToken");
  const char *server_ca_pem = jsonString(object, "serverCaPem");
  cJSON *ca_item = cJSON_GetObjectItemCaseSensitive(object, "serverCaPem");
  if (ca_item != nullptr && !cJSON_IsString(ca_item)) {
    return false;
  }
  if (ssid == nullptr || password == nullptr || server_url == nullptr || stream_id == nullptr || device_token == nullptr) {
    return false;
  }
  config.ssid = ssid;
  config.password = password;
  config.server_url = server_url;
  config.stream_id = stream_id;
  config.device_token = device_token;
  config.server_ca_pem = server_ca_pem != nullptr ? server_ca_pem : "";
  if (config.device_token.length() != 64 || config.server_ca_pem.length() > 4096) {
    return false;
  }
  for (size_t i = 0; i < config.device_token.length(); ++i) {
    if (!isxdigit(static_cast<unsigned char>(config.device_token[i]))) {
      return false;
    }
  }
  if (!config.server_ca_pem.isEmpty() && (!config.server_ca_pem.startsWith("-----BEGIN CERTIFICATE-----") ||
      config.server_ca_pem.indexOf("-----END CERTIFICATE-----") < 0)) {
    return false;
  }
  return !config.ssid.isEmpty() && config.ssid.length() <= 32 && !hasControlCharacters(config.ssid) &&
      (config.password.isEmpty() || (config.password.length() >= 8 && config.password.length() <= 63)) &&
      !hasControlCharacters(config.password) && validServerUrl(config.server_url) && validStreamId(config.stream_id);
}

static void loadDeviceConfig() {
  Preferences preferences;
  if (preferences.begin("cctv", true)) {
    String stored = preferences.getString("config", "");
    preferences.end();
    cJSON *object = cJSON_Parse(stored.c_str());
    DeviceConfig config;
    if (object != nullptr && readConfig(object, config)) {
      device_config = config;
    }
    cJSON_Delete(object);
  }
#if !defined(CCTV_FACTORY_BUILD)
  if (!hasWiFiConfig() && strcmp(WIFI_SSID, "YOUR_WIFI_SSID") != 0 && strcmp(WIFI_PASSWORD, "YOUR_WIFI_PASSWORD") != 0) {
    device_config.ssid = WIFI_SSID;
    device_config.password = WIFI_PASSWORD;
  }
#endif
}

static void sendSerialResponse(const char *request_id, bool ok, const char *message) {
  cJSON *response = cJSON_CreateObject();
  if (response == nullptr) {
    return;
  }
  bool connected = !wifi_reconfigure_pending && WiFi.status() == WL_CONNECTED;
  cJSON_AddStringToObject(response, "type", "cctv.response");
  cJSON_AddStringToObject(response, "requestId", request_id);
  cJSON_AddBoolToObject(response, "ok", ok);
  cJSON_AddStringToObject(response, "message", message);
  cJSON_AddBoolToObject(response, "configured", hasWiFiConfig());
  cJSON_AddBoolToObject(response, "wifiConnected", connected);
  cJSON_AddBoolToObject(response, "cameraInitialized", camera_initialized);
  cJSON_AddStringToObject(response, "firmwareVersion", FIRMWARE_VERSION);
  cJSON_AddStringToObject(response, "serverUrl", device_config.server_url.c_str());
  cJSON_AddStringToObject(response, "streamId", device_config.stream_id.c_str());
  cJSON_AddBoolToObject(response, "publishing", !wifi_reconfigure_pending && publishing.load());
  cJSON_AddStringToObject(response, "publishMessage", publish_message.load());
  cJSON_AddNumberToObject(response, "appliedRevision", applied_revision.load());
  cJSON_AddNumberToObject(response, "fps", actual_fps.load());
  const char *frame_size = actual_frame_size.load() == FRAMESIZE_SVGA ? "SVGA" : actual_frame_size.load() == FRAMESIZE_VGA ? "VGA" : actual_frame_size.load() == FRAMESIZE_QVGA ? "QVGA" : "CIF";
  cJSON_AddStringToObject(response, "frameSize", frame_size);
  cJSON_AddNumberToObject(response, "jpegQuality", actual_jpeg_quality.load());
  cJSON_AddBoolToObject(response, "adaptive", actual_adaptive.load());
  if (connected) {
    String ip = WiFi.localIP().toString();
    String stream_url = "http://" + ip + ":81/stream";
    cJSON_AddStringToObject(response, "ip", ip.c_str());
    cJSON_AddStringToObject(response, "streamUrl", stream_url.c_str());
  }
  char *json = cJSON_PrintUnformatted(response);
  if (json != nullptr) {
    Serial.println(json);
    cJSON_free(json);
  }
  cJSON_Delete(response);
}

static void handleSerialRequest(const String &line) {
  if (line.indexOf("\\u0000") >= 0) {
    sendSerialResponse("", false, "NUL characters are not allowed");
    return;
  }
  const char *parse_end = nullptr;
  cJSON *request = cJSON_ParseWithOpts(line.c_str(), &parse_end, true);
  if (request == nullptr || !cJSON_IsObject(request)) {
    cJSON_Delete(request);
    sendSerialResponse("", false, "Invalid JSON request");
    return;
  }
  const char *request_id = jsonString(request, "requestId");
  const char *type = jsonString(request, "type");
  if (request_id == nullptr || strlen(request_id) == 0 || strlen(request_id) > 64 || hasControlCharacters(String(request_id))) {
    sendSerialResponse("", false, "requestId must contain 1 to 64 bytes");
  } else if (type != nullptr && strcmp(type, "cctv.status") == 0) {
    sendSerialResponse(request_id, true, "Device status");
  } else if (type != nullptr && strcmp(type, "cctv.configure") == 0) {
    DeviceConfig config;
    if (!readConfig(request, config)) {
      sendSerialResponse(request_id, false, "Invalid Wi-Fi, server URL, stream ID, device token, or CA certificate");
    } else {
      // Store a single NVS value so a reset cannot persist only part of the configuration.
      cJSON *stored = cJSON_CreateObject();
      if (stored != nullptr) {
        cJSON_AddStringToObject(stored, "ssid", config.ssid.c_str());
        cJSON_AddStringToObject(stored, "password", config.password.c_str());
        cJSON_AddStringToObject(stored, "serverUrl", config.server_url.c_str());
        cJSON_AddStringToObject(stored, "streamId", config.stream_id.c_str());
        cJSON_AddStringToObject(stored, "deviceToken", config.device_token.c_str());
        cJSON_AddStringToObject(stored, "serverCaPem", config.server_ca_pem.c_str());
      }
      char *encoded = stored != nullptr ? cJSON_PrintUnformatted(stored) : nullptr;
      Preferences preferences;
      bool saved = false;
      if (encoded != nullptr && preferences.begin("cctv", false)) {
        saved = preferences.putString("config", encoded) == strlen(encoded);
        preferences.end();
      }
      cJSON_free(encoded);
      cJSON_Delete(stored);
      if (!saved) {
        sendSerialResponse(request_id, false, "Unable to save device configuration");
      } else {
        xSemaphoreTake(config_mutex, portMAX_DELAY);
        device_config = config;
        config_generation.fetch_add(1);
        has_remote_profile = false;
        remote_profile_pending = false;
        xSemaphoreGive(config_mutex);
        wifi_reconfigure_pending = true;
        sendSerialResponse(request_id, true, "Configuration saved; connecting to Wi-Fi");
      }
    }
  } else {
    sendSerialResponse(request_id, false, "Unsupported request type");
  }
  cJSON_Delete(request);
}

static void maintainSerialConfiguration() {
  while (Serial.available() > 0) {
    char ch = static_cast<char>(Serial.read());
    if (ch == '\n') {
      if (serial_request_overflow) {
        sendSerialResponse("", false, "Request exceeds 8192 bytes");
      } else if (!serial_request.isEmpty()) {
        handleSerialRequest(serial_request);
      }
      serial_request = "";
      serial_request_overflow = false;
    } else if (ch != '\r' && !serial_request_overflow) {
      if (serial_request.length() >= SERIAL_REQUEST_LIMIT) {
        serial_request = "";
        serial_request_overflow = true;
      } else {
        serial_request += ch;
      }
    }
  }
}

static bool initSynchronizationPrimitives() {
  if (config_mutex == nullptr) {
    config_mutex = xSemaphoreCreateMutex();
  }
  if (tls_mutex == nullptr) {
    tls_mutex = xSemaphoreCreateMutex();
  }
  if (camera_mutex == nullptr) {
    camera_mutex = xSemaphoreCreateMutex();
  }
  if (stream_client_mutex == nullptr) {
    stream_client_mutex = xSemaphoreCreateMutex();
  }
  return camera_mutex != nullptr && stream_client_mutex != nullptr && config_mutex != nullptr && tls_mutex != nullptr;
}

static uint32_t fpsToIntervalMs(uint8_t fps) {
  if (fps == 0) {
    return 250;
  }
  return 1000 / fps;
}

static const char *streamProfileName(StreamProfile profile) {
  switch (profile) {
    case StreamProfile::PROFILE_HIGH:
      return "HIGH";
    case StreamProfile::PROFILE_BALANCED:
      return "BALANCED";
    case StreamProfile::PROFILE_RESILIENT:
      return "RESILIENT";
    default:
      return "UNKNOWN";
  }
}

static StreamProfile selectStreamProfileForRssi(int rssi) {
  if (rssi <= RSSI_RESILIENT_THRESHOLD) {
    return StreamProfile::PROFILE_RESILIENT;
  }
  if (rssi <= RSSI_BALANCED_THRESHOLD) {
    return StreamProfile::PROFILE_BALANCED;
  }
  return StreamProfile::PROFILE_HIGH;
}

static bool applyStreamProfile(StreamProfile profile, bool force) {
  if (!force && profile == active_stream_profile) {
    return true;
  }

  uint8_t target_fps = STREAM_BALANCED_FPS;
  framesize_t target_frame_size = STREAM_BALANCED_FRAME_SIZE;
  int target_quality = STREAM_BALANCED_JPEG_QUALITY;

  switch (profile) {
    case StreamProfile::PROFILE_HIGH:
      target_fps = STREAM_HIGH_FPS;
      target_frame_size = STREAM_HIGH_FRAME_SIZE;
      target_quality = STREAM_HIGH_JPEG_QUALITY;
      break;
    case StreamProfile::PROFILE_BALANCED:
      target_fps = STREAM_BALANCED_FPS;
      target_frame_size = STREAM_BALANCED_FRAME_SIZE;
      target_quality = STREAM_BALANCED_JPEG_QUALITY;
      break;
    case StreamProfile::PROFILE_RESILIENT:
      target_fps = STREAM_RESILIENT_FPS;
      target_frame_size = STREAM_RESILIENT_FRAME_SIZE;
      target_quality = STREAM_RESILIENT_JPEG_QUALITY;
      break;
  }

  if (!psramFound()) {
    target_frame_size = STREAM_RESILIENT_FRAME_SIZE;
    if (target_quality < STREAM_RESILIENT_JPEG_QUALITY) {
      target_quality = STREAM_RESILIENT_JPEG_QUALITY;
    }
    if (target_fps > STREAM_BALANCED_FPS) {
      target_fps = STREAM_BALANCED_FPS;
    }
    if (profile == StreamProfile::PROFILE_HIGH) {
      profile = StreamProfile::PROFILE_BALANCED;
    }
  }

  if (xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(500)) != pdTRUE) {
    return false;
  }

  bool applied = false;
  if (camera_initialized) {
    sensor_t *sensor = esp_camera_sensor_get();
    if (sensor != nullptr) {
      applied = sensor->set_framesize(sensor, target_frame_size) == 0 && sensor->set_quality(sensor, target_quality) == 0;
    }
  } else {
    applied = true;
  }

  if (applied) {
    stream_min_frame_interval_ms = fpsToIntervalMs(target_fps);
    active_stream_profile = profile;
    actual_fps.store(target_fps);
    actual_frame_size.store(target_frame_size);
    actual_jpeg_quality.store(target_quality);
  }
  xSemaphoreGive(camera_mutex);

  if (applied) {
    Serial.printf(
        "[INFO] Stream profile=%s rssi=%d fps=%u quality=%d frameSize=%d\n",
        streamProfileName(active_stream_profile),
        WiFi.RSSI(),
        target_fps,
        target_quality,
        static_cast<int>(target_frame_size));
  }
  return applied;
}

static void maintainAdaptiveStreamProfile() {
  if (WiFi.status() != WL_CONNECTED || !camera_initialized) {
    return;
  }
  xSemaphoreTake(config_mutex, portMAX_DELAY);
  bool use_remote = has_remote_profile;
  bool pending = remote_profile_pending;
  RemoteProfile profile = remote_profile;
  uint32_t generation = config_generation.load();
  xSemaphoreGive(config_mutex);
  uint32_t now = millis();
  if (!pending && now - last_stream_profile_eval_ms < STREAM_PROFILE_EVAL_INTERVAL_MS) {
    return;
  }
  last_stream_profile_eval_ms = now;
  StreamProfile signal_profile = selectStreamProfileForRssi(WiFi.RSSI());
  if (!use_remote) {
    actual_adaptive.store(true);
    (void)applyStreamProfile(signal_profile, false);
    return;
  }
  uint8_t fps = profile.fps;
  framesize_t size = profile.frame_size;
  int quality = profile.jpeg_quality;
  if (profile.adaptive) {
    uint8_t cap = signal_profile == StreamProfile::PROFILE_RESILIENT ? STREAM_RESILIENT_FPS : signal_profile == StreamProfile::PROFILE_BALANCED ? STREAM_BALANCED_FPS : STREAM_HIGH_FPS;
    framesize_t size_cap = signal_profile == StreamProfile::PROFILE_RESILIENT ? FRAMESIZE_QVGA : signal_profile == StreamProfile::PROFILE_BALANCED ? FRAMESIZE_CIF : profile.frame_size;
    int quality_floor = signal_profile == StreamProfile::PROFILE_RESILIENT ? STREAM_RESILIENT_JPEG_QUALITY : signal_profile == StreamProfile::PROFILE_BALANCED ? STREAM_BALANCED_JPEG_QUALITY : STREAM_HIGH_JPEG_QUALITY;
    if (fps > cap) fps = cap;
    if (size > size_cap) size = size_cap;
    if (quality < quality_floor) quality = quality_floor;
  }
  if (!psramFound()) {
    size = FRAMESIZE_QVGA;
    if (fps > STREAM_BALANCED_FPS) fps = STREAM_BALANCED_FPS;
    if (quality < STREAM_RESILIENT_JPEG_QUALITY) quality = STREAM_RESILIENT_JPEG_QUALITY;
  }
  bool changed = fps != actual_fps.load() || size != actual_frame_size.load() || quality != actual_jpeg_quality.load();
  bool applied = !changed && !pending;
  if (!applied && xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    sensor_t *sensor = camera_initialized ? esp_camera_sensor_get() : nullptr;
    applied = sensor != nullptr && sensor->set_framesize(sensor, size) == 0 && sensor->set_quality(sensor, quality) == 0;
    if (applied) {
      stream_min_frame_interval_ms = fpsToIntervalMs(fps);
      actual_fps.store(fps);
      actual_frame_size.store(size);
      actual_jpeg_quality.store(quality);
      actual_adaptive.store(profile.adaptive);
      applied_revision.store(profile.revision);
    }
    xSemaphoreGive(camera_mutex);
  }
  if (applied && (pending || changed)) {
    xSemaphoreTake(config_mutex, portMAX_DELAY);
    if (generation == config_generation.load() && remote_profile.revision == profile.revision) {
      remote_profile_pending = false;
      // New resolution/FPS starts a new upload so server FFmpeg sees a fresh stream.
      config_generation.fetch_add(1);
    }
    xSemaphoreGive(config_mutex);
  }
}

static camera_config_t buildCameraConfig() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    // Allocate buffers for the largest remotely selectable frame size.
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 10;
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
    config.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    config.frame_size = STREAM_RESILIENT_FRAME_SIZE;
    config.jpeg_quality = STREAM_RESILIENT_JPEG_QUALITY;
    config.fb_count = 1;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }
  return config;
}

static bool initCameraUnlocked() {
  camera_config_t config = buildCameraConfig();
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    camera_initialized = false;
    return false;
  }
  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor != nullptr) {
    sensor->set_framesize(sensor, psramFound() ? STREAM_BALANCED_FRAME_SIZE : STREAM_RESILIENT_FRAME_SIZE);
    sensor->set_quality(sensor, psramFound() ? STREAM_BALANCED_JPEG_QUALITY : STREAM_RESILIENT_JPEG_QUALITY);
  }
  if (psramFound()) {
    active_stream_profile = StreamProfile::PROFILE_BALANCED;
    stream_min_frame_interval_ms = fpsToIntervalMs(STREAM_BALANCED_FPS);
  } else {
    active_stream_profile = StreamProfile::PROFILE_RESILIENT;
    stream_min_frame_interval_ms = fpsToIntervalMs(STREAM_RESILIENT_FPS);
  }
  camera_initialized = true;
  actual_fps.store(psramFound() ? STREAM_BALANCED_FPS : STREAM_RESILIENT_FPS);
  actual_frame_size.store(psramFound() ? STREAM_BALANCED_FRAME_SIZE : STREAM_RESILIENT_FRAME_SIZE);
  actual_jpeg_quality.store(psramFound() ? STREAM_BALANCED_JPEG_QUALITY : STREAM_RESILIENT_JPEG_QUALITY);
  return true;
}

static bool initCamera() {
  if (!initSynchronizationPrimitives()) {
    return false;
  }
  if (xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
    Serial.println("Failed to lock camera mutex during init.");
    return false;
  }
  bool ok = initCameraUnlocked();
  xSemaphoreGive(camera_mutex);
  return ok;
}

static bool recoverCamera(const char *reason) {
  uint32_t now = millis();
  if (now - last_camera_recovery_ms < CAMERA_RECOVERY_COOLDOWN_MS) {
    return false;
  }
  last_camera_recovery_ms = now;
  Serial.printf("[WARN] Camera recovery triggered: %s\n", reason);

  if (xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
    Serial.println("Camera recovery skipped (mutex timeout).");
    return false;
  }

  if (camera_initialized) {
    esp_camera_deinit();
    camera_initialized = false;
    delay(80);
  }
  bool ok = initCameraUnlocked();
  xSemaphoreGive(camera_mutex);
  Serial.println(ok ? "Camera recovery success." : "Camera recovery failed.");
  return ok;
}

static bool captureJpegFrame(JpegFrame &frame) {
  frame.fb = nullptr;
  frame.buf = nullptr;
  frame.len = 0;
  frame.must_free = false;

  if (xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
    return false;
  }

  if (!camera_initialized) {
    xSemaphoreGive(camera_mutex);
    return false;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    xSemaphoreGive(camera_mutex);
    return false;
  }

  if (fb->format == PIXFORMAT_JPEG) {
    frame.fb = fb;
    frame.buf = fb->buf;
    frame.len = fb->len;
    frame.must_free = false;
    xSemaphoreGive(camera_mutex);
    return true;
  }

  uint8_t *jpg_buf = nullptr;
  size_t jpg_len = 0;
  bool converted = frame2jpg(fb, 80, &jpg_buf, &jpg_len);
  esp_camera_fb_return(fb);
  xSemaphoreGive(camera_mutex);

  if (!converted || jpg_buf == nullptr || jpg_len == 0) {
    if (jpg_buf != nullptr) {
      free(jpg_buf);
    }
    return false;
  }

  frame.buf = jpg_buf;
  frame.len = jpg_len;
  frame.must_free = true;
  return true;
}

static void releaseJpegFrame(JpegFrame &frame) {
  if (frame.fb != nullptr) {
    esp_camera_fb_return(frame.fb);
  } else if (frame.must_free && frame.buf != nullptr) {
    free(frame.buf);
  }
  frame.fb = nullptr;
  frame.buf = nullptr;
  frame.len = 0;
  frame.must_free = false;
}

#include "push_publisher.h"

static void maintainWiFiConnection() {
  if (!hasWiFiConfig()) {
    return;
  }
  uint32_t now = millis();
  if (wifi_reconfigure_pending) {
    WiFi.disconnect(false, true);
    WiFi.begin(device_config.ssid.c_str(), device_config.password.c_str());
    WiFi.setTxPower(WIFI_POWER_19_5dBm);
    wifi_reconfigure_pending = false;
    wifi_connected_once = false;
    wifi_reconnect_failures = 0;
    wifi_attempt_started_ms = now;
    last_wifi_reconnect_attempt_ms = now;
    Serial.println("Connecting to Wi-Fi with saved configuration.");
    return;
  }
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifi_connected_once) {
      wifi_connected_once = true;
      Serial.println("Wi-Fi connected.");
    }
    wifi_reconnect_failures = 0;
    wifi_attempt_started_ms = 0;
    if (!ntp_started) {
      configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
      ntp_started = true;
    }
    return;
  }

  // Keep USB provisioning responsive while the Wi-Fi driver connects asynchronously.
  if (wifi_attempt_started_ms != 0 && now - wifi_attempt_started_ms < WIFI_CONNECT_TIMEOUT_MS) {
    return;
  }
  if (now - last_wifi_reconnect_attempt_ms < WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }
  last_wifi_reconnect_attempt_ms = now;
  if (wifi_reconnect_failures < WIFI_MAX_RECONNECT_FAILURES) {
    wifi_reconnect_failures++;
  }
  Serial.printf("[WARN] Wi-Fi disconnected. Reconnecting (attempt %u); USB configuration remains available.\n", wifi_reconnect_failures);
  WiFi.disconnect(false, true);
  WiFi.begin(device_config.ssid.c_str(), device_config.password.c_str());
  wifi_attempt_started_ms = now;
}

static esp_err_t index_handler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  return httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t health_handler(httpd_req_t *req) {
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");

  String ip = WiFi.localIP().toString();
  const char *wifi = WiFi.status() == WL_CONNECTED ? "true" : "false";
  const char *cam = camera_initialized ? "true" : "false";
  const char *profile = streamProfileName(active_stream_profile);
  uint32_t interval_ms = stream_min_frame_interval_ms;
  uint32_t target_fps = interval_ms > 0 ? 1000 / interval_ms : 0;
  char body[320];
  int written = snprintf(body, sizeof(body),
      "{\"wifiConnected\":%s,\"cameraInitialized\":%s,\"ip\":\"%s\",\"rssi\":%d,\"streamProfile\":\"%s\",\"targetFps\":%u}",
      wifi, cam, ip.c_str(), WiFi.RSSI(), profile, target_fps);
  if (written < 0 || static_cast<size_t>(written) >= sizeof(body)) {
    return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "format error");
  }
  return httpd_resp_send(req, body, written);
}

static esp_err_t sendFramePayload(httpd_req_t *req, const uint8_t *data, size_t length) {
  if (data == nullptr || length == 0) {
    return ESP_ERR_INVALID_ARG;
  }
  size_t offset = 0;
  while (offset < length) {
    size_t chunk_size = length - offset;
    if (chunk_size > STREAM_PAYLOAD_CHUNK_SIZE) {
      chunk_size = STREAM_PAYLOAD_CHUNK_SIZE;
    }
    esp_err_t res = httpd_resp_send_chunk(req, reinterpret_cast<const char *>(data + offset), chunk_size);
    if (res != ESP_OK) {
      return res;
    }
    offset += chunk_size;
  }
  return ESP_OK;
}

static esp_err_t stream_handler(httpd_req_t *req) {
  if (publisher_claims_camera.load() || xSemaphoreTake(stream_client_mutex, 0) != pdTRUE) {
    httpd_resp_set_status(req, "503 Service Unavailable");
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, "{\"error\":\"stream busy\"}", HTTPD_RESP_USE_STRLEN);
  }

  esp_err_t res = httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  if (res == ESP_OK) {
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
  }

  uint8_t capture_failures = 0;
  char part_buf[64];
  uint32_t next_frame_due_ms = millis() + stream_min_frame_interval_ms;

  while (res == ESP_OK && !publisher_claims_camera.load()) {
    uint32_t now_ms = millis();
    int32_t wait_ms = static_cast<int32_t>(next_frame_due_ms - now_ms);
    if (wait_ms > 0) {
      delay(static_cast<uint32_t>(wait_ms));
    }

    if (WiFi.status() != WL_CONNECTED) {
      res = ESP_FAIL;
      break;
    }

    JpegFrame frame;
    if (!captureJpegFrame(frame)) {
      capture_failures++;
      if (capture_failures >= STREAM_CAPTURE_FAILURE_LIMIT) {
        recoverCamera("consecutive capture failures");
        capture_failures = 0;
      }
      delay(20);
      continue;
    }

    capture_failures = 0;

    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) {
      int header_len = snprintf(part_buf, sizeof(part_buf), STREAM_PART, frame.len);
      if (header_len <= 0 || static_cast<size_t>(header_len) >= sizeof(part_buf)) {
        res = ESP_FAIL;
      } else {
        res = httpd_resp_send_chunk(req, part_buf, static_cast<size_t>(header_len));
      }
    }
    if (res == ESP_OK) {
      res = sendFramePayload(req, frame.buf, frame.len);
    }

    releaseJpegFrame(frame);

    if (res != ESP_OK) {
      Serial.println("[INFO] Stream client disconnected.");
      break;
    }

    uint32_t frame_interval_ms = stream_min_frame_interval_ms;
    if (frame_interval_ms == 0) {
      frame_interval_ms = 1;
    }
    next_frame_due_ms = millis() + frame_interval_ms;
  }

  if (publisher_claims_camera.load() && res == ESP_OK) {
    res = ESP_FAIL;
  }
  xSemaphoreGive(stream_client_mutex);
  return res;
}

static void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.lru_purge_enable = true;

  httpd_uri_t index_uri = {
      .uri = "/",
      .method = HTTP_GET,
      .handler = index_handler,
      .user_ctx = nullptr};

  httpd_uri_t health_uri = {
      .uri = "/health",
      .method = HTTP_GET,
      .handler = health_handler,
      .user_ctx = nullptr};

  if (index_httpd == nullptr) {
    esp_err_t index_result = httpd_start(&index_httpd, &config);
    if (index_result == ESP_OK) {
      httpd_register_uri_handler(index_httpd, &index_uri);
      httpd_register_uri_handler(index_httpd, &health_uri);
    } else {
      Serial.printf("Failed to start index server: 0x%x\n", index_result);
    }
  }

  httpd_config_t stream_config = HTTPD_DEFAULT_CONFIG();
  stream_config.server_port = 81;
  stream_config.ctrl_port = config.ctrl_port + 1;
  stream_config.lru_purge_enable = true;
  stream_config.recv_wait_timeout = STREAM_RECV_WAIT_TIMEOUT_SECONDS;
  stream_config.send_wait_timeout = STREAM_SEND_WAIT_TIMEOUT_SECONDS;

  httpd_uri_t stream_uri = {
      .uri = "/stream",
      .method = HTTP_GET,
      .handler = stream_handler,
      .user_ctx = nullptr};

  if (stream_httpd == nullptr) {
    esp_err_t stream_result = httpd_start(&stream_httpd, &stream_config);
    if (stream_result == ESP_OK) {
      httpd_register_uri_handler(stream_httpd, &stream_uri);
    } else {
      Serial.printf("Failed to start stream server: 0x%x\n", stream_result);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(false);
  delay(200);
  loadDeviceConfig();
  serial_request.reserve(SERIAL_REQUEST_LIMIT);

  if (!initSynchronizationPrimitives()) {
    Serial.println("Failed to initialize mutexes. Restarting...");
    delay(WIFI_RETRY_DELAY_MS);
    ESP.restart();
    return;
  }

  if (!initCamera()) {
    Serial.println("Camera unavailable; USB configuration remains available while recovery retries.");
  }

  pinMode(LED_GPIO_NUM, OUTPUT);
  digitalWrite(LED_GPIO_NUM, LOW);

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  wifi_reconfigure_pending = hasWiFiConfig();
  Serial.printf("CCTV firmware %s ready. USB JSON configuration at 115200 baud.\n", FIRMWARE_VERSION);
  if (!hasWiFiConfig()) {
    Serial.println("No Wi-Fi configuration; waiting for USB provisioning.");
  }
  if (xTaskCreatePinnedToCore(publisherTask, "cctv-publish", 12288, nullptr, 1, nullptr, 0) != pdPASS ||
      xTaskCreatePinnedToCore(remoteProfileTask, "cctv-profile", 8192, nullptr, 1, nullptr, 0) != pdPASS) {
    publish_message.store("Unable to start publishing tasks");
    Serial.println("Unable to start publishing tasks; check available memory.");
  }
}

void loop() {
  maintainSerialConfiguration();
  maintainWiFiConnection();
  if (!camera_initialized) {
    (void)recoverCamera("camera unavailable");
  }
  if (WiFi.status() == WL_CONNECTED && (index_httpd == nullptr || stream_httpd == nullptr)) {
    startCameraServer();
  }
  maintainAdaptiveStreamProfile();
  delay(10);
}
