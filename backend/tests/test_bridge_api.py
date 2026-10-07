"""Tests for the hardware serial bridge API endpoints.

Covers:
- Task 5: SOS from an unknown topology node (HW-01) creates a card,
  emits EMERGENCY_CREATED + PACKET_DELIVERED, does not crash.
- Task 6: GET /gateway/status returns "simulated" by default,
  "mock" after POST /bridge/status, back to "simulated" after 10 s
  (monotonic clock is mocked).
"""
from __future__ import annotations

import os
import sys
import time
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.main import app
import backend.gateway.bridge_api as bridge_api_module


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_gw_state() -> None:
    """Reset the in-process bridge state so tests are independent."""
    bridge_api_module._gw_state.update({
        "mode": "simulated",
        "port": None,
        "connected": False,
        "last_packet_ts": None,
        "packets_received": 0,
        "packets_ignored": 0,
        "_last_status_ts": None,
    })
    bridge_api_module._hw_nodes.clear()


# ---------------------------------------------------------------------------
# Task 5: Unknown-node SOS
# ---------------------------------------------------------------------------

class TestUnknownNodeSOS:
    """HW-01 is not in the planned mesh topology. Ingest must still work."""

    def test_sos_from_unknown_node_creates_card(self):
        _reset_gw_state()
        with TestClient(app) as client:
            payload = {
                "kind": "SOS",
                "node": "HW-01",
                "cat": "TRP",
                "n": 3,
                "lat": 30.3256,
                "lon": 77.9423,
                "bat": 82,
                "timestamp": "2026-10-07T10:00:00+00:00",
                "source_kind": "hardware",
            }
            res = client.post("/bridge/ingest", json=payload)
            assert res.status_code == 200, res.text
            body = res.json()
            assert body["status"] == "ok"
            assert body["kind"] == "SOS"
            assert "packet_id" in body

    def test_sos_from_unknown_node_appears_in_sos_list(self):
        """After ingest, the SOS must appear in GET /sos ranked list."""
        _reset_gw_state()
        # Clear existing SOS entries
        from backend.simulation.sos import sos_tracker
        sos_tracker.clear()

        with TestClient(app) as client:
            payload = {
                "kind": "SOS",
                "node": "HW-01",
                "cat": "TRP",
                "n": 2,
                "lat": 30.32,
                "lon": 77.94,
                "bat": 75,
                "source_kind": "hardware",
            }
            ingest_res = client.post("/bridge/ingest", json=payload)
            assert ingest_res.status_code == 200

            sos_res = client.get("/sos")
            assert sos_res.status_code == 200
            entries = sos_res.json()
            assert len(entries) >= 1

            hw_entries = [e for e in entries if e["source"] == "HW-01"]
            assert len(hw_entries) >= 1
            assert hw_entries[0]["source_kind"] == "hardware"
            assert hw_entries[0]["code"] == "TRP"

    def test_sos_emits_emergency_created_and_delivered(self):
        """EMERGENCY_CREATED and PACKET_DELIVERED must both be emitted."""
        _reset_gw_state()
        from backend.node import events as ev_bus

        received: list[dict[str, Any]] = []

        def _capture(event: dict) -> None:
            received.append(event)

        ev_bus.register(_capture)
        try:
            with TestClient(app) as client:
                payload = {
                    "kind": "SOS",
                    "node": "HW-01",
                    "cat": "MED",
                    "n": 1,
                    "lat": 30.32,
                    "lon": 77.94,
                    "bat": 60,
                    "source_kind": "hardware",
                }
                res = client.post("/bridge/ingest", json=payload)
                assert res.status_code == 200

            event_types = {e.get("event") for e in received}
            assert "EMERGENCY_CREATED" in event_types, f"Got: {event_types}"
            assert "PACKET_DELIVERED" in event_types, f"Got: {event_types}"
        finally:
            ev_bus.unregister(_capture)

    def test_sos_missing_lat_returns_422(self):
        _reset_gw_state()
        with TestClient(app) as client:
            payload = {
                "kind": "SOS",
                "node": "HW-01",
                "cat": "TRP",
                "n": 1,
                "lon": 77.94,
                # lat missing
                "source_kind": "hardware",
            }
            res = client.post("/bridge/ingest", json=payload)
            assert res.status_code == 422

    def test_snf_from_unknown_node_ok(self):
        _reset_gw_state()
        with TestClient(app) as client:
            payload = {
                "kind": "SNF",
                "node": "HW-01",
                "dev": "cafe01cafe01",
                "rssi": -68,
                "ch": 6,
                "source_kind": "hardware",
            }
            res = client.post("/bridge/ingest", json=payload)
            assert res.status_code == 200
            assert res.json()["kind"] == "SNF"

    def test_hb_from_unknown_node_ok(self):
        _reset_gw_state()
        with TestClient(app) as client:
            payload = {
                "kind": "HB",
                "node": "HW-01",
                "bat": 88,
                "source_kind": "hardware",
            }
            res = client.post("/bridge/ingest", json=payload)
            assert res.status_code == 200
            assert res.json()["kind"] == "HB"


