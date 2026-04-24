"""Problem resource sphere solver.

The solver places a partially known sphere on the surface around an anchor
center. It samples possible positions, then scores each candidate by how well
the rays from that candidate to one or more target spheres pass through the
selected reference spheres.
"""

import math


def _fibonacci_sphere(n):
    """Return n near-evenly distributed unit vectors on a unit sphere."""
    if n <= 0:
        return []
    if n == 1:
        return [(0.0, 1.0, 0.0)]
    points = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        y = 1 - (2 * i) / (n - 1)
        r = math.sqrt(max(0.0, 1 - y * y))
        theta = golden * i
        points.append((math.cos(theta) * r, y, math.sin(theta) * r))
    return points


def _point_to_ray_distance(point, origin, direction):
    """Distance from a point to a ray starting at origin along unit direction."""
    vx = point[0] - origin[0]
    vy = point[1] - origin[1]
    vz = point[2] - origin[2]
    t = vx * direction[0] + vy * direction[1] + vz * direction[2]
    if t < 0:
        return math.sqrt(vx * vx + vy * vy + vz * vz)
    cx = origin[0] + t * direction[0]
    cy = origin[1] + t * direction[1]
    cz = origin[2] + t * direction[2]
    dx = point[0] - cx
    dy = point[1] - cy
    dz = point[2] - cz
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _vec_len(v):
    return math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)


def _confidence_ellipsoid(candidates, percentile=0.05):
    """Build an axis-aligned ellipsoid enclosing the best percentile."""
    if not candidates:
        return None

    sorted_candidates = sorted(candidates, key=lambda c: c["fitness"])
    count = max(3, int(math.ceil(len(sorted_candidates) * percentile)))
    top = sorted_candidates[:min(count, len(sorted_candidates))]

    cx = sum(c["position"][0] for c in top) / len(top)
    cy = sum(c["position"][1] for c in top) / len(top)
    cz = sum(c["position"][2] for c in top) / len(top)

    rx = max(abs(c["position"][0] - cx) for c in top)
    ry = max(abs(c["position"][1] - cy) for c in top)
    rz = max(abs(c["position"][2] - cz) for c in top)
    floor = 0.03

    return {
        "center": (cx, cy, cz),
        "radii": (max(rx, floor), max(ry, floor), max(rz, floor)),
        "sample_count": len(top),
        "percentile": percentile,
        "max_fitness": top[-1]["fitness"],
    }


def solve_sphere(anchor, radius, target_pos=None, references=None, samples=2000, target_positions=None):
    """Solve a problem sphere position.

    Args:
        anchor: Known center coordinate.
        radius: Distance from the problem sphere to the anchor.
        target_pos: Backward-compatible single target coordinate.
        references: Reference spheres on the expected projection paths.
        samples: Number of sampled candidate points.
        target_positions: Optional list of target coordinates for joint solving.
    """
    if radius <= 0:
        raise ValueError("radius must be positive")
    if samples < 1:
        raise ValueError("samples must be >= 1")
    if references is None:
        references = []

    if target_positions is None:
        if target_pos is None:
            raise ValueError("at least one target position is required")
        target_positions = [target_pos]
    elif not target_positions:
        raise ValueError("at least one target position is required")

    candidates = []
    best = None

    for u in _fibonacci_sphere(samples):
        s = (
            anchor[0] + radius * u[0],
            anchor[1] + radius * u[1],
            anchor[2] + radius * u[2],
        )

        directions = []
        for target in target_positions:
            dvec = (target[0] - s[0], target[1] - s[1], target[2] - s[2])
            dlen = _vec_len(dvec)
            if dlen >= 1e-9:
                directions.append((dvec[0] / dlen, dvec[1] / dlen, dvec[2] / dlen))

        if not directions:
            continue

        if not references:
            fitness = 0.0
        else:
            total = 0.0
            for direction in directions:
                for ref in references:
                    dist = _point_to_ray_distance(ref["pos"], s, direction)
                    total += dist * dist
            fitness = total

        candidates.append({"position": s, "fitness": fitness})
        if best is None or fitness < best["fitness"]:
            best = {"position": s, "fitness": fitness, "directions": directions}
            best["direction"] = directions[0]

    return {
        "best": best,
        "candidates": candidates,
        "confidence": _confidence_ellipsoid(candidates),
    }
