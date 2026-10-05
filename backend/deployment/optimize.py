"""Step 4: reduce node count. Hexagonal lattice search + pruning (+ greedy connected set cover kept for comparison)."""
import math
import numpy as np
try:
    from backend.deployment.planner import PlannerInput, place_nodes, coverage_ratio, build_links, reachable_from_gateway
except ImportError:
    from planner import PlannerInput, place_nodes, coverage_ratio, build_links, reachable_from_gateway


def grid(width, height, step):
    xs = np.arange(-width / 2, width / 2 + 1e-9, step)
    ys = np.arange(-height / 2, height / 2 + 1e-9, step)
    return np.array([(x, y) for x in xs for y in ys])


def covers_all(nodes, pts, r):
    arr = np.array(nodes)
    return (np.hypot(arr[:, None, 0] - pts[None, :, 0],
                     arr[:, None, 1] - pts[None, :, 1]) <= r).any(axis=0).all()


def connected(nodes, gw, lora):
    points = {"GATEWAY": tuple(gw)} | {f"N{i}": tuple(n) for i, n in enumerate(nodes)}
    return len(reachable_from_gateway(points, build_links(points, lora))) == len(points)


def valid(nodes, pts, gw, p):
    return bool(nodes) and covers_all(nodes, pts, p.wifi_range_m) and connected(nodes, gw, p.lora_range_m)


def hex_lattice(p, scale, ox, oy, rotated):
    """Hex lattice of disks. Spacing r*sqrt(3) between neighbours covers the plane."""
    r = p.wifi_range_m * scale
    dx, dy = r * math.sqrt(3), 1.5 * r
    W, H = (p.height_m, p.width_m) if rotated else (p.width_m, p.height_m)
    nodes = []
    row, y = 0, -H / 2 - dy + oy
    while y <= H / 2 + dy:
        x = -W / 2 - dx + ox + (dx / 2 if row % 2 else 0)
        while x <= W / 2 + dx:
            nodes.append((y, x) if rotated else (x, y))
            x += dx
        y += dy
        row += 1
    # keep only nodes whose disk touches the area
    return [n for n in nodes
            if abs(n[0]) <= p.width_m / 2 + r and abs(n[1]) <= p.height_m / 2 + r]


def prune(nodes, pts, gw, p):
    nodes = list(nodes)
    changed = True
    while changed:
        changed = False
        for n in list(nodes):
            trial = [m for m in nodes if m != n]
            if valid(trial, pts, gw, p):
                nodes, changed = trial, True
    return nodes


def blocked(n, zones):
    """zones: list of (x, y, radius_m) where NO node may be placed."""
    return any(math.hypot(n[0] - zx, n[1] - zy) <= zr for zx, zy, zr in zones)


def repair(nodes, pts, cands, covers, r):
    """Greedy: add allowed candidates until every point is covered again."""
    uncovered = np.ones(len(pts), dtype=bool)
    if nodes:
        arr = np.array(nodes)
        uncovered = ~(np.hypot(arr[:, None, 0] - pts[None, :, 0],
                               arr[:, None, 1] - pts[None, :, 1]) <= r).any(axis=0)
    nodes = list(nodes)
    while uncovered.any():
        gain = (covers & uncovered).sum(axis=1)
        b = gain.argmax()
        if gain[b] == 0:
            break
        nodes.append(tuple(cands[b]))
        uncovered &= ~covers[b]
    return nodes


def optimize(p: PlannerInput, gateway_xy, restricted=None, plan_step=25, offsets=6):
    """restricted: list of (x, y, radius_m) in local meters. Nodes are never placed inside them,
    but the area inside them must still be covered by Wi-Fi."""
    restricted = restricted or []
    pts = grid(p.width_m, p.height_m, plan_step)
    gw = np.array(gateway_xy, dtype=float)
    r = p.wifi_range_m
    best = None

    cands = covers = None
    if restricted:
        allc = grid(p.width_m + r, p.height_m + r, 50)
        cands = np.array([c for c in allc if not blocked(c, restricted)])
        covers = np.hypot(cands[:, None, 0] - pts[None, :, 0],
                          cands[:, None, 1] - pts[None, :, 1]) <= r
    for scale in (1.0, 0.95, 0.9, 0.85, 0.8):         # shrink lattice if LoRa links too long
        for rotated in (False, True):
            for i in range(offsets):
                for j in range(offsets):
                    ox = i * r * math.sqrt(3) / offsets
                    oy = j * 1.5 * r / offsets
                    lat = hex_lattice(p, scale, ox, oy, rotated)
                    lat = [n for n in lat if any(math.hypot(n[0]-q[0], n[1]-q[1]) <= r for q in pts[::7])]
                    if restricted:
                        lat = repair([n for n in lat if not blocked(n, restricted)], pts, cands, covers, r)
                    if best is not None and len(lat) > len(best) + 3:
                        continue                      # can't beat best after pruning (cheap skip)
                    if not covers_all(lat, pts, r):
                        continue
                    cand = prune(lat, pts, gw, p) if valid(lat, pts, gw, p) else None
                    if cand and (best is None or len(cand) < len(best)):
                        best = cand
        if best:
            break
    return best


if __name__ == "__main__":
    p = PlannerInput(28.6139, 77.2090, 2000, 2000, 300, 1000)
    gw = (0, -1000)
    nodes = optimize(p, gw)
    print("Baseline square grid: ", len(place_nodes(p)), "nodes")
    print("Optimized (hex+prune):", len(nodes), "nodes")
    print(f"Wi-Fi coverage (fine 10 m check): {coverage_ratio(nodes, p, step_m=10) * 100:.1f}%")
    print("Gateway-connected:", connected(nodes, gw, p.lora_range_m))