import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js';
import * as WebIFC from 'web-ifc';
import { DxfViewer } from 'dxf-viewer';
import { createClient } from '@supabase/supabase-js';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';

// ────────────────────────────────────────────────────────────
// 설정
// ────────────────────────────────────────────────────────────
const cfg = window.APP_CONFIG || {};
const hasSupabase = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const supabase = hasSupabase ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
const BUCKET = 'models';

const $ = (id) => document.getElementById(id);
const el = {
  title: $('title'), mode: $('mode'),
  file: $('file'), uploadStatus: $('upload-status'),
  models: $('models'), viewer: $('viewer'), empty: $('empty'), loading: $('loading'),
  viewerBar: $('viewer-bar'), currentName: $('current-name'), fit: $('fit'), pinBtn: $('pin'),
  pinHint: $('pin-hint'),
  comments: $('comments'), commentHint: $('comment-hint'), form: $('comment-form'),
  author: $('author'), body: $('body'), commentStatus: $('comment-status'),
  pinState: $('pin-state'), pinClear: $('pin-clear'),
  tools3d: $('tools3d'), isolate: $('isolate'), section: $('section'), explode: $('explode'),
  hide: $('hide'), showAll: $('show-all'), storeySel: $('storey'),
};

el.title.textContent = cfg.TITLE || '모델 뷰어';
el.mode.textContent = hasSupabase ? '수파베이스 연결됨' : '로컬 모드 · config.js에 키를 넣으면 저장돼요';
el.mode.classList.toggle('local', !hasSupabase);

// 로컬 모드용 저장소 (새로고침하면 사라집니다)
const local = { models: [], comments: {} };
let current = null;        // { id, name, kind, url, file? }
let comments = [];         // 현재 모델의 코멘트
let pinMode = false;       // 위치 찍기 모드
let pendingPin = null;     // { x, y, z } 아직 저장 안 된 핀
const markers = [];        // 화면에 올라간 마커 스프라이트
let markerScale = 1;

