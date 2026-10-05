"""Step 5: run optimizer, export JSON for other modules, draw a plot."""
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Rectangle

from planner import PlannerInput, local_to_latlon, build_links, coverage_ratio
from optimize import optimize, connected


def run(p: PlannerInput, gateway_xy, out_json="deployment.json", out_png="deployment.png"):
    nodes_xy = [tuple(float(v) for v in n) for n in optimize(p, gateway_xy)]
    points = {"GATEWAY": gateway_xy} | {f"NODE-{i:02d}": xy for i, xy in enumerate(nodes_xy, 1)}
    links = build_links(points, p.lora_range_m)

    def ll(xy):
        lat, lon = local_to_latlon(*xy, p)
        return {"lat": round(lat, 6), "lon": round(lon, 6)}

    result = {
        "assumptions": {"wifi_range_m": p.wifi_range_m, "lora_range_m": p.lora_range_m,
                        "area_m": [p.width_m, p.height_m]},
        "nodes": [{"id": i, **ll(xy), "status": "PLANNED"} for i, xy in points.items() if i != "GATEWAY"],
        "gateway": {"id": "GATEWAY", **ll(gateway_xy)},
        "links": links,
        "wifi_coverage": round(coverage_ratio(nodes_xy, p, step_m=10), 4),
        "valid": connected(nodes_xy, gateway_xy, p.lora_range_m),
    }
    json.dump(result, open(out_json, "w"), indent=2)

    fig, ax = plt.subplots(figsize=(8, 8))
    ax.add_patch(Rectangle((-p.width_m / 2, -p.height_m / 2), p.width_m, p.height_m,
                           fill=False, ec="black", lw=2, label="Disaster area"))
    for x, y in nodes_xy:
        ax.add_patch(Circle((x, y), p.wifi_range_m, alpha=0.12, color="tab:blue"))
    for l in links:
        (x1, y1), (x2, y2) = points[l["from"]], points[l["to"]]
        ax.plot([x1, x2], [y1, y2], color="tab:orange", lw=0.6, alpha=0.6)
    for i, (x, y) in enumerate(nodes_xy, 1):
        ax.plot(x, y, "o", color="tab:blue")
        ax.text(x + 15, y + 15, str(i), fontsize=8)
    ax.plot(*gateway_xy, "s", color="red", ms=10, label="Gateway")
    ax.set_xlim(-p.width_m / 2 - 400, p.width_m / 2 + 400)
    ax.set_ylim(-p.height_m / 2 - 400, p.height_m / 2 + 400)
    ax.set_aspect("equal")
    ax.set_title(f"{len(nodes_xy)} nodes | Wi-Fi {p.wifi_range_m} m (blue) | LoRa {p.lora_range_m} m links (orange)")
    ax.legend(loc="upper right")
    fig.savefig(out_png, dpi=130, bbox_inches="tight")
    return result


if __name__ == "__main__":
    p = PlannerInput(28.6139, 77.2090, 2000, 2000, 300, 1000)
    r = run(p, (0, -1000))
    print(f"nodes={len(r['nodes'])} links={len(r['links'])} coverage={r['wifi_coverage']*100:.1f}% valid={r['valid']}")