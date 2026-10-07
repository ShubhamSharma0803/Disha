"""Tests for FastAPI simulation API endpoints and WebSocket event streaming."""
from __future__ import annotations

import os
import sys
import pytest
from fastapi.testclient import TestClient

# Ensure root in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.main import app


def test_root():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


def test_post_plan():
    with TestClient(app) as client:
        payload = {
            "center_lat": 28.6139,
            "center_lon": 77.2090,
            "width_m": 1000,
            "height_m": 1000,
            "wifi_range_m": 300,
            "lora_range_m": 1000,
            "gateway_xy": [0, -500],
            "restricted_zones": [],
        }
        response = client.post("/plan", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "nodes" in data
        assert "links" in data
        assert "valid" in data
        assert data["valid"] is True


def test_simulation_lifecycle_and_state():
    with TestClient(app) as client:
        # 1. Start simulation
        res_start = client.post("/simulation/start")
        assert res_start.status_code == 200
        data = res_start.json()
        assert data["status"] == "started"
        assert "nodes" in data
        assert "links" in data

        # 2. Get state
        res_state = client.get("/simulation/state")
        assert res_state.status_code == 200
        st = res_state.json()
        assert "nodes" in st
        assert "GATEWAY" in st["state"]
        assert st["state"]["GATEWAY"]["status"] == "ALIVE"

        # 3. Kill a node
        res_kill = client.post("/simulation/kill/NODE-01")
        assert res_kill.status_code == 200
        assert res_kill.json()["status"] == "killed"

        st_after_kill = client.get("/simulation/state").json()
        assert st_after_kill["state"]["NODE-01"]["status"] == "DEAD"

        # 4. Revive the node
        res_revive = client.post("/simulation/revive/NODE-01")
        assert res_revive.status_code == 200
        assert res_revive.json()["status"] == "revived"

        st_after_revive = client.get("/simulation/state").json()
        assert st_after_revive["state"]["NODE-01"]["status"] == "ALIVE"

        # 5. Invalid node IDs return 404
        assert client.post("/simulation/kill/NONEXISTENT").status_code == 404
        assert client.post("/simulation/revive/NONEXISTENT").status_code == 404
        assert client.post("/simulation/emergency", json={
            "source": "NONEXISTENT",
            "type": "MEDICAL",
            "message": "test",
        }).status_code == 404

        # 6. Starting twice restarts cleanly
        res_restart = client.post("/simulation/start")
        assert res_restart.status_code == 200
        assert res_restart.json()["status"] == "started"


def test_websocket_emergency_delivery():
    with TestClient(app) as client:
        # Ensure simulation is started
        res_start = client.post("/simulation/start")
        assert res_start.status_code == 200

        # Connect WebSocket and originate emergency
        with client.websocket_connect("/ws/events") as ws:
            res_emg = client.post("/simulation/emergency", json={
                "source": "NODE-01",
                "type": "MEDICAL",
                "message": "Immediate assistance required",
            })
            assert res_emg.status_code == 200
            target_pkt_id = res_emg.json()["packet_id"]

            # Listen for delivered event on websocket
            delivered_event = None
            for _ in range(30):
                data = ws.receive_json()
                if (
                    data.get("event") == "PACKET_DELIVERED"
                    and data.get("packet_id") == target_pkt_id
                ):
                    delivered_event = data
                    break

            assert delivered_event is not None, f"Expected PACKET_DELIVERED for {target_pkt_id}"
            assert delivered_event["packet_id"] == target_pkt_id
            assert "route" in delivered_event
            assert "GATEWAY" in delivered_event["route"]
            assert "NODE-01" in delivered_event["route"]


def test_sos_invalid_code_returns_422():
    with TestClient(app) as client:
        # Invalid code on /simulation/emergency
        res1 = client.post("/simulation/emergency", json={
            "source": "NODE-01",
            "code": "INVALID_CODE",
        })
        assert res1.status_code == 422

        # Invalid code on /sos alias
        res2 = client.post("/sos", json={
            "source": "NODE-01",
            "code": "BADCODE",
        })
        assert res2.status_code == 422

        # Invalid people count (e.g. 0 or 10)
        res3 = client.post("/sos", json={
            "source": "NODE-01",
            "code": "MED",
            "people": 0,
        })
        assert res3.status_code == 422

        # Note exceeding 40 chars
        res4 = client.post("/sos", json={
            "source": "NODE-01",
            "code": "MED",
            "note": "X" * 45,
        })
        assert res4.status_code == 422


def test_sos_delivery_and_fields_intact():
    with TestClient(app) as client:
        # Ensure simulation is started
        res_start = client.post("/simulation/start")
        assert res_start.status_code == 200

        with client.websocket_connect("/ws/events") as ws:
            # Originate emergency via /sos alias
            res_sos = client.post("/sos", json={
                "source": "NODE-01",
                "code": "MED",
                "people": 3,
                "note": "Broken arm at node 1",
                "source_kind": "hardware",
            })
            assert res_sos.status_code == 200
            sos_data = res_sos.json()
            assert sos_data["status"] == "originated"
            assert sos_data["code"] == "MED"
            assert sos_data["priority"] == 1
            assert sos_data["people"] == 3
            assert sos_data["note"] == "Broken arm at node 1"
            assert sos_data["source_kind"] == "hardware"
            target_pkt_id = sos_data["packet_id"]

            # Listen for PACKET_DELIVERED event on websocket
            delivered_event = None
            for _ in range(30):
                data = ws.receive_json()
                if (
                    data.get("event") == "PACKET_DELIVERED"
                    and data.get("packet_id") == target_pkt_id
                ):
                    delivered_event = data
                    break

            assert delivered_event is not None, f"Expected PACKET_DELIVERED for {target_pkt_id}"
            assert delivered_event["type"] == "PACKET_DELIVERED"
            assert delivered_event["code"] == "MED"
            assert delivered_event["priority"] == 1
            assert delivered_event["people"] == 3
            assert delivered_event["note"] == "Broken arm at node 1"
            assert delivered_event["source_kind"] == "hardware"
            assert "route" in delivered_event
            assert "GATEWAY" in delivered_event["route"]
            assert delivered_event["hop_count"] >= 1

        # Check GET /simulation/sos
        res_sos_list = client.get("/simulation/sos")
        assert res_sos_list.status_code == 200
        items = res_sos_list.json()
        assert isinstance(items, list)
        matching = [e for e in items if e["packet_id"] == target_pkt_id]
        assert len(matching) == 1
        item = matching[0]
        assert item["status"] == "DELIVERED"
        assert item["code"] == "MED"
        assert item["priority"] == 1
        assert item["people"] == 3
        assert item["note"] == "Broken arm at node 1"
        assert item["source_kind"] == "hardware"


def test_simulation_sos_ranking():
    with TestClient(app) as client:
        # Restart simulation to clear tracker
        client.post("/simulation/start")

        # Originate 4 emergencies with different priority, people, and codes:
        # 1. SAF (code SAF -> priority 4, people 1)
        # 2. FWD (code FWD -> priority 3, people 5)
        # 3. MIS (code MIS -> priority 2, people 1)
        # 4. MED (code MED -> priority 1, people 2)
        # 5. TRP (code TRP -> priority 1, people 7)
        client.post("/sos", json={"source": "NODE-01", "code": "SAF", "people": 1, "note": "safe"})
        client.post("/sos", json={"source": "NODE-01", "code": "FWD", "people": 5, "note": "food"})
        client.post("/sos", json={"source": "NODE-01", "code": "MIS", "people": 1, "note": "missing"})
        client.post("/sos", json={"source": "NODE-01", "code": "MED", "people": 2, "note": "medical"})
        client.post("/sos", json={"source": "NODE-01", "code": "TRP", "people": 7, "note": "trapped"})

        res = client.get("/simulation/sos")
        assert res.status_code == 200
        items = res.json()
        assert len(items) >= 5

        # Check ranking: priority asc, people desc, created_at asc
        codes_ranked = [i["code"] for i in items[:5]]
        assert codes_ranked == ["TRP", "MED", "MIS", "FWD", "SAF"]


if __name__ == "__main__":
    pytest.main(["-v", __file__])

