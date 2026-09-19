import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js';
import { is3d, walkPoseFromHit, walkClickIntent, commentHotkeyBlocked, explodeVec, explodePos, verticalExplodeY, clampFov, issueStatus } from './format.js';
import { applyDisplayMode, clearDisplayMode, aimSun } from './display-modes.js';

const SELECT_BLUE = 0x0474e0;
const HIGHLIGHT = 0x0474e0;
const WALK_SPEED = 1.42;

export class ViewerEngine {
  constructor(host, handlers = {}) {
    this.host = host;
    this.handlers = handlers;
    this.kind = null;
    this.tool = 'select';
    this.gumballMode = 'translate';
    this.showModelBox = false;
    this.pending = null;
    this.comments = [];
    this.markers = [];
    this.highlighted = [];
    this.hiddenIds = new Set();
    this.isolated = false;
    this.storeyOf = new Map();
    this.storeyNames = [];
    this.storeyCount = 0;
    this.storeyFilter = '';
    this.bboxY = { min: 0, max: 1 };
    this.explodeMode = 'vertical';
    this.explodeAmount = 0;
    this.explodeReady = false;
    this.sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.displayMode = 'rendered';
    this.fov = 50;
    this.shadowsOn = true;
    this.ambientOn = true;
    this.sunAz = 45;
    this.sunAlt = 50;
    this.highlightMat = new THREE.MeshLambertMaterial({ color: HIGHLIGHT, emissive: 0x023d78, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.spriteCache = new Map();
    this.keys = {};
    this.walkLook = false;
    this.walkHit = null;
    this.walkPick = null;
    this.walkMarker = null;
    this.lastWalk = 0;
    this.lastPointer = null;
    this.downAt = null;
    this.gizmoDragging = false;
    this.ifcApi = null;
    this.ifcModelID = null;
    this.dxf = null;
    this.dxfHost = null;
    this.svgHost = null;
    this.svgEl = null;
    this.svgView = null;
    this.svgDown = null;
    this.libredwg = null;
    this.boundKey = (e) => this.onKey(e);
    this.boundBlur = () => { this.keys = {}; };
    this.boundResize = () => this.resize();
  }

  emit(type, payload) {
    this.handlers[type]?.(payload);
  }

  mount() {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x9f9f9f, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfd6d2, 1);
    scene.add(hemi);
    const ambient = new THREE.AmbientLight(0x000000, 0);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(1, 2, 1.5);
    sun.castShadow = true;
    // ponytail: INI ShadowMapSize=16448 is GPU-hostile; 2048 + PCFSoft is the upgrade path if acne shows
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.intensity = 1;
    scene.add(sun);
    scene.add(sun.target);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;

    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setMode('translate');
    gizmo.setSize(0.85);
    gizmo.addEventListener('dragging-changed', (e) => {
      this.gizmoDragging = e.value;
      orbit.enabled = !e.value && this.tool !== 'walk';
    });
    gizmo.addEventListener('objectChange', () => {
      const obj = gizmo.object;
      if (obj) {
        obj.updateMatrix();
        const base = obj.userData.basePos;
        const off = obj.userData.explodeOff;
        if (base && off) {
          base.set(obj.position.x - off.x, obj.position.y - off.y, obj.position.z - off.z);
          obj.userData.baseY = base.y;
        }
      }
      this.refreshSelBox();
    });
    gizmo.visible = false;
    scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.orbit = orbit;
    this.gizmo = gizmo;
    this.hemi = hemi;
    this.sun = sun;
    this.ambient = ambient;
    applyDisplayMode(this);

    renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    renderer.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
    renderer.domElement.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('keydown', this.boundKey);
    window.addEventListener('keyup', this.boundKey);
    window.addEventListener('blur', this.boundBlur);
    window.addEventListener('resize', this.boundResize);
    this.resize();
    const loop = (t) => {
      this.raf = requestAnimationFrame(loop);
      this.tickWalk(t);
      if (this.tool !== 'walk') this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop(0);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.boundKey);
    window.removeEventListener('keyup', this.boundKey);
    window.removeEventListener('blur', this.boundBlur);
    window.removeEventListener('resize', this.boundResize);
    this.clearThree();
    if (this.ground) {
      this.scene?.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground.material.dispose();
      this.ground = null;
    }
    this.hideDxf();
    this.hideSvg();
    this.gizmo?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  resize() {
    if (!this.renderer) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pick3d(e) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(e), this.camera);
    const hitM = ray.intersectObjects(this.markers, false)[0];
    const comment = hitM && typeof hitM.object.userData.commentIndex === 'number'
      ? hitM.object.userData.commentIndex - 1
      : null;
    const objs = this.group.children.filter((m) => m.visible);
    if (this.ground?.visible) objs.push(this.ground);
    const hit = ray.intersectObjects(objs, false)[0] || null;
    return { comment, hit };
  }

  rememberPointer(e) {
    this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
  }

  commentAtPointer() {
    if (!is3d(this.kind) || !this.group) return false;
    let hit = this.lastPointer ? this.pick3d(this.lastPointer).hit : null;
    if (!hit) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
      const objs = this.group.children.filter((m) => m.visible);
      hit = ray.intersectObjects(objs, false)[0] || null;
    }
    const src = hit
      ? {
        x: hit.point.x,
        y: hit.point.y,
        z: hit.point.z,
        element_id: hit.object.userData.expressID ?? null,
        element_name: this.describeElement(hit.object.userData.expressID),
      }
      : this.walkPick;
    if (!src) return false;
    if (src.element_id != null) this.select(src.element_id);
    this.walkPick = src;
    this.pending = src;
    this.emit('onPin', src);
    this.drawMarkers();
    return true;
  }

