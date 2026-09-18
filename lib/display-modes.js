import * as THREE from 'three';

// Architecture - Rendered / Sketch. Values from the Rhino INIs on disk.
export const PRESET = {
  rendered: {
    gradTop: [200, 200, 200],
    gradBot: [140, 140, 140],
    hemi: 1,
    sun: 1.15,
    ambient: 0,
    shadowIntensity: 1,
    ground: false,
    edge: 0x000000,
    edgeWidth: 1,
    paper: false,
  },
  sketch: {
    bg: [255, 255, 255],
    hemi: 0.25,
    sun: 0.7,
    ambient: 112 / 255,
    shadowIntensity: 0.61,
    ground: true,
    edge: 0x2b2b2b,
    edgeWidth: 2,
    paper: true,
  },
};

let assets;

function makeGrad(top, bot) {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0, `rgb(${top.join(',')})`);
  lg.addColorStop(1, `rgb(${bot.join(',')})`);
  g.fillStyle = lg;
  g.fillRect(0, 0, 2, 256);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function ensureAssets() {
  if (assets) return assets;
  const gradMap = makeGrad([200, 200, 200], [140, 140, 140]);
  const wrapGrad = makeGrad([236, 238, 242], [78, 82, 88]);

  const paper = new THREE.MeshLambertMaterial({ color: 0xf4f4f4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  paper.customProgramCacheKey = () => 'arch-hatch';
  // ShadingEffect=1: ParallelLineWidth=1, Separation=3, Rotation=70 — screen-space (Rhino sep is px, not world).
  paper.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float _ha = 1.2217304763968446;
       float _hu = gl_FragCoord.x * cos(_ha) + gl_FragCoord.y * sin(_ha);
       outgoingLight *= 0.78 + 0.22 * step(0.16, abs(fract(_hu / 3.0) - 0.5));
       #include <opaque_fragment>`,
    );
  };

  assets = {
    gradMap,
    wrapGrad,
    white: new THREE.Color(0xffffff),
    flat: new THREE.Color(0xb0b0b4),
    paper,
    paperGlass: new Map(),
    // ponytail: WebGL linewidth is 1 on ANGLE; Line2 if THThickness=2 must read as 2px
    edgeRendered: new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 }),
    edgeSketch: new THREE.LineBasicMaterial({ color: 0x2b2b2b, linewidth: 2 }),
  };
  return assets;
}

function sketchAlpha(mat) {
  if (!mat) return 1;
  const op = Number.isFinite(mat.opacity) ? mat.opacity : 1;
  const tr = Number.isFinite(mat.transmission) ? mat.transmission : 0;
  // ponytail: Lambert can't refract; PathTracing/physical if transmission must look real
  if (tr > 0) return Math.min(op, Math.max(0.12, 1 - tr));
  if (mat.transparent || op < 1) return op;
  return 1;
}

function paperFor(pack, alpha) {
  if (!(alpha < 1)) return pack.paper;
  const key = alpha.toFixed(3);
  let m = pack.paperGlass.get(key);
  if (m) return m;
  m = pack.paper.clone();
  m.color.setHex(0xfafafa);
  m.transparent = true;
  m.opacity = +key;
  m.depthWrite = false;
  pack.paperGlass.set(key, m);
  return m;
}

function sketchMat(base, pack) {
  if (Array.isArray(base)) return base.map((m) => paperFor(pack, sketchAlpha(m)));
  return paperFor(pack, sketchAlpha(base));
}

function skipRaycast() {}

function ensureEdges(mesh, mat) {
  let edge = mesh.userData.archEdges;
  if (!edge) {
    // ponytail: EdgesGeometry crease, not Rhino TechnicalMask hidden-line; Line2 if we need real TE thickness
    edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), mat);
    edge.raycast = skipRaycast;
    edge.renderOrder = 1;
    mesh.add(edge);
    mesh.userData.archEdges = edge;
  } else {
    edge.material = mat;
  }
  edge.visible = true;
  return edge;
}

export function sunDir(azDeg, altDeg) {
  const azN = Number(azDeg);
  const altN = Number(altDeg);
  const az = ((((Number.isFinite(azN) ? azN : 45) % 360) + 360) % 360) * Math.PI / 180;
  const alt = Math.min(85, Math.max(5, Number.isFinite(altN) ? altN : 50)) * Math.PI / 180;
  const c = Math.cos(alt);
  return { x: Math.sin(az) * c, y: Math.sin(alt), z: Math.cos(az) * c };
}

function fitShadowRig(engine) {
  if (!engine.sun) return;
  const dir = sunDir(engine.sunAz, engine.sunAlt);
  const vec = new THREE.Vector3(dir.x, dir.y, dir.z);
  if (!engine.group) {
    engine.sun.position.copy(vec.multiplyScalar(10));
    return;
  }
  const box = new THREE.Box3().setFromObject(engine.group);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z, 1) * 0.55;
  engine.sun.position.copy(center).addScaledVector(vec, r * 2.2);
  engine.sun.target.position.copy(center);
  engine.sun.target.updateMatrixWorld();
  const cam = engine.sun.shadow.camera;
  cam.left = cam.bottom = -r * 1.2;
  cam.right = cam.top = r * 1.2;
  cam.near = Math.max(r * 0.15, 0.1);
  cam.far = r * 5;
  cam.updateProjectionMatrix();
}

