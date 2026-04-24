// ==================== 全局状态 ====================
let scene, camera, renderer, controls;
let centerMeshes = {};   // id -> THREE.Mesh
let sphereMeshes = {};   // id -> THREE.Mesh
let lineObjects = {};    // sphereId -> [THREE.Line]
let highlightedId = null;
let projections = [];
let projectionMeshes = [];
let projectionResults = [];
let currentFilterMode = "both";

// ==================== Three.js 初始化 ====================
function initScene() {
    const container = document.getElementById("scene-container");
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0f23);

    camera = new THREE.PerspectiveCamera(
        60, container.clientWidth / container.clientHeight, 0.1, 1000
    );
    camera.position.set(10, 8, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    // 坐标轴
    const axes = new THREE.AxesHelper(20);
    scene.add(axes);

    // 网格
    const grid = new THREE.GridHelper(20, 20, 0x333366, 0x222244);
    scene.add(grid);

    // 灯光
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 15, 10);
    scene.add(dir);

    window.addEventListener("resize", onResize);
    animate();
}

function onResize() {
    const container = document.getElementById("scene-container");
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// ==================== 3D 对象管理 ====================
function addCenterToScene(id, x, y, z, name) {
    const geo = new THREE.SphereGeometry(0.15, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData = { type: "center", id, name };
    scene.add(mesh);
    centerMeshes[id] = mesh;
}

function addSphereToScene(id, x, y, z, radius, name) {
    const geo = new THREE.SphereGeometry(radius, 32, 32);
    const mat = new THREE.MeshPhongMaterial({
        color: 0x4ecdc4, transparent: true, opacity: 0.35,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData = { type: "sphere", id, name };

    // 球心点
    const dotGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x4ecdc4 });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    mesh.add(dot);

    scene.add(mesh);
    sphereMeshes[id] = mesh;
}

function removeCenterFromScene(id) {
    if (centerMeshes[id]) {
        scene.remove(centerMeshes[id]);
        delete centerMeshes[id];
    }
}

function removeSphereFromScene(id) {
    if (sphereMeshes[id]) {
        scene.remove(sphereMeshes[id]);
        delete sphereMeshes[id];
    }
    clearLines(id);
}

function updateSphereInScene(id, x, y, z, radius) {
    const mesh = sphereMeshes[id];
    if (!mesh) return;
    mesh.position.set(x, y, z);
    mesh.geometry.dispose();
    mesh.geometry = new THREE.SphereGeometry(radius, 32, 32);
}

function clearLines(sphereId) {
    if (lineObjects[sphereId]) {
        lineObjects[sphereId].forEach((l) => scene.remove(l));
        delete lineObjects[sphereId];
    }
}

function updateLines(sphereId, relations) {
    clearLines(sphereId);
    const sphereMesh = sphereMeshes[sphereId];
    if (!sphereMesh) return;
    const lines = [];
    relations.forEach((rel) => {
        const centerMesh = centerMeshes[rel.center_id];
        if (!centerMesh) return;
        const points = [sphereMesh.position.clone(), centerMesh.position.clone()];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineDashedMaterial({
            color: 0x666688, dashSize: 0.3, gapSize: 0.15,
        });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        scene.add(line);
        lines.push(line);
    });
    lineObjects[sphereId] = lines;
}

function highlightElement(type, id) {
    // 清除之前的高亮
    Object.values(centerMeshes).forEach((m) => m.material.color.setHex(0xff6b6b));
    Object.values(sphereMeshes).forEach((m) => m.material.opacity = 0.35);

    if (type === "center" && centerMeshes[id]) {
        centerMeshes[id].material.color.setHex(0xffaa00);
    } else if (type === "sphere" && sphereMeshes[id]) {
        sphereMeshes[id].material.opacity = 0.7;
    }
}

// ==================== 投影 3D 可视化 ====================
function addProjectionCylinder(sourcePos, targetPos, radius) {
    const direction = new THREE.Vector3().subVectors(
        new THREE.Vector3(targetPos[0], targetPos[1], targetPos[2]),
        new THREE.Vector3(sourcePos[0], sourcePos[1], sourcePos[2])
    );
    if (direction.length() === 0) return;
    direction.normalize();

    const length = 200;
    const geo = new THREE.CylinderGeometry(radius, radius, length, 32, 1, true);
    const mat = new THREE.MeshPhongMaterial({
        color: 0xffaa00, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sourcePos[0], sourcePos[1], sourcePos[2]);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    scene.add(mesh);
    projectionMeshes.push(mesh);
}

function removeAllProjectionCylinders() {
    projectionMeshes.forEach(m => {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
    });
    projectionMeshes = [];
}

function renderProjectionCylinders() {
    removeAllProjectionCylinders();
    projections.forEach(proj => {
        const srcMesh = sphereMeshes[proj.source_id];
        const tgtMesh = sphereMeshes[proj.target_id];
        if (!srcMesh || !tgtMesh) return;
        addProjectionCylinder(
            [srcMesh.position.x, srcMesh.position.y, srcMesh.position.z],
            [tgtMesh.position.x, tgtMesh.position.y, tgtMesh.position.z],
            proj.radius
        );
    });
}

function resetSphereAppearance() {
    Object.values(sphereMeshes).forEach(m => {
        m.material.color.setHex(0x4ecdc4);
        m.material.opacity = 0.35;
    });
}

function highlightProjectionResults() {
    resetSphereAppearance();
    if (projectionResults.length === 0) return;
    projectionResults.forEach(r => {
        const mesh = sphereMeshes[r.sphere.id];
        if (mesh) {
            mesh.material.opacity = 0.7;
            mesh.material.color.setHex(0xffaa00);
        }
    });
}

// ==================== API 调用 ====================
async function apiGet(path) {
    const res = await fetch(path);
    return res.json();
}

async function apiPost(path, body) {
    const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "请求失败");
    }
    return res.json();
}

async function apiPut(path, body) {
    const res = await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "请求失败");
    }
    return res.json();
}