// ────────────────────────────────────────────────────────────
// 마커 (Speckle처럼 번호 달린 점)
// ────────────────────────────────────────────────────────────
const spriteCache = new Map();
function markerTexture(label, color) {
  const key = `${label}|${color}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
  g.fillStyle = '#fff'; g.font = '700 56px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(label), 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  spriteCache.set(key, t);
  return t;
}
function makeMarker(label, pos, color = '#D65F1F') {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(label, color), depthTest: false, depthWrite: false, sizeAttenuation: false }));
  s.position.set(pos.x, pos.y, pos.z ?? 0);
  s.scale.set(0.075, 0.075, 1);
  s.renderOrder = 999;
  s.userData.commentIndex = label;
  return s;
}
const IS3D = (k) => ['ifc', 'glb', 'dae', '3dm'].includes(k);
function activeScene() { return IS3D(current?.kind) ? three.scene : current?.kind === 'dxf' ? dxf?.GetScene() : null; }
function clearMarkers() {
  const scene = activeScene();
  for (const m of markers) { scene?.remove(m); m.material.dispose(); }
  markers.length = 0;
}
function drawMarkers() {
  clearMarkers();
  if (current?.kind === 'dwg') { drawSvgMarkers(); return; }
  const scene = activeScene();
  if (!scene) return;
  comments.forEach((c, i) => {
    if (c.pos_x == null) return;
    const m = makeMarker(i + 1, { x: c.pos_x, y: c.pos_y, z: c.pos_z });
    scene.add(m); markers.push(m);
  });
  if (pendingPin) {
    const m = makeMarker('+', pendingPin, '#1F2C38');
    scene.add(m); markers.push(m);
  }
  if (current?.kind === 'dxf') dxf?.Render();
}
function setPending(pos) {
  pendingPin = pos;
  el.pinState.hidden = !pos;
  el.pinState.querySelector('span').textContent = pos ? (pos.element_name ? `객체 선택 · ${pos.element_name}` : `위치 찍힘 · ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}${pos.z != null ? ', ' + pos.z.toFixed(1) : ''}`) : '';
  if (!pos) highlightElement(null);
  drawMarkers();
  if (pos) el.body.focus();
}
function setPinMode(on) {
  pinMode = on;
  el.pinBtn.classList.toggle('on', on);
  el.pinHint.hidden = !on;
  el.viewer.style.cursor = on ? 'crosshair' : '';
}
el.pinBtn.addEventListener('click', () => setPinMode(!pinMode));
el.pinClear.addEventListener('click', () => setPending(null));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setPinMode(false); setPending(null); } });

// ────────────────────────────────────────────────────────────
// 3D (IFC) 뷰어
// ────────────────────────────────────────────────────────────
const three = { renderer: null, scene: null, camera: null, controls: null, group: null };
const ray = new THREE.Raycaster();
let downAt = null;

function ensureThree() {
  if (three.renderer) return;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xffffff, 1);
  el.viewer.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd6d2, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // 마커를 먼저 본다
    const hitM = ray.intersectObjects(markers, false)[0];
    if (hitM && typeof hitM.object.userData.commentIndex === 'number') { focusComment(hitM.object.userData.commentIndex - 1); return; }
    if (!pinMode || !three.group) return;
    const hit = ray.intersectObjects(three.group.children.filter((m) => m.visible), false)[0];
    if (hit) {
      const id = hit.object.userData.expressID;
      const info = describeElement(id);
      highlightElement(id);
      setPending({ x: hit.point.x, y: hit.point.y, z: hit.point.z, element_id: id ?? null, element_name: info });
      setPinMode(false);
    }
  });

  Object.assign(three, { renderer, scene, camera, controls });
  resizeThree();
  window.addEventListener('resize', resizeThree);
  const loop = () => { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
}
function resizeThree() {
  if (!three.renderer) return;
  const w = el.viewer.clientWidth, h = el.viewer.clientHeight;
  three.renderer.setSize(w, h, false);
  three.camera.aspect = w / h;
  three.camera.updateProjectionMatrix();
}
function clearThree() {
  if (!three.group) return;
  three.scene.remove(three.group);
  three.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  three.group = null;
}
function fitThree(target) {
  if (!three.group) return;
  const box = new THREE.Box3().setFromObject(three.group);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = target ? new THREE.Vector3(target.x, target.y, target.z) : box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * (target ? 0.15 : 0.6) || 10;
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(three.camera.fov / 2));
  three.camera.near = Math.max(dist / 200, 0.01);
  three.camera.far = dist * 200;
  three.camera.updateProjectionMatrix();
  three.camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(dist));
  three.controls.target.copy(center);
  three.controls.update();
}

let ifcApi = null;
let ifcModelID = null;
const highlightMat = new THREE.MeshLambertMaterial({ color: 0xD65F1F, emissive: 0x7a2e08, side: THREE.DoubleSide });
let highlighted = [];
function highlightElement(id) {
  for (const h of highlighted) h.mesh.material = h.mat;
  highlighted = [];
  if (id == null || !three.group) return;
  for (const m of three.group.children) if (m.userData.expressID === id) { highlighted.push({ mesh: m, mat: m.material }); m.material = highlightMat; }
}
function describeElement(id) {
  if (id == null) return null;
  if (current?.kind !== 'ifc') { const m = three.group?.children.find((x) => x.userData.expressID === id); return m?.userData.label || null; }
  if (!ifcApi || ifcModelID == null) return null;
  try {
    const line = ifcApi.GetLine(ifcModelID, id);
    const type = ifcApi.GetNameFromTypeCode(line.type).replace(/^IFC/, '');
    const name = line.Name?.value || line.ObjectType?.value || '';
    const si = storeyOf.get(id);
    const floor = si != null ? `${storeyNames[si]} · ` : '';
    return floor + (name ? `${type} · ${name}` : type);
  } catch { return null; }
}
async function ensureIfc() {
  if (ifcApi) return ifcApi;
  ifcApi = new WebIFC.IfcAPI();
  ifcApi.SetWasmPath('/');
  await ifcApi.Init();
  return ifcApi;
}
async function loadIfc(arrayBuffer) {
  ensureThree();
  clearThree();
  hideDxf(); hideSvg();
  three.renderer.domElement.style.display = 'block';
  resetTools();
  const api = await ensureIfc();
  if (ifcModelID != null) { try { api.CloseModel(ifcModelID); } catch {} }
  const modelID = api.OpenModel(new Uint8Array(arrayBuffer), { COORDINATE_TO_ORIGIN: true });
  ifcModelID = modelID;
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
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        pos[v * 3] = verts[v * 6]; pos[v * 3 + 1] = verts[v * 6 + 1]; pos[v * 3 + 2] = verts[v * 6 + 2];
        nor[v * 3] = verts[v * 6 + 3]; nor[v * 3 + 1] = verts[v * 6 + 4]; nor[v * 3 + 2] = verts[v * 6 + 5];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
      const c = pg.color;
      const key = `${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)},${c.w.toFixed(2)}`;
      let mat = materials.get(key);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(c.x, c.y, c.z), transparent: c.w < 1, opacity: c.w, side: THREE.DoubleSide });
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
  three.group = group;
  three.scene.add(group);
  buildStoreyMap(api, modelID, group);
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  markerScale = Math.max(size.x, size.y, size.z) / 40 || 1;
  resizeThree();
  fitThree();
}


// ────────────────────────────────────────────────────────────
// GLB · DAE · 3DM — three.js 로더로 엽니다 (스케치업은 glb/dae로 내보내서)
// ────────────────────────────────────────────────────────────
async function loadGeneric3D(kind, url, name) {
  ensureThree();
  clearThree();
  hideDxf(); hideSvg();
  three.renderer.domElement.style.display = 'block';
  resetTools();
  let root;
  if (kind === 'glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    root = gltf.scene;
  } else if (kind === 'dae') {
    const dae = await new ColladaLoader().loadAsync(url);
    root = dae.scene;
  } else {
    const loader = new Rhino3dmLoader();
    loader.setLibraryPath('/');            // public/rhino3dm.js, rhino3dm.wasm
    root = await loader.loadAsync(url);
  }
  // 씬을 평평하게: 메시마다 하나의 "객체"
  root.updateMatrixWorld(true);
  const group = new THREE.Group();
  let idx = 1;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.clone(false);
    m.geometry = o.geometry;
    m.material = Array.isArray(o.material) ? o.material.map((mm) => mm.clone()) : o.material.clone();
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) { mm.side = THREE.DoubleSide; if (mm.map === undefined) {} }
    m.matrix.copy(o.matrixWorld);
    m.matrixAutoUpdate = false;
    m.matrix.decompose(m.position, m.quaternion, m.scale);
    m.userData.expressID = idx++;
    m.userData.label = o.name || o.parent?.name || `객체 ${m.userData.expressID}`;
    m.userData.baseY = m.position.y;
    group.add(m);
  });
  if (kind === '3dm' && group.children.length === 0) throw new Error('메시가 없습니다. 3dm은 메시로 변환된 객체만 보여요.');
  three.group = group;
  three.scene.add(group);
  storeyOf = new Map(); storeyCount = 0; storeyNames = [];
  el.storeySel.innerHTML = '<option value="">전체</option>';
  const box = new THREE.Box3().setFromObject(group);
  bboxY = { min: box.min.y, max: box.max.y };
  const size = box.getSize(new THREE.Vector3());
  markerScale = Math.max(size.x, size.y, size.z) / 40 || 1;
  resizeThree();
  fitThree();
}

// ────────────────────────────────────────────────────────────
// 2D (DXF) 뷰어
// ────────────────────────────────────────────────────────────
let dxf = null, dxfHost = null, dxfDown = null;
async function loadDxf(blobUrl) {
  if (three.renderer) three.renderer.domElement.style.display = 'none';
  hideSvg();
  if (!dxfHost) {
    dxfHost = document.createElement('div');
    Object.assign(dxfHost.style, { width: '100%', height: '100%' });
    el.viewer.appendChild(dxfHost);
  }
  dxfHost.style.display = 'block';
  if (dxf) { dxf.Destroy(); dxf = null; dxfHost.innerHTML = ''; }
  dxf = new DxfViewer(dxfHost, { autoResize: true, clearColor: new THREE.Color(0xffffff), colorCorrection: true });
  window.__dxf = dxf;
  dxf.Subscribe('message', (e) => console.warn('dxf:', e.detail.level, e.detail.message));
  dxf.Subscribe('pointerdown', (e) => { dxfDown = { x: e.detail.domEvent.clientX, y: e.detail.domEvent.clientY }; });
  dxf.Subscribe('pointerup', (e) => {
    const d = e.detail.domEvent;
    if (!dxfDown || Math.hypot(d.clientX - dxfDown.x, d.clientY - dxfDown.y) > 4) return;
    const p = e.detail.position;
    // 마커 근처를 눌렀으면 그 코멘트로
    const near = markers.find((m) => typeof m.userData.commentIndex === 'number' && Math.hypot(m.position.x - p.x, m.position.y - p.y) < markerScale * 0.6);
    if (near) { focusComment(near.userData.commentIndex - 1); return; }
    if (!pinMode) return;
    setPending({ x: p.x, y: p.y, z: null });
    setPinMode(false);
  });
  await dxf.Load({ url: blobUrl, fonts: [] });
  fitDxf();
  const b = dxf.GetBounds();
  markerScale = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) / 40 : 1;
}
function hideDxf() { if (dxfHost) dxfHost.style.display = 'none'; }
function fitDxf() { const b = dxf?.GetBounds(); if (b) { dxf.FitView(b.minX, b.maxX, b.minY, b.maxY, 0.1); dxf.Render(); } }


// ────────────────────────────────────────────────────────────
// DWG 뷰어 — libredwg로 읽어서 SVG로 그립니다
// ────────────────────────────────────────────────────────────
let libredwg = null, svgHost = null, svgEl = null, svgView = null, svgDown = null;
async function ensureLibredwg() {
  if (libredwg) return libredwg;
  libredwg = await LibreDwg.create('');   // public/libredwg-web.wasm
  return libredwg;
}
async function loadDwg(arrayBuffer) {
  if (three.renderer) three.renderer.domElement.style.display = 'none';
  hideDxf();
  if (!svgHost) {
    svgHost = document.createElement('div');
    svgHost.className = 'svg-host';
    el.viewer.appendChild(svgHost);
    svgHost.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!svgView) return;
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const p = svgPoint(e.clientX, e.clientY);
      svgView.w *= k; svgView.h *= k;
      svgView.x = p.x - (p.x - svgView.x) * k;
      svgView.y = p.y - (p.y - svgView.y) * k;
      applySvgView();
    }, { passive: false });
    svgHost.addEventListener('pointerdown', (e) => { svgDown = { x: e.clientX, y: e.clientY, vx: svgView?.x, vy: svgView?.y, moved: false }; svgHost.setPointerCapture(e.pointerId); });
    svgHost.addEventListener('pointermove', (e) => {
      if (!svgDown || !svgView || !(e.buttons & 1)) return;
      const r = svgHost.getBoundingClientRect();
      const dx = (e.clientX - svgDown.x) * svgView.w / r.width, dy = (e.clientY - svgDown.y) * svgView.h / r.height;
      if (Math.hypot(e.clientX - svgDown.x, e.clientY - svgDown.y) > 4) svgDown.moved = true;
      svgView.x = svgDown.vx - dx; svgView.y = svgDown.vy - dy; applySvgView();
    });
    svgHost.addEventListener('pointerup', (e) => {
      const wasClick = svgDown && !svgDown.moved; svgDown = null;
      if (!wasClick) return;
      const pinEl = e.target.closest?.('.pin');
      if (pinEl && pinEl.dataset.i != null) { focusComment(Number(pinEl.dataset.i)); return; }
      if (!pinMode) return;
      const p = svgPoint(e.clientX, e.clientY);
      setPending({ x: p.x, y: p.y, z: null });
      setPinMode(false);
    });
  }
  svgHost.style.display = 'block';
  svgHost.innerHTML = '';
  const lib = await ensureLibredwg();
  const dwg = lib.dwg_read_data(arrayBuffer, Dwg_File_Type.DWG);
  const db = lib.convert(dwg);
  const svgText = lib.dwg_to_svg(db);
  lib.dwg_free(dwg);
  svgHost.innerHTML = svgText;
  svgEl = svgHost.querySelector('svg');
  if (!svgEl) throw new Error('svg 변환 실패');
  svgEl.removeAttribute('width'); svgEl.removeAttribute('height');
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgEl.style.width = '100%'; svgEl.style.height = '100%';
  // 캐드 색은 검은 바탕 기준이라 바탕을 어둡게 둡니다 (.svg-host)
  const pins = document.createElementNS('http://www.w3.org/2000/svg', 'g'); pins.setAttribute('class', 'pins'); svgEl.appendChild(pins);
  delete svgEl.dataset.box;
  fitSvg();
}
function hideSvg() { if (svgHost) svgHost.style.display = 'none'; }
function svgBox() {
  try {
    const b = svgEl.getBBox();
    if (b.width > 0 && b.height > 0) return { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch {}
  const vb = svgEl.getAttribute('viewBox');
  if (vb) { const [x, y, w, h] = vb.split(/[\s,]+/).map(Number); return { x, y, w, h }; }
  return { x: 0, y: 0, w: 100, h: 100 };
}
function fitSvg() {
  if (!svgEl) return;
  if (!svgEl.dataset.box) { const b = svgBox(); svgEl.dataset.box = JSON.stringify(b); }
  const b = JSON.parse(svgEl.dataset.box);
  const pad = 0.05;
  svgView = { x: b.x - b.w * pad, y: b.y - b.h * pad, w: b.w * (1 + 2 * pad), h: b.h * (1 + 2 * pad) };
  applySvgView();
}
function applySvgView() {
  svgEl.setAttribute('viewBox', `${svgView.x} ${svgView.y} ${svgView.w} ${svgView.h}`);
  drawSvgMarkers();
}
function svgPoint(cx, cy) {
  const pt = svgEl.createSVGPoint(); pt.x = cx; pt.y = cy;
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}
function focusSvg(x, y) {
  if (!svgEl || !svgView) return;
  const b = JSON.parse(svgEl.dataset.box);
  const w = b.w * 0.25, h = w * (svgView.h / svgView.w);
  svgView = { x: x - w / 2, y: y - h / 2, w, h };
  applySvgView();
}
function drawSvgMarkers() {
  if (!svgEl || !svgView) return;
  const g = svgEl.querySelector('g.pins'); if (!g) return;
  g.innerHTML = '';
  const r = svgView.w / 60;
  const mk = (label, x, y, color, i) => {
    const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grp.setAttribute('class', 'pin'); if (i != null) grp.dataset.i = i;
    grp.innerHTML = `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="#fff" stroke-width="${r * 0.15}"/><text x="${x}" y="${y}" font-size="${r * 1.1}" font-family="IBM Plex Mono, monospace" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central">${label}</text>`;
    g.appendChild(grp);
  };
  comments.forEach((c, i) => { if (c.pos_x != null) mk(i + 1, c.pos_x, c.pos_y, '#D65F1F', i); });
  if (pendingPin) mk('+', pendingPin.x, pendingPin.y, '#1F2C38', null);
}

