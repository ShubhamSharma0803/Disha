"""Deployment planner - Step 2: node placement + Wi-Fi coverage check."""
import math
from dataclasses import dataclass

M_PER_DEG_LAT = 111_320.0


@dataclass
class PlannerInput:
    center_lat: float
    center_lon: float
    width_m: float
    height_m: float
    wifi_range_m: float
    lora_range_m: float


def local_to_latlon(x, y, p: PlannerInput):
    """Local meters (origin = area center) -> lat/lon."""
    lat = p.center_lat + y / M_PER_DEG_LAT
    lon = p.center_lon + x / (M_PER_DEG_LAT * math.cos(math.radians(p.center_lat)))
    return lat, lon


def latlon_to_local(lat, lon, p: PlannerInput):
    """lat/lon -> local meters (origin = area center). Inverse of local_to_latlon."""
    y = (lat - p.center_lat) * M_PER_DEG_LAT
    x = (lon - p.center_lon) * M_PER_DEG_LAT * math.cos(math.radians(p.center_lat))
    return x, y


def place_nodes(p: PlannerInput):
    """Square grid. A circle of radius r fully covers a square of side r*sqrt(2),
    so cells of that size (shrunk slightly to fit the area evenly) are covered."""
    max_cell = p.wifi_range_m * math.sqrt(2)
    cols = math.ceil(p.width_m / max_cell)
    rows = math.ceil(p.height_m / max_cell)
    cell_w, cell_h = p.width_m / cols, p.height_m / rows

    nodes = []
    for r in range(rows):
        for c in range(cols):
            x = -p.width_m / 2 + cell_w * (c + 0.5)
            y = -p.height_m / 2 + cell_h * (r + 0.5)
            nodes.append((x, y))
    return nodes


def coverage_ratio(nodes, p: PlannerInput, step_m=25):
    """Verify coverage by sampling points across the area."""
    total = covered = 0
    x = -p.width_m / 2
    while x <= p.width_m / 2:
        y = -p.height_m / 2
        while y <= p.height_m / 2:
            total += 1
            if any(math.hypot(x - nx, y - ny) <= p.wifi_range_m for nx, ny in nodes):
                covered += 1
            y += step_m
        x += step_m
    return covered / total


def build_links(points, lora_range_m):
    """points: {id: (x, y)} including GATEWAY. Link = two points within LoRa range."""
    ids = list(points)
    links = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            (x1, y1), (x2, y2) = points[ids[i]], points[ids[j]]
            d = math.hypot(x1 - x2, y1 - y2)
            if d <= lora_range_m:
                links.append({"from": ids[i], "to": ids[j], "distance_m": round(d)})
    return links


def reachable_from_gateway(points, links):
    """BFS from GATEWAY. Returns the set of node ids that have a path to it."""
    adj = {i: [] for i in points}
    for l in links:
        adj[l["from"]].append(l["to"])
        adj[l["to"]].append(l["from"])
    seen, queue = {"GATEWAY"}, ["GATEWAY"]
    while queue:
        cur = queue.pop(0)
        for nxt in adj[cur]:
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen


def plan(p: PlannerInput, gateway_xy):
    nodes_xy = place_nodes(p)
    points = {"GATEWAY": gateway_xy}
    for i, xy in enumerate(nodes_xy, 1):
        points[f"NODE-{i:02d}"] = xy

    links = build_links(points, p.lora_range_m)
    reached = reachable_from_gateway(points, links)
    unreachable = [i for i in points if i not in reached]

    return {
        "nodes": [
            {"id": i, "lat": local_to_latlon(*xy, p)[0], "lon": local_to_latlon(*xy, p)[1],
             "status": "PLANNED"}
            for i, xy in points.items() if i != "GATEWAY"
        ],
        "gateway": {"id": "GATEWAY", "lat": local_to_latlon(*gateway_xy, p)[0],
                    "lon": local_to_latlon(*gateway_xy, p)[1]},
        "links": links,
        "wifi_coverage": coverage_ratio(nodes_xy, p),
        "unreachable": unreachable,
        "valid": not unreachable,
    }


if __name__ == "__main__":
    # Gateway: middle of the bottom edge (e.g. where the rescue team arrives)
    for lora in (1000, 300):
        p = PlannerInput(28.6139, 77.2090, 2000, 2000, 300, lora)
        r = plan(p, gateway_xy=(0, -1000))
        print(f"LoRa range {lora} m -> nodes={len(r['nodes'])}, links={len(r['links'])}, "
              f"coverage={r['wifi_coverage']*100:.0f}%, valid={r['valid']}, "
              f"unreachable={len(r['unreachable'])}")