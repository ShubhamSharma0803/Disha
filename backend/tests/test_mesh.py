"""Tests for packet, multi-hop delivery, TTL expiry, duplicate suppression, node failure, failover, and events."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.node.config import load_topology, Topology
from backend.node.packet import Packet
from backend.node.node import Node
from backend.node import events
from backend.gateway.gateway import Gateway
from backend.routing.router import Router, INF
from backend.simulation.run_sim import MeshNetwork


# ---------------------------------------------------------------------------
#  Helper topologies
# ---------------------------------------------------------------------------

def _make_linear_topology(tmp_dir: str) -> str:
    """Create a minimal deployment.json: GATEWAY -- NODE-01 -- NODE-02 (linear)."""
    deploy = {
        "assumptions": {"wifi_range_m": 300, "lora_range_m": 1000,
                        "area_m": [1000, 1000], "restricted_zones": []},
        "nodes": [
            {"id": "NODE-01", "lat": 28.61, "lon": 77.21, "status": "PLANNED",
             "hops_from_gateway": 1, "deploy_order": 1},
            {"id": "NODE-02", "lat": 28.62, "lon": 77.21, "status": "PLANNED",
             "hops_from_gateway": 2, "deploy_order": 2},
        ],
        "gateway": {"id": "GATEWAY", "lat": 28.60, "lon": 77.21},
        "links": [
            {"from": "GATEWAY", "to": "NODE-01", "distance_m": 500},
            {"from": "NODE-01", "to": "NODE-02", "distance_m": 500},
        ],
        "deployment_order": ["NODE-01", "NODE-02"],
        "drone_targets": [],
        "wifi_coverage": 1.0,
        "valid": True,
    }
    path = os.path.join(tmp_dir, "test_deploy.json")
    with open(path, "w") as f:
        json.dump(deploy, f)
    return path


def _make_diamond_topology(tmp_dir: str) -> str:
    """Topology with redundant paths:
    GATEWAY -- NODE-01 -- NODE-02
    GATEWAY -- NODE-03 -- NODE-02
    """
    deploy = {
        "assumptions": {"wifi_range_m": 300, "lora_range_m": 1000,
                        "area_m": [1000, 1000], "restricted_zones": []},
        "nodes": [
            {"id": "NODE-01", "lat": 28.61, "lon": 77.21, "status": "PLANNED",
             "hops_from_gateway": 1, "deploy_order": 1},
            {"id": "NODE-02", "lat": 28.62, "lon": 77.21, "status": "PLANNED",
             "hops_from_gateway": 2, "deploy_order": 2},
            {"id": "NODE-03", "lat": 28.61, "lon": 77.22, "status": "PLANNED",
             "hops_from_gateway": 1, "deploy_order": 3},
        ],
        "gateway": {"id": "GATEWAY", "lat": 28.60, "lon": 77.21},
        "links": [
            {"from": "GATEWAY", "to": "NODE-01", "distance_m": 500},
            {"from": "NODE-01", "to": "NODE-02", "distance_m": 500},
            {"from": "GATEWAY", "to": "NODE-03", "distance_m": 500},
            {"from": "NODE-03", "to": "NODE-02", "distance_m": 500},
        ],
        "deployment_order": ["NODE-01", "NODE-02", "NODE-03"],
        "drone_targets": [],
        "wifi_coverage": 1.0,
        "valid": True,
    }
    path = os.path.join(tmp_dir, "test_diamond.json")
    with open(path, "w") as f:
        json.dump(deploy, f)
    return path


# ---------------------------------------------------------------------------
#  1. Packet round-trip serialization
# ---------------------------------------------------------------------------

def test_packet_round_trip():
    pkt = Packet(
        packet_id="PKT-001",
        packet_type="EMERGENCY",
        source="NODE-03",
        destination="GATEWAY",
        payload={"type": "MEDICAL", "message": "test"},
        hop_count=2,
        ttl=8,
        route=["NODE-03", "NODE-02"],
    )
    raw = pkt.to_json()
    restored = Packet.from_json(raw)
    assert restored.packet_id == pkt.packet_id
    assert restored.packet_type == pkt.packet_type
    assert restored.source == pkt.source
    assert restored.destination == pkt.destination
    assert restored.payload == pkt.payload
    assert restored.hop_count == pkt.hop_count
    assert restored.ttl == pkt.ttl
    assert restored.route == pkt.route
    assert restored.timestamp == pkt.timestamp


def test_packet_forwarded():
    pkt = Packet(packet_id="P1", packet_type="EMERGENCY",
                 source="A", destination="B", hop_count=0, ttl=10)
    fwd = pkt.forwarded()
    assert fwd.hop_count == 1
    assert fwd.ttl == 9
    assert fwd.packet_id == pkt.packet_id
    assert pkt.hop_count == 0
    assert pkt.ttl == 10


# ---------------------------------------------------------------------------
#  2. Multi-hop delivery  NODE-02 -> NODE-01 -> GATEWAY
# ---------------------------------------------------------------------------

async def _run_multi_hop(tmp_dir: str) -> Gateway:
    path = _make_linear_topology(tmp_dir)
    topo = load_topology(path)

    gw = Gateway(topo)
    n1 = Node("NODE-01", topo)
    n2 = Node("NODE-02", topo)

    await gw.start()
    await n1.start()
    await n2.start()

    await asyncio.sleep(3.5)

    emergency = Packet(
        packet_id="PKT-TEST-MULTI",
        packet_type="EMERGENCY",
        source="NODE-02",
        destination="GATEWAY",
        payload={"type": "TRAPPED", "message": "help"},
    )
    await n2.originate(emergency)
    await asyncio.sleep(1.5)

    await n2.stop()
    await n1.stop()
    await gw.stop()
    return gw


def test_multi_hop_delivery():
    events.clear()
    collected: list[dict] = []
    events.register(lambda e: collected.append(e))

    with tempfile.TemporaryDirectory() as tmp:
        gw = asyncio.run(_run_multi_hop(tmp))

    assert len(gw.delivered) >= 1, "Gateway should have received the packet"
    pkt = gw.delivered[0]
    assert pkt.packet_id == "PKT-TEST-MULTI"
    assert "NODE-02" in pkt.route
    assert "NODE-01" in pkt.route
    assert "GATEWAY" in pkt.route

    delivered_events = [e for e in collected if e["event"] == "PACKET_DELIVERED"]
    assert len(delivered_events) >= 1
    events.clear()


# ---------------------------------------------------------------------------
#  3. TTL expiry
# ---------------------------------------------------------------------------

async def _run_ttl_expiry(tmp_dir: str) -> Gateway:
    path = _make_linear_topology(tmp_dir)
    topo = load_topology(path)

    gw = Gateway(topo)
    n1 = Node("NODE-01", topo)
    n2 = Node("NODE-02", topo)

    await gw.start()
    await n1.start()
    await n2.start()

    await asyncio.sleep(3.5)

    pkt = Packet(
        packet_id="PKT-TTL-TEST",
        packet_type="EMERGENCY",
        source="NODE-02",
        destination="GATEWAY",
        payload={"type": "OTHER", "message": "ttl test"},
        ttl=1,
    )
    await n2.originate(pkt)
    await asyncio.sleep(1.5)

    await n2.stop()
    await n1.stop()
    await gw.stop()
    return gw


def test_ttl_expiry():
    events.clear()
    with tempfile.TemporaryDirectory() as tmp:
        gw = asyncio.run(_run_ttl_expiry(tmp))

    ttl_deliveries = [p for p in gw.delivered if p.packet_id == "PKT-TTL-TEST"]
    assert len(ttl_deliveries) == 0, "Packet with expired TTL should NOT be delivered"
    events.clear()


# ---------------------------------------------------------------------------
#  4. Duplicate suppression
# ---------------------------------------------------------------------------

async def _run_duplicate_test(tmp_dir: str) -> Gateway:
    path = _make_linear_topology(tmp_dir)
    topo = load_topology(path)

    gw = Gateway(topo)
    n1 = Node("NODE-01", topo)
    n2 = Node("NODE-02", topo)

    await gw.start()
    await n1.start()
    await n2.start()

    await asyncio.sleep(3.5)

    for _ in range(2):
        pkt = Packet(
            packet_id="PKT-DUP-TEST",
            packet_type="EMERGENCY",
            source="NODE-02",
            destination="GATEWAY",
            payload={"type": "FIRE", "message": "duplicate test"},
        )
        await n2.originate(pkt)
        await asyncio.sleep(0.3)

    await asyncio.sleep(1.5)

    await n2.stop()
    await n1.stop()
    await gw.stop()
    return gw


def test_duplicate_suppression():
    events.clear()
    with tempfile.TemporaryDirectory() as tmp:
        gw = asyncio.run(_run_duplicate_test(tmp))

    dup_deliveries = [p for p in gw.delivered if p.packet_id == "PKT-DUP-TEST"]
    assert len(dup_deliveries) == 1, (
        f"Duplicate packet should be delivered exactly once, got {len(dup_deliveries)}"
    )
    events.clear()


# ---------------------------------------------------------------------------
#  5. Route failover and events: kill node on active route, assert re-route
# ---------------------------------------------------------------------------

async def _run_route_failover_test(tmp_dir: str) -> tuple[dict, list[dict]]:
    collected: list[dict] = []
    events.clear()
    events.register(lambda e: collected.append(e))

    path = _make_diamond_topology(tmp_dir)
    topo = load_topology(path)

    net = MeshNetwork(topo)
    await net.start()
    await asyncio.sleep(3.5)  # allow route convergence

    # First packet: NODE-02 -> GATEWAY
    pkt1 = Packet(
        packet_id="PKT-FAILOVER-1",
        packet_type="EMERGENCY",
        source="NODE-02",
        destination="GATEWAY",
        payload={"type": "MEDICAL", "message": "failover test 1"},
    )
    await net.nodes["NODE-02"].originate(pkt1)
    await asyncio.sleep(1.5)

    assert len(net.gateway.delivered) >= 1
    route1 = list(net.gateway.delivered[-1].route)

    # Identify intermediate node used (NODE-01 or NODE-03)
    primary_hop = [n for n in route1 if n not in ("NODE-02", "GATEWAY")][0]

    # Kill the primary hop node
    await net.kill_node(primary_hop)
    await asyncio.sleep(0.5)

    # Second packet: NODE-02 -> GATEWAY
    pkt2 = Packet(
        packet_id="PKT-FAILOVER-2",
        packet_type="EMERGENCY",
        source="NODE-02",
        destination="GATEWAY",
        payload={"type": "MEDICAL", "message": "failover test 2"},
    )
    await net.nodes["NODE-02"].originate(pkt2)
    await asyncio.sleep(2.0)

    delivered2 = [p for p in net.gateway.delivered if p.packet_id == "PKT-FAILOVER-2"]

    await net.stop()
    res = {
        "primary_hop": primary_hop,
        "route1": route1,
        "delivered2": delivered2,
    }
    return res, collected


def test_route_failover_and_events():
    events.clear()
    with tempfile.TemporaryDirectory() as tmp:
        res, collected = asyncio.run(_run_route_failover_test(tmp))

    assert len(res["delivered2"]) == 1, "Second packet should be delivered via alternative route"
    route2 = res["delivered2"][0].route
    assert res["primary_hop"] not in route2, "Alternative route must not contain the killed node"

    # Assert NODE_FAILED event was emitted for primary_hop
    failed_events = [e for e in collected if e.get("event") == "NODE_FAILED" and e.get("node_id") == res["primary_hop"]]
    assert len(failed_events) >= 1, f"Expected NODE_FAILED event for {res['primary_hop']}"

    # Assert ROUTE_CHANGED event was emitted
    route_events = [e for e in collected if e.get("event") == "ROUTE_CHANGED"]
    assert len(route_events) >= 1, "Expected ROUTE_CHANGED event to be emitted"

    events.clear()


# ---------------------------------------------------------------------------
#  6. Gateway isolation: kill all gateway neighbours, assert clean drop & no loop
# ---------------------------------------------------------------------------

async def _run_gateway_isolation_test(tmp_dir: str) -> tuple[Node, Gateway]:
    path = _make_linear_topology(tmp_dir)
    topo = load_topology(path)

    net = MeshNetwork(topo)
    await net.start()
    await asyncio.sleep(3.5)

    # Kill GATEWAY's only neighbour (NODE-01)
    await net.kill_node("NODE-01")
    await asyncio.sleep(0.5)

    # Send emergency from NODE-02
    pkt = Packet(
        packet_id="PKT-ISOLATED",
        packet_type="EMERGENCY",
        source="NODE-02",
        destination="GATEWAY",
        payload={"type": "FIRE", "message": "isolated test"},
    )
    sent_ok = await net.nodes["NODE-02"].originate(pkt)

    # Allow liveness expiry + retry timeout
    await asyncio.sleep(4.0)

    n2 = net.nodes["NODE-02"]
    gw = net.gateway

    await net.stop()
    return n2, gw


def test_gateway_isolation():
    events.clear()
    with tempfile.TemporaryDirectory() as tmp:
        n2, gw = asyncio.run(_run_gateway_isolation_test(tmp))

    # Assert no delivery to gateway
    isolated_deliveries = [p for p in gw.delivered if p.packet_id == "PKT-ISOLATED"]
    assert len(isolated_deliveries) == 0, "Isolated packet should NOT reach gateway"

    # Assert NODE-02 route to gateway is infinity
    assert n2.router.hops_to_gateway == INF, "NODE-02 should have infinite hops to gateway"
    assert n2.router.next_hop is None, "NODE-02 next_hop should be None"

    events.clear()


# ---------------------------------------------------------------------------
#  Runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("test_packet_round_trip ...", end=" ")
    test_packet_round_trip()
    print("PASSED")

    print("test_packet_forwarded ...", end=" ")
    test_packet_forwarded()
    print("PASSED")

    print("test_multi_hop_delivery ...", end=" ")
    test_multi_hop_delivery()
    print("PASSED")

    print("test_ttl_expiry ...", end=" ")
    test_ttl_expiry()
    print("PASSED")

    print("test_duplicate_suppression ...", end=" ")
    test_duplicate_suppression()
    print("PASSED")

    print("test_route_failover_and_events ...", end=" ")
    test_route_failover_and_events()
    print("PASSED")

    print("test_gateway_isolation ...", end=" ")
    test_gateway_isolation()
    print("PASSED")

    print("\nALL MESH TESTS PASSED")