// ────────────────────────────────────────────────────────────
// 3D 도구 — 선택만 보기 · 단면 · 분해
// ────────────────────────────────────────────────────────────
const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
let bboxY = { min: 0, max: 1 };
let storeyOf = new Map();   // expressID -> 층 번호 (0 = 맨 아래)
let storeyCount = 0;
let storeyNames = [];       // 층 번호 -> 이름
let hiddenIds = new Set();  // 사용자가 숨긴 객체
let isolated = false;

function buildStoreyMap(api, modelID, group) {
  storeyOf = new Map(); storeyCount = 0;
  try {
    const storeys = [];
    const ids = api.GetLineIDsWithType(modelID, WebIFC.IFCBUILDINGSTOREY);
    for (let i = 0; i < ids.size(); i++) {
      const s = api.GetLine(modelID, ids.get(i));
      storeys.push({ id: s.expressID, elev: Number(s.Elevation?.value ?? 0), name: s.Name?.value || s.LongName?.value || '' });
    }
    storeys.sort((a, b) => a.elev - b.elev);
    const index = new Map(storeys.map((s, i) => [s.id, i]));
    storeyCount = storeys.length;
    storeyNames = storeys.map((s, i) => s.name || `${i + 1}층`);
    const rels = api.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < rels.size(); i++) {
      const r = api.GetLine(modelID, rels.get(i));
      const si = index.get(r.RelatingStructure?.value);
      if (si == null) continue;
      for (const e of r.RelatedElements || []) storeyOf.set(e.value, si);
    }
  } catch (e) { console.warn('storey map failed', e); }
  for (const m of group.children) {
    m.userData.baseY = m.position.y;
    m.userData.storey = storeyOf.get(m.userData.expressID);
  }
  const box = new THREE.Box3().setFromObject(group);
  bboxY = { min: box.min.y, max: box.max.y };
  el.storeySel.innerHTML = '<option value="">전체 층</option>' + storeyNames.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
  window.__dbg = { storeyCount, mapped: storeyOf.size, meshes: group.children.length, withStorey: group.children.filter((m) => m.userData.storey != null).length };
}
function resetTools() {
  isolated = false; el.isolate.classList.remove('on');
  hiddenIds = new Set(); if (el.storeySel) el.storeySel.value = '';
  el.section.value = 1000; el.explode.value = 0;
  if (three.renderer) three.renderer.clippingPlanes = [];
}
function applySection() {
  if (!three.renderer) return;
  const t = Number(el.section.value) / 1000;
  if (t >= 1) { three.renderer.clippingPlanes = []; return; }
  const y = bboxY.min + (bboxY.max - bboxY.min) * t;
  sectionPlane.constant = y;   // 법선 (0,-1,0): y <= 높이 인 부분만 보입니다
  three.renderer.clippingPlanes = [sectionPlane];
}
function applyExplode() {
  if (!three.group) return;
  const t = Number(el.explode.value) / 100;
  const gap = (bboxY.max - bboxY.min) / Math.max(storeyCount, 1) * 0.8;
  for (const m of three.group.children) {
    const si = m.userData.storey;
    m.position.y = m.userData.baseY + (si == null ? 0 : si * gap * t);
    m.updateMatrix();
  }
}
function applyVisibility() {
  if (!three.group) return;
  const id = highlighted[0]?.mesh.userData.expressID;
  if (isolated && id == null) isolated = false;
  const floor = el.storeySel.value === '' ? null : Number(el.storeySel.value);
  for (const m of three.group.children) {
    const eid = m.userData.expressID;
    let v = true;
    if (isolated) v = eid === id;
    else {
      if (hiddenIds.has(eid)) v = false;
      if (floor != null && m.userData.storey !== floor) v = false;
    }
    m.visible = v;
  }
  el.isolate.classList.toggle('on', isolated);
  el.showAll.hidden = !(hiddenIds.size || floor != null || isolated);
}
const applyIsolate = applyVisibility;
el.section.addEventListener('input', applySection);
el.explode.addEventListener('input', applyExplode);
el.isolate.addEventListener('click', () => {
  if (!highlighted.length && !isolated) { el.commentStatus.textContent = '먼저 📍 객체 찍기로 객체를 하나 고르세요.'; return; }
  isolated = !isolated; applyVisibility();
});
el.hide.addEventListener('click', () => {
  const id = highlighted[0]?.mesh.userData.expressID;
  if (id == null) { el.commentStatus.textContent = '먼저 📍 객체 찍기로 숨길 객체를 고르세요.'; return; }
  hiddenIds.add(id); highlightElement(null); setPending(null); applyVisibility();
});
el.showAll.addEventListener('click', () => { hiddenIds = new Set(); isolated = false; el.storeySel.value = ''; applyVisibility(); });
el.storeySel.addEventListener('change', () => { isolated = false; applyVisibility(); });

