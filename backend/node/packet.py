"""Packet dataclass matching docs/protocol.md section 4."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class Packet:
    packet_id: str
    packet_type: str          # HELLO | EMERGENCY | ACK
    source: str
    destination: str
    payload: dict[str, Any] = field(default_factory=dict)
    hop_count: int = 0
    ttl: int = 10
    timestamp: str = ""
    route: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()

    # ---- serialization ----

    def to_json(self) -> str:
        return json.dumps(self.__dict__)

    @classmethod
    def from_json(cls, raw: str) -> Packet:
        return cls(**json.loads(raw))

    # ---- forwarding helpers ----

    def forwarded(self) -> Packet:
        """Return a new Packet with ttl-1 and hop_count+1 (ready to send)."""
        return Packet(
            packet_id=self.packet_id,
            packet_type=self.packet_type,
            source=self.source,
            destination=self.destination,
            payload=self.payload,
            hop_count=self.hop_count + 1,
            ttl=self.ttl - 1,
            timestamp=self.timestamp,
            route=list(self.route),
        )
