"""Gateway node: receives EMERGENCY packets, emits PACKET_DELIVERED, sends ACK back."""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.node.node import Node
from backend.node.packet import Packet
from backend.node.config import Topology
from backend.node import events


class Gateway(Node):
    """Gateway is a Node with hops=0. It delivers EMERGENCY packets and sends ACKs."""

    def __init__(self, topology: Topology) -> None:
        super().__init__("GATEWAY", topology, is_gateway=True)

    async def _on_deliver(self, pkt: Packet) -> None:
        self.delivered.append(pkt)

        events.emit({
            "event": "PACKET_DELIVERED",
            "packet_id": pkt.packet_id,
            "route": pkt.route,
            "hop_count": pkt.hop_count,
            "code": pkt.payload.get("code"),
            "priority": pkt.payload.get("priority"),
            "people": pkt.payload.get("people", 1),
            "note": pkt.payload.get("note"),
            "source_kind": pkt.payload.get("source_kind"),
        })

        # Send ACK back along the reverse of the route
        if pkt.packet_type == "EMERGENCY":
            reverse_route = list(reversed(pkt.route))
            ack = Packet(
                packet_id=f"ACK-{pkt.packet_id}",
                packet_type="ACK",
                source="GATEWAY",
                destination=pkt.source,
                payload={"ack_for": pkt.packet_id, "reverse_route": reverse_route},
                ttl=len(reverse_route) + 5,
            )
            await self.originate(ack)
