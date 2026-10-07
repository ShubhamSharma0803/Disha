"""Unit tests for backend/gateway/serial_parser.py.

Run:
    pytest backend/tests/test_serial_parser.py -v
"""
from __future__ import annotations

import json
import pytest

from backend.gateway.serial_parser import parse_line


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _line(obj: dict) -> str:
    return json.dumps(obj)


# ---------------------------------------------------------------------------
# Should return None (silently dropped)
# ---------------------------------------------------------------------------

class TestDropped:
    def test_empty_string(self):
        assert parse_line("") is None

    def test_whitespace_only(self):
        assert parse_line("   \n") is None

    def test_plain_text(self):
        assert parse_line("ets Jun  8 2016 00:22:57") is None

    def test_partial_json(self):
        assert parse_line('{"t":"SOS"') is None  # truncated

    def test_no_t_field(self):
        assert parse_line('{"foo": "bar"}') is None

    def test_unknown_t(self):
        assert parse_line('{"t":"XYZ","node":"HW-01"}') is None

    def test_sos_missing_lat(self):
        assert parse_line('{"t":"SOS","node":"HW-01","cat":"TRP","n":2,"lon":77.9}') is None

    def test_sos_missing_lon(self):
        assert parse_line('{"t":"SOS","node":"HW-01","cat":"TRP","n":2,"lat":30.3}') is None

    def test_snf_missing_dev(self):
        assert parse_line('{"t":"SNF","node":"HW-01","rssi":-70}') is None

    def test_snf_missing_rssi(self):
        assert parse_line('{"t":"SNF","node":"HW-01","dev":"abc123"}') is None

    def test_not_a_dict(self):
        assert parse_line("[1,2,3]") is None

    def test_debug_log_line(self):
        assert parse_line("[DEBUG] tx_queue depth=2") is None


# ---------------------------------------------------------------------------
# SOS
# ---------------------------------------------------------------------------

class TestSOS:
    def test_minimal(self):
        raw = _line({"t": "SOS", "node": "HW-01", "cat": "TRP", "n": 3,
                     "lat": 30.3256, "lon": 77.9423})
        r = parse_line(raw)
        assert r is not None
        assert r["kind"] == "SOS"
        assert r["node"] == "HW-01"
        assert r["cat"] == "TRP"
        assert r["n"] == 3
        assert r["lat"] == pytest.approx(30.3256)
        assert r["lon"] == pytest.approx(77.9423)
        assert r["source_kind"] == "hardware"

    def test_with_bat(self):
        raw = _line({"t": "SOS", "node": "HW-02", "cat": "MED", "n": 1,
                     "lat": 30.0, "lon": 78.0, "bat": 55})
        r = parse_line(raw)
        assert r["bat"] == 55

    def test_lowercase_t(self):
        raw = _line({"t": "sos", "node": "HW-01", "cat": "MED", "n": 1,
                     "lat": 30.0, "lon": 78.0})
        r = parse_line(raw)
        assert r is not None
        assert r["kind"] == "SOS"

    def test_n_clamped_high(self):
        raw = _line({"t": "SOS", "node": "HW-01", "cat": "TRP", "n": 99,
                     "lat": 30.0, "lon": 78.0})
        r = parse_line(raw)
        assert r["n"] == 9

    def test_n_clamped_low(self):
        raw = _line({"t": "SOS", "node": "HW-01", "cat": "TRP", "n": -5,
                     "lat": 30.0, "lon": 78.0})
        r = parse_line(raw)
        assert r["n"] == 1

    def test_unknown_cat_defaults_to_MIS(self):
        raw = _line({"t": "SOS", "node": "HW-01", "cat": "BOGUS", "n": 2,
                     "lat": 30.0, "lon": 78.0})
        r = parse_line(raw)
        assert r["cat"] == "MIS"

    def test_all_valid_cats(self):
        for cat in ("MED", "TRP", "MIS", "FWD", "SHL", "SAF"):
            raw = _line({"t": "SOS", "node": "HW-01", "cat": cat, "n": 1,
                         "lat": 30.0, "lon": 78.0})
            r = parse_line(raw)
            assert r["cat"] == cat


# ---------------------------------------------------------------------------
# SNF
# ---------------------------------------------------------------------------

class TestSNF:
    def test_minimal(self):
        raw = _line({"t": "SNF", "node": "HW-01", "dev": "a3f9c1", "rssi": -71})
        r = parse_line(raw)
        assert r is not None
        assert r["kind"] == "SNF"
        assert r["dev"] == "a3f9c1"
        assert r["rssi"] == -71
        assert r["source_kind"] == "hardware"

    def test_with_channel(self):
        raw = _line({"t": "SNF", "node": "HW-01", "dev": "abc", "rssi": -60, "ch": 6})
        r = parse_line(raw)
        assert r["ch"] == 6

    def test_ch_clamped(self):
        raw = _line({"t": "SNF", "node": "HW-01", "dev": "abc", "rssi": -60, "ch": 99})
        r = parse_line(raw)
        assert r["ch"] == 13  # clamped to max


# ---------------------------------------------------------------------------
# HB
# ---------------------------------------------------------------------------

class TestHB:
    def test_minimal(self):
        raw = _line({"t": "HB", "node": "HW-01"})
        r = parse_line(raw)
        assert r is not None
        assert r["kind"] == "HB"
        assert r["node"] == "HW-01"
        assert r["source_kind"] == "hardware"

    def test_with_bat(self):
        raw = _line({"t": "HB", "node": "HW-02", "bat": 65})
        r = parse_line(raw)
        assert r["bat"] == 65

    def test_bat_clamped(self):
        raw = _line({"t": "HB", "node": "HW-01", "bat": 150})
        r = parse_line(raw)
        assert r["bat"] == 100