  onPointerDown(e) {
    this.rememberPointer(e);
    this.downAt = { x: e.clientX, y: e.clientY };
    if (this.tool === 'walk' && e.button === 0) this.orbit.enabled = false;
  }

  onPointerMove(e) {
    this.rememberPointer(e);
    if (this.tool !== 'walk' || !(e.buttons & 1) || !this.downAt) return;
    if (!this.walkLook) {
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) <= 4) return;
      this.walkLook = true;
    }
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y -= e.movementX * 0.005;
    this.camera.rotation.x -= e.movementY * 0.005;
    this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x));
  }

  onPointerUp(e) {
    this.rememberPointer(e);
    const looking = this.walkLook;
    this.walkLook = false;
    if (looking || this.gizmoDragging) return;
    if (!this.downAt || Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) return;
    if (!is3d(this.kind) || !this.group) return;
    const pick = this.pick3d(e);
    if (pick.comment != null && this.tool !== 'walk' && this.tool !== 'placeWalk') {
      this.emit('onFocusComment', pick.comment);
      return;
    }
    if (this.tool === 'placeWalk') {
      if (pick.hit) {
        this.placeWalkAt(pick.hit.point);
        this.setTool('walk');
      }
      return;
    }
    if (this.tool === 'walk') {
      const obj = pick.hit?.object;
      const id = obj?.userData?.expressID;
      if (walkClickIntent(id, e.shiftKey || e.altKey, obj != null && obj === this.ground) === 'teleport') {
        if (pick.hit) this.placeWalkAt(pick.hit.point);
        else this.select(null);
        return;
      }
      this.select(id);
      this.walkPick = { x: pick.hit.point.x, y: pick.hit.point.y, z: pick.hit.point.z, element_id: id, element_name: this.describeElement(id) };
      return;
    }
    if (!pick.hit) {
      if (this.tool === 'select') this.select(null);
      return;
    }
    const id = pick.hit.object.userData.expressID;
    const info = this.describeElement(id);
    if (this.tool === 'pin') {
      this.select(id);
      this.pending = { x: pick.hit.point.x, y: pick.hit.point.y, z: pick.hit.point.z, element_id: id ?? null, element_name: info };
      this.emit('onPin', this.pending);
      this.setTool('select');
      this.drawMarkers();
      return;
    }
    this.select(id);
  }

  placeWalkAt(point) {
    this.walkHit = { x: point.x, y: point.y, z: point.z };
    const box = this.group ? new THREE.Box3().setFromObject(this.group) : null;
    const diag = box && !box.isEmpty() ? box.min.distanceTo(box.max) : 10;
    const look = new THREE.Vector3();
    this.camera.getWorldDirection(look);
    const pose = walkPoseFromHit(this.walkHit, look, diag);
    this.camera.position.set(pose.x, pose.y, pose.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(0, Math.atan2(-pose.lx, -pose.lz), 0);
    this.orbit.target.set(pose.x + pose.lx, pose.y, pose.z + pose.lz);
    this.drawWalkMarker(pose.eye);
  }

  clearWalkMarker() {
    if (!this.walkMarker) return;
    this.scene?.remove(this.walkMarker);
    this.walkMarker.geometry?.dispose();
    this.walkMarker.material?.dispose();
    this.walkMarker = null;
  }

  drawWalkMarker(eye) {
    this.clearWalkMarker();
    if (!this.walkHit || !this.scene) return;
    const r = Math.max((eye || 1.6) * 0.12, 0.04);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x0474e0, depthTest: false }),
    );
    mesh.position.set(this.walkHit.x, this.walkHit.y, this.walkHit.z);
    mesh.renderOrder = 998;
    mesh.raycast = () => {};
    this.walkMarker = mesh;
    this.scene.add(mesh);
  }

  onKey(e) {
    const down = e.type === 'keydown';
    const typing = commentHotkeyBlocked(e.target);
    if (typing && e.code !== 'Escape') {
      if (!down) this.keys[e.code] = false;
      return;
    }
    this.keys[e.code] = down;
    if (this.tool === 'walk' && /^(Key[WASDQE]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown)$/.test(e.code)) {
      e.preventDefault();
    }
    if (!down) return;
    if (e.code === 'Escape') {
      if (this.pending) {
        this.pending = null;
        this.emit('onPin', null);
        this.drawMarkers();
        e.preventDefault();
        return;
      }
      if (typing) return;
      if (this.tool === 'walk' || this.tool === 'placeWalk') this.setTool('select');
    }
    if (e.code === 'KeyG') this.setGumball('translate');
    if (e.code === 'KeyR') this.setGumball('rotate');
    if (e.code === 'KeyS' && this.tool !== 'walk') this.setGumball('scale');
    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      this.hideSelected();
    }
  }

  tickWalk(t) {
    if (this.tool !== 'walk') {
      this.lastWalk = t;
      return;
    }
    const dt = Math.min((t - this.lastWalk) / 1000, 0.05);
    this.lastWalk = t;
    const box = this.group ? new THREE.Box3().setFromObject(this.group) : null;
    const diag = box && !box.isEmpty() ? box.min.distanceTo(box.max) : 10;
    const speed = Math.max(diag * 0.2, 0.5) * WALK_SPEED * dt;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    if (this.keys.KeyW || this.keys.ArrowUp) this.camera.position.addScaledVector(forward, speed);
    if (this.keys.KeyS || this.keys.ArrowDown) this.camera.position.addScaledVector(forward, -speed);
    if (this.keys.KeyA || this.keys.ArrowLeft) this.camera.position.addScaledVector(right, -speed);
    if (this.keys.KeyD || this.keys.ArrowRight) this.camera.position.addScaledVector(right, speed);
    if (this.keys.KeyQ || this.keys.PageUp) this.camera.position.y += speed;
    if (this.keys.KeyE || this.keys.PageDown) this.camera.position.y -= speed;
    this.orbit.target.copy(this.camera.position).add(forward);
  }

  setTool(tool) {
    this.tool = tool;
    this.orbit.enabled = tool !== 'walk';
    this.host.style.cursor = tool === 'pin' || tool === 'placeWalk' ? 'crosshair' : tool === 'walk' ? 'move' : '';
    if (tool === 'walk') this.detachGizmo();
    else this.attachGizmo();
    this.emit('onTool', tool);
  }

  setGumball(mode) {
    this.gumballMode = mode;
    this.gizmo.setMode(mode);
    this.attachGizmo();
    this.emit('onGumball', mode);
  }

  setModelBox(on) {
    this.showModelBox = on;
    this.refreshModelBox();
  }

  setDisplayMode(mode) {
    if (mode !== 'rendered' && mode !== 'sketch') return;
    const id = this.selectedId;
    if (this.highlighted.length) this.select(null);
    this.displayMode = mode;
    applyDisplayMode(this);
    if (id != null) this.select(id);
  }

  setFov(deg) {
    this.fov = clampFov(deg);
    if (!this.camera) return;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  setShadows(on) {
    this.shadowsOn = !!on;
    applyDisplayMode(this);
  }

  setAmbient(on) {
    this.ambientOn = !!on;
    applyDisplayMode(this);
  }

  setSun(az, alt) {
    if (az != null && Number.isFinite(+az)) this.sunAz = (((+az % 360) + 360) % 360);
    if (alt != null && Number.isFinite(+alt)) this.sunAlt = Math.min(85, Math.max(5, +alt));
    aimSun(this);
  }

  select(id) {
    for (const h of this.highlighted) h.mesh.material = h.mat;
    this.highlighted = [];
    let mesh = null;
    if (id != null && this.group) {
      for (const m of this.group.children) {
        if (m.userData.expressID === id) {
          this.highlighted.push({ mesh: m, mat: m.material });
          m.material = this.highlightMat;
          mesh = m;
        }
      }
    }
    this.selectedId = id ?? null;
    this.refreshSelBox();
    this.attachGizmo();
    const info = this.describeElement(id);
    this.emit('onSelect', id == null ? null : { id, name: info, mesh });
  }

  attachGizmo() {
    const mesh = this.highlighted[0]?.mesh;
    if (!mesh || this.tool === 'walk' || !is3d(this.kind)) {
      this.detachGizmo();
      return;
    }
    mesh.matrixAutoUpdate = true;
    this.gizmo.attach(mesh);
    this.gizmo.visible = true;
  }

  detachGizmo() {
    this.gizmo.detach();
    this.gizmo.visible = false;
  }

  refreshSelBox() {
    if (this.selBox) {
      this.scene.remove(this.selBox);
      this.selBox.geometry?.dispose();
      this.selBox = null;
    }
    const mesh = this.highlighted[0]?.mesh;
    if (!mesh) return;
    const helper = new THREE.BoxHelper(mesh, SELECT_BLUE);
    this.selBox = helper;
    this.scene.add(helper);
  }

  refreshModelBox() {
    if (this.modelBox) {
      this.scene.remove(this.modelBox);
      this.modelBox.geometry?.dispose();
      this.modelBox = null;
    }
    if (!this.showModelBox || !this.group) return;
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const helper = new THREE.Box3Helper(box, 0x62626a);
    this.modelBox = helper;
    this.scene.add(helper);
  }

  describeElement(id) {
    if (id == null) return null;
    if (this.kind !== 'ifc') {
      const m = this.group?.children.find((x) => x.userData.expressID === id);
      return m?.userData.label || null;
    }
    if (!this.ifcApi || this.ifcModelID == null) return null;
    try {
      const line = this.ifcApi.GetLine(this.ifcModelID, id);
      const type = this.ifcApi.GetNameFromTypeCode(line.type).replace(/^IFC/, '');
      const name = line.Name?.value || line.ObjectType?.value || '';
      const si = this.storeyOf.get(id);
      const floor = si != null ? `${this.storeyNames[si]} · ` : '';
      return floor + (name ? `${type} · ${name}` : type);
    } catch {
      return null;
    }
  }

  clearThree() {
    this.detachGizmo();
    this.walkHit = null;
    this.walkPick = null;
    this.clearWalkMarker();
    this.clearMarkers();
    clearDisplayMode(this);
    if (this.selBox) this.scene.remove(this.selBox);
    if (this.modelBox) this.scene.remove(this.modelBox);
    this.selBox = this.modelBox = null;
    this.explodeReady = false;
    this.explodeAmount = 0;
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.group = null;
  }

  resetTools() {
    this.isolated = false;
    this.hiddenIds = new Set();
    this.storeyFilter = '';
    if (this.renderer) this.renderer.clippingPlanes = [];
    this.select(null);
  }

  fit(target) {
    if (is3d(this.kind)) this.fitThree(target);
    else if (this.kind === 'dwg') this.fitSvg();
    else this.fitDxf();
  }

  fitThree(target) {
    if (!this.group) return;
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = target ? new THREE.Vector3(target.x, target.y, target.z) : box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * (target ? 0.15 : 0.6) || 10;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.near = Math.max(dist / 200, 0.01);
    this.camera.far = dist * 200;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(dist));
    this.orbit.target.copy(center);
    this.orbit.update();
  }

  async open(model) {
    this.kind = model.kind;
    this.pending = null;
    this.walkHit = null;
    this.walkPick = null;
    this.clearWalkMarker();
    this.clearMarkers();
    this.resetTools();
    this.setTool('select');
    if (this.renderer) this.renderer.domElement.style.display = is3d(model.kind) ? 'block' : 'none';
    if (model.kind === 'ifc') {
      const buf = model.file ? await model.file.arrayBuffer() : await (await fetch(model.url)).arrayBuffer();
      await this.loadIfc(buf);
    } else if (is3d(model.kind)) {
      const url = model.file ? URL.createObjectURL(model.file) : model.url;
      await this.loadGeneric3D(model.kind, url);
    } else if (model.kind === 'dwg') {
      const buf = model.file ? await model.file.arrayBuffer() : await (await fetch(model.url)).arrayBuffer();
      await this.loadDwg(buf);
    } else {
      const url = model.file ? URL.createObjectURL(model.file) : model.url;
      await this.loadDxf(url);
    }
    this.drawMarkers();
  }

  async ensureIfc() {
    if (this.ifcApi && typeof this.ifcApi.OpenModel === 'function' && this.ifcApi.wasmModule) {
      return this.ifcApi;
    }
    this.ifcApi = null;
    const mod = await import('web-ifc');
    const ns = mod.IfcAPI ? mod : mod.default;
    const IfcAPI = ns?.IfcAPI || mod.default?.IfcAPI;
    if (typeof IfcAPI !== 'function') {
      throw new Error('web-ifc IfcAPI를 불러오지 못했어요.');
    }
    this.WebIFC = ns;
    const api = new IfcAPI();
    // webpack sets currentScriptPath to the chunk URL; absolute path skips that prefix
    const wasmBase = typeof window !== 'undefined' ? `${window.location.origin}/` : '/';
    api.SetWasmPath(wasmBase, true);
    try {
      await api.Init((path) => (path.endsWith('.wasm') ? `${wasmBase}${path.split('/').pop()}` : path));
    } catch (err) {
      throw new Error(`web-ifc WASM을 초기화하지 못했어요. /web-ifc.wasm을 확인하세요. (${err?.message || err})`);
    }
    if (typeof api.OpenModel !== 'function' || typeof api.wasmModule?.OpenModel !== 'function') {
      throw new Error('web-ifc WASM을 초기화하지 못했어요. OpenModel을 찾을 수 없습니다.');
    }
    this.ifcApi = api;
    return api;
  }

  async loadIfc(arrayBuffer) {
    this.clearThree();
    this.hideDxf();
    this.hideSvg();
    const api = await this.ensureIfc();
    if (typeof api.OpenModel !== 'function') {
      throw new Error('web-ifc WASM을 초기화하지 못했어요. OpenModel을 찾을 수 없습니다.');
    }
    if (this.ifcModelID != null) {
      try { api.CloseModel(this.ifcModelID); } catch { /* already closed */ }
    }
    const modelID = api.OpenModel(new Uint8Array(arrayBuffer), { COORDINATE_TO_ORIGIN: true });
    this.ifcModelID = modelID;
    const group = new THREE.Group();
    const materials = new Map();
    api.StreamAllMeshes(modelID, (mesh) => {
      const placed = mesh.geometries;
      for (let i = 0; i < placed.size(); i++) {
        const pg = placed.get(i);
        const g = api.GetGeometry(modelID, pg.geometryExpressID);
        const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const index = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        const n = verts.length / 6;
        const pos = new Float32Array(n * 3);
        const nor = new Float32Array(n * 3);
        for (let v = 0; v < n; v++) {
          pos[v * 3] = verts[v * 6];
          pos[v * 3 + 1] = verts[v * 6 + 1];
          pos[v * 3 + 2] = verts[v * 6 + 2];
          nor[v * 3] = verts[v * 6 + 3];
          nor[v * 3 + 1] = verts[v * 6 + 4];
          nor[v * 3 + 2] = verts[v * 6 + 5];
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
        const c = pg.color;
        const key = `${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)},${c.w.toFixed(2)}`;
        let mat = materials.get(key);
        if (!mat) {
          mat = new THREE.MeshLambertMaterial({
            color: new THREE.Color(c.x, c.y, c.z),
            transparent: c.w < 1,
            opacity: c.w,
            side: THREE.DoubleSide,
          });
          materials.set(key, mat);
        }
        const m = new THREE.Mesh(geometry, mat);
        m.matrix.fromArray(pg.flatTransformation);
        m.matrixAutoUpdate = false;
        m.matrix.decompose(m.position, m.quaternion, m.scale);
        m.userData.expressID = mesh.expressID;
        group.add(m);
        g.delete();
      }
    });
    this.group = group;
    this.scene.add(group);
    this.buildStoreyMap(api, modelID, group);
    applyDisplayMode(this);
    this.resize();
    this.fitThree();
    this.refreshModelBox();
  }

  async loadGeneric3D(kind, url) {
    this.clearThree();
    this.hideDxf();
    this.hideSvg();
    let root;
    if (kind === 'glb') root = (await new GLTFLoader().loadAsync(url)).scene;
    else if (kind === 'dae') root = (await new ColladaLoader().loadAsync(url)).scene;
    else {
      const loader = new Rhino3dmLoader();
      loader.setLibraryPath('/');
      root = await loader.loadAsync(url);
      // Rhino3dmLoader has no Y-up convert. 3DM is Z-up; Three is Y-up.
      root.rotateX(-Math.PI / 2);
    }
    root.updateMatrixWorld(true);
    const group = new THREE.Group();
    let idx = 1;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.clone(false);
      m.geometry = o.geometry;
      m.material = Array.isArray(o.material) ? o.material.map((mm) => mm.clone()) : o.material.clone();
      for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mm.side = THREE.DoubleSide;
      m.matrix.copy(o.matrixWorld);
      m.matrixAutoUpdate = false;
      m.matrix.decompose(m.position, m.quaternion, m.scale);
      m.userData.expressID = idx++;
      m.userData.label = o.name || o.parent?.name || `객체 ${m.userData.expressID}`;
      m.userData.baseY = m.position.y;
      group.add(m);
    });
    if (kind === '3dm' && group.children.length === 0) throw new Error('메시가 없습니다. 3dm은 메시로 변환된 객체만 보여요.');
    this.group = group;
    this.scene.add(group);
    this.storeyOf = new Map();
    this.storeyCount = 0;
    this.storeyNames = [];
    this.emit('onStoreys', []);
    const box = new THREE.Box3().setFromObject(group);
    this.bboxY = { min: box.min.y, max: box.max.y };
    applyDisplayMode(this);
    this.resize();
    this.fitThree();
    this.refreshModelBox();
  }

  async loadDxf(blobUrl) {
    this.hideSvg();
    if (!this.dxfHost) {
      this.dxfHost = document.createElement('div');
      Object.assign(this.dxfHost.style, { width: '100%', height: '100%' });
      this.host.appendChild(this.dxfHost);
    }
    this.dxfHost.style.display = 'block';
    const { DxfViewer } = await import('dxf-viewer');
    if (this.dxf) {
      this.dxf.Destroy();
      this.dxf = null;
      this.dxfHost.innerHTML = '';
    }
    this.dxf = new DxfViewer(this.dxfHost, { autoResize: true, clearColor: new THREE.Color(0xececee), colorCorrection: true });
    let dxfDown = null;
    this.dxf.Subscribe('pointerdown', (e) => { dxfDown = { x: e.detail.domEvent.clientX, y: e.detail.domEvent.clientY }; });
    this.dxf.Subscribe('pointerup', (e) => {
      const d = e.detail.domEvent;
      if (!dxfDown || Math.hypot(d.clientX - dxfDown.x, d.clientY - dxfDown.y) > 4) return;
      const p = e.detail.position;
      const near = this.markers.find((m) => typeof m.userData.commentIndex === 'number' && Math.hypot(m.position.x - p.x, m.position.y - p.y) < 8);
      if (near) { this.emit('onFocusComment', near.userData.commentIndex - 1); return; }
      if (this.tool !== 'pin') return;
      this.pending = { x: p.x, y: p.y, z: null };
      this.emit('onPin', this.pending);
      this.setTool('select');
      this.drawMarkers();
    });
    await this.dxf.Load({ url: blobUrl, fonts: [] });
    this.fitDxf();
  }

  hideDxf() {
    if (this.dxfHost) this.dxfHost.style.display = 'none';
  }

  fitDxf() {
    const b = this.dxf?.GetBounds();
    if (b) { this.dxf.FitView(b.minX, b.maxX, b.minY, b.maxY, 0.1); this.dxf.Render(); }
  }

  async loadDwg(arrayBuffer) {
    this.hideDxf();
    if (!this.svgHost) {
      this.svgHost = document.createElement('div');
      this.svgHost.className = 'svg-host';
      this.host.appendChild(this.svgHost);
      this.svgHost.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (!this.svgView) return;
        const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const p = this.svgPoint(e.clientX, e.clientY);
        this.svgView.w *= k;
        this.svgView.h *= k;
        this.svgView.x = p.x - (p.x - this.svgView.x) * k;
        this.svgView.y = p.y - (p.y - this.svgView.y) * k;
        this.applySvgView();
      }, { passive: false });
      this.svgHost.addEventListener('pointerdown', (e) => {
        this.svgDown = { x: e.clientX, y: e.clientY, vx: this.svgView?.x, vy: this.svgView?.y, moved: false };
        this.svgHost.setPointerCapture(e.pointerId);
      });
      this.svgHost.addEventListener('pointermove', (e) => {
        if (!this.svgDown || !this.svgView || !(e.buttons & 1)) return;
        const r = this.svgHost.getBoundingClientRect();
        const dx = (e.clientX - this.svgDown.x) * this.svgView.w / r.width;
        const dy = (e.clientY - this.svgDown.y) * this.svgView.h / r.height;
        if (Math.hypot(e.clientX - this.svgDown.x, e.clientY - this.svgDown.y) > 4) this.svgDown.moved = true;
        this.svgView.x = this.svgDown.vx - dx;
        this.svgView.y = this.svgDown.vy - dy;
        this.applySvgView();
      });
      this.svgHost.addEventListener('pointerup', (e) => {
        const wasClick = this.svgDown && !this.svgDown.moved;
        this.svgDown = null;
        if (!wasClick) return;
        const pinEl = e.target.closest?.('.pin');
        if (pinEl && pinEl.dataset.i != null) { this.emit('onFocusComment', Number(pinEl.dataset.i)); return; }
        if (this.tool !== 'pin') return;
        const p = this.svgPoint(e.clientX, e.clientY);
        this.pending = { x: p.x, y: p.y, z: null };
        this.emit('onPin', this.pending);
        this.setTool('select');
        this.drawMarkers();
      });
    }
    this.svgHost.style.display = 'block';
    this.svgHost.innerHTML = '';
    const { LibreDwg, Dwg_File_Type } = await import('@mlightcad/libredwg-web');
    if (!this.libredwg) this.libredwg = await LibreDwg.create('');
    const dwg = this.libredwg.dwg_read_data(arrayBuffer, Dwg_File_Type.DWG);
    const db = this.libredwg.convert(dwg);
    this.svgHost.innerHTML = this.libredwg.dwg_to_svg(db);
    this.libredwg.dwg_free(dwg);
    this.svgEl = this.svgHost.querySelector('svg');
    if (!this.svgEl) throw new Error('svg 변환 실패');
    this.svgEl.removeAttribute('width');
    this.svgEl.removeAttribute('height');
    this.svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.svgEl.style.width = '100%';
    this.svgEl.style.height = '100%';
    const pins = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pins.setAttribute('class', 'pins');
    this.svgEl.appendChild(pins);
    delete this.svgEl.dataset.box;
    this.fitSvg();
  }

  hideSvg() {
    if (this.svgHost) this.svgHost.style.display = 'none';
  }

  svgBox() {
    try {
      const b = this.svgEl.getBBox();
      if (b.width > 0 && b.height > 0) return { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch { /* not in DOM yet */ }
    const vb = this.svgEl.getAttribute('viewBox');
    if (vb) {
      const [x, y, w, h] = vb.split(/[\s,]+/).map(Number);
      return { x, y, w, h };
    }
    return { x: 0, y: 0, w: 100, h: 100 };
  }

  fitSvg() {
    if (!this.svgEl) return;
    if (!this.svgEl.dataset.box) this.svgEl.dataset.box = JSON.stringify(this.svgBox());
    const b = JSON.parse(this.svgEl.dataset.box);
    const pad = 0.05;
    this.svgView = { x: b.x - b.w * pad, y: b.y - b.h * pad, w: b.w * (1 + 2 * pad), h: b.h * (1 + 2 * pad) };
    this.applySvgView();
  }

  applySvgView() {
    this.svgEl.setAttribute('viewBox', `${this.svgView.x} ${this.svgView.y} ${this.svgView.w} ${this.svgView.h}`);
    this.drawSvgMarkers();
  }

  svgPoint(cx, cy) {
    const pt = this.svgEl.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    return pt.matrixTransform(this.svgEl.getScreenCTM().inverse());
  }

  focusSvg(x, y) {
    if (!this.svgEl || !this.svgView) return;
    const b = JSON.parse(this.svgEl.dataset.box);
    const w = b.w * 0.25;
    const h = w * (this.svgView.h / this.svgView.w);
    this.svgView = { x: x - w / 2, y: y - h / 2, w, h };
    this.applySvgView();
  }

  buildStoreyMap(api, modelID, group) {
    this.storeyOf = new Map();
    this.storeyCount = 0;
    try {
      const storeys = [];
      const ids = api.GetLineIDsWithType(modelID, this.WebIFC.IFCBUILDINGSTOREY);
      for (let i = 0; i < ids.size(); i++) {
        const s = api.GetLine(modelID, ids.get(i));
        storeys.push({ id: s.expressID, elev: Number(s.Elevation?.value ?? 0), name: s.Name?.value || s.LongName?.value || '' });
      }
      storeys.sort((a, b) => a.elev - b.elev);
      const index = new Map(storeys.map((s, i) => [s.id, i]));
      this.storeyCount = storeys.length;
      this.storeyNames = storeys.map((s, i) => s.name || `${i + 1}층`);
      const rels = api.GetLineIDsWithType(modelID, this.WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
      for (let i = 0; i < rels.size(); i++) {
        const r = api.GetLine(modelID, rels.get(i));
        const si = index.get(r.RelatingStructure?.value);
        if (si == null) continue;
        for (const e of r.RelatedElements || []) this.storeyOf.set(e.value, si);
      }
    } catch (err) {
      console.warn('storey map failed', err);
    }
    for (const m of group.children) {
      m.userData.baseY = m.position.y;
      m.userData.storey = this.storeyOf.get(m.userData.expressID);
    }
    const box = new THREE.Box3().setFromObject(group);
    this.bboxY = { min: box.min.y, max: box.max.y };
    this.emit('onStoreys', this.storeyNames);
  }

  applySection(t01) {
    if (!this.renderer) return;
    if (t01 >= 1) { this.renderer.clippingPlanes = []; return; }
    const y = this.bboxY.min + (this.bboxY.max - this.bboxY.min) * t01;
    this.sectionPlane.constant = y;
    this.renderer.clippingPlanes = [this.sectionPlane];
  }

  captureExplodeBases() {
    if (!this.group) return;
    this.group.updateMatrixWorld(true);
    const origin = new THREE.Box3().setFromObject(this.group).getCenter(new THREE.Vector3());
    const byId = new Map();
    for (const m of this.group.children) {
      m.userData.basePos = m.position.clone();
      m.userData.baseY = m.position.y;
      m.userData.explodeOff = { x: 0, y: 0, z: 0 };
      const id = m.userData.expressID ?? m.id;
      const list = byId.get(id);
      if (list) list.push(m);
      else byId.set(id, [m]);
    }
    // ponytail: IFC groups by expressID; no id → per-mesh. Upgrade: spatial assembly tree
    const box = new THREE.Box3();
    const part = new THREE.Vector3();
    for (const meshes of byId.values()) {
      box.makeEmpty();
      for (const m of meshes) box.expandByObject(m);
      const vec = box.isEmpty() ? { x: 0, y: 0, z: 0 } : explodeVec(origin, box.getCenter(part));
      for (const m of meshes) m.userData.explodeVec = vec;
    }
    this.explodeReady = true;
  }

  applyExplode(t01, mode) {
    if (!this.group) return;
    if (mode === 'xyz' || mode === 'vertical') this.explodeMode = mode;
    this.explodeAmount = Math.min(1, Math.max(0, Number(t01) || 0));
    if (!this.explodeReady) this.captureExplodeBases();
    const amount = this.explodeAmount;
    if (this.explodeMode === 'xyz') {
      for (const m of this.group.children) {
        const base = m.userData.basePos;
        const vec = m.userData.explodeVec || { x: 0, y: 0, z: 0 };
        if (!base) continue;
        const p = explodePos(base, vec, amount);
        m.position.set(p.x, p.y, p.z);
        m.userData.explodeOff = { x: vec.x * amount, y: vec.y * amount, z: vec.z * amount };
        m.updateMatrix();
      }
    } else {
      const gap = (this.bboxY.max - this.bboxY.min) / Math.max(this.storeyCount, 1) * 0.8;
      for (const m of this.group.children) {
        const base = m.userData.basePos;
        const baseY = base ? base.y : m.userData.baseY;
        const oy = verticalExplodeY(0, m.userData.storey, gap, amount);
        if (base) m.position.set(base.x, baseY + oy, base.z);
        else m.position.y = baseY + oy;
        m.userData.explodeOff = { x: 0, y: oy, z: 0 };
        m.updateMatrix();
      }
    }
    this.refreshSelBox();
    this.refreshModelBox();
  }

  applyVisibility() {
    if (!this.group) return;
    const id = this.highlighted[0]?.mesh.userData.expressID;
    if (this.isolated && id == null) this.isolated = false;
    const floor = this.storeyFilter === '' ? null : Number(this.storeyFilter);
    for (const m of this.group.children) {
      const eid = m.userData.expressID;
      let v = true;
      if (this.isolated) v = eid === id;
      else {
        if (this.hiddenIds.has(eid)) v = false;
        if (floor != null && m.userData.storey !== floor) v = false;
      }
      m.visible = v;
    }
    this.emit('onVisibility', { isolated: this.isolated, hidden: this.hiddenIds.size, floor });
  }

  isolate() {
    if (!this.highlighted.length && !this.isolated) return '먼저 객체를 고르세요.';
    this.isolated = !this.isolated;
    this.applyVisibility();
    return '';
  }

  hideSelected() {
    const id = this.highlighted[0]?.mesh.userData.expressID;
    if (id == null) return '숨길 객체를 고르세요.';
    this.hiddenIds.add(id);
    this.select(null);
    this.applyVisibility();
    return '';
  }

  showAll() {
    this.hiddenIds = new Set();
    this.isolated = false;
    this.storeyFilter = '';
    this.applyVisibility();
  }

  setStorey(value) {
    this.storeyFilter = value;
    this.isolated = false;
    this.applyVisibility();
  }

  setPins(comments, pending) {
    this.comments = comments;
    this.pending = pending;
    this.drawMarkers();
  }

  markerTexture(label, color) {
    const key = `${label}|${color}`;
    if (this.spriteCache.has(key)) return this.spriteCache.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.beginPath();
    g.arc(64, 64, 34, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = 3.5;
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = color;
    g.font = '600 48px "IBM Plex Mono", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(label), 64, 66);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.spriteCache.set(key, t);
    return t;
  }

  makeMarker(label, pos, color = '#0474E0') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.markerTexture(label, color),
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
    }));
    s.position.set(pos.x, pos.y, pos.z ?? 0);
    s.scale.set(0.028, 0.028, 1);
    s.renderOrder = 999;
    s.userData.commentIndex = label;
    return s;
  }

  activeScene() {
    return is3d(this.kind) ? this.scene : this.kind === 'dxf' ? this.dxf?.GetScene() : null;
  }

  clearMarkers() {
    // kind가 바뀐 뒤에 불려도 지워지도록, 지금 씬이 아니라 마커가 붙어 있는 부모에서 뗍니다.
    for (const m of this.markers) {
      (m.parent || this.scene)?.remove(m);
      m.material.dispose();
    }
    this.markers.length = 0;
    if (this.kind === 'dxf') this.dxf?.Render();
  }

  drawMarkers() {
    this.clearMarkers();
    if (this.kind === 'dwg') { this.drawSvgMarkers(); return; }
    const scene = this.activeScene();
    if (!scene) return;
    this.comments.forEach((c, i) => {
      if (c.kind === 'pdf' || c.pos_x == null || issueStatus(c) === 'done') return;
      const m = this.makeMarker(i + 1, { x: c.pos_x, y: c.pos_y, z: c.pos_z });
      scene.add(m);
      this.markers.push(m);
    });
    if (this.pending && this.pending.kind !== 'pdf') {
      const m = this.makeMarker('+', this.pending, '#1C1C1C');
      scene.add(m);
      this.markers.push(m);
    }
    if (this.kind === 'dxf') this.dxf?.Render();
  }

  drawSvgMarkers() {
    if (!this.svgEl || !this.svgView) return;
    const g = this.svgEl.querySelector('g.pins');
    if (!g) return;
    g.innerHTML = '';
    const r = this.svgView.w / 140;
    const mk = (label, x, y, color, i) => {
      const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      grp.setAttribute('class', 'pin');
      if (i != null) grp.dataset.i = i;
      grp.innerHTML = `<circle cx="${x}" cy="${y}" r="${r * 2.6}" fill="transparent"/><circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${color}" stroke-width="${r * 0.22}"/><text x="${x}" y="${y}" font-size="${r * 1.25}" font-family="IBM Plex Mono, monospace" font-weight="600" fill="${color}" text-anchor="middle" dominant-baseline="central">${label}</text>`;
      g.appendChild(grp);
    };
    this.comments.forEach((c, i) => { if (c.kind !== 'pdf' && c.pos_x != null && issueStatus(c) !== 'done') mk(i + 1, c.pos_x, c.pos_y, '#0474E0', i); });
    if (this.pending && this.pending.kind !== 'pdf') mk('+', this.pending.x, this.pending.y, '#1C1C1C', null);
  }

  focusComment(c) {
    if (!c) return;
    if (is3d(this.kind)) this.select(c.element_id ?? null);
    if (c.pos_x == null) return;
    if (is3d(this.kind)) this.fitThree({ x: c.pos_x, y: c.pos_y, z: c.pos_z });
    else if (this.kind === 'dwg') this.focusSvg(c.pos_x, c.pos_y);
    else if (this.dxf) {
      const b = this.dxf.GetBounds();
      const w = b ? (b.maxX - b.minX) * 0.25 : 100;
      this.dxf.SetView({ x: c.pos_x, y: c.pos_y }, w);
    }
  }
}