async function apiDelete(path) {
    const res = await fetch(path, { method: "DELETE" });
    return res.json();
}

// ==================== 投影查询 ====================
function renderProjectionOptions(spheres) {
    const sourceSelect = document.getElementById("proj-source");
    const targetSelect = document.getElementById("proj-target");
    const sourceVal = sourceSelect.value;
    const targetVal = targetSelect.value;

    const opts = '<option value="">选择资源球...</option>' +
        spheres.map(s => `<option value="${s.id}">${s.name} (${s.calculated_x.toFixed(1)}, ${s.calculated_y.toFixed(1)}, ${s.calculated_z.toFixed(1)})</option>`).join("");
    sourceSelect.innerHTML = opts;
    targetSelect.innerHTML = opts;
    sourceSelect.value = sourceVal;
    targetSelect.value = targetVal;
}

function renderProjectionList() {
    const container = document.getElementById("projection-list");
    container.innerHTML = "";
    if (projections.length === 0) {
        container.innerHTML = '<div style="color:#666;font-size:12px;">暂无投影</div>';
        document.getElementById("projection-result").style.display = "none";
        return;
    }
    projections.forEach((p, idx) => {
        const modeLabel = p.filter_mode === "intersect" ? "相交" : p.filter_mode === "contain" ? "包含" : "两者";
        const div = document.createElement("div");
        div.className = "projection-tag";
        div.innerHTML = `
            <span>${p.source_name}→${p.target_name} r=${p.radius} [${modeLabel}]</span>
            <span class="tag-delete" data-idx="${idx}">✕</span>
        `;
        container.appendChild(div);
    });
    container.querySelectorAll(".tag-delete").forEach(btn => {
        btn.addEventListener("click", async () => {
            projections.splice(parseInt(btn.dataset.idx), 1);
            renderProjectionCylinders();
            await queryProjections();
        });
    });
}

function renderProjectionResults() {
    const resultSection = document.getElementById("projection-result");
    const container = document.getElementById("projection-result-list");

    if (projections.length === 0) {
        resultSection.style.display = "none";
        return;
    }

    resultSection.style.display = "block";
    container.innerHTML = "";

    if (projectionResults.length === 0) {
        container.innerHTML = '<div style="color:#666;font-size:12px;">无匹配结果</div>';
        return;
    }

    projectionResults.forEach(r => {
        const typeLabels = r.match_types.map(t => t === "contain" ? "包含" : "相交").join(", ");
        const div = document.createElement("div");
        div.className = "projection-result-item";
        div.innerHTML = `● ${r.sphere.name} — ${typeLabels}`;
        container.appendChild(div);
    });
}

