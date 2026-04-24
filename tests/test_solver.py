import math
import pytest
from app.solver import _fibonacci_sphere, _point_to_ray_distance, solve_sphere


def test_fibonacci_sphere_count():
    assert len(_fibonacci_sphere(100)) == 100


def test_fibonacci_sphere_on_unit_sphere():
    for p in _fibonacci_sphere(200):
        length = math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2)
        assert abs(length - 1.0) < 1e-6


def test_fibonacci_sphere_edge_cases():
    assert _fibonacci_sphere(0) == []
    assert _fibonacci_sphere(1) == [(0.0, 1.0, 0.0)]


def test_ray_distance_on_ray():
    assert _point_to_ray_distance((5, 0, 0), (0, 0, 0), (1, 0, 0)) == 0.0


def test_ray_distance_perpendicular():
    d = _point_to_ray_distance((0, 3, 0), (0, 0, 0), (1, 0, 0))
    assert abs(d - 3.0) < 1e-9


def test_ray_distance_behind_origin():
    # 点位于射线起点的反向：距离退化为到起点的欧氏距离
    d = _point_to_ray_distance((-5, 0, 0), (0, 0, 0), (1, 0, 0))
    assert abs(d - 5.0) < 1e-9


def test_solve_no_references_all_zero_fitness():
    r = solve_sphere((0, 0, 0), 1.0, (10, 0, 0), [], samples=50)
    assert len(r["candidates"]) > 0
    assert all(c["fitness"] == 0.0 for c in r["candidates"])
    assert r["best"] is not None
    assert r["confidence"] is not None
    assert r["confidence"]["sample_count"] >= 3


def test_solve_candidates_lie_on_anchor_sphere():
    r = solve_sphere((1, 2, 3), 5.0, (20, 2, 3), [], samples=30)
    for c in r["candidates"]:
        dx = c["position"][0] - 1
        dy = c["position"][1] - 2
        dz = c["position"][2] - 3
        assert abs(math.sqrt(dx * dx + dy * dy + dz * dz) - 5.0) < 1e-6


def test_solve_picks_direction_through_reference():
    # 锚点原点、模长 1、目标 (10,0,0)、参考球 (0.5,0,0)
    # 唯一最优：问题球在 (-1,0,0)——从那里朝 +x 发射线正好穿过 (0.5,0,0)
    # 从 (1,0,0) 朝 +x 的射线不会向回穿过 (0.5,0,0)（ref 在起点反向）
    r = solve_sphere(
        (0, 0, 0), 1.0, (10, 0, 0),
        [{"pos": (0.5, 0, 0), "radius": 0.1}],
        samples=800,
    )
    best = r["best"]["position"]
    assert best[0] < -0.9
    assert abs(best[1]) < 0.3
    assert abs(best[2]) < 0.3
    assert r["best"]["fitness"] < 0.05


def test_solve_accepts_multiple_targets():
    r = solve_sphere(
        (0, 0, 0),
        1.0,
        target_positions=[(10, 0, 0), (10, 3, 0)],
        references=[{"pos": (0.5, 0, 0), "radius": 0.1}],
        samples=500,
    )
    assert r["best"] is not None
    assert len(r["best"]["directions"]) == 2
    assert r["confidence"] is not None
    assert len(r["confidence"]["radii"]) == 3


def test_solve_invalid_radius():
    with pytest.raises(ValueError):
        solve_sphere((0, 0, 0), 0, (1, 0, 0), [], samples=10)


def test_solve_invalid_samples():
    with pytest.raises(ValueError):
        solve_sphere((0, 0, 0), 1.0, (1, 0, 0), [], samples=0)
