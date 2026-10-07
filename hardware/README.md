# Hardware Module

This directory contains the firmware sketches, hardware configurations, serial bridge script, and localization/state backend for the physical nodes in the Disha Emergency Network.

---

## 1. ESP32 Node 1 Firmware (`hardware/esp32/`)

### Files
- [`hardware/esp32/node_01/node_01.ino`](file:///Users/sanyamnandal/drone-3d-simulator/hardware/esp32/node_01/node_01.ino): Arduino IDE project sketch for Node 1.
- [`hardware/esp32/node_01.ino`](file:///Users/sanyamnandal/drone-3d-simulator/hardware/esp32/node_01.ino): Direct sketch file.

### Hardware Components & Pinout
- **MCU**: ESP32 Dev Module
- **Display**: SSD1306 0.96" I2C OLED (128x64, address `0x3C`)
  - `SDA`: GPIO 21
  - `SCL`: GPIO 22
- **Wi-Fi Mode**: AP + STA (locked to Wi-Fi Channel 1 for ESP-NOW synchronization)
- **Captive Portal**:
  - SSID: `RESCUE_NODE_01`
  - IP: `192.168.4.1`
  - DNS Server: Port 53 (redirects all requests to captive emergency portal)

### Message Format (ESP-NOW Payload)
When an SOS report is submitted via the captive portal, the node formats the payload as:
```text
SOS|<NODE_ID>|<CATEGORY_CODE>|<PEOPLE_COUNT>|<NOTE>
```

---

## 2. ESP8266 Node 2 Firmware (`hardware/esp8266/`)

### Files
- [`hardware/esp8266/node_02/node_02.ino`](file:///Users/sanyamnandal/drone-3d-simulator/hardware/esp8266/node_02/node_02.ino): Arduino IDE project sketch for Node 2.
- [`hardware/esp8266/node_02.ino`](file:///Users/sanyamnandal/drone-3d-simulator/hardware/esp8266/node_02.ino): Direct sketch file.

### Roles & Features
1. **ESP-NOW SOS Receiver (Normal Mode)**:
   - Receives raw broadcast ESP-NOW packets from Node 1 on Channel 1.
   - Emits structured JSON event over serial (`event: "SOS_RX"`).
2. **Wi-Fi Sniffing (Sniff Mode)**:
   - Promiscuous mode Wi-Fi frame capture for probe requests (`0x40`).
   - One-way salted hash of MAC addresses (`FNV-1a` with salt) for privacy-preserving victim detection.
   - Emits `event: "SEARCH_OBSERVATION"` and periodic `event: "DEVICE_COUNT"`.
3. **Serial Command Switching**:
   - Accepts `MODE SNIFF` and `MODE NORMAL` commands via Serial (115200 baud).

---

## 3. Serial Bridge (`hardware/bridge_v2.py`)

Communicates over USB serial with the hardware gateway (e.g. Node 2 / ESP8266) and bridges telemetry and SOS alerts to the FastAPI backend.

### Usage
```bash
python bridge_v2.py <SERIAL_PORT>
# Example: python bridge_v2.py /dev/cu.usbserial-0001 (macOS) or COM15 (Windows)
```

---

## 4. Hardware Backend API (`hardware/backend.py`)

FastAPI server that manages state, mode switching (`NORMAL` vs `SNIFF`), and trilateration / weighted RSSI distance estimation for victim localization.

### Endpoints
- `POST /api/search-observation`: Ingests sniffed probe requests.
- `GET /api/mode` / `POST /api/mode`: Queries or requests node mode change.
- `POST /api/mode-actual`: Reports node mode confirmation from hardware.
- `POST /api/sos`: Stores incoming emergency packets.
- `GET /api/state`: Computes RSSI distance estimation and returns real-time node and victim positions.
- `GET /`: Serves `dashboard.html`.

### Run Backend
```bash
uvicorn backend:app --reload --port 8000
```