async function queryProjections() {
    if (projections.length === 0) {
        projectionResults = [];
        renderProjectionList();
        renderProjectionResults();
        resetSphereAppearance();
        return;
    }
    try {
        const data = await apiPost("/api/projections/query", {
            projections: projections.map(p => ({
                source_id: p.source_id,
                target_id: p.target_id,
                radius: p.radius,
                filter_mode: p.filter_mode,
            })),
        });
        projectionResults = data.results;
        renderProjectionList();
        renderProjectionResults();
        highlightProjectionResults();
    } catch (e) {
        alert(e.message);
    }
}

function validateProjections(spheres) {
    const validIds = new Set(spheres.map(s => s.id));
    projections = projections.filter(p => validIds.has(p.source_id) && validIds.has(p.target_id));
}

// ==================== 加载全部数据 ====================
async function loadAll() {
    // 清空场景
    Object.keys(centerMeshes).forEach(removeCenterFromScene);
    Object.keys(sphereMeshes).forEach(removeSphereFromScene);

    const [centers, spheres] = await Promise.all([
        apiGet("/api/centers"),
        apiGet("/api/spheres"),
    ]);

    centers.forEach((c) => addCenterToScene(c.id, c.x, c.y, c.z, c.name));
    spheres.forEach((s) => {
        addSphereToScene(s.id, s.calculated_x, s.calculated_y, s.calculated_z, s.radius, s.name);
        updateLines(s.id, s.relations);
    });

    renderRelationOptions(centers);
    renderElementList(centers, spheres);
    renderProjectionOptions(spheres);
    validateProjections(spheres);
    renderProjectionCylinders();
    if (projections.length > 0) {
        await queryProjections();
    } else {
        resetSphereAppearance();
    }
}

// ==================== UI 渲染 ====================
function renderRelationOptions(centers) {
    const container = document.getElementById("sphere-relations");
    container.innerHTML = "";
    if (centers.length === 0) {
        container.innerHTML = '<div style="color:#666;font-size:12px;">暂无中心点，请先创建</div>';
        return;
    }
    centers.forEach((c) => {
        const div = document.createElement("div");
        div.className = "relation-item";
        div.innerHTML = `
            <input type="checkbox" data-center-id="${c.id}" class="rel-check">
            <span class="center-label">${c.name} (${c.x}, ${c.y}, ${c.z})</span>
            <input type="number" data-center-id="${c.id}" class="weight-input" value="0.5" step="0.1" min="0">
        `;
        container.appendChild(div);
    });
    // 权重变化时预览坐标
    container.querySelectorAll("input").forEach((inp) => {
        inp.addEventListener("input", previewSphereCoord);
    });
}

async function previewSphereCoord() {
    const preview = document.getElementById("sphere-preview");
    const relations = getSelectedRelations();
    if (relations.length < 2) {
        preview.textContent = "";
        return;
    }
    const centers = await apiGet("/api/centers");
    const filtered = relations.filter((r) => centers.find((c) => c.id === r.center_id));
    if (filtered.length < 2) {
        preview.textContent = "";
        return;
    }
    const total = filtered.reduce((s, r) => s + r.weight, 0);
    if (total === 0) {
        preview.textContent = "权重总和为0";
        return;
    }
    let x = 0, y = 0, z = 0;
    filtered.forEach((r) => {
        const c = centers.find((cc) => cc.id === r.center_id);
        x += r.weight * c.x;
        y += r.weight * c.y;
        z += r.weight * c.z;
    });
    x /= total; y /= total; z /= total;
    preview.textContent = `计算坐标: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
}

function getSelectedRelations() {
    const checks = document.querySelectorAll("#sphere-relations .rel-check:checked");
    const relations = [];
    checks.forEach((cb) => {
        const cid = parseInt(cb.dataset.centerId);
        const weightInput = document.querySelector(
            `#sphere-relations .weight-input[data-center-id="${cid}"]`
        );
        relations.push({ center_id: cid, weight: parseFloat(weightInput.value) || 0 });
    });
    return relations;
}

