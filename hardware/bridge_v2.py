import sys, json, time, serial, requests

# Usage:  python bridge_v2.py COM15
PORT = sys.argv[1] if len(sys.argv) > 1 else "COM15"
BASE = "http://localhost:8000"

ser = serial.Serial(PORT, 115200, timeout=0.3)
print("Listening on", PORT, "->", BASE)
sent_mode, last_poll = None, 0


def post(path, data):
    try:
        requests.post(BASE + path, json=data, timeout=2)
    except requests.RequestException as e:
        print("backend not reachable:", e)


while True:
    # 1) dashboard button -> ESP8266 (check once per second)
    if time.time() - last_poll > 1:
        last_poll = time.time()
        try:
            want = requests.get(BASE + "/api/mode", timeout=2).json()["want"]
            if want != sent_mode:
                ser.write(("MODE " + want + "\n").encode())
                sent_mode = want
                print("sent command: MODE", want)
        except requests.RequestException:
            pass

    # 2) ESP8266 -> dashboard
    line = ser.readline().decode(errors="ignore").strip()
    if line: print("RX:", line[:100])
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except json.JSONDecodeError:
        continue
    ev = o.get("event")
    if ev == "SEARCH_OBSERVATION":
        o["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        post("/api/search-observation", o)
    elif ev == "SOS_RX":
        print("SOS:", o["payload"])
        post("/api/sos", o)
    elif ev == "MODE":
        print("node mode is now", o["mode"])
        post("/api/mode-actual", o)
