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
let solveObjects = [];

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

// ==================== 求解问题球 3D 可视化 ====================
function clearSolveVisualization() {
    solveObjects.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
        }
    });
    solveObjects = [];
}

function drawSolveVisualization(result, anchorPos, radius, targetPositions) {
    clearSolveVisualization();

    // 锚定球面（线框）——展示问题球的候选所在面
    const sphereGeo = new THREE.SphereGeometry(radius, 24, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
        color: 0x8899ff, wireframe: true, transparent: true, opacity: 0.18,
    });
    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    sphereMesh.position.set(anchorPos[0], anchorPos[1], anchorPos[2]);
    scene.add(sphereMesh);
    solveObjects.push(sphereMesh);

    // 候选点云：按 fitness 上色（绿=好 → 红=差）
    const candidates = result.candidates || [];
    if (candidates.length > 0) {
        const fits = candidates.map(c => c.fitness);
        const minFit = Math.min(...fits);
        const maxFit = Math.max(...fits);
        const range = (maxFit - minFit) || 1;

        const positions = [];
        const colors = [];
        candidates.forEach(c => {
            positions.push(c.position[0], c.position[1], c.position[2]);
            const t = (c.fitness - minFit) / range;
            colors.push(t, 1 - t, 0.2);
        });

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        const mat = new THREE.PointsMaterial({
            size: 0.12, vertexColors: true, transparent: true, opacity: 0.8,
        });
        const pts = new THREE.Points(geo, mat);
        scene.add(pts);
        solveObjects.push(pts);
    }

    // 置信度椭球：用 fitness 最好的前 5% 候选点拟合出的误差范围
    if (result.confidence) {
        const cp = result.confidence.center;
        const cr = result.confidence.radii;
        const ellipsoidGeo = new THREE.SphereGeometry(1, 32, 16);
        const ellipsoidMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35,
        });
        const ellipsoid = new THREE.Mesh(ellipsoidGeo, ellipsoidMat);
        ellipsoid.position.set(cp[0], cp[1], cp[2]);
        ellipsoid.scale.set(cr[0], cr[1], cr[2]);
        scene.add(ellipsoid);
        solveObjects.push(ellipsoid);
    }

    // 最优解位置 + 从它到每个目标球的方向射线
    if (result.best) {
        const bp = result.best.position;
        const bestGeo = new THREE.SphereGeometry(0.22, 20, 20);
        const bestMat = new THREE.MeshBasicMaterial({ color: 0xffee00 });
        const bestMesh = new THREE.Mesh(bestGeo, bestMat);
        bestMesh.position.set(bp[0], bp[1], bp[2]);
        scene.add(bestMesh);
        solveObjects.push(bestMesh);

        targetPositions.forEach((targetPos) => {
            const lineGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(bp[0], bp[1], bp[2]),
                new THREE.Vector3(targetPos[0], targetPos[1], targetPos[2]),
            ]);
            const lineMat = new THREE.LineBasicMaterial({ color: 0xffee00 });
            const line = new THREE.Line(lineGeo, lineMat);
            scene.add(line);
            solveObjects.push(line);
        });
    }
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

// ==================== 求解问题球 UI ====================
function renderSolveOptions(centers, spheres) {
    const anchorSel = document.getElementById("solve-anchor");
    const anchorVal = anchorSel.value;
    anchorSel.innerHTML = '<option value="">选择中心点...</option>' +
        centers.map(c => `<option value="${c.id}">${c.name} (${c.x}, ${c.y}, ${c.z})</option>`).join("");
    anchorSel.value = anchorVal;

    const targetContainer = document.getElementById("solve-targets");
    const checkedTargets = new Set(
        Array.from(targetContainer.querySelectorAll(".solve-target-check:checked"))
            .map(c => parseInt(c.dataset.sphereId))
    );
    targetContainer.innerHTML = "";
    if (spheres.length === 0) {
        targetContainer.innerHTML = '<div style="color:#666;font-size:12px;">暂无资源球</div>';
    } else {
        spheres.forEach(s => {
            const div = document.createElement("div");
            div.className = "relation-item";
            div.innerHTML = `
                <input type="checkbox" data-sphere-id="${s.id}" class="solve-target-check" ${checkedTargets.has(s.id) ? "checked" : ""}>
                <span class="center-label">${s.name} (${s.calculated_x.toFixed(1)}, ${s.calculated_y.toFixed(1)}, ${s.calculated_z.toFixed(1)})</span>
            `;
            targetContainer.appendChild(div);
        });
    }

    const refContainer = document.getElementById("solve-references");
    const checked = new Set(
        Array.from(refContainer.querySelectorAll(".solve-ref-check:checked"))
            .map(c => parseInt(c.dataset.sphereId))
    );
    refContainer.innerHTML = "";
    if (spheres.length === 0) {
        refContainer.innerHTML = '<div style="color:#666;font-size:12px;">暂无资源球</div>';
        return;
    }
    spheres.forEach(s => {
        const div = document.createElement("div");
        div.className = "relation-item";
        div.innerHTML = `
            <input type="checkbox" data-sphere-id="${s.id}" class="solve-ref-check" ${checked.has(s.id) ? "checked" : ""}>
            <span class="center-label">${s.name} (${s.calculated_x.toFixed(1)}, ${s.calculated_y.toFixed(1)}, ${s.calculated_z.toFixed(1)})</span>
        `;
        refContainer.appendChild(div);
    });
}