// ────────────────────────────────────────────────────────────
// 모델 열기
// ────────────────────────────────────────────────────────────
function kindOf(name) {
  const ext = name.split('.').pop().toLowerCase();
  return ({ ifc: 'ifc', dxf: 'dxf', dwg: 'dwg', glb: 'glb', gltf: 'glb', dae: 'dae', '3dm': '3dm' })[ext] || null;
}
async function openModel(model) {
  clearMarkers();
  setPending(null); setPinMode(false);
  current = model;
  el.empty.hidden = true;
  el.loading.hidden = false;
  el.viewerBar.hidden = false;
  el.currentName.textContent = `${model.kind.toUpperCase()} · ${model.name}`;
  highlightModel(model.id);
  try {
    el.tools3d.hidden = !IS3D(model.kind);
    el.tools3d.classList.toggle('generic', model.kind !== 'ifc');
    if (model.kind === 'ifc') {
      const buf = model.file ? await model.file.arrayBuffer() : await (await fetch(model.url)).arrayBuffer();
      await loadIfc(buf);
    } else if (IS3D(model.kind)) {
      const url = model.file ? URL.createObjectURL(model.file) : model.url;
      await loadGeneric3D(model.kind, url, model.name);
    } else if (model.kind === 'dwg') {
      const buf = model.file ? await model.file.arrayBuffer() : await (await fetch(model.url)).arrayBuffer();
      await loadDwg(buf);
    } else {
      const url = model.file ? URL.createObjectURL(model.file) : model.url;
      await loadDxf(url);
    }
  } catch (e) {
    console.error(e);
    el.uploadStatus.textContent = '이 파일은 열 수 없어요. 형식을 확인해 주세요.';
    el.uploadStatus.classList.add('err');
  } finally {
    el.loading.hidden = true;
  }
  el.form.hidden = false;
  el.commentHint.textContent = `"${model.name}"에 남긴 코멘트. 번호를 누르면 그 자리로 가요.`;
  await renderComments();
}
el.fit.addEventListener('click', () => { if (IS3D(current?.kind)) fitThree(); else if (current?.kind === 'dwg') fitSvg(); else fitDxf(); });

