#include <ESP8266WiFi.h>
#include <espnow.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

extern "C" {
  #include "user_interface.h"
}

// ===== SETTINGS =====
#define NODE_ID      "NODE-02"
#define SALT         0x5A17C0DEUL
#define LOCK_CHANNEL 1        // must match Node 1
#define MIN_RSSI     -100     // example: -70 = nearby devices only
#define USE_DUMMY_AP 1        // 1 = teammate's original setup; 0 = plain station mode (try if sniffing prints nothing)
#define TIMESLICE    0        // 1 = sniff only part of the time (try if SOS packets get lost)
const uint32_t SNIFF_MS = 3000, LISTEN_MS = 7000;
// ====================

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define SCREEN_ADDRESS 0x3C
#define SDA_PIN 4
#define SCL_PIN 5
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ---- SOS state (teammate's part) ----
String lastRxPacket = "No Alerts Received";
int totalRxCount = 0;
volatile bool newPacketReceived = false;
bool sniffMode = false;

// ---- Sniffer state (your part) ----
struct Obs { uint8_t mac[6]; int8_t rssi; uint8_t ch; };
Obs q[32];
volatile uint8_t qHead = 0, qTail = 0;
volatile uint8_t currentChannel = LOCK_CHANNEL;

#define MAX_DEV 80
uint32_t devHash[MAX_DEV], devSeen[MAX_DEV];
int8_t devRssi[MAX_DEV];
uint32_t lastSummary = 0;

uint32_t hashMac(const uint8_t* d) {
  uint32_t h = 2166136261UL ^ SALT;
  for (int i = 0; i < 6; i++) { h ^= d[i]; h *= 16777619UL; }
  return h;
}

void noteDevice(uint32_t h, int rssi) {
  uint32_t now = millis();
  int slot = -1;
  for (int i = 0; i < MAX_DEV; i++)
    if (devSeen[i] != 0 && devHash[i] == h) { slot = i; break; }
  if (slot < 0)
    for (int i = 0; i < MAX_DEV; i++)
      if (devSeen[i] == 0 || now - devSeen[i] > 60000) { slot = i; break; }
  if (slot < 0) return;
  devHash[slot] = h; devSeen[slot] = now; devRssi[slot] = rssi;
}

// Sniffer callback: capture all 802.11 probe requests (0x40) of any valid length
void sniffer(uint8_t* buf, uint16_t len) {
  if (!sniffMode) return;
  if (len < 36) return;              // minimum 802.11 mgmt frame with RxControl header
  if (buf[12] != 0x40) return;       // 0x40 = probe request
  uint8_t next = (qHead + 1) % 32;
  if (next == qTail) return;         // queue full, drop
  memcpy(q[qHead].mac, buf + 22, 6); // sender address (bytes 22-27)
  q[qHead].rssi = (int8_t)buf[0];    // first byte of RxControl = RSSI
  q[qHead].ch = currentChannel;
  qHead = next;
}

void OnDataRecv(uint8_t* mac, uint8_t* incomingData, uint8_t len) {
  if (sniffMode) return;             // ignore when in sniffing mode
  char packet[128];
  int n = (len > 127) ? 127 : len;
  memcpy(packet, incomingData, n);
  packet[n] = '\0';
  lastRxPacket = String(packet);
  totalRxCount++;
  newPacketReceived = true;
}

void updateGatewayDisplay() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);  display.println(F("[ NODE-02 GATEWAY ]"));
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
  display.setCursor(0, 14); display.println(sniffMode ? "Mode: SNIFFING (ON)" : "Mode: NORMAL (SOS ON)");
  display.setCursor(0, 26); display.print(F("Alerts Received: ")); display.println(totalRxCount);
  display.setCursor(0, 38); display.println(F("Latest Payload:"));
  display.setCursor(0, 48); display.println(lastRxPacket.substring(0, 21));
  display.display();
}

