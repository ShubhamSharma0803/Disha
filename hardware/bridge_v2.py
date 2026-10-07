import sys, json, time, serial, requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Usage:  python bridge_v2.py COM15
PORT = sys.argv[1] if len(sys.argv) > 1 else "COM15"
BASE = "http://localhost:8000"

print(f"Bridge starting for {PORT} -> {BASE}")
sent_mode = None
last_poll = 0


def post(path, data):
    try:
        requests.post(BASE + path, json=data, timeout=2)
    except requests.RequestException as e:
        print("backend not reachable:", e)


while True:
    try:
        print(f"Connecting to {PORT}...")
        with serial.Serial(PORT, 115200, timeout=0.3) as ser:
            print(f"Connected to {PORT}! Listening for packets...")
            sent_mode = None

            want = None
            while True:
                # 1) dashboard button -> ESP8266 (check mode every 0.4s)
                if time.time() - last_poll > 0.4:
                    last_poll = time.time()
                    try:
                        want = requests.get(BASE + "/api/mode", timeout=2).json().get("want")
                        if want and want != sent_mode:
                            ser.write(f"MODE {want}\n".encode())
                            ser.flush()
                            sent_mode = want
                            print(f"sent command to Node 2: MODE {want}")
                    except requests.RequestException:
                        pass

                # 2) ESP8266 -> dashboard
                raw = ser.readline().decode(errors="ignore").replace("\r", "").strip()
                if not raw:
                    continue

                if "{" not in raw or "}" not in raw:
                    print("RX (text):", raw[:100])
                    continue

                start = raw.index("{")
                end = raw.rindex("}") + 1
                json_part = raw[start:end]

                try:
                    o = json.loads(json_part)
                except json.JSONDecodeError:
                    continue

                ev = o.get("event")
                if ev == "SEARCH_OBSERVATION":
                    o["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    post("/api/search-observation", o)
                elif ev == "SOS_RX":
                    print("SOS RECEIVED:", o.get("payload"))
                    post("/api/sos", o)
                elif ev == "MODE":
                    actual = o.get("mode")
                    print("node mode confirmed:", actual)
                    post("/api/mode-actual", o)
                    if want and actual != want:
                        ser.write(f"MODE {want}\n".encode())
                        ser.flush()
                        sent_mode = want

    except (serial.SerialException, PermissionError, OSError) as e:
        print(f"Waiting for {PORT} (in use by Arduino IDE or disconnected): {e}")
        time.sleep(2)