function renderElementList(centers, spheres) {
    const container = document.getElementById("element-list");
    container.innerHTML = "";
    centers.forEach((c) => {
        const div = document.createElement("div");
        div.className = "element-item";
        div.innerHTML = `
            <div class="element-info">
                <span class="dot-center"></span>
                <span class="element-name">${c.name}</span>
                <span class="element-detail">(${c.x}, ${c.y}, ${c.z})</span>
            </div>
            <span class="element-delete" data-type="center" data-id="${c.id}">✕</span>
        `;
        div.addEventListener("click", (e) => {
            if (e.target.classList.contains("element-delete")) return;
            highlightElement("center", c.id);
        });
        container.appendChild(div);
    });
    spheres.forEach((s) => {
        const div = document.createElement("div");
        div.className = "element-item";
        div.innerHTML = `
            <div class="element-info">
                <span class="dot-sphere"></span>
                <span class="element-name">${s.name}</span>
                <span class="element-detail">r=${s.radius} (${s.calculated_x.toFixed(1)}, ${s.calculated_y.toFixed(1)}, ${s.calculated_z.toFixed(1)})</span>
            </div>
            <div class="element-actions">
                <span class="element-edit" data-id="${s.id}">✎</span>
                <span class="element-delete" data-type="sphere" data-id="${s.id}">✕</span>
            </div>
        `;
        div.addEventListener("click", (e) => {
            if (e.target.classList.contains("element-delete") || e.target.classList.contains("element-edit")) return;
            highlightElement("sphere", s.id);
        });
        container.appendChild(div);
    });
    // 删除按钮事件
    container.querySelectorAll(".element-delete").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const type = btn.dataset.type;
            const id = btn.dataset.id;
            if (!confirm(`确定删除？`)) return;
            await apiDelete(`/api/${type === "center" ? "centers" : "spheres"}/${id}`);
            await loadAll();
        });
    });

    // 编辑资源球按钮事件
    container.querySelectorAll(".element-edit").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.id);
            const sphere = spheres.find((s) => s.id === id);
            if (sphere) openEditModal(sphere, centers);
        });
    });
}

// ==================== 编辑资源球 ====================
let editingSphere = null;

function openEditModal(sphere, centers) {
    editingSphere = sphere;
    const modal = document.getElementById("edit-modal");
    document.getElementById("edit-sphere-name").value = sphere.name;
    document.getElementById("edit-sphere-radius").value = sphere.radius;

    // 渲染关联选项
    const relContainer = document.getElementById("edit-sphere-relations");
    relContainer.innerHTML = "";
    centers.forEach((c) => {
        const existing = sphere.relations.find((r) => r.center_id === c.id);
        const div = document.createElement("div");
        div.className = "relation-item";
        div.innerHTML = `
            <input type="checkbox" data-center-id="${c.id}" class="rel-check" ${existing ? "checked" : ""}>
            <span class="center-label">${c.name} (${c.x}, ${c.y}, ${c.z})</span>
            <input type="number" data-center-id="${c.id}" class="weight-input" value="${existing ? existing.weight : 0.5}" step="0.1" min="0">
        `;
        relContainer.appendChild(div);
    });

    // 预览坐标
    relContainer.querySelectorAll("input").forEach((inp) => {
        inp.addEventListener("input", previewEditCoord);
    });
    previewEditCoord();

    modal.style.display = "flex";
}

function closeEditModal() {
    document.getElementById("edit-modal").style.display = "none";
    editingSphere = null;
}

function getEditRelations() {
    const checks = document.querySelectorAll("#edit-sphere-relations .rel-check:checked");
    const relations = [];
    checks.forEach((cb) => {
        const cid = parseInt(cb.dataset.centerId);
        const weightInput = document.querySelector(
            `#edit-sphere-relations .weight-input[data-center-id="${cid}"]`
        );
        relations.push({ center_id: cid, weight: parseFloat(weightInput.value) || 0 });
    });
    return relations;
}

