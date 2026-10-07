"""Mesh network node: in-process queues, HELLO broadcast, liveness, packet forwarding & retries."""
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

HELLO_INTERVAL = 2.0
LIVENESS_CHECK_INTERVAL = 1.0
NEIGHBOUR_TIMEOUT_S = 8.0
MISSED_HELLOS_BEFORE_DEAD = 3
SEEN_SET_MAX = 2048
HOST = "127.0.0.1"
DEFAULT_HOP_DELAY_S = 0.7

# ---------------------------------------------------------------------------
#  In-process message bus: replaces per-message TCP connections.
#  Each node registers an asyncio.Queue; sending = put_nowait on target queue.
# ---------------------------------------------------------------------------

_node_queues: dict[str, asyncio.Queue] = {}


def _register_node_queue(node_id: str) -> asyncio.Queue:
    """Register (or re-register) a node's inbox queue."""
    q: asyncio.Queue = asyncio.Queue()
    _node_queues[node_id] = q
    return q


def _unregister_node_queue(node_id: str) -> None:
    _node_queues.pop(node_id, None)


def _deliver_to_queue(target_id: str, pkt: Packet) -> bool:
    """Non-blocking enqueue. Returns True on success, False if target not registered."""
    q = _node_queues.get(target_id)
    if q is None:
        return False
    try:
        q.put_nowait(pkt)
        return True
    except asyncio.QueueFull:
        return False


def get_hop_delay() -> float:
    val = os.getenv("HOP_DELAY_S")
    if val is not None:
        try:
            return float(val)
        except ValueError:
            pass
    if "pytest" in sys.modules or "PYTEST_CURRENT_TEST" in os.environ:
        return 0.0
    return DEFAULT_HOP_DELAY_S


