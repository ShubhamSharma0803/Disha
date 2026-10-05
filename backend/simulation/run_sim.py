"""Run a full mesh simulation and interactive CLI."""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.node.config import load_topology, Topology
from backend.node.node import Node
from backend.node.packet import Packet
from backend.node import events
from backend.gateway.gateway import Gateway

DEFAULT_TOPOLOGY = os.path.join(
    os.path.dirname(__file__), "..", "..", "docs", "sample_deployment.json"
)


class MeshNetwork:
    """Manages all nodes in a simulation topology."""

    def __init__(self, topology: Topology) -> None:
        self.topology = topology
        self.gateway = Gateway(topology)
        self.nodes: dict[str, Node] = {"GATEWAY": self.gateway}
        for nid in topology.ids:
            if nid != "GATEWAY":
                self.nodes[nid] = Node(nid, topology)

    async def start(self) -> None:
        seen_links: set[tuple[str, str]] = set()
        for nid in self.topology.ids:
            for nbr in self.topology.neighbors[nid]:
                key = tuple(sorted([nid, nbr]))
                if key not in seen_links:
                    seen_links.add(key)
                    events.emit({"event": "LINK_CREATED", "from": key[0], "to": key[1]})

        for n in self.nodes.values():
            await n.start()

    async def stop(self) -> None:
        for n in self.nodes.values():
            await n.stop()

    async def kill_node(self, node_id: str) -> bool:
        if node_id in self.nodes:
            await self.nodes[node_id].kill()
            return True
        return False

    async def revive_node(self, node_id: str) -> bool:
        if node_id in self.nodes:
            await self.nodes[node_id].revive()
            return True
        return False

    def print_routes(self) -> None:
        print("\n--- Current Mesh Routes ---", file=sys.stderr)
        for nid in sorted(self.nodes.keys()):
            n = self.nodes[nid]
            status = "ALIVE" if n.is_alive else "DEAD"
            r = n.router
            hops_val = r.hops_to_gateway
            hops_str = "INF" if hops_val == float("inf") else str(hops_val)
            print(f"  {nid:<10} [{status:<5}]  hops={hops_str:<5}  next_hop={r.next_hop}", file=sys.stderr)
        print("---------------------------\n", file=sys.stderr)


async def run_simulation(topology_path: str, interactive: bool = True) -> None:
    topo = load_topology(topology_path)
    net = MeshNetwork(topo)
    await net.start()

    convergence_time = 3.5
    print(f"\n[WAIT] Waiting {convergence_time}s for routing convergence...", file=sys.stderr)
    await asyncio.sleep(convergence_time)
    net.print_routes()

    if not interactive or not sys.stdin.isatty():
        # Automated single packet run if not interactive TTY
        farthest_id = "NODE-01"
        for nid in sorted(net.nodes.keys()):
            if nid != "GATEWAY" and net.nodes[nid].router.hops_to_gateway < float("inf"):
                if net.nodes[nid].router.hops_to_gateway > net.nodes[farthest_id].router.hops_to_gateway:
                    farthest_id = nid

        print(f"[SEND] Sending test EMERGENCY from {farthest_id}", file=sys.stderr)
        pkt = Packet(
            packet_id="PKT-SIM-AUTO",
            packet_type="EMERGENCY",
            source=farthest_id,
            destination="GATEWAY",
            payload={"type": "MEDICAL", "message": "Automated simulation test"},
        )
        await net.nodes[farthest_id].originate(pkt)
        await asyncio.sleep(2.0)

        if net.gateway.delivered:
            delivered_pkt = net.gateway.delivered[-1]
            print(f"\n[OK] PACKET_DELIVERED id={delivered_pkt.packet_id}", file=sys.stderr)
            print(f"   route: {' -> '.join(delivered_pkt.route)}", file=sys.stderr)
        else:
            print("\n[FAIL] Packet was NOT delivered", file=sys.stderr)

        await net.stop()
        return

    # Interactive CLI loop
    loop = asyncio.get_event_loop()
    print("\nMesh Interactive CLI ready.")
    print("Commands: send <NODE-ID> <TYPE> <message> | kill <NODE-ID> | revive <NODE-ID> | routes | quit\n")

    while True:
        try:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            cmd_line = line.strip()
            if not cmd_line:
                continue
            parts = cmd_line.split(maxsplit=3)
            cmd = parts[0].lower()

            if cmd in ("quit", "exit"):
                break
            elif cmd == "routes":
                net.print_routes()
            elif cmd == "kill" and len(parts) >= 2:
                nid = parts[1]
                if await net.kill_node(nid):
                    print(f"[CLI] Killed node {nid}")
                else:
                    print(f"[CLI] Node {nid} not found")
            elif cmd == "revive" and len(parts) >= 2:
                nid = parts[1]
                if await net.revive_node(nid):
                    print(f"[CLI] Revived node {nid}")
                else:
                    print(f"[CLI] Node {nid} not found")
            elif cmd == "send" and len(parts) >= 4:
                nid, ptype, msg = parts[1], parts[2], parts[3]
                if nid in net.nodes and net.nodes[nid].is_alive:
                    pkt = Packet(
                        packet_id=f"PKT-CLI-{time.monotonic():.2f}",
                        packet_type="EMERGENCY",
                        source=nid,
                        destination="GATEWAY",
                        payload={"type": ptype, "message": msg},
                    )
                    sent = await net.nodes[nid].originate(pkt)
                    print(f"[CLI] Originated emergency from {nid} (sent={sent})")
                else:
                    print(f"[CLI] Node {nid} not found or dead")
            else:
                print(f"[CLI] Unknown command: {cmd_line}")
        except (EOFError, KeyboardInterrupt):
            break

    await net.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run mesh network simulation CLI")
    parser.add_argument(
        "--topology", "-t",
        default=DEFAULT_TOPOLOGY,
        help="Path to deployment.json (default: docs/sample_deployment.json)",
    )
    parser.add_argument(
        "--auto", "-a",
        action="store_true",
        help="Run non-interactive automated test instead of interactive CLI",
    )
    args = parser.parse_args()
    asyncio.run(run_simulation(os.path.abspath(args.topology), interactive=not args.auto))


if __name__ == "__main__":
    main()
