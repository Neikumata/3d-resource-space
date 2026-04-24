import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "space.db")


def get_db():
    """获取数据库连接。"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """创建数据库表。"""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS center_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            z REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS resource_spheres (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            radius REAL NOT NULL DEFAULT 1.0,
            calculated_x REAL NOT NULL DEFAULT 0.0,
            calculated_y REAL NOT NULL DEFAULT 0.0,
            calculated_z REAL NOT NULL DEFAULT 0.0,
            is_solved INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sphere_id INTEGER NOT NULL,
            center_id INTEGER NOT NULL,
            weight REAL NOT NULL,
            FOREIGN KEY (sphere_id) REFERENCES resource_spheres(id) ON DELETE CASCADE,
            FOREIGN KEY (center_id) REFERENCES center_points(id) ON DELETE CASCADE,
            UNIQUE(sphere_id, center_id)
        );
    """)
    # 旧库迁移：resource_spheres 缺 is_solved 列时补上
    cols = [r[1] for r in conn.execute("PRAGMA table_info(resource_spheres)").fetchall()]
    if "is_solved" not in cols:
        conn.execute("ALTER TABLE resource_spheres ADD COLUMN is_solved INTEGER NOT NULL DEFAULT 0")
    conn.commit()
    conn.close()
