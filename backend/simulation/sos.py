"""SOS emergency registry and ranking tracker."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.node import events


@dataclass
class SOSEntry:
    packet_id: str
    source: str
    destination: str = "GATEWAY"
    code: Optional[str] = None
    priority: int = 4
    people: int = 1
    note: Optional[str] = None
    source_kind: str = "simulated"
    type: Optional[str] = None
    message: Optional[str] = None
    status: str = "IN_FLIGHT"  # IN_FLIGHT | DELIVERED | DROPPED
    route: list[str] = field(default_factory=list)
    hop_count: int = 0
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "packet_id": self.packet_id,
            "source": self.source,
            "destination": self.destination,
            "code": self.code,
            "priority": self.priority,
            "people": self.people,
            "note": self.note,
            "source_kind": self.source_kind,
            "status": self.status,
            "route": list(self.route),
            "hop_count": self.hop_count,
            "created_at": self.created_at,
            "type": self.type,
            "message": self.message,
        }


class SOSTracker:
    """Maintains an ordered in-memory log of all emergencies so far."""

    def __init__(self) -> None:
        self._entries: dict[str, SOSEntry] = {}

    def record_emergency(
        self,
        packet_id: str,
        source: str,
        destination: str = "GATEWAY",
        code: Optional[str] = None,
        priority: int = 4,
        people: int = 1,
        note: Optional[str] = None,
        source_kind: str = "simulated",
        type: Optional[str] = None,
        message: Optional[str] = None,
        created_at: Optional[str] = None,
        route: Optional[list[str]] = None,
    ) -> SOSEntry:
        entry = SOSEntry(
            packet_id=packet_id,
            source=source,
            destination=destination,
            code=code,
            priority=priority,
            people=people,
            note=note,
            source_kind=source_kind,
            type=type,
            message=message,
            status="IN_FLIGHT",
            route=list(route or [source]),
            hop_count=0,
            created_at=created_at or datetime.now(timezone.utc).isoformat(),
        )
        self._entries[packet_id] = entry
        return entry

    def on_forward(self, packet_id: str, from_node: Optional[str], to_node: Optional[str]) -> None:
        entry = self._entries.get(packet_id)
        if entry and entry.status == "IN_FLIGHT":
            if to_node and to_node not in entry.route:
                entry.route.append(to_node)
            entry.hop_count += 1

    def on_deliver(
        self,
        packet_id: str,
        route: Optional[list[str]] = None,
        hop_count: Optional[int] = None,
    ) -> None:
        entry = self._entries.get(packet_id)
        if entry:
            entry.status = "DELIVERED"
            if route:
                entry.route = list(route)
            if hop_count is not None:
                entry.hop_count = hop_count
            elif route:
                entry.hop_count = max(0, len(route) - 1)

    def on_drop(self, packet_id: str) -> None:
        entry = self._entries.get(packet_id)
        if entry and entry.status != "DELIVERED":
            entry.status = "DROPPED"

    def clear(self) -> None:
        self._entries.clear()

    def get_all_ranked(self) -> list[dict[str, Any]]:
        """Return all emergencies ranked by priority asc, people desc, created_at asc."""
        items = list(self._entries.values())
        items.sort(key=lambda e: (e.priority, -e.people, e.created_at))
        return [item.to_dict() for item in items]


sos_tracker = SOSTracker()


def _sos_event_listener(event: dict[str, Any]) -> None:
    ev = event.get("event") or event.get("type")
    pid = event.get("packet_id")
    if not pid:
        return

    if ev == "EMERGENCY_CREATED":
        if pid not in sos_tracker._entries:
            payload = event.get("payload") or {}
            sos_tracker.record_emergency(
                packet_id=pid,
                source=event.get("source", ""),
                destination="GATEWAY",
                code=payload.get("code") or event.get("code"),
                priority=payload.get("priority") or event.get("priority", 4),
                people=payload.get("people") or event.get("people", 1),
                note=payload.get("note") or event.get("note"),
                source_kind=payload.get("source_kind") or event.get("source_kind", "simulated"),
                type=payload.get("type"),
                message=payload.get("message"),
                created_at=event.get("timestamp"),
                route=[event.get("source", "")],
            )
    elif ev == "PACKET_FORWARDED":
        sos_tracker.on_forward(pid, event.get("from"), event.get("to"))
    elif ev == "PACKET_DELIVERED":
        sos_tracker.on_deliver(pid, event.get("route"), event.get("hop_count"))
    elif ev == "PACKET_DROPPED":
        sos_tracker.on_drop(pid)


events.register(_sos_event_listener)
