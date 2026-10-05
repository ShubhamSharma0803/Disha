"""Load deployment.json into a Topology used by every node."""
from __future__ import annotations

import json
from dataclasses import dataclass, field

GATEWAY_PORT = 5000
BASE_NODE_PORT = 5001  # NODE-01 -> 5001, NODE-02 -> 5002, ...


@dataclass
class Topology:
    ids: list[str]                              # GATEWAY + all node ids
    neighbors: dict[str, list[str]]             # adjacency (undirected)
    ports: dict[str, int]                        # id -> TCP port
    coords: dict[str, tuple[float, float]]       # id -> (lat, lon)


def load_topology(path_or_data: str | dict) -> Topology:
    """Parse deployment.json (or loaded dict) and return ids, undirected neighbours, and port map."""
    if isinstance(path_or_data, dict):
        data = path_or_data
    else:
        with open(path_or_data) as f:
            data = json.load(f)

    ids: list[str] = ["GATEWAY"]
    coords: dict[str, tuple[float, float]] = {
        "GATEWAY": (data["gateway"]["lat"], data["gateway"]["lon"])
    }
    for n in data["nodes"]:
        ids.append(n["id"])
        coords[n["id"]] = (n["lat"], n["lon"])

    # Build undirected adjacency from "links"
    neighbors: dict[str, list[str]] = {i: [] for i in ids}
    for link in data["links"]:
        a, b = link["from"], link["to"]
        if a in neighbors and b in neighbors:
            if b not in neighbors[a]:
                neighbors[a].append(b)
            if a not in neighbors[b]:
                neighbors[b].append(a)

    # Assign ports: GATEWAY=5000, NODE-01=5001, NODE-02=5002, ...
    ports: dict[str, int] = {"GATEWAY": GATEWAY_PORT}
    for n in data["nodes"]:
        nid = n["id"]
        try:
            seq = int(nid.split("-")[1])
            ports[nid] = BASE_NODE_PORT + seq - 1
        except Exception:
            ports[nid] = BASE_NODE_PORT + len(ports) - 1

    return Topology(ids=ids, neighbors=neighbors, ports=ports, coords=coords)
