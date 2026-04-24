from fastapi import APIRouter, HTTPException
from app.database import get_db, init_db
from app.models import (
    CenterCreate, CenterResponse,
    SphereCreate, SphereUpdate, SphereResponse,
    ProjectionQuery,
)
from app.calc import calculate_position
from app.projection import query_projection as calc_projection

router = APIRouter(prefix="/api")


# --- 启动时初始化数据库 ---
@router.on_event("startup")
def startup():
    init_db()


# --- 中心点 API ---

@router.get("/centers", response_model=list[CenterResponse])
def list_centers():
    conn = get_db()
    rows = conn.execute("SELECT * FROM center_points").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/centers", response_model=CenterResponse, status_code=201)
def create_center(data: CenterCreate):
    conn = get_db()
    try:
        cursor = conn.execute(
            "INSERT INTO center_points (name, x, y, z) VALUES (?, ?, ?, ?)",
            (data.name, data.x, data.y, data.z),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM center_points WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)
    except Exception:
        conn.close()
        raise HTTPException(status_code=400, detail="中心点名称已存在")
    finally:
        conn.close()


@router.delete("/centers/{center_id}")
def delete_center(center_id: int):
    conn = get_db()
    # 找到受影响的资源球
    affected = conn.execute(
        "SELECT DISTINCT sphere_id FROM relations WHERE center_id = ?", (center_id,)
    ).fetchall()
    # 删除中心点（CASCADE 自动删 relations）
    conn.execute("DELETE FROM center_points WHERE id = ?", (center_id,))
    conn.commit()
    # 重算受影响的资源球
    for (sphere_id,) in affected:
        _recalc_sphere(conn, sphere_id)
    conn.commit()
    conn.close()
    return {"ok": True}


# --- 资源球 API ---

@router.get("/spheres", response_model=list[SphereResponse])
def list_spheres():
    conn = get_db()
    rows = conn.execute("SELECT * FROM resource_spheres").fetchall()
    result = []
    for row in rows:
        rels = conn.execute(
            "SELECT center_id, weight FROM relations WHERE sphere_id = ?",
            (row["id"],),
        ).fetchall()
        sphere = dict(row)
        sphere["relations"] = [dict(r) for r in rels]
        result.append(sphere)
    conn.close()
    return result