function focusComment(i) {
  const c = comments[i];
  if (!c) return;
  el.comments.querySelectorAll('li').forEach((li, k) => li.classList.toggle('on', k === i));
  el.comments.querySelectorAll('li')[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (IS3D(current.kind)) highlightElement(c.element_id ?? null);
  if (c.pos_x == null) return;
  if (IS3D(current.kind)) fitThree({ x: c.pos_x, y: c.pos_y, z: c.pos_z });
  else if (current.kind === 'dwg') focusSvg(c.pos_x, c.pos_y);
  else if (dxf) { const b = dxf.GetBounds(); const w = b ? (b.maxX - b.minX) * 0.25 : 100; dxf.SetView({ x: c.pos_x, y: c.pos_y }, w); }
}

// ────────────────────────────────────────────────────────────
// 모델 목록 · 업로드
// ────────────────────────────────────────────────────────────
async function fetchModels() {
  if (!supabase) return local.models;
  const { data, error } = await supabase.from('models').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); el.uploadStatus.textContent = '목록을 못 불러왔어요. 키와 SQL 설정을 확인해 주세요.'; el.uploadStatus.classList.add('err'); return []; }
  return data.map((r) => ({ ...r, url: supabase.storage.from(BUCKET).getPublicUrl(r.path).data.publicUrl }));
}
function renderModels(models) {
  el.models.innerHTML = models.length ? '' : '<li class="hint">아직 올라온 모델이 없어요.</li>';
  for (const m of models) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.id = m.id;
    b.innerHTML = `<span class="name">${esc(m.name)}</span><span class="meta"><span class="kind">${m.kind.toUpperCase()}</span>${fmtDate(m.created_at)}</span>`;
    b.addEventListener('click', () => openModel(m));
    li.appendChild(b); el.models.appendChild(li);
  }
  if (current) highlightModel(current.id);
}
function highlightModel(id) { el.models.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === String(id))); }
async function refreshModels() { renderModels(await fetchModels()); }

