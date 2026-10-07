#include <WiFi.h>
#include <esp_now.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ─── Hardware Config ─────────────────────────────────────────────────────────
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define SCREEN_ADDRESS 0x3C
#define SDA_PIN 21
#define SCL_PIN 22

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ─── Node & Network Config ───────────────────────────────────────────────────
const char* NODE_ID = "NODE-01";
const char* AP_SSID = "DISHA-RESCUE-NET";
const byte DNS_PORT = 53;
const int WIFI_CHANNEL = 1; // Locked to Channel 1

IPAddress apIP(192, 168, 4, 1);

DNSServer dnsServer;
WebServer server(80);

// Universal ESP-NOW Broadcast MAC Address
uint8_t broadcastMAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ─── State Tracking ──────────────────────────────────────────────────────────
int sosMessagesReceived = 0;
String lastFormattedPacket = "";

// ─── Web Templates (PROGMEM) ─────────────────────────────────────────────────
const char PORTAL_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>RESCUE MESH SOS</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, sans-serif; }
    body { background: #0f172a; color: #f8fafc; padding: 16px; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { text-align: center; margin-bottom: 16px; }
    .header h2 { color: #ef4444; font-size: 20px; font-weight: 800; }
    .header p { color: #94a3b8; font-size: 12px; margin-top: 2px; }
    .section-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .cat-btn { background: #0f172a; border: 2px solid #334155; border-radius: 12px; padding: 12px 8px; color: #f8fafc; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .cat-btn.selected { border-color: #ef4444; background: rgba(239, 68, 68, 0.15); color: #fca5a5; }
    .counter-row { display: flex; align-items: center; justify-content: space-between; background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 8px 12px; margin-bottom: 16px; }
    .counter-btn { width: 36px; height: 36px; background: #334155; border: none; border-radius: 8px; color: #fff; font-size: 20px; font-weight: bold; }
    .counter-val { font-size: 18px; font-weight: 800; color: #38bdf8; }
    input[type="text"] { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 12px; color: #fff; font-size: 14px; outline: none; margin-bottom: 16px; }
    .submit-btn { width: 100%; background: linear-gradient(135deg, #dc2626, #991b1b); color: #fff; border: none; border-radius: 12px; padding: 16px; font-size: 15px; font-weight: 800; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2>🚨 EMERGENCY RESCUE</h2>
      <p>Direct Gateway Link • Offline Emergency Mesh</p>
    </div>
    <form id="sosForm" action="/submit" method="POST">
      <input type="hidden" id="code" name="code" value="MED">
      <input type="hidden" id="people" name="people" value="1">
      <div class="section-label">1. Select Emergency Type</div>
      <div class="grid">
        <button type="button" class="cat-btn selected" onclick="selectCategory('MED', this)"><span>🚑</span>Medical</button>
        <button type="button" class="cat-btn" onclick="selectCategory('TRP', this)"><span>🧱</span>Trapped</button>
        <button type="button" class="cat-btn" onclick="selectCategory('MIS', this)"><span>🔍</span>Missing</button>
        <button type="button" class="cat-btn" onclick="selectCategory('FWD', this)"><span>🍞</span>Food/Water</button>
        <button type="button" class="cat-btn" onclick="selectCategory('SHL', this)"><span>⛺</span>Shelter</button>
        <button type="button" class="cat-btn" onclick="selectCategory('SAF', this)"><span>✅</span>I'm Safe</button>
      </div>
      <div class="section-label">2. People Needing Help</div>
      <div class="counter-row">
        <span style="font-size: 13px; color: #cbd5e1;">Total Group Count:</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <button type="button" class="counter-btn" onclick="updatePeople(-1)">-</button>
          <span id="peopleDisp" class="counter-val">1</span>
          <button type="button" class="counter-btn" onclick="updatePeople(1)">+</button>
        </div>
      </div>
      <div class="section-label">3. Brief Note (Optional, Max 40 Chars)</div>
      <input type="text" id="note" name="note" maxlength="40" placeholder="e.g. 2 injured, 1st floor back room">
      <button type="submit" class="submit-btn">BROADCAST SOS ALERT</button>
    </form>
  </div>
  <script>
    let count = 1;
    function selectCategory(code, btn) {
      document.getElementById('code').value = code;
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    }
    function updatePeople(val) {
      count = Math.max(1, Math.min(9, count + val));
      document.getElementById('people').value = count;
      document.getElementById('peopleDisp').innerText = count;
    }
  </script>
</body>
</html>
)rawliteral";

const char SUCCESS_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>REQUEST SENT</title>
  <style>
    body { background: #0f172a; color: #f8fafc; padding: 20px; text-align: center; font-family: -apple-system, sans-serif; display: flex; flex-direction: column; justify-content: center; min-height: 100vh; }
    .card { background: #1e293b; border: 1px solid #10b981; border-radius: 16px; padding: 24px; }
    h2 { color: #34d399; margin-bottom: 8px; font-size: 22px; }
    p { color: #cbd5e1; font-size: 14px; line-height: 1.5; }
    .badge { display: inline-block; background: rgba(52, 211, 153, 0.15); color: #34d399; font-weight: bold; padding: 6px 12px; border-radius: 20px; margin-top: 14px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>✅ REQUEST SENT</h2>
    <p>Your emergency signal has been broadcast across the direct Node-to-Node Mesh Gateway.</p>
    <div class="badge">STATUS: MESH DISPATCH SUCCESS</div>
  </div>
</body>
</html>
)rawliteral";

// ─── OLED UI Helper ──────────────────────────────────────────────────────────
void updateDisplay() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print(F("[ ")); display.print(NODE_ID); display.println(F(" ]"));
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

  display.setCursor(0, 14);
  display.println(F("Mesh Radio: ONLINE"));

  display.setCursor(0, 26);
  display.print(F("Clients: ")); display.print(WiFi.softAPgetStationNum());
  display.print(F(" | SOS: ")); display.println(sosMessagesReceived);

  display.setCursor(0, 38);
  display.print(F("Status: "));
  if (lastFormattedPacket.length() > 0) {
    display.println(F("Sent"));
  } else {
    display.println(F("Listening"));
  }
  display.setCursor(0, 48);
  if (lastFormattedPacket.length() > 0) {
    display.println(lastFormattedPacket.substring(0, 21));
  } else {
    display.println(F("Awaiting SOS..."));
  }
  display.display();
}

// ─── Web Request Handlers ────────────────────────────────────────────────────
void handlePortal() { server.send(200, "text/html", PORTAL_HTML); }

void handleSubmit() {
  String code = server.hasArg("code") ? server.arg("code") : "MED";
  String people = server.hasArg("people") ? server.arg("people") : "1";
  String note = server.hasArg("note") ? server.arg("note") : "";
  if (note.length() > 40) note = note.substring(0, 40);

  lastFormattedPacket = "SOS|" + String(NODE_ID) + "|" + code + "|" + people + "|" + note;
  sosMessagesReceived++;

  // Broadcast packet via ESP-NOW to all listening nodes
  esp_err_t result = esp_now_send(broadcastMAC, (uint8_t *) lastFormattedPacket.c_str(), lastFormattedPacket.length());
  
  if (result == ESP_OK) {
    Serial.println(">>> ESP-NOW BROADCAST SUCCESS <<<");
  } else {
    Serial.println(">>> ESP-NOW BROADCAST FAIL <<<");
  }

  updateDisplay();
  server.send(200, "text/html", SUCCESS_HTML);
}

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);

  if(!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) for(;;);

  // Set AP+STA mode and explicitly lock to Channel 1
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));
  WiFi.softAP(AP_SSID, NULL, WIFI_CHANNEL, 0, 16);

  dnsServer.start(DNS_PORT, "*", apIP);

  server.on("/", handlePortal);
  server.on("/submit", HTTP_POST, handleSubmit);
  server.on("/hotspot-detect.html", handlePortal);
  server.on("/generate_204", handlePortal);
  server.on("/redirect", handlePortal);
  server.onNotFound(handlePortal);
  server.begin();

  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW Init Failed");
    return;
  }

  // Register Broadcast Peer on Channel 1
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, broadcastMAC, 6);
  peerInfo.channel = WIFI_CHANNEL;  
  peerInfo.encrypt = false;
  
  if (esp_now_add_peer(&peerInfo) != ESP_OK){
    Serial.println("Failed to add broadcast peer");
    return;
  }

  updateDisplay();
}

// ─── Loop ────────────────────────────────────────────────────────────────────
void loop() {
  dnsServer.processNextRequest();
  server.handleClient();

  static unsigned long lastRefresh = 0;
  if (millis() - lastRefresh > 2000) {
    lastRefresh = millis();
    updateDisplay();
  }

  static unsigned long lastHb = 0;
  if (millis() - lastHb > 3000) {
    lastHb = millis();
    String hb = "HB|" + String(NODE_ID);
    esp_now_send(broadcastMAC, (uint8_t *) hb.c_str(), hb.length());
  }
}