export function aimSun(engine) {
  fitShadowRig(engine);
}

export function ambientWrap(on, p) {
  // ponytail: hemi sky≈ground was invisible; SSAOPass if we need real crease AO
  if (on !== false) {
    return {
      hemi: p.paper ? 0.7 : 1.25,
      sky: 0xf4f6fa,
      ground: p.paper ? 0x6e6e6e : 0x2c3036,
      amb: p.ambient,
      ambI: p.paper ? 0.7 : 0,
      grad: !p.paper,
    };
  }
  return { hemi: 0, sky: 0xffffff, ground: 0xffffff, amb: 1, ambI: p.paper ? 0.9 : 0.58, grad: false };
}

function applyGround(engine, sketch) {
  if (!sketch || engine.shadowsOn === false) {
    if (engine.ground) engine.ground.visible = false;
    return;
  }
  const box = new THREE.Box3().setFromObject(engine.group);
  if (box.isEmpty()) return;
  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1) * 3;
  if (!engine.ground) {
    engine.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.61 }),
    );
    engine.ground.rotation.x = -Math.PI / 2;
    engine.ground.receiveShadow = true;
    engine.scene.add(engine.ground);
  }
  engine.ground.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  engine.ground.scale.set(span, span, 1);
  engine.ground.visible = true;
}

function applyMeshes(engine, sketch, pack) {
  const edgeMat = sketch ? pack.edgeSketch : pack.edgeRendered;
  engine.group.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData.baseMat && o.material !== engine.highlightMat) o.userData.baseMat = o.material;
    const mats = Array.isArray(o.userData.baseMat) ? o.userData.baseMat : [o.userData.baseMat];
    for (const m of mats) {
      if (!m) continue;
      m.polygonOffset = true;
      m.polygonOffsetFactor = 1;
      m.polygonOffsetUnits = 1;
    }
    o.material = sketch ? sketchMat(o.userData.baseMat, pack) : o.userData.baseMat;
    o.castShadow = true;
    o.receiveShadow = true;
    ensureEdges(o, edgeMat);
  });
}

export function applyDisplayMode(engine) {
  if (!engine.scene || !engine.renderer) return;
  const sketch = engine.displayMode === 'sketch';
  const p = sketch ? PRESET.sketch : PRESET.rendered;
  const pack = ensureAssets();

  const wrap = ambientWrap(engine.ambientOn !== false, p);
  const shadows = engine.shadowsOn !== false;
  engine.scene.background = wrap.grad ? pack.wrapGrad : (sketch ? pack.white : pack.flat);
  engine.renderer.setClearColor(sketch ? 0xffffff : (wrap.grad ? 0x7a7e84 : 0xb0b0b4), 1);
  engine.renderer.shadowMap.enabled = shadows;
  engine.renderer.shadowMap.needsUpdate = true;

  engine.hemi.color.setHex(wrap.sky);
  engine.hemi.groundColor.setHex(wrap.ground);
  engine.hemi.intensity = wrap.hemi;
  engine.sun.intensity = p.sun;
  engine.sun.castShadow = shadows;
  engine.ambient.color.setRGB(wrap.amb, wrap.amb, wrap.amb);
  engine.ambient.intensity = wrap.ambI;
  if (engine.sun.shadow) engine.sun.shadow.intensity = shadows ? p.shadowIntensity : 0;

  if (!engine.group) {
    if (engine.ground) engine.ground.visible = false;
    return;
  }
  applyMeshes(engine, sketch, pack);
  applyGround(engine, sketch);
  fitShadowRig(engine);
}

export function clearDisplayMode(engine) {
  if (engine.ground) engine.ground.visible = false;
}

if (typeof window === 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('lib/display-modes.js')) {
  console.assert(PRESET.rendered.ground === false && PRESET.rendered.ambient === 0);
  console.assert(PRESET.rendered.shadowIntensity === 1 && PRESET.rendered.edge === 0x000000);
  console.assert(PRESET.sketch.ground === true && PRESET.sketch.shadowIntensity === 0.61);
  console.assert(PRESET.sketch.edge === 0x2b2b2b && PRESET.sketch.bg[0] === 255);
  console.assert(PRESET.sketch.ambient === 112 / 255);
  console.assert(sketchAlpha({ opacity: 1 }) === 1);
  console.assert(sketchAlpha({ opacity: 0.25, transparent: true }) === 0.25);
  console.assert(sketchAlpha({ opacity: 1, transmission: 1 }) === 0.12);
  console.assert(sketchAlpha({ opacity: 0.4, transmission: 0.2 }) === 0.4);
  const on = ambientWrap(true, PRESET.rendered);
  const off = ambientWrap(false, PRESET.rendered);
  console.assert(on.hemi === 1.25 && on.grad === true && on.ground === 0x2c3036 && on.ambI === 0);
  console.assert(off.hemi === 0 && off.grad === false && off.ambI === 0.58 && off.ground === 0xffffff);
  const n = sunDir(0, 45);
  const e = sunDir(90, 45);
  console.assert(Math.abs(n.x) < 1e-9 && n.z > 0.6 && Math.abs(n.y - n.z) < 1e-9);
  console.assert(e.x > 0.6 && Math.abs(e.z) < 1e-9);
  console.assert(sunDir(0, 90).y > 0.99 && sunDir(0, 0).y > 0.08);
  console.log('display-modes ok');
}