async function runSolve() {
    const anchorId = parseInt(document.getElementById("solve-anchor").value);
    const radius = parseFloat(document.getElementById("solve-radius").value);
    const samples = parseInt(document.getElementById("solve-samples").value) || 2000;
    const saveAsName = document.getElementById("solve-save-name").value.trim();
    const targetIds = Array.from(
        document.querySelectorAll("#solve-targets .solve-target-check:checked")
    ).map(c => parseInt(c.dataset.sphereId));
    const refs = Array.from(
        document.querySelectorAll("#solve-references .solve-ref-check:checked")
    ).map(c => parseInt(c.dataset.sphereId));

    if (!anchorId) return alert("请选择锚定中心点");
    if (!radius || radius <= 0) return alert("请输入有效模长");
    if (targetIds.length === 0) return alert("请选择至少一个方向参考目标球");
    if (targetIds.some(id => refs.includes(id))) return alert("方向目标球不能同时作为路径参考球");

    const resultDiv = document.getElementById("solve-result");
    resultDiv.textContent = "求解中…";

    try {
        const data = await apiPost("/api/solve", {
            anchor_center_id: anchorId,
            radius,
            target_sphere_ids: targetIds,
            reference_sphere_ids: refs,
            samples,
            save_as_name: saveAsName || null,
        });

        const anchorMesh = centerMeshes[anchorId];
        const targetMeshes = targetIds.map(id => sphereMeshes[id]).filter(Boolean);
        if (!anchorMesh || targetMeshes.length !== targetIds.length) {
            resultDiv.textContent = "锚点或目标球不在场景中";
            return;
        }
        drawSolveVisualization(
            data,
            [anchorMesh.position.x, anchorMesh.position.y, anchorMesh.position.z],
            radius,
            targetMeshes.map(m => [m.position.x, m.position.y, m.position.z])
        );

        if (data.best) {
            const p = data.best.position;
            const hint = data.best.fitness < 1e-6 ? " (完美对准)" : "";
            const conf = data.confidence;
            const confText = conf
                ? `<br>置信椭球: center=(${conf.center.map(v => v.toFixed(2)).join(", ")}), radii=(${conf.radii.map(v => v.toFixed(2)).join(", ")})`
                : "";
            const savedText = data.saved_sphere ? `<br>已保存: ${data.saved_sphere.name}` : "";
            resultDiv.innerHTML =
                `最优解: (${p[0].toFixed(2)}, ${p[1].toFixed(2)}, ${p[2].toFixed(2)})<br>` +
                `残差: ${data.best.fitness.toFixed(4)}${hint}<br>` +
                `候选点数: ${data.candidates.length}` +
                confText +
                savedText;
            if (data.saved_sphere) {
                document.getElementById("solve-save-name").value = "";
                await loadAll();
            }
        } else {
            resultDiv.textContent = "未找到候选解";
        }
    } catch (e) {
        resultDiv.textContent = "";
        alert(e.message);
    }
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
    renderSolveOptions(centers, spheres);
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

    // 求解 - 执行
    document.getElementById("btn-solve").addEventListener("click", runSolve);
    document.getElementById("btn-solve-clear").addEventListener("click", () => {
        clearSolveVisualization();
        document.getElementById("solve-result").textContent = "";
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