async function previewEditCoord() {
    const preview = document.getElementById("edit-sphere-preview");
    const relations = getEditRelations();
    if (relations.length < 2) {
        preview.textContent = relations.length === 0 ? "" : "至少需要2个关联";
        return;
    }
    const centers = await apiGet("/api/centers");
    const filtered = relations.filter((r) => centers.find((c) => c.id === r.center_id));
    if (filtered.length < 2) {
        preview.textContent = "";
        return;
    }
    const total = filtered.reduce((s, r) => s + r.weight, 0);
    if (total === 0) {
        preview.textContent = "权重总和为0";
        return;
    }
    let x = 0, y = 0, z = 0;
    filtered.forEach((r) => {
        const c = centers.find((cc) => cc.id === r.center_id);
        x += r.weight * c.x;
        y += r.weight * c.y;
        z += r.weight * c.z;
    });
    x /= total; y /= total; z /= total;
    preview.textContent = `计算坐标: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
}

// ==================== 事件绑定 ====================
function bindEvents() {
    // 添加中心点
    document.getElementById("btn-add-center").addEventListener("click", async () => {
        const name = document.getElementById("center-name").value.trim();
        const x = parseFloat(document.getElementById("center-x").value) || 0;
        const y = parseFloat(document.getElementById("center-y").value) || 0;
        const z = parseFloat(document.getElementById("center-z").value) || 0;
        if (!name) return alert("请输入名称");
        try {
            await apiPost("/api/centers", { name, x, y, z });
            document.getElementById("center-name").value = "";
            await loadAll();
        } catch (e) {
            alert(e.message);
        }
    });

    // 添加资源球
    document.getElementById("btn-add-sphere").addEventListener("click", async () => {
        const name = document.getElementById("sphere-name").value.trim();
        const radius = parseFloat(document.getElementById("sphere-radius").value) || 1;
        const relations = getSelectedRelations();
        if (!name) return alert("请输入名称");
        if (relations.length < 2) return alert("至少选择2个中心点");
        try {
            await apiPost("/api/spheres", { name, radius, relations });
            document.getElementById("sphere-name").value = "";
            await loadAll();
        } catch (e) {
            alert(e.message);
        }
    });

    // 编辑资源球 - 取消
    document.getElementById("btn-edit-cancel").addEventListener("click", closeEditModal);

    // 编辑资源球 - 保存
    document.getElementById("btn-edit-save").addEventListener("click", async () => {
        if (!editingSphere) return;
        const name = document.getElementById("edit-sphere-name").value.trim();
        const radius = parseFloat(document.getElementById("edit-sphere-radius").value) || 1;
        const relations = getEditRelations();
        if (!name) return alert("请输入名称");
        if (relations.length < 2) return alert("至少选择2个中心点");
        try {
            await apiPut(`/api/spheres/${editingSphere.id}`, { name, radius, relations });
            closeEditModal();
            await loadAll();
        } catch (e) {
            alert(e.message);
        }
    });

    // 点击模态框背景关闭
    document.getElementById("edit-modal").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeEditModal();
    });

    // 投影 - 筛选模式切换
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentFilterMode = btn.dataset.mode;
        });
    });

    // 投影 - 添加投影
    document.getElementById("btn-add-projection").addEventListener("click", async () => {
        const sourceSelect = document.getElementById("proj-source");
        const targetSelect = document.getElementById("proj-target");
        const sourceId = parseInt(sourceSelect.value);
        const targetId = parseInt(targetSelect.value);
        const radius = parseFloat(document.getElementById("proj-radius").value) || 2;

        if (!sourceId || !targetId) return alert("请选择起点和方向参考资源球");
        if (sourceId === targetId) return alert("起点和方向参考不能相同");

        const sourceName = sourceSelect.options[sourceSelect.selectedIndex].text.split(" (")[0];
        const targetName = targetSelect.options[targetSelect.selectedIndex].text.split(" (")[0];

        projections.push({
            source_id: sourceId, target_id: targetId,
            radius, filter_mode: currentFilterMode,
            source_name: sourceName, target_name: targetName,
        });
        renderProjectionCylinders();
        await queryProjections();
    });
}

// ==================== 启动 ====================
document.addEventListener("DOMContentLoaded", () => {
    initScene();
    bindEvents();
    loadAll();
});