void applyMode(bool sniff) {
  wifi_promiscuous_enable(0);
  esp_now_deinit();
  if (sniff) {                       // SNIFF MODE: Promiscuous ON, ESP-NOW OFF
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    currentChannel = LOCK_CHANNEL;
    wifi_set_channel(currentChannel);
    wifi_set_promiscuous_rx_cb(sniffer);
    wifi_promiscuous_enable(1);
    qHead = 0;
    qTail = 0;
  } else {                           // NORMAL MODE: ESP-NOW ON, Promiscuous OFF
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP("NODE2_DUMMY", NULL, LOCK_CHANNEL, 0);
    currentChannel = LOCK_CHANNEL;
    wifi_set_channel(LOCK_CHANNEL);
    if (esp_now_init() == 0) {
      esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
      esp_now_register_recv_cb(OnDataRecv);
    } else Serial.println("Error initializing ESP-NOW");
  }
  sniffMode = sniff;
  Serial.printf("{\"event\":\"MODE\",\"node_id\":\"%s\",\"mode\":\"%s\"}\n",
                NODE_ID, sniff ? "SNIFF" : "NORMAL");
  updateGatewayDisplay();
}

void handleCommands() {              // laptop sends "MODE SNIFF" or "MODE NORMAL"
  while (Serial.available()) {
    String c = Serial.readStringUntil('\n');
    c.trim();
    if (c.indexOf("MODE SNIFF") >= 0) {
      applyMode(true);
    } else if (c.indexOf("MODE NORMAL") >= 0) {
      applyMode(false);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== RESCUE NODE 2 (ESP8266 GATEWAY + SNIFFER) ONLINE ===");

  Wire.begin(SDA_PIN, SCL_PIN);
  if (display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) updateGatewayDisplay();

  wifi_set_sleep_type(NONE_SLEEP_T);
  applyMode(false);        // start in NORMAL mode
}

void loop() {
  handleCommands();

  // Channel hopping across 1, 6, 11 in SNIFF mode to catch all Wi-Fi probes
  static uint32_t lastHop = 0;
  static uint8_t chIdx = 0;
  const uint8_t hopChannels[] = {1, 6, 11};
  if (sniffMode && millis() - lastHop > 300) {
    lastHop = millis();
    chIdx = (chIdx + 1) % 3;
    currentChannel = hopChannels[chIdx];
    wifi_set_channel(currentChannel);
  }

  // 1) SOS packet or heartbeat from Node 1 (NORMAL MODE ONLY)
  if (!sniffMode && newPacketReceived) {
    newPacketReceived = false;
    if (lastRxPacket.startsWith("HB|")) {
      String fromNode = lastRxPacket.substring(3);
      Serial.printf("{\"event\":\"HB\",\"node_id\":\"%s\",\"ms\":%lu}\n",
                    fromNode.c_str(), millis());
    } else {
      Serial.println("\n==========================================");
      Serial.println("[NODE 2 GATEWAY]: EMERGENCY PACKET RX!");
      Serial.print("Payload: "); Serial.println(lastRxPacket);
      Serial.println("==========================================");
      String p = lastRxPacket;
      p.replace("\"", "'");
      p.replace("\r", " ");
      p.replace("\n", " ");
      p.trim();
      Serial.printf("{\"event\":\"SOS_RX\",\"node_id\":\"%s\",\"payload\":\"%s\",\"ms\":%lu}\n",
                    NODE_ID, p.c_str(), millis());
      updateGatewayDisplay();
    }
  }

  // 2) Sniffed probe requests (SNIFF MODE ONLY)
  if (sniffMode) {
    while (qTail != qHead) {
      Obs o = q[qTail];
      qTail = (qTail + 1) % 32;
      if (o.rssi < MIN_RSSI) continue;
      uint32_t h = hashMac(o.mac);
      noteDevice(h, o.rssi);
      Serial.printf("{\"event\":\"SEARCH_OBSERVATION\",\"node_id\":\"%s\",\"device_hash\":\"%08X\","
                    "\"rssi\":%d,\"channel\":%d,\"rand\":%d,\"ms\":%lu}\n",
                    NODE_ID, h, o.rssi, o.ch, (o.mac[0] & 0x02) ? 1 : 0, millis());
    }

    // 3) Device count every 5 s in sniff mode
    uint32_t now = millis();
    if (now - lastSummary > 5000) {
      lastSummary = now;
      int total = 0, close = 0;
      for (int i = 0; i < MAX_DEV; i++)
        if (devSeen[i] != 0 && now - devSeen[i] < 60000) { total++; if (devRssi[i] > -70) close++; }
      Serial.printf("{\"event\":\"DEVICE_COUNT\",\"node_id\":\"%s\",\"signals_60s\":%d,\"close_60s\":%d}\n",
                    NODE_ID, total, close);
    }
  }

  yield();
}
