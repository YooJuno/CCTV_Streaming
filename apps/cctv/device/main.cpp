#include <Arduino.h>
#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"
#include "img_converters.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <cstring>

#define WIFI_SSID "JUNO_HOME_2.4G"
#define WIFI_PASSWORD "juno980220@"

const char *WIFI_SSID_VALUE = WIFI_SSID;
const char *WIFI_PASSWORD_VALUE = WIFI_PASSWORD;

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

static bool usingPlaceholderCredentials() {
  return strcmp(WIFI_SSID_VALUE, "YOUR_WIFI_SSID") == 0 || strcmp(WIFI_PASSWORD_VALUE, "YOUR_WIFI_PASSWORD") == 0;
}

static bool initSynchronizationPrimitives() {
  if (camera_mutex == nullptr) {
    camera_mutex = xSemaphoreCreateMutex();
  }
  if (stream_client_mutex == nullptr) {
    stream_client_mutex = xSemaphoreCreateMutex();
  }
  return camera_mutex != nullptr && stream_client_mutex != nullptr;
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
      sensor->set_framesize(sensor, target_frame_size);
      sensor->set_quality(sensor, target_quality);
      applied = true;
    }
  } else {
    applied = true;
  }

  if (applied) {
    stream_min_frame_interval_ms = fpsToIntervalMs(target_fps);
    active_stream_profile = profile;
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
  uint32_t now = millis();
  if (now - last_stream_profile_eval_ms < STREAM_PROFILE_EVAL_INTERVAL_MS) {
    return;
  }
  last_stream_profile_eval_ms = now;
  StreamProfile target_profile = selectStreamProfileForRssi(WiFi.RSSI());
  (void)applyStreamProfile(target_profile, false);
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
    config.frame_size = STREAM_BALANCED_FRAME_SIZE;
    config.jpeg_quality = STREAM_BALANCED_JPEG_QUALITY;
    config.fb_count = 2;
#if defined(CAMERA_GRAB_LATEST)
    config.grab_mode = CAMERA_GRAB_LATEST;
#endif
#if defined(CAMERA_FB_IN_PSRAM)
    config.fb_location = CAMERA_FB_IN_PSRAM;
#endif
  } else {
    config.frame_size = STREAM_RESILIENT_FRAME_SIZE;
    config.jpeg_quality = STREAM_RESILIENT_JPEG_QUALITY;
    config.fb_count = 1;
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

static void logWiFiConfigWarning() {
  if (usingPlaceholderCredentials()) {
    Serial.println("[ERROR] WIFI_SSID/WIFI_PASSWORD are placeholders.");
    Serial.println("Set WIFI_SSID/WIFI_PASSWORD in main.cpp.");
  }
}

static bool connectWiFi(uint32_t timeout_ms) {
  if (usingPlaceholderCredentials()) {
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
#if defined(WIFI_POWER_19_5dBm)
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
#endif
  WiFi.disconnect(false, true);
  delay(100);
  WiFi.begin(WIFI_SSID_VALUE, WIFI_PASSWORD_VALUE);

  uint32_t start_ms = millis();
  Serial.printf("Connecting to Wi-Fi SSID: %s", WIFI_SSID_VALUE);
  while (WiFi.status() != WL_CONNECTED && (millis() - start_ms) < timeout_ms) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

static void maintainWiFiConnection() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifi_connected_once) {
      wifi_connected_once = true;
      Serial.println("Wi-Fi connected.");
    }
    wifi_reconnect_failures = 0;
    return;
  }

  if (usingPlaceholderCredentials()) {
    return;
  }

  uint32_t now = millis();
  if (now - last_wifi_reconnect_attempt_ms < WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }
  last_wifi_reconnect_attempt_ms = now;
  Serial.println("[WARN] Wi-Fi disconnected. Attempting reconnect...");

  bool connected = connectWiFi(WIFI_CONNECT_TIMEOUT_MS);
  if (connected) {
    wifi_reconnect_failures = 0;
    Serial.print("Wi-Fi reconnected. IP: ");
    Serial.println(WiFi.localIP());
    return;
  }

  wifi_reconnect_failures++;
  Serial.printf("[WARN] Wi-Fi reconnect failed (%u/%u)\n", wifi_reconnect_failures, WIFI_MAX_RECONNECT_FAILURES);
  if (wifi_reconnect_failures >= WIFI_MAX_RECONNECT_FAILURES) {
    Serial.println("[ERROR] Too many Wi-Fi reconnect failures. Restarting...");
    delay(WIFI_RETRY_DELAY_MS);
    ESP.restart();
  }
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
  if (xSemaphoreTake(stream_client_mutex, 0) != pdTRUE) {
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

  while (res == ESP_OK) {
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

  esp_err_t index_result = httpd_start(&index_httpd, &config);
  if (index_result == ESP_OK) {
    httpd_register_uri_handler(index_httpd, &index_uri);
    httpd_register_uri_handler(index_httpd, &health_uri);
  } else {
    Serial.printf("Failed to start index server: 0x%x\n", index_result);
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

  esp_err_t stream_result = httpd_start(&stream_httpd, &stream_config);
  if (stream_result == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
  } else {
    Serial.printf("Failed to start stream server: 0x%x\n", stream_result);
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(false);
  delay(200);

  if (!initSynchronizationPrimitives()) {
    Serial.println("Failed to initialize mutexes. Restarting...");
    delay(WIFI_RETRY_DELAY_MS);
    ESP.restart();
    return;
  }

  if (!initCamera()) {
    delay(WIFI_RETRY_DELAY_MS);
    ESP.restart();
    return;
  }

  pinMode(LED_GPIO_NUM, OUTPUT);
  digitalWrite(LED_GPIO_NUM, LOW);

  logWiFiConfigWarning();
  if (!connectWiFi(WIFI_CONNECT_TIMEOUT_MS)) {
    Serial.println("Wi-Fi connection timeout. Restarting...");
    delay(WIFI_RETRY_DELAY_MS);
    ESP.restart();
    return;
  }

  IPAddress ip = WiFi.localIP();
  Serial.print("Wi-Fi connected. IP address: ");
  Serial.println(ip);
  Serial.print("Open http://");
  Serial.print(ip);
  Serial.println("/ for status page.");
  Serial.print("MJPEG stream: http://");
  Serial.print(ip);
  Serial.println(":81/stream");

  StreamProfile initial_profile = selectStreamProfileForRssi(WiFi.RSSI());
  if (!applyStreamProfile(initial_profile, true)) {
    Serial.println("[WARN] Failed to apply initial stream profile.");
  }

  startCameraServer();
  wifi_connected_once = true;
}

void loop() {
  maintainWiFiConnection();
  maintainAdaptiveStreamProfile();
  delay(1000);
}