@router.post("/spheres", response_model=SphereResponse, status_code=201)
def create_sphere(data: SphereCreate):
    if len(data.relations) < 2:
        raise HTTPException(status_code=400, detail="至少需要关联2个中心点")
    conn = get_db()
    # 计算坐标
    pos = _calc_position_from_relations(conn, data.relations)
    try:
        cursor = conn.execute(
            "INSERT INTO resource_spheres (name, radius, calculated_x, calculated_y, calculated_z) VALUES (?, ?, ?, ?, ?)",
            (data.name, data.radius, pos[0], pos[1], pos[2]),
        )
        sphere_id = cursor.lastrowid
        for rel in data.relations:
            conn.execute(
                "INSERT INTO relations (sphere_id, center_id, weight) VALUES (?, ?, ?)",
                (sphere_id, rel.center_id, rel.weight),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM resource_spheres WHERE id = ?", (sphere_id,)).fetchone()
        rels = conn.execute(
            "SELECT center_id, weight FROM relations WHERE sphere_id = ?", (sphere_id,),
        ).fetchall()
        sphere = dict(row)
        sphere["relations"] = [dict(r) for r in rels]
        return sphere
    except Exception:
        conn.close()
        raise HTTPException(status_code=400, detail="资源球名称已存在或关联无效")
    finally:
        conn.close()


@router.put("/spheres/{sphere_id}", response_model=SphereResponse)
def update_sphere(sphere_id: int, data: SphereUpdate):
    conn = get_db()
    row = conn.execute("SELECT * FROM resource_spheres WHERE id = ?", (sphere_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="资源球不存在")
    # 更新基础字段
    if data.name is not None:
        conn.execute("UPDATE resource_spheres SET name = ? WHERE id = ?", (data.name, sphere_id))
    if data.radius is not None:
        conn.execute("UPDATE resource_spheres SET radius = ? WHERE id = ?", (data.radius, sphere_id))
    # 更新关联关系
    if data.relations is not None:
        if len(data.relations) < 2:
            conn.close()
            raise HTTPException(status_code=400, detail="至少需要关联2个中心点")
        conn.execute("DELETE FROM relations WHERE sphere_id = ?", (sphere_id,))
        for rel in data.relations:
            conn.execute(
                "INSERT INTO relations (sphere_id, center_id, weight) VALUES (?, ?, ?)",
                (sphere_id, rel.center_id, rel.weight),
            )
        pos = _calc_position_from_relations(conn, data.relations)
        conn.execute(
            "UPDATE resource_spheres SET calculated_x = ?, calculated_y = ?, calculated_z = ? WHERE id = ?",
            (pos[0], pos[1], pos[2], sphere_id),
        )
    conn.commit()
    row = conn.execute("SELECT * FROM resource_spheres WHERE id = ?", (sphere_id,)).fetchone()
    rels = conn.execute(
        "SELECT center_id, weight FROM relations WHERE sphere_id = ?", (sphere_id,),
    ).fetchall()
    sphere = dict(row)
    sphere["relations"] = [dict(r) for r in rels]
    conn.close()
    return sphere


@router.delete("/spheres/{sphere_id}")
def delete_sphere(sphere_id: int):
    conn = get_db()
    conn.execute("DELETE FROM resource_spheres WHERE id = ?", (sphere_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# --- 投影查询 API ---

@router.post("/projections/query")
def query_projections(data: ProjectionQuery):
    conn = get_db()
    all_spheres = conn.execute("SELECT * FROM resource_spheres").fetchall()
    sphere_list = [dict(r) for r in all_spheres]

    result_map = {}

    for idx, proj in enumerate(data.projections):
        source = conn.execute(
            "SELECT * FROM resource_spheres WHERE id = ?", (proj.source_id,)
        ).fetchone()
        target = conn.execute(
            "SELECT * FROM resource_spheres WHERE id = ?", (proj.target_id,)
        ).fetchone()
        if not source or not target:
            continue

        source_pos = (source["calculated_x"], source["calculated_y"], source["calculated_z"])
        target_pos = (target["calculated_x"], target["calculated_y"], target["calculated_z"])

        candidates = [s for s in sphere_list if s["id"] != proj.source_id and s["id"] != proj.target_id]
        matches = calc_projection(candidates, source_pos, target_pos, proj.radius, proj.filter_mode)

        for sphere, match_type in matches:
            sid = sphere["id"]
            if sid not in result_map:
                result_map[sid] = {"sphere": sphere, "matched_by": [], "match_types": []}
            result_map[sid]["matched_by"].append(idx)
            result_map[sid]["match_types"].append(match_type)

    conn.close()
    return {"results": list(result_map.values())}


# --- 内部辅助函数 ---

def _calc_position_from_relations(conn, relations):
    """从关联关系计算坐标。"""
    centers = []
    weights = []
    for rel in relations:
        row = conn.execute("SELECT x, y, z FROM center_points WHERE id = ?", (rel.center_id,)).fetchone()
        if not row:
            raise ValueError(f"中心点 id={rel.center_id} 不存在")
        centers.append((row["x"], row["y"], row["z"]))
        weights.append(rel.weight)
    return calculate_position(centers, weights)


def _recalc_sphere(conn, sphere_id):
    """重新计算资源球坐标（关联被删除后调用）。"""
    rels = conn.execute(
        "SELECT center_id, weight FROM relations WHERE sphere_id = ?", (sphere_id,)
    ).fetchall()
    if len(rels) < 2:
        # 不足2个关联，删除该资源球
        conn.execute("DELETE FROM resource_spheres WHERE id = ?", (sphere_id,))
        return
    centers = []
    weights = []
    for rel in rels:
        row = conn.execute("SELECT x, y, z FROM center_points WHERE id = ?", (rel["center_id"],)).fetchone()
        centers.append((row["x"], row["y"], row["z"]))
        weights.append(rel["weight"])
    pos = calculate_position(centers, weights)
    conn.execute(
        "UPDATE resource_spheres SET calculated_x = ?, calculated_y = ?, calculated_z = ? WHERE id = ?",
        (pos[0], pos[1], pos[2], sphere_id),
    )
