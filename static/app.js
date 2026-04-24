// ==================== 全局状态 ====================
let scene, camera, renderer, controls;
let centerMeshes = {};   // id -> THREE.Mesh
let sphereMeshes = {};   // id -> THREE.Mesh
let lineObjects = {};    // sphereId -> [THREE.Line]
let highlightedId = null;

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
            <span class="element-delete" data-type="sphere" data-id="${s.id}">✕</span>
        `;
        div.addEventListener("click", (e) => {
            if (e.target.classList.contains("element-delete")) return;
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
}

// ==================== 启动 ====================
document.addEventListener("DOMContentLoaded", () => {
    initScene();
    bindEvents();
    loadAll();
});
