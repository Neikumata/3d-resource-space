from pydantic import BaseModel, Field


class CenterCreate(BaseModel):
    name: str
    x: float
    y: float
    z: float


class CenterResponse(BaseModel):
    id: int
    name: str
    x: float
    y: float
    z: float


class RelationInput(BaseModel):
    center_id: int
    weight: float


class SphereCreate(BaseModel):
    name: str
    radius: float = 1.0
    relations: list[RelationInput]


class SphereUpdate(BaseModel):
    name: str | None = None
    radius: float | None = None
    relations: list[RelationInput] | None = None


class SphereResponse(BaseModel):
    id: int
    name: str
    radius: float
    calculated_x: float
    calculated_y: float
    calculated_z: float
    is_solved: int = 0
    relations: list[dict]


class ProjectionInput(BaseModel):
    source_id: int
    target_id: int
    radius: float
    filter_mode: str = "both"


class ProjectionQuery(BaseModel):
    projections: list[ProjectionInput]


class SolveQuery(BaseModel):
    anchor_center_id: int
    radius: float
    target_sphere_id: int | None = None
    target_sphere_ids: list[int] = Field(default_factory=list)
    reference_sphere_ids: list[int] = Field(default_factory=list)
    samples: int = 2000
    save_as_name: str | None = None
