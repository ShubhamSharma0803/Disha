"""Step 5/6: run optimizer, add deployment order, export JSON, draw a plot."""
import json
import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Rectangle

try:
    from backend.deployment.planner import PlannerInput, local_to_latlon, latlon_to_local, build_links, coverage_ratio, place_nodes
    from backend.deployment.optimize import optimize, connected
except ImportError:
    from planner import PlannerInput, local_to_latlon, latlon_to_local, build_links, coverage_ratio, place_nodes
    from optimize import optimize, connected


def hops_from_gateway(points, links):
    """BFS hop count from GATEWAY over the LoRa links."""
    adj = {i: [] for i in points}
    for l in links:
        adj[l["from"]].append(l["to"])
        adj[l["to"]].append(l["from"])
    hops, queue = {"GATEWAY": 0}, ["GATEWAY"]
    while queue:
        cur = queue.pop(0)
        for nxt in adj[cur]:
            if nxt not in hops:
                hops[nxt] = hops[cur] + 1
                queue.append(nxt)
    return hops


def run(p: PlannerInput, gateway_xy, restricted_latlon=None,
        out_json=None, out_png=None):
    """restricted_latlon: [{"lat":..,"lon":..,"radius_m":..}] - no node may be placed inside."""
    restricted_latlon = restricted_latlon or []
    zones = [(*latlon_to_local(z["lat"], z["lon"], p), z["radius_m"]) for z in restricted_latlon]

    opt_res = optimize(p, gateway_xy, restricted=zones)
    if not opt_res:
        opt_res = place_nodes(p)
    nodes_xy = [tuple(float(v) for v in n) for n in opt_res]
    # temporary ids to compute hops, then final ids follow the deployment order
    tmp = {"GATEWAY": gateway_xy} | {f"T{i}": xy for i, xy in enumerate(nodes_xy)}
    hops = hops_from_gateway(tmp, build_links(tmp, p.lora_range_m))
    dist = lambda xy: math.hypot(xy[0] - gateway_xy[0], xy[1] - gateway_xy[1])
    ordered = sorted(range(len(nodes_xy)), key=lambda i: (hops[f"T{i}"], dist(nodes_xy[i])))

    points = {"GATEWAY": gateway_xy}
    node_hops = {}
    for order, i in enumerate(ordered, 1):
        nid = f"NODE-{order:02d}"
        points[nid] = nodes_xy[i]
        node_hops[nid] = hops[f"T{i}"]
    links = build_links(points, p.lora_range_m)

    def ll(xy):
        lat, lon = local_to_latlon(*xy, p)
        return {"lat": round(lat, 6), "lon": round(lon, 6)}

    nodes = [{"id": nid, **ll(xy), "status": "PLANNED",
              "hops_from_gateway": node_hops[nid], "deploy_order": k}
             for k, (nid, xy) in enumerate(((n, x) for n, x in points.items() if n != "GATEWAY"), 1)]

    result = {
        "assumptions": {"wifi_range_m": p.wifi_range_m, "lora_range_m": p.lora_range_m,
                        "area_m": [p.width_m, p.height_m], "restricted_zones": restricted_latlon},
        "nodes": nodes,
        "gateway": {"id": "GATEWAY", **ll(gateway_xy)},
        "links": links,
        "deployment_order": [n["id"] for n in nodes],
        "drone_targets": [{"order": n["deploy_order"], "node_id": n["id"],
                           "lat": n["lat"], "lon": n["lon"]} for n in nodes],
        "wifi_coverage": round(coverage_ratio(nodes_xy, p, step_m=10), 4),
        "valid": connected(nodes_xy, gateway_xy, p.lora_range_m),
    }

    if out_json:
        filename = "deployment.json" if out_json is True else out_json
        with open(filename, "w") as f:
            json.dump(result, f, indent=2)

    if out_png:
        filename = "deployment.png" if out_png is True else out_png
        fig, ax = plt.subplots(figsize=(8, 8))
        ax.add_patch(Rectangle((-p.width_m / 2, -p.height_m / 2), p.width_m, p.height_m,
                               fill=False, ec="black", lw=2, label="Disaster area"))
        for zx, zy, zr in zones:
            ax.add_patch(Circle((zx, zy), zr, fc="red", alpha=0.25, hatch="//", ec="red"))
        for x, y in nodes_xy:
            ax.add_patch(Circle((x, y), p.wifi_range_m, alpha=0.12, color="tab:blue"))
        for l in links:
            (x1, y1), (x2, y2) = points[l["from"]], points[l["to"]]
            ax.plot([x1, x2], [y1, y2], color="tab:orange", lw=0.6, alpha=0.6)
        for nid, xy in points.items():
            if nid == "GATEWAY":
                continue
            ax.plot(*xy, "o", color="tab:blue")
            ax.text(xy[0] + 15, xy[1] + 15, str(int(nid[-2:])), fontsize=8)
        ax.plot(*gateway_xy, "s", color="red", ms=10, label="Gateway")
        if zones:
            ax.plot([], [], "s", color="red", alpha=0.3, label="Restricted (no node)")
        ax.set_xlim(-p.width_m / 2 - 400, p.width_m / 2 + 400)
        ax.set_ylim(-p.height_m / 2 - 400, p.height_m / 2 + 400)
        ax.set_aspect("equal")
        ax.set_title(f"{len(nodes_xy)} nodes | numbers = deployment order (gateway outward)")
        ax.legend(loc="upper right")
        fig.savefig(filename, dpi=130, bbox_inches="tight")
        plt.close(fig)

    return result


if __name__ == "__main__":
    p = PlannerInput(28.6139, 77.2090, 2000, 2000, 300, 1000)
    # Example restricted zones (lat/lon + radius): e.g. flooded pond, unstable building
    zones = [
        {"lat": 28.6139, "lon": 77.2090, "radius_m": 250},
        {"lat": 28.6184, "lon": 77.2152, "radius_m": 200},
    ]
    r = run(p, (0, -1000), restricted_latlon=zones, out_json="deployment.json", out_png="deployment.png")
    print(f"nodes={len(r['nodes'])} links={len(r['links'])} coverage={r['wifi_coverage']*100:.1f}% valid={r['valid']}")
    print("deployment order:", r["deployment_order"][:6], "...")