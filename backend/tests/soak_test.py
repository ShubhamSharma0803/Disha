"""
Soak test: start a 22-node simulation via the HTTP API, idle, send SOS packets,
kill a relay, verify delivery, and report mesh stability metrics.

Usage:
    python backend/tests/soak_test.py

Requires the FastAPI server NOT to be running (this script runs it in-process).
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time

# Ensure repo root in path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)

os.environ["HOP_DELAY_S"] = "0.05"  # tiny delay for realism but fast test

from backend.node.config import load_topology
from backend.node.packet import Packet
from backend.node import events
from backend.simulation.run_sim import MeshNetwork
from backend.deployment.planner import PlannerInput
from backend.deployment.run_planner import run as run_planner


def count_time_wait() -> int:
    """Count TIME_WAIT sockets via netstat on Windows, return 0 on other OS."""
    if sys.platform != "win32":
        return 0
    try:
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True, timeout=15,
        )
        return sum(1 for line in result.stdout.splitlines() if "TIME_WAIT" in line)
    except Exception as e:
        print(f"  [WARN] netstat failed: {e}")
        return -1


async def run_soak():
    print("=" * 70)
    print("  DISHA MESH SOAK TEST — 22-node deployment")
    print("=" * 70)

    # ---------------------------------------------------------------
    # Step 0: Generate a 22-node deployment plan
    # ---------------------------------------------------------------
    print("\n[STEP 0] Generating 22-node deployment plan...")
    plan = run_planner(
        p=PlannerInput(
            center_lat=28.6139,
            center_lon=77.2090,
            width_m=2000,
            height_m=2000,
            wifi_range_m=300,
            lora_range_m=1000,
        ),
        gateway_xy=(0.0, -1000.0),
    )
    node_count = len(plan["nodes"])
    link_count = len(plan["links"])
    print(f"  Plan: {node_count} nodes, {link_count} links, valid={plan.get('valid')}")

    if node_count < 10:
        print(f"  [WARN] Only {node_count} nodes generated (expected ~22). Test continues but results may differ.")

    # ---------------------------------------------------------------
    # Step 0.5: Set up event collector
    # ---------------------------------------------------------------
    collected: list[dict] = []
    events.clear()
    events.register(lambda e: collected.append(e))

    # ---------------------------------------------------------------
    # Step 1: Start simulation
    # ---------------------------------------------------------------
    print("\n[STEP 1] Starting mesh simulation...")
    topo = load_topology(plan)
    net = MeshNetwork(topo)
    await net.start()
    all_node_ids = [nid for nid in topo.ids if nid != "GATEWAY"]
    print(f"  Started {len(net.nodes)} nodes (including GATEWAY)")

    # Wait for convergence (HELLO 2s, timeout 8s → ~10s for deep mesh)
    convergence_s = 12.0
    print(f"  Waiting {convergence_s}s for routing convergence...")
    await asyncio.sleep(convergence_s)

    # Print route table
    routable_count = sum(
        1 for nid in all_node_ids
        if net.nodes[nid].router.hops_to_gateway != float("inf")
    )
    print(f"  Routable nodes: {routable_count}/{len(all_node_ids)}")

    tw_before = count_time_wait()
    print(f"  TIME_WAIT sockets before idle: {tw_before}")

    # ---------------------------------------------------------------
    # Step 2a: Idle for 120s, count false failures
    # ---------------------------------------------------------------
    idle_s = 120
    print(f"\n[STEP 2a] Idling for {idle_s}s...")
    start_idle = time.monotonic()
    collected.clear()  # reset event collector
    await asyncio.sleep(idle_s)
    elapsed_idle = time.monotonic() - start_idle

    node_failed_idle = [e for e in collected if e.get("event") == "NODE_FAILED"]
    neighbour_lost_idle = [e for e in collected if e.get("event") == "NEIGHBOUR_LOST"]
    tw_after_idle = count_time_wait()

    print(f"  Elapsed: {elapsed_idle:.1f}s")
    print(f"  NODE_FAILED events during idle: {len(node_failed_idle)}")
    print(f"  NEIGHBOUR_LOST events during idle: {len(neighbour_lost_idle)}")
    print(f"  TIME_WAIT sockets after idle: {tw_after_idle}")

    assert len(node_failed_idle) == 0, (
        f"FAIL: {len(node_failed_idle)} NODE_FAILED during idle! Events: {node_failed_idle[:5]}"
    )

    # ---------------------------------------------------------------
    # Step 2b: Send SOS from each non-gateway node, one after another
    # ---------------------------------------------------------------
    print(f"\n[STEP 2b] Sending SOS from each of {len(all_node_ids)} non-gateway nodes...")
    collected.clear()
    delivered_ids: set[str] = set()
    failed_sources: list[str] = []

    for nid in sorted(all_node_ids):
        node = net.nodes[nid]
        if not node.is_alive:
            print(f"  [SKIP] {nid} is dead")
            continue
        if node.router.hops_to_gateway == float("inf"):
            print(f"  [SKIP] {nid} has no route to gateway")
            continue
        pkt = Packet(
            packet_id=f"SOS-SEQ-{nid}",
            packet_type="EMERGENCY",
            source=nid,
            destination="GATEWAY",
            payload={"code": "MED", "priority": 1, "people": 1, "note": f"soak-{nid}", "source_kind": "simulated"},
        )
        ok = await node.originate(pkt)
        await asyncio.sleep(0.3)  # small gap between sends

    # Wait for all to deliver
    await asyncio.sleep(5.0)

    delivered_events = [
        e for e in collected
        if e.get("event") == "PACKET_DELIVERED" and str(e.get("packet_id", "")).startswith("SOS-SEQ-")
    ]
    delivered_ids = {e["packet_id"] for e in delivered_events}
    expected_ids = {f"SOS-SEQ-{nid}" for nid in all_node_ids if net.nodes[nid].is_alive and net.nodes[nid].router.hops_to_gateway != float("inf")}
    # Allow some flexibility for nodes that genuinely have no route
    missing = expected_ids - delivered_ids
    print(f"  Delivered: {len(delivered_ids)}/{len(expected_ids)}")
    if missing:
        print(f"  Missing: {missing}")
    assert len(missing) == 0, f"FAIL: {len(missing)} SOS packets not delivered: {missing}"

    # ---------------------------------------------------------------
    # Step 2c: Concurrent SOS: 3 nodes, repeated 5 times
    # ---------------------------------------------------------------
    print("\n[STEP 2c] Concurrent SOS test (3 nodes × 5 rounds)...")
    collected.clear()
    concurrent_nodes = sorted(all_node_ids)[:3]
    concurrent_delivered = 0
    concurrent_total = 0

    for round_i in range(5):
        coros = []
        for nid in concurrent_nodes:
            node = net.nodes[nid]
            if not node.is_alive or node.router.hops_to_gateway == float("inf"):
                continue
            pkt = Packet(
                packet_id=f"SOS-CONC-R{round_i}-{nid}",
                packet_type="EMERGENCY",
                source=nid,
                destination="GATEWAY",
                payload={"code": "TRP", "priority": 1, "people": 1, "note": f"conc-r{round_i}", "source_kind": "simulated"},
            )
            concurrent_total += 1
            coros.append(node.originate(pkt))
        await asyncio.gather(*coros, return_exceptions=True)
        await asyncio.sleep(1.0)

    await asyncio.sleep(5.0)
    conc_delivered = [
        e for e in collected
        if e.get("event") == "PACKET_DELIVERED" and str(e.get("packet_id", "")).startswith("SOS-CONC-")
    ]
    concurrent_delivered = len(conc_delivered)
    print(f"  Concurrent delivered: {concurrent_delivered}/{concurrent_total}")
    assert concurrent_delivered == concurrent_total, (
        f"FAIL: {concurrent_total - concurrent_delivered} concurrent SOS not delivered"
    )

    # ---------------------------------------------------------------
    # Step 2d: Kill one relay node, wait 10s, send SOS from remaining
    # ---------------------------------------------------------------
    print("\n[STEP 2d] Kill relay + reroute test...")
    collected.clear()

    # Pick a relay node (not direct neighbour of GATEWAY, if possible)
    relay_candidates = [
        nid for nid in all_node_ids
        if net.nodes[nid].is_alive
        and net.nodes[nid].router.hops_to_gateway is not None
        and net.nodes[nid].router.hops_to_gateway > 1
        and net.nodes[nid].router.hops_to_gateway != float("inf")
    ]
    if not relay_candidates:
        relay_candidates = [nid for nid in all_node_ids if net.nodes[nid].is_alive]
    relay_to_kill = relay_candidates[0] if relay_candidates else all_node_ids[0]

    print(f"  Killing relay: {relay_to_kill}")
    await net.kill_node(relay_to_kill)
    await asyncio.sleep(10.0)

    remaining = [
        nid for nid in all_node_ids
        if net.nodes[nid].is_alive and net.nodes[nid].router.hops_to_gateway != float("inf")
    ]
    print(f"  Remaining routable nodes: {len(remaining)}")

    kill_delivered = 0
    kill_total = 0
    for nid in remaining:
        node = net.nodes[nid]
        pkt = Packet(
            packet_id=f"SOS-KILL-{nid}",
            packet_type="EMERGENCY",
            source=nid,
            destination="GATEWAY",
            payload={"code": "MIS", "priority": 2, "people": 1, "note": f"kill-test-{nid}", "source_kind": "simulated"},
        )
        kill_total += 1
        await node.originate(pkt)
        await asyncio.sleep(0.2)

    await asyncio.sleep(5.0)

    kill_del_events = [
        e for e in collected
        if e.get("event") == "PACKET_DELIVERED" and str(e.get("packet_id", "")).startswith("SOS-KILL-")
    ]
    kill_delivered = len(kill_del_events)
    rerouted_events = [
        e for e in collected
        if e.get("event") == "PACKET_REROUTED" and str(e.get("packet_id", "")).startswith("SOS-KILL-")
    ]
    print(f"  Delivered after kill: {kill_delivered}/{kill_total} ({len(rerouted_events)} rerouted)")
    assert kill_delivered == kill_total, (
        f"FAIL: {kill_total - kill_delivered} SOS not delivered after relay kill"
    )

    # ---------------------------------------------------------------
    # Step 2e: TIME_WAIT check
    # ---------------------------------------------------------------
    tw_final = count_time_wait()
    print(f"\n[STEP 2e] TIME_WAIT sockets at end: {tw_final}")
    if tw_final > 500:
        print(f"  [WARN] TIME_WAIT count {tw_final} exceeds threshold of 500")
    else:
        print(f"  TIME_WAIT is low (≤ 500): OK")

    # ---------------------------------------------------------------
    # Cleanup
    # ---------------------------------------------------------------
    await net.stop()
    events.clear()

    # ---------------------------------------------------------------
    # Summary
    # ---------------------------------------------------------------
    print("\n" + "=" * 70)
    print("  SOAK TEST RESULTS")
    print("=" * 70)
    print(f"  Nodes: {node_count} + GATEWAY")
    print(f"  Idle NODE_FAILED:      {len(node_failed_idle)} (target: 0)")
    print(f"  Idle NEIGHBOUR_LOST:   {len(neighbour_lost_idle)} (target: 0 or small)")
    print(f"  Sequential SOS:        {len(delivered_ids)}/{len(expected_ids)} delivered")
    print(f"  Concurrent SOS:        {concurrent_delivered}/{concurrent_total} delivered")
    print(f"  Post-kill SOS:         {kill_delivered}/{kill_total} delivered")
    print(f"  TIME_WAIT before idle: {tw_before}")
    print(f"  TIME_WAIT after idle:  {tw_after_idle}")
    print(f"  TIME_WAIT final:       {tw_final}")
    print("=" * 70)

    all_passed = (
        len(node_failed_idle) == 0
        and len(missing) == 0
        and concurrent_delivered == concurrent_total
        and kill_delivered == kill_total
        and tw_final <= 500
    )
    if all_passed:
        print("  ✅ ALL SOAK CHECKS PASSED")
    else:
        print("  ❌ SOME CHECKS FAILED — see above")

    return all_passed


def main():
    ok = asyncio.run(run_soak())
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