// 샘플 파일: 서버에서 받아 와서 업로드와 같은 길로 보냅니다
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', async () => {
  const url = b.dataset.sample;
  el.uploadStatus.textContent = '샘플을 가져오는 중…';
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], url.split('/').pop(), { type: blob.type });
  await handleFile(file);
}));

// 드래그해서 올리기 (화면 어디에나)
['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === document.body) document.body.classList.remove('dragging'); }));
document.addEventListener('drop', async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) await handleFile(file);
});

el.file.addEventListener('change', async () => {
  const file = el.file.files[0];
  if (!file) return;
  await handleFile(file);
});

async function handleFile(file) {
  const kind = kindOf(file.name);
  el.uploadStatus.classList.remove('err');
  if (!kind) { el.uploadStatus.textContent = 'IFC, DWG, DXF, GLB, DAE, 3DM 파일만 올릴 수 있어요. 스케치업(.skp)은 glb나 dae로 내보내서 올려 주세요.'; el.uploadStatus.classList.add('err'); return; }
  const owner = '';
  if (!supabase) {
    const m = { id: `local-${Date.now()}`, name: file.name, kind, owner, created_at: new Date().toISOString(), file };
    local.models.unshift(m); renderModels(local.models);
    el.uploadStatus.textContent = '로컬 모드: 내 브라우저에서만 열려요.';
    await openModel(m); return;
  }
  el.uploadStatus.textContent = '올리는 중…';
  const path = `${Date.now()}_${file.name.replace(/[^\w.\-가-힣]/g, '_')}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (up.error) { el.uploadStatus.textContent = `올리기 실패: ${up.error.message}`; el.uploadStatus.classList.add('err'); return; }
  const ins = await supabase.from('models').insert({ name: file.name, path, kind, owner }).select().single();
  if (ins.error) { el.uploadStatus.textContent = `기록 실패: ${ins.error.message}`; el.uploadStatus.classList.add('err'); return; }
  el.uploadStatus.textContent = '올렸어요.';
  el.file.value = '';
  await refreshModels();
  await openModel({ ...ins.data, url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
}

// ────────────────────────────────────────────────────────────
// 코멘트
// ────────────────────────────────────────────────────────────
async function fetchComments(modelId) {
  if (!supabase) return local.comments[modelId] || [];
  const { data, error } = await supabase.from('comments').select('*').eq('model_id', modelId).order('created_at', { ascending: true });
  if (error) { console.error(error); return []; }
  return data;
}
async function renderComments() {
  if (!current) return;
  comments = await fetchComments(current.id);
  el.comments.innerHTML = comments.length ? '' : '<li class="hint">첫 코멘트를 남겨 보세요. 📍 객체 찍기를 누르고 모델의 객체를 클릭하면 그 객체에 달려요.</li>';
  comments.forEach((c, i) => {
    const li = document.createElement('li');
    const pin = c.pos_x != null ? `<button type="button" class="pin-no" data-i="${i}">${i + 1}</button>` : `<span class="pin-no none">–</span>`;
    const where = c.element_name ? `<span class="where">${esc(c.element_name)}</span>` : '';
    li.innerHTML = `${pin}<div><div class="who">${esc(c.author || '이름 없음')} · ${fmtDate(c.created_at)}</div>${where}<p class="text">${esc(c.body)}</p></div>`;
    li.querySelector('.pin-no[data-i]')?.addEventListener('click', () => focusComment(i));
    el.comments.appendChild(li);
  });
  el.comments.scrollTop = el.comments.scrollHeight;
  drawMarkers();
}
el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current) return;
  const author = el.author.value.trim(), body = el.body.value.trim();
  if (!body) return;
  el.commentStatus.classList.remove('err');
  const row = { author, body, pos_x: pendingPin?.x ?? null, pos_y: pendingPin?.y ?? null, pos_z: pendingPin?.z ?? null, element_id: pendingPin?.element_id ?? null, element_name: pendingPin?.element_name ?? null };
  if (!supabase) {
    (local.comments[current.id] ||= []).push({ ...row, created_at: new Date().toISOString() });
    el.body.value = ''; setPending(null);
    el.commentStatus.textContent = '로컬 모드: 새로고침하면 사라져요.';
    await renderComments(); return;
  }
  const btn = el.form.querySelector('button[type=submit]'); btn.disabled = true;
  const { error } = await supabase.from('comments').insert({ model_id: current.id, ...row });
  btn.disabled = false;
  if (error) { el.commentStatus.textContent = `저장 실패: ${error.message}`; el.commentStatus.classList.add('err'); return; }
  el.body.value = ''; setPending(null);
  el.commentStatus.textContent = '남겼어요. 수파베이스 표에서도 확인해 보세요.';
  await renderComments();
});
if (supabase) {
  supabase.channel('comments').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, (payload) => {
    if (current && payload.new.model_id === current.id) renderComments();
  }).subscribe();
}

// ────────────────────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

refreshModels();
