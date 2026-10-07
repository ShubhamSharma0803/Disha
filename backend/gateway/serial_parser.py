"""Parse raw ESP32 serial lines into typed events.

Wire format is defined in docs/protocol.md §8.
Each line is a single JSON object terminated by \\n.
Any line that is not valid JSON, or has no ``"t"`` field, is silently dropped
so that ESP32 boot-logs and debug text never crash the bridge.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# Valid SOS category codes (maps 1-to-1 with backend VALID_CODES)
_VALID_CATS = {"MED", "TRP", "MIS", "FWD", "SHL", "SAF"}

# Fallback when cat is unknown
_DEFAULT_CAT = "MIS"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp(value: Any, lo: int, hi: int, default: int) -> int:
    try:
        v = int(value)
        return max(lo, min(hi, v))
    except (TypeError, ValueError):
        return default


def parse_line(raw: str) -> Optional[Dict[str, Any]]:
    """Parse one raw serial line.

    Returns a normalised dict with a ``"kind"`` key:
      - ``"SOS"``   - emergency packet
      - ``"SNF"``   - Wi-Fi sniff observation
      - ``"HB"``    - heartbeat
    Returns ``None`` if the line should be silently discarded.
    """
    raw = raw.strip()
    if not raw:
        return None

    # Must be valid JSON
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        return None

    if not isinstance(obj, dict):
        return None

    # Check for event format from Node 2 (e.g. {"event":"SOS_RX", ...})
    ev = obj.get("event")
    if isinstance(ev, str):
        ev = ev.upper()
        if ev == "SOS_RX":
            payload = str(obj.get("payload", ""))
            parts = payload.split("|")
            source_node = parts[1] if len(parts) > 1 and parts[1] else str(obj.get("node_id", "NODE-01"))
            cat = parts[2].upper() if len(parts) > 2 and parts[2].upper() in _VALID_CATS else _DEFAULT_CAT
            n = _clamp(parts[3] if len(parts) > 3 else 1, 1, 9, 1)
            note = parts[4] if len(parts) > 4 else ""
            try:
                lat = float(obj.get("lat", 30.3256))
                lon = float(obj.get("lon", 77.9423))
            except (TypeError, ValueError):
                lat, lon = 30.3256, 77.9423

            return {
                "kind": "SOS",
                "node": source_node,
                "cat": cat,
                "n": n,
                "note": note,
                "lat": lat,
                "lon": lon,
                "bat": _clamp(obj.get("bat"), 0, 100, -1),
                "timestamp": _now_iso(),
                "source_kind": "hardware",
            }

        elif ev == "SEARCH_OBSERVATION":
            dev = obj.get("device_hash") or obj.get("dev")
            if not dev:
                return None
            try:
                rssi = int(obj["rssi"])
            except (KeyError, TypeError, ValueError):
                return None
            return {
                "kind": "SNF",
                "node": str(obj.get("node_id", obj.get("node", "NODE-02"))),
                "dev": str(dev),
                "rssi": rssi,
                "ch": _clamp(obj.get("channel", obj.get("ch")), 1, 13, 0) or None,
                "bat": _clamp(obj.get("bat"), 0, 100, -1),
                "timestamp": _now_iso(),
                "source_kind": "hardware",
            }

        elif ev == "HB":
            return {
                "kind": "HB",
                "node": str(obj.get("node_id", obj.get("node", "NODE-01"))),
                "bat": _clamp(obj.get("bat"), 0, 100, -1),
                "timestamp": _now_iso(),
                "source_kind": "hardware",
            }

    t = obj.get("t")
    if not isinstance(t, str):
        return None

    t = t.upper()

    # ------------------------------------------------------------------ SOS --
    if t == "SOS":
        cat = str(obj.get("cat", "")).upper()
        if cat not in _VALID_CATS:
            cat = _DEFAULT_CAT

        try:
            lat = float(obj["lat"])
            lon = float(obj["lon"])
        except (KeyError, TypeError, ValueError):
            return None  # lat/lon are mandatory

        return {
            "kind": "SOS",
            "node": str(obj.get("node", "HW-UNKNOWN")),
            "cat": cat,
            "n": _clamp(obj.get("n", 1), 1, 9, 1),
            "lat": lat,
            "lon": lon,
            "bat": _clamp(obj.get("bat"), 0, 100, -1),
            "timestamp": _now_iso(),
            "source_kind": "hardware",
        }

    # ------------------------------------------------------------------ SNF --
    if t == "SNF":
        dev = obj.get("dev")
        if not dev:
            return None  # device identifier is mandatory

        try:
            rssi = int(obj["rssi"])
        except (KeyError, TypeError, ValueError):
            return None  # rssi is mandatory

        return {
            "kind": "SNF",
            "node": str(obj.get("node", "HW-UNKNOWN")),
            "dev": str(dev),
            "rssi": rssi,
            "ch": _clamp(obj.get("ch"), 1, 13, 0) or None,
            "bat": _clamp(obj.get("bat"), 0, 100, -1),
            "timestamp": _now_iso(),
            "source_kind": "hardware",
        }

    # ------------------------------------------------------------------- HB --
    if t == "HB":
        return {
            "kind": "HB",
            "node": str(obj.get("node", "HW-UNKNOWN")),
            "bat": _clamp(obj.get("bat"), 0, 100, -1),
            "timestamp": _now_iso(),
            "source_kind": "hardware",
        }

    # Unknown type - silently drop
    return None
