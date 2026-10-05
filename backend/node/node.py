"""Mesh network node: asyncio TCP server, HELLO broadcast, liveness, packet forwarding & retries."""
from __future__ import annotations

import asyncio
import collections
import time
import sys
import os

# Allow imports whether run as a package or standalone
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.node.config import Topology
from backend.node.packet import Packet
from backend.node import events
from backend.routing.router import Router, INF

HELLO_INTERVAL = 1.0
LIVENESS_CHECK_INTERVAL = 0.5
SEEN_SET_MAX = 2048
HOST = "127.0.0.1"


class Node:
    """A single mesh node. Runs a TCP server, sends HELLOs, tracks liveness, forwards packets with retry."""

    def __init__(self, node_id: str, topology: Topology, is_gateway: bool = False) -> None:
        self.node_id = node_id
        self.topology = topology
        self.is_gateway = is_gateway
        self.port = topology.ports[node_id]
        self.lora_neighbours: list[str] = topology.neighbors.get(node_id, [])
        self.router = Router(node_id, is_gateway=is_gateway, max_hops=len(topology.ids) + 5)
        self._seen: collections.OrderedDict[str, None] = collections.OrderedDict()
        self._server: asyncio.Server | None = None
        self._tasks: list[asyncio.Task] = []
        self.delivered: list[Packet] = []  # gateway collects delivered packets here
        self.is_alive: bool = False

    # ---- lifecycle ----

    async def start(self) -> None:
        if self.is_alive:
            return
        self.is_alive = True
        self._server = await asyncio.start_server(
            self._handle_connection, HOST, self.port
        )
        self._tasks.append(asyncio.create_task(self._hello_loop()))
        self._tasks.append(asyncio.create_task(self._liveness_loop()))
        events.emit({
            "event": "NODE_ACTIVE",
            "node_id": self.node_id,
        })

    async def stop(self) -> None:
        self.is_alive = False
        for t in self._tasks:
            t.cancel()
        self._tasks.clear()
        if self._server:
            try:
                self._server.close()
                await self._server.wait_closed()
            except Exception:
                pass
            self._server = None

    async def kill(self) -> None:
        """Simulate power loss / sudden node failure."""
        await self.stop()
        self.router._neighbours.clear()

    async def revive(self) -> None:
        """Revive node after failure."""
        await self.start()

    # ---- TCP transport ----

    async def _handle_connection(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        try:
            while self.is_alive:
                line = await reader.readline()
                if not line:
                    break
                try:
                    pkt = Packet.from_json(line.decode().strip())
                except Exception:
                    continue
                await self._on_packet(pkt)
        finally:
            writer.close()

    async def send_to(self, target_id: str, pkt: Packet) -> bool:
        """Send a packet to a LoRa neighbour via TCP. Returns True on success."""
        if not self.is_alive:
            return False
        if target_id not in self.lora_neighbours:
            return False
        port = self.topology.ports.get(target_id)
        if port is None:
            return False
        try:
            reader, writer = await asyncio.open_connection(HOST, port)
            writer.write((pkt.to_json() + "\n").encode())
            await writer.drain()
            writer.close()
            await writer.wait_closed()
            return True
        except OSError:
            self._mark_neighbour_dead(target_id)
            return False

    def _mark_neighbour_dead(self, target_id: str) -> None:
        removed = self.router.remove_neighbour(target_id)
        if removed:
            events.emit({
                "event": "NODE_FAILED",
                "node_id": target_id,
                "detected_by": self.node_id,
            })
            self._check_route_changed()

    def _check_route_changed(self) -> None:
        changed, old_hop, new_hop = self.router.check_route_change()
        if changed:
            events.emit({
                "event": "ROUTE_CHANGED",
                "source": self.node_id,
                "old_route": [old_hop] if old_hop else [],
                "new_route": [new_hop] if new_hop else [],
            })

    # ---- loops ----

    async def _hello_loop(self) -> None:
        while self.is_alive:
            await asyncio.sleep(HELLO_INTERVAL)
            if not self.is_alive:
                break
            hops = self.router.hops_to_gateway
            hello = Packet(
                packet_id=f"HELLO-{self.node_id}-{time.monotonic():.2f}",
                packet_type="HELLO",
                source=self.node_id,
                destination="*",
                payload={
                    "hops_to_gateway": None if hops == INF else hops,
                    "next_hop": self.router.next_hop,
                },
                ttl=1,
            )
            for nbr in self.lora_neighbours:
                await self.send_to(nbr, hello)

    async def _liveness_loop(self) -> None:
        while self.is_alive:
            await asyncio.sleep(LIVENESS_CHECK_INTERVAL)
            if not self.is_alive:
                break
            now = time.monotonic()
            dead_list = [
                nid for nid, entry in list(self.router._neighbours.items())
                if now - entry.last_seen > 3.0
            ]
            for dead_id in dead_list:
                self._mark_neighbour_dead(dead_id)

    # ---- packet dispatch ----

    async def _on_packet(self, pkt: Packet) -> None:
        if not self.is_alive:
            return
        if pkt.packet_type == "HELLO":
            await self._handle_hello(pkt)
        elif pkt.packet_type in ("EMERGENCY", "ACK"):
            await self._handle_data(pkt)

    async def _handle_hello(self, pkt: Packet) -> None:
        hops = pkt.payload.get("hops_to_gateway")
        if hops is None:
            hops = INF
        next_hop = pkt.payload.get("next_hop")
        self.router.update_neighbour(pkt.source, hops, next_hop=next_hop)
        self._check_route_changed()

    async def _handle_data(self, pkt: Packet) -> None:
        # Duplicate suppression
        if pkt.packet_id in self._seen:
            return
        self._seen[pkt.packet_id] = None
        if len(self._seen) > SEEN_SET_MAX:
            self._seen.popitem(last=False)

        # TTL check
        if pkt.ttl <= 0:
            return

        # Append self to route
        pkt.route.append(self.node_id)

        # Am I the destination?
        if pkt.destination == self.node_id or (
            self.is_gateway and pkt.destination == "GATEWAY"
        ):
            await self._on_deliver(pkt)
            return

        # Forward toward destination with retry and queueing
        await self._forward_with_retry(pkt)

    def _pick_forward_target(self, pkt: Packet) -> str | None:
        """Choose next hop. For EMERGENCY: best route to gateway.
        For ACK: follow reverse route if available, else best route."""
        if pkt.packet_type == "ACK" and pkt.payload.get("reverse_route"):
            rev = pkt.payload["reverse_route"]
            if self.node_id in rev:
                idx = rev.index(self.node_id)
                if idx + 1 < len(rev):
                    candidate = rev[idx + 1]
                    if candidate in self.lora_neighbours:
                        return candidate

        # Default: distance-vector next hop
        hop = self.router.next_hop
        # Avoid sending back to the sender if possible
        if hop and len(pkt.route) >= 2 and hop == pkt.route[-2]:
            alive = self.router.alive_neighbours()
            alternatives = [n for n in alive if n != hop and n in self.lora_neighbours]
            if alternatives:
                return alternatives[0]
        return hop

    async def _forward_with_retry(self, pkt: Packet) -> bool:
        fwd = pkt.forwarded()
        primary_target = self._pick_forward_target(pkt)

        # 1. Try primary next hop
        if primary_target is not None:
            events.emit({
                "event": "PACKET_FORWARDED",
                "packet_id": fwd.packet_id,
                "from": self.node_id,
                "to": primary_target,
            })
            if await self.send_to(primary_target, fwd):
                return True

        # 2. Primary failed -> try alternative alive neighbours with finite route to gateway
        sorted_candidates = self.router.get_sorted_next_hops()
        for alt_target, alt_hops in sorted_candidates:
            if alt_target == primary_target:
                continue
            events.emit({
                "event": "PACKET_FORWARDED",
                "packet_id": fwd.packet_id,
                "from": self.node_id,
                "to": alt_target,
            })
            if await self.send_to(alt_target, fwd):
                return True

        # 3. No route currently available -> queue for up to 5 seconds
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and self.is_alive:
            await asyncio.sleep(0.2)
            target = self._pick_forward_target(pkt)
            if target is not None:
                events.emit({
                    "event": "PACKET_FORWARDED",
                    "packet_id": fwd.packet_id,
                    "from": self.node_id,
                    "to": target,
                })
                if await self.send_to(target, fwd):
                    return True

        # 4. Expired without route -> drop packet
        return False

    async def _on_deliver(self, pkt: Packet) -> None:
        """Override in Gateway for EMERGENCY handling."""
        pass

    # ---- public API for injecting packets ----

    async def originate(self, pkt: Packet) -> bool:
        """Send a new packet from this node (it is the source)."""
        pkt.route.append(self.node_id)
        self._seen[pkt.packet_id] = None

        if pkt.packet_type == "EMERGENCY":
            events.emit({
                "event": "EMERGENCY_CREATED",
                "packet_id": pkt.packet_id,
                "source": pkt.source,
                "payload": pkt.payload,
            })

        return await self._forward_with_retry(pkt)
