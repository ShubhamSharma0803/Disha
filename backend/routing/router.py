"""Distance-vector router: HELLO-based neighbour discovery, liveness, and next-hop selection."""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

INF = float("inf")
NEIGHBOUR_TIMEOUT_S = 8.0  # consider a neighbour dead after 8 seconds of silence


@dataclass
class NeighbourEntry:
    hops_to_gateway: float = INF
    next_hop: str | None = None  # neighbour's advertised next hop
    last_seen: float = 0.0


class Router:
    """Each node owns a Router. It tracks neighbours and computes next-hop to gateway."""

    def __init__(self, node_id: str, is_gateway: bool = False, max_hops: int = 50) -> None:
        self.node_id = node_id
        self.is_gateway = is_gateway
        self.max_hops = max_hops
        self._neighbours: dict[str, NeighbourEntry] = {}
        self._last_next_hop: str | None = None
        self._last_hops: float = 0.0 if is_gateway else INF

    # ---- public queries ----

    @property
    def hops_to_gateway(self) -> float:
        if self.is_gateway:
            return 0.0
        best_id, best_hops = self._compute_best_route()
        if best_hops >= self.max_hops:
            return INF
        return best_hops

    @property
    def next_hop(self) -> str | None:
        if self.is_gateway:
            return None
        best_id, best_hops = self._compute_best_route()
        if best_hops >= self.max_hops or best_id is None:
            return None
        return best_id

    def alive_neighbours(self) -> list[str]:
        now = time.monotonic()
        return [
            nid for nid, e in self._neighbours.items()
            if now - e.last_seen <= NEIGHBOUR_TIMEOUT_S
        ]

    def get_sorted_next_hops(self) -> list[tuple[str, float]]:
        """Returns alive neighbours sorted by distance to gateway.
        Excludes neighbours whose advertised next_hop is this node (split horizon)."""
        if self.is_gateway:
            return []
        now = time.monotonic()
        candidates: list[tuple[str, float]] = []
        for nid, entry in self._neighbours.items():
            if now - entry.last_seen > NEIGHBOUR_TIMEOUT_S:
                continue
            if entry.next_hop == self.node_id:  # Split horizon check
                continue
            if entry.hops_to_gateway < INF and (entry.hops_to_gateway + 1) < self.max_hops:
                candidates.append((nid, entry.hops_to_gateway + 1))
        candidates.sort(key=lambda x: x[1])
        return candidates

    # ---- updates ----

    def update_neighbour(self, neighbour_id: str, hops_to_gateway: float, next_hop: str | None = None) -> None:
        entry = self._neighbours.get(neighbour_id)
        if entry is None:
            entry = NeighbourEntry()
            self._neighbours[neighbour_id] = entry
        entry.hops_to_gateway = hops_to_gateway if hops_to_gateway is not None else INF
        entry.next_hop = next_hop
        entry.last_seen = time.monotonic()

    def remove_neighbour(self, neighbour_id: str) -> bool:
        if neighbour_id in self._neighbours:
            del self._neighbours[neighbour_id]
            return True
        return False

    def check_route_change(self) -> tuple[bool, str | None, str | None]:
        """Returns (changed, old_next_hop, new_next_hop)."""
        cur_hop = self.next_hop
        if cur_hop != self._last_next_hop:
            old_hop = self._last_next_hop
            self._last_next_hop = cur_hop
            self._last_hops = self.hops_to_gateway
            return True, old_hop, cur_hop
        return False, self._last_next_hop, cur_hop

    # ---- internals ----

    def _compute_best_route(self) -> tuple[str | None, float]:
        best_id: str | None = None
        best_hops = INF
        now = time.monotonic()
        for nid, entry in self._neighbours.items():
            if now - entry.last_seen > NEIGHBOUR_TIMEOUT_S:
                continue
            # Split Horizon / Poison Reverse: ignore neighbour if their route passes through us
            if entry.next_hop == self.node_id:
                continue
            if entry.hops_to_gateway < best_hops:
                best_hops = entry.hops_to_gateway
                best_id = nid
        if best_id is not None:
            return best_id, best_hops + 1
        return None, INF