class Node:
    """A single mesh node. Uses in-process queues, sends HELLOs, tracks liveness, forwards packets with retry."""

    def __init__(self, node_id: str, topology: Topology, is_gateway: bool = False) -> None:
        self.node_id = node_id
        self.topology = topology
        self.is_gateway = is_gateway
        self.lora_neighbours: list[str] = topology.neighbors.get(node_id, [])
        self.router = Router(node_id, is_gateway=is_gateway, max_hops=len(topology.ids) + 5)
        self._seen: collections.OrderedDict[str, None] = collections.OrderedDict()
        self._inbox: asyncio.Queue | None = None
        self._tasks: list[asyncio.Task] = []
        self.delivered: list[Packet] = []  # gateway collects delivered packets here
        self.is_alive: bool = False
        # Track consecutive missed HELLOs per neighbour
        self._missed_hellos: dict[str, int] = {}

    # ---- lifecycle ----

    async def start(self) -> None:
        if self.is_alive:
            return
        self.is_alive = True
        self._inbox = _register_node_queue(self.node_id)
        self._tasks.append(asyncio.create_task(self._inbox_loop()))
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
        _unregister_node_queue(self.node_id)
        self._inbox = None

    async def kill(self) -> None:
        """Simulate power loss / sudden node failure."""
        await self.stop()
        self.router._neighbours.clear()
        self._missed_hellos.clear()
        events.emit({
            "event": "NODE_FAILED",
            "node_id": self.node_id,
            "detected_by": "SIMULATOR",
        })

    async def revive(self) -> None:
        """Revive node after failure."""
        await self.start()
        events.emit({
            "event": "NODE_REVIVED",
            "node_id": self.node_id,
        })

    # ---- in-process transport ----

    async def _inbox_loop(self) -> None:
        """Consume packets from the in-process inbox queue."""
        while self.is_alive:
            try:
                pkt = await asyncio.wait_for(self._inbox.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            except Exception:
                break
            if not self.is_alive:
                break
            await self._on_packet(pkt)

    async def send_to(self, target_id: str, pkt: Packet) -> bool:
        """Send a packet to a neighbour via in-process queue. Returns True on success."""
        if not self.is_alive:
            return False
        if target_id not in self.lora_neighbours:
            return False
        ok = _deliver_to_queue(target_id, pkt)
        if not ok:
            # Target not registered (truly dead / not started) — emit NEIGHBOUR_LOST
            self._mark_neighbour_lost(target_id)
        return ok

    def _mark_neighbour_lost(self, target_id: str) -> None:
        """Emit NEIGHBOUR_LOST (not NODE_FAILED) when a neighbour is unreachable."""
        removed = self.router.remove_neighbour(target_id)
        if removed:
            events.emit({
                "event": "NEIGHBOUR_LOST",
                "neighbour_id": target_id,
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
            # Send HELLOs to all neighbours concurrently
            coros = [self.send_to(nbr, hello) for nbr in self.lora_neighbours]
            await asyncio.gather(*coros, return_exceptions=True)

    async def _liveness_loop(self) -> None:
        while self.is_alive:
            await asyncio.sleep(LIVENESS_CHECK_INTERVAL)
            if not self.is_alive:
                break
            now = time.monotonic()
            for nid, entry in list(self.router._neighbours.items()):
                time_since = now - entry.last_seen
                if time_since > NEIGHBOUR_TIMEOUT_S:
                    # Count consecutive misses
                    self._missed_hellos[nid] = self._missed_hellos.get(nid, 0) + 1
                    if self._missed_hellos[nid] >= MISSED_HELLOS_BEFORE_DEAD:
                        self._missed_hellos.pop(nid, None)
                        self._mark_neighbour_lost(nid)
                else:
                    # Reset miss counter when we hear from them
                    self._missed_hellos.pop(nid, None)

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
        # Reset missed HELLO counter on receipt
        self._missed_hellos.pop(pkt.source, None)
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
            if pkt.packet_type == "EMERGENCY":
                events.emit({
                    "event": "PACKET_DROPPED",
                    "packet_id": pkt.packet_id,
                    "at_node": self.node_id,
                    "reason": "TTL_EXPIRED",
                    "drop_detail": f"TTL reached 0 at {self.node_id}",
                    "router_state": self._router_state_snapshot(),
                })
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

    def _router_state_snapshot(self) -> dict:
        """Capture router state for debugging PACKET_DROPPED events."""
        alive = self.router.alive_neighbours()
        sorted_hops = self.router.get_sorted_next_hops()
        return {
            "node_id": self.node_id,
            "next_hop": self.router.next_hop,
            "hops_to_gateway": self.router.hops_to_gateway if self.router.hops_to_gateway != INF else None,
            "alive_neighbours": alive,
            "sorted_candidates": sorted_hops,
        }

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
            if pkt.packet_type == "EMERGENCY":
                delay = get_hop_delay()
                if delay > 0:
                    await asyncio.sleep(delay)
            if await self.send_to(primary_target, fwd):
                return True

        # 2. Primary failed -> try alternative alive neighbours with finite route to gateway
        failed_hop = primary_target
        sorted_candidates = self.router.get_sorted_next_hops()
        for alt_target, alt_hops in sorted_candidates:
            if alt_target == primary_target:
                continue
            if failed_hop is not None:
                events.emit({
                    "event": "PACKET_REROUTED",
                    "packet_id": fwd.packet_id,
                    "at_node": self.node_id,
                    "failed_next_hop": failed_hop,
                    "new_next_hop": alt_target,
                })
            events.emit({
                "event": "PACKET_FORWARDED",
                "packet_id": fwd.packet_id,
                "from": self.node_id,
                "to": alt_target,
            })
            if pkt.packet_type == "EMERGENCY":
                delay = get_hop_delay()
                if delay > 0:
                    await asyncio.sleep(delay)
            if await self.send_to(alt_target, fwd):
                return True
            failed_hop = alt_target

        # 3. No route currently available -> queue for up to 2 seconds (origin) or 5 seconds (relay)
        # Origin nodes get a shorter retry to match spec; relay nodes retain 5s for mid-flight reroute
        is_origin = (len(pkt.route) <= 1) or (pkt.route[0] == self.node_id)
        retry_budget = 2.0 if is_origin else 5.0
        deadline = time.monotonic() + retry_budget
        while time.monotonic() < deadline and self.is_alive:
            await asyncio.sleep(0.2)
            target = self._pick_forward_target(pkt)
            if target is not None:
                if failed_hop is not None and target != failed_hop:
                    events.emit({
                        "event": "PACKET_REROUTED",
                        "packet_id": fwd.packet_id,
                        "at_node": self.node_id,
                        "failed_next_hop": failed_hop,
                        "new_next_hop": target,
                    })
                events.emit({
                    "event": "PACKET_FORWARDED",
                    "packet_id": fwd.packet_id,
                    "from": self.node_id,
                    "to": target,
                })
                if pkt.packet_type == "EMERGENCY":
                    delay = get_hop_delay()
                    if delay > 0:
                        await asyncio.sleep(delay)
                if await self.send_to(target, fwd):
                    return True
                failed_hop = target

        # 4. Expired without route -> drop packet
        if pkt.packet_type == "EMERGENCY":
            events.emit({
                "event": "PACKET_DROPPED",
                "packet_id": pkt.packet_id,
                "at_node": self.node_id,
                "reason": "NO_ROUTE",
                "drop_detail": f"No alive neighbour with path to gateway after {retry_budget}s retry at {self.node_id}",
                "router_state": self._router_state_snapshot(),
            })
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
                "code": pkt.payload.get("code"),
                "priority": pkt.payload.get("priority"),
                "people": pkt.payload.get("people", 1),
                "note": pkt.payload.get("note"),
                "source_kind": pkt.payload.get("source_kind"),
            })

        return await self._forward_with_retry(pkt)