# ---------------------------------------------------------------------------
# Task 6: GET /gateway/status – mode transitions
# ---------------------------------------------------------------------------

class TestGatewayStatus:

    def test_default_is_simulated(self):
        """Before any bridge report, mode must be 'simulated'."""
        _reset_gw_state()
        with TestClient(app) as client:
            res = client.get("/gateway/status")
            assert res.status_code == 200
            body = res.json()
            assert body["mode"] == "simulated"
            assert body["connected"] is False

    def test_after_bridge_status_post_mode_is_mock(self):
        """After POST /bridge/status with mode=mock, GET /gateway/status returns mock."""
        _reset_gw_state()
        # Use a fake monotonic time that is 'now'
        fake_now = 1_000_000.0

        with patch("backend.gateway.bridge_api.time") as mock_time:
            mock_time.monotonic.return_value = fake_now

            with TestClient(app) as client:
                # Report from bridge
                report = {
                    "mode": "mock",
                    "port": "backend/gateway/mock_serial.txt",
                    "connected": True,
                    "packets_received": 5,
                    "packets_ignored": 2,
                }
                post_res = client.post("/bridge/status", json=report)
                assert post_res.status_code == 200

                # Immediately after – should be mock
                get_res = client.get("/gateway/status")
                assert get_res.status_code == 200
                body = get_res.json()
                assert body["mode"] == "mock"
                assert body["connected"] is True
                assert body["packets_received"] == 5
                assert body["packets_ignored"] == 2

    def test_mode_reverts_to_simulated_after_10s(self):
        """If last report was >10 s ago, GET /gateway/status returns 'simulated'."""
        _reset_gw_state()
        fake_now = 1_000_000.0

        with patch("backend.gateway.bridge_api.time") as mock_time:
            # First: bridge reports at t=0
            mock_time.monotonic.return_value = fake_now

            with TestClient(app) as client:
                report = {
                    "mode": "mock",
                    "port": "mock_serial.txt",
                    "connected": True,
                    "packets_received": 10,
                    "packets_ignored": 1,
                }
                client.post("/bridge/status", json=report)

                # Advance clock by 11 s (past the 10-s stale window)
                mock_time.monotonic.return_value = fake_now + 11.0

                get_res = client.get("/gateway/status")
                assert get_res.status_code == 200
                body = get_res.json()
                assert body["mode"] == "simulated", (
                    f"Expected 'simulated' after 11 s, got {body['mode']!r}"
                )
                assert body["connected"] is False

    def test_mode_stays_mock_within_10s(self):
        """Within the 10-s window the mode stays as reported."""
        _reset_gw_state()
        fake_now = 1_000_000.0

        with patch("backend.gateway.bridge_api.time") as mock_time:
            mock_time.monotonic.return_value = fake_now

            with TestClient(app) as client:
                report = {
                    "mode": "live",
                    "port": "COM3",
                    "connected": True,
                    "packets_received": 20,
                    "packets_ignored": 0,
                }
                client.post("/bridge/status", json=report)

                # Advance only 5 s – still within window
                mock_time.monotonic.return_value = fake_now + 5.0

                get_res = client.get("/gateway/status")
                body = get_res.json()
                assert body["mode"] == "live"
                assert body["connected"] is True

    def test_bridge_status_get_alias_includes_nodes(self):
        """GET /bridge/status keeps the legacy per-node list."""
        _reset_gw_state()
        with TestClient(app) as client:
            # Ingest a HB to populate the node table
            client.post("/bridge/ingest", json={
                "kind": "HB", "node": "HW-01", "bat": 80, "source_kind": "hardware",
            })
            res = client.get("/bridge/status")
            assert res.status_code == 200
            body = res.json()
            assert "nodes" in body
            # The HB we just sent should appear (no time mock needed – HB always registers)

    def test_packets_received_increments_on_ingest(self):
        """packets_received in /gateway/status increments with each successful ingest."""
        _reset_gw_state()
        fake_now = 1_000_000.0

        with patch("backend.gateway.bridge_api.time") as mock_time:
            mock_time.monotonic.return_value = fake_now

            with TestClient(app) as client:
                # Post bridge status first so mode != simulated
                client.post("/bridge/status", json={
                    "mode": "mock", "port": None, "connected": True,
                    "packets_received": 0, "packets_ignored": 0,
                })

                # Ingest a HB
                client.post("/bridge/ingest", json={
                    "kind": "HB", "node": "HW-01", "bat": 90, "source_kind": "hardware",
                })

                # The internal counter increments regardless of status report
                assert bridge_api_module._gw_state["packets_received"] >= 1
