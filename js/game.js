"use strict";

const $ = id => document.getElementById(id);

if (typeof BABYLON === "undefined") {
  $("no-babylon").classList.remove("hidden");
  throw new Error("Babylon.js failed to load");
}

/* ---------------- 错误报告 ---------------- */
function reportError(title, msg) {
  let box = document.getElementById("error-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "error-box";
    box.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;max-width:85vw;padding:10px 18px;border-radius:8px;font:13px/1.6 monospace;white-space:pre-wrap;word-break:break-all;";
    document.body.appendChild(box);
  }
  box.style.background = "rgba(60,0,0,.94)";
  box.style.color = "#ffd7d7";
  box.style.border = "1px solid #ff5555";
  box.textContent = title + (msg ? "\n" + msg : "");
}
window.addEventListener("error", e => reportError("[JS Error]", e.message + (e.filename ? "  @" + e.filename + ":" + e.lineno : "")));
window.addEventListener("unhandledrejection", e => reportError("[Promise Error]", String((e.reason && e.reason.message) || e.reason)));

/* ---------------- 工具 ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distTo = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

/* ---------------- 音效 ---------------- */
const AudioFX = {
  ctx: null,
  init() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  beep(type, f0, f1, dur, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur);
  },
  shoot() { this.beep("square", 880, 160, 0.09, 0.05); },
  explosion() { this.beep("sawtooth", 180, 28, 0.5, 0.16); },
  hit() { this.beep("triangle", 140, 55, 0.25, 0.14); },
  pickup() { this.beep("sine", 420, 1500, 0.22, 0.09); }
};

/* ---------------- DOM ---------------- */
const canvas = $("game");
const ui = {
  hud: $("hud"), score: $("score"), level: $("level"),
  hull: $("hull"), hullText: $("hull-text"), high: $("high"),
  powers: $("powers"),
  crosshair: $("crosshair"), hint: $("hint"),
  menu: $("menu"), gameover: $("gameover"),
  finalScore: $("final-score"), finalHigh: $("final-high")
};

/* ---------------- 引擎 / 场景 ---------------- */
let engine;
try {
  engine = new BABYLON.Engine(canvas, true);
} catch (e) {
  reportError("[WebGL 初始化失败]", e.message + "\n请确认浏览器支持 WebGL（设置中开启硬件加速），或换用 Chrome / Edge");
  throw e;
}
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0, 0, 0.02, 1);
scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
scene.fogDensity = 0.0035;
scene.fogColor = new BABYLON.Color3(0, 0, 0.04);

const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.55;
hemi.diffuse = new BABYLON.Color3(0.75, 0.8, 1);
hemi.groundColor = new BABYLON.Color3(0.08, 0.08, 0.14);
const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.5, -0.7, 0.5), scene);
sun.intensity = 0.8;

const camera = new BABYLON.FreeCamera("cam", new BABYLON.Vector3(0, 6, -16), scene);
camera.minDistance = 0.1;
camera.maxDistance = 2000;

/* ---------------- 星空 ---------------- */
function makeStarTexture() {
  const size = 1024;
  const dt = new BABYLON.DynamicTexture("stars", { width: size, height: size }, scene, false);
  const ctx = dt.getContext();
  ctx.fillStyle = "#01020a";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 950; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() < 0.9 ? rand(0.4, 1.4) : rand(1.5, 2.6);
    const a = rand(0.25, 1);
    const tint = Math.random();
    const c = tint < 0.7 ? "255,255,255" : (tint < 0.85 ? "160,200,255" : "255,220,170");
    ctx.fillStyle = "rgba(" + c + "," + a.toFixed(2) + ")";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  dt.update();
  return dt;
}
const starMat = new BABYLON.StandardMaterial("starMat", scene);
starMat.emissiveTexture = makeStarTexture();
starMat.disableLighting = true;
starMat.fogEnabled = false;
starMat.sideOrientation = BABYLON.Mesh.BACKSIDE;
const starSphere = BABYLON.MeshBuilder.CreateSphere("stars", { diameter: 3000, segments: 24 }, scene);
starSphere.material = starMat;
starSphere.isPickable = false;

/* ---------------- 材质 ---------------- */
const shipHullMat = new BABYLON.StandardMaterial("shipHull", scene);
shipHullMat.diffuse = new BABYLON.Color3(0.6, 0.66, 0.8);
shipHullMat.specular = new BABYLON.Color3(0.5, 0.5, 0.6);

const shipDarkMat = new BABYLON.StandardMaterial("shipDark", scene);
shipDarkMat.diffuse = new BABYLON.Color3(0.16, 0.18, 0.24);
shipDarkMat.specular = new BABYLON.Color3(0.2, 0.2, 0.25);

const cockpitMat = new BABYLON.StandardMaterial("cockpit", scene);
cockpitMat.diffuse = new BABYLON.Color3(0.05, 0.25, 0.45);
cockpitMat.emissive = new BABYLON.Color3(0.08, 0.4, 0.8);
cockpitMat.specular = new BABYLON.Color3(0.9, 0.9, 1);

const tipMat = new BABYLON.StandardMaterial("tip", scene);
tipMat.diffuse = new BABYLON.Color3(0.4, 0.05, 0.05);
tipMat.emissive = new BABYLON.Color3(1, 0.18, 0.12);

const glowMat = new BABYLON.StandardMaterial("glow", scene);
glowMat.diffuse = new BABYLON.Color3(0.5, 0.2, 0.05);
glowMat.emissive = new BABYLON.Color3(1, 0.55, 0.15);

const bulletMat = new BABYLON.StandardMaterial("bullet", scene);
bulletMat.diffuse = new BABYLON.Color3(0.05, 0.3, 0.4);
bulletMat.emissive = new BABYLON.Color3(0.2, 0.95, 1);

const bulletHeavyMat = new BABYLON.StandardMaterial("bulletHeavy", scene);
bulletHeavyMat.diffuse = new BABYLON.Color3(0.35, 0.08, 0.4);
bulletHeavyMat.emissive = new BABYLON.Color3(0.95, 0.45, 1);

const rockMat = new BABYLON.StandardMaterial("rock", scene);
rockMat.diffuse = new BABYLON.Color3(0.52, 0.44, 0.36);
rockMat.specular = new BABYLON.Color3(0.08, 0.07, 0.06);

const droneBodyMat = new BABYLON.StandardMaterial("droneBody", scene);
droneBodyMat.diffuse = new BABYLON.Color3(0.28, 0.16, 0.16);
droneBodyMat.specular = new BABYLON.Color3(0.35, 0.25, 0.25);

const droneCoreMat = new BABYLON.StandardMaterial("droneCore", scene);
droneCoreMat.diffuse = new BABYLON.Color3(0.3, 0.05, 0.05);
droneCoreMat.emissive = new BABYLON.Color3(1, 0.15, 0.1);

const hlineSafeMat = new BABYLON.StandardMaterial("hlineSafe", scene);
hlineSafeMat.emissive = new BABYLON.Color3(0.2, 0.7, 0.9);
hlineSafeMat.diffuse = new BABYLON.Color3(0, 0.1, 0.15);
hlineSafeMat.disableLighting = true;
hlineSafeMat.alpha = 0.3;

const tickSafeMat = new BABYLON.StandardMaterial("tickSafe", scene);
tickSafeMat.emissive = new BABYLON.Color3(0.9, 0.95, 1);
tickSafeMat.diffuse = new BABYLON.Color3(0, 0, 0);
tickSafeMat.disableLighting = true;
tickSafeMat.alpha = 0.85;

const tickDangerMat = new BABYLON.StandardMaterial("tickDanger", scene);
tickDangerMat.emissive = new BABYLON.Color3(1, 0.35, 0.2);
tickDangerMat.diffuse = new BABYLON.Color3(0, 0, 0);
tickDangerMat.disableLighting = true;
tickDangerMat.alpha = 1;

const hlineDangerMat = new BABYLON.StandardMaterial("hlineDanger", scene);
hlineDangerMat.emissive = new BABYLON.Color3(1, 0.25, 0.15);
hlineDangerMat.diffuse = new BABYLON.Color3(0.2, 0.05, 0.03);
hlineDangerMat.disableLighting = true;
hlineDangerMat.alpha = 0.85;

const heightRingMat = new BABYLON.StandardMaterial("heightRing", scene);
heightRingMat.emissive = new BABYLON.Color3(0.2, 0.8, 1);
heightRingMat.diffuse = new BABYLON.Color3(0, 0, 0);
heightRingMat.disableLighting = true;
heightRingMat.alpha = 0.4;

function makePowerMat(name, c, alpha) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.emissive = c;
  m.diffuse = new BABYLON.Color3(0, 0, 0);
  m.disableLighting = true;
  m.alpha = alpha;
  return m;
}
const powerMatMulti = makePowerMat("pmMulti", new BABYLON.Color3(0.3, 0.9, 1), 1);
const powerHaloMulti = makePowerMat("phMulti", new BABYLON.Color3(0.3, 0.9, 1), 0.22);
const powerMatRepair = makePowerMat("pmRepair", new BABYLON.Color3(0.35, 1, 0.5), 1);
const powerHaloRepair = makePowerMat("phRepair", new BABYLON.Color3(0.35, 1, 0.5), 0.22);
const powerMatDouble = makePowerMat("pmDouble", new BABYLON.Color3(1, 0.8, 0.35), 1);
const powerHaloDouble = makePowerMat("phDouble", new BABYLON.Color3(1, 0.8, 0.35), 0.22);

/* ---------------- 飞船 ---------------- */
const glows = [];
let engineLight = null;
let probeF = null, probeR = null, probeU = null;

function shipBasis() {
  const p = shipRoot.position;
  return {
    fwd: probeF.getAbsolutePosition().subtract(p),
    right: probeR.getAbsolutePosition().subtract(p),
    up: probeU.getAbsolutePosition().subtract(p)
  };
}

function buildShip() {
  const root = new BABYLON.TransformNode("ship", scene);

  const body = BABYLON.MeshBuilder.CreateSphere("body", { diameter: 1.2, segments: 12 }, scene);
  body.scaling.set(0.8, 0.75, 2.2);
  body.material = shipHullMat;
  body.parent = root;

  const nose = BABYLON.MeshBuilder.CreateCylinder("nose", {
    diameterTop: 0.02, diameterBottom: 0.6, height: 1.0, tessellation: 12
  }, scene);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0, 1.35);
  nose.material = shipHullMat;
  nose.parent = root;

  const cockpit = BABYLON.MeshBuilder.CreateSphere("cockpit", { diameter: 0.55, segments: 10 }, scene);
  cockpit.scaling.set(1, 0.7, 1.5);
  cockpit.position.set(0, 0.38, 0.4);
  cockpit.material = cockpitMat;
  cockpit.parent = root;

  for (const s of [-1, 1]) {
    const wing = BABYLON.MeshBuilder.CreateBox("wing", { width: 1.7, height: 0.09, depth: 1.0 }, scene);
    wing.position.set(1.25 * s, -0.05, -0.45);
    wing.rotation.z = 0.14 * s;
    wing.material = shipHullMat;
    wing.parent = root;

    const tip = BABYLON.MeshBuilder.CreateSphere("tip", { diameter: 0.18, segments: 6 }, scene);
    tip.position.set(2.05 * s, -0.16, -0.6);
    tip.material = tipMat;
    tip.parent = root;

    const eng = BABYLON.MeshBuilder.CreateCylinder("eng", { diameter: 0.4, height: 0.5, tessellation: 10 }, scene);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(0.38 * s, -0.02, -1.2);
    eng.material = shipDarkMat;
    eng.parent = root;

    const glow = BABYLON.MeshBuilder.CreateSphere("glow", { diameter: 0.34, segments: 8 }, scene);
    glow.position.set(0.38 * s, -0.02, -1.52);
    glow.material = glowMat;
    glow.parent = root;
    glows.push(glow);
  }

  engineLight = new BABYLON.PointLight("engineLight", new BABYLON.Vector3(0, 0, -1.6), scene);
  engineLight.diffuse = new BABYLON.Color3(1, 0.6, 0.2);
  engineLight.intensity = 0.7;
  engineLight.range = 14;
  engineLight.parent = root;

  probeF = new BABYLON.TransformNode("probeF", scene);
  probeF.position.set(0, 0, 1);
  probeF.parent = root;
  probeR = new BABYLON.TransformNode("probeR", scene);
  probeR.position.set(1, 0, 0);
  probeR.parent = root;
  probeU = new BABYLON.TransformNode("probeU", scene);
  probeU.position.set(0, 1, 0);
  probeU.parent = root;

  const ring = BABYLON.MeshBuilder.CreateTorus("heightRing", {
    diameter: 11, thickness: 0.1, tessellation: 40
  }, scene);
  ring.material = heightRingMat;
  ring.isPickable = false;
  ring.parent = root;

  return root;
}
const shipRoot = buildShip();

/* ---------------- 瞄准辅助 ---------------- */
const AIM_LEN = 40;
const aimBeamMat = new BABYLON.StandardMaterial("aimBeam", scene);
aimBeamMat.emissive = new BABYLON.Color3(0, 0.55, 0.7);
aimBeamMat.diffuse = new BABYLON.Color3(0, 0.2, 0.25);
aimBeamMat.disableLighting = true;
aimBeamMat.alpha = 0.35;

const aimCrossMat = new BABYLON.StandardMaterial("aimCross", scene);
aimCrossMat.emissive = new BABYLON.Color3(0, 0.8, 1);
aimCrossMat.disableLighting = true;
aimCrossMat.alpha = 0.85;

const aimNode = new BABYLON.TransformNode("aimNode", scene);
const aimBeam = BABYLON.MeshBuilder.CreateCylinder("aimBeam", {
  diameterTop: 0.05, diameterBottom: 0.05, height: AIM_LEN, tessellation: 6
}, scene);
aimBeam.rotation.x = Math.PI / 2;
aimBeam.position.z = 2 + AIM_LEN / 2;
aimBeam.material = aimBeamMat;
aimBeam.isPickable = false;
aimBeam.parent = aimNode;
const aimCrossA = BABYLON.MeshBuilder.CreateBox("aimCrossA", { width: 2.6, height: 0.16, depth: 0.06 }, scene);
aimCrossA.position.z = 2 + AIM_LEN;
aimCrossA.material = aimCrossMat;
aimCrossA.isPickable = false;
aimCrossA.parent = aimNode;
const aimCrossB = BABYLON.MeshBuilder.CreateBox("aimCrossB", { width: 0.16, height: 2.6, depth: 0.06 }, scene);
aimCrossB.position.z = 2 + AIM_LEN;
aimCrossB.material = aimCrossMat;
aimCrossB.isPickable = false;
aimCrossB.parent = aimNode;
aimNode.setEnabled(false);

function updateAim(fwd) {
  const sx = shipRoot.position.x, sy = shipRoot.position.y, sz = shipRoot.position.z;
  const fLen = Math.max(0.001, Math.sqrt(fwd.x * fwd.x + fwd.y * fwd.y + fwd.z * fwd.z));
  const fx = fwd.x / fLen, fy = fwd.y / fLen, fz = fwd.z / fLen;
  aimNode.position.copyFrom(shipRoot.position);
  aimNode.rotation.y = Math.atan2(fx, fz);
  aimNode.rotation.x = -Math.asin(clamp(fy, -1, 1));
  let locked = false;
  for (let i = 0; i < rocks.length && !locked; i++) {
    const p = rocks[i].mesh.position;
    const dx = p.x - sx, dy = p.y - sy, dz = p.z - sz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 90 && (dx * fx + dy * fy + dz * fz) / d > 0.99) locked = true;
  }
  for (let i = 0; i < drones.length && !locked; i++) {
    const p = drones[i].mesh.position;
    const dx = p.x - sx, dy = p.y - sy, dz = p.z - sz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 90 && (dx * fx + dy * fy + dz * fz) / d > 0.99) locked = true;
  }
  aimBeamMat.alpha = locked ? 0.8 : 0.35;
  aimCrossMat.emissive = locked
    ? new BABYLON.Color3(0.35, 1, 0.55)
    : new BABYLON.Color3(0, 0.8, 1);
}

/* ---------------- 敌人 ---------------- */
function recomputeNormals(mesh) {
  const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const idx = mesh.getIndices();
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const bx = pos[b] - pos[a], by = pos[b + 1] - pos[a + 1], bz = pos[b + 2] - pos[a + 2];
    const cx = pos[c] - pos[a], cy = pos[c + 1] - pos[a + 1], cz = pos[c + 2] - pos[a + 2];
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    if (n[i] * pos[i] + n[i + 1] * pos[i + 1] + n[i + 2] * pos[i + 2] < 0) {
      n[i] = -n[i]; n[i + 1] = -n[i + 1]; n[i + 2] = -n[i + 2];
    }
    const l = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, n);
}

function createRock() {
  const radius = rand(1.2, 3.2);
  const mesh = BABYLON.MeshBuilder.CreateSphere("rock", { diameter: radius * 2, segments: 7 }, scene);
  const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const n = rand(0.65, 1.35);
    pos[i] *= n;
    pos[i + 1] *= n;
    pos[i + 2] *= n;
  }
  mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
  recomputeNormals(mesh);
  mesh.material = rockMat;
  mesh.isPickable = false;
  const line = BABYLON.MeshBuilder.CreateCylinder("rockHLine", {
    diameterTop: 0.07, diameterBottom: 0.07, height: 24, tessellation: 4
  }, scene);
  line.material = hlineSafeMat;
  line.isPickable = false;
  const tick = makeHeightTick(line);
  const hp = radius < 2 ? 1 : radius < 2.7 ? 2 : 3;
  return {
    mesh,
    line,
    tick,
    radius: radius * 1.1,
    hp,
    vel: new BABYLON.Vector3(0, 0, 0),
    ang: new BABYLON.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2))
  };
}

function createDrone() {
  const root = new BABYLON.TransformNode("drone", scene);
  const body = BABYLON.MeshBuilder.CreateCylinder("droneBody", {
    diameterTop: 0.05, diameterBottom: 0.55, height: 1.0, tessellation: 8
  }, scene);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.35;
  body.material = droneBodyMat;
  body.parent = root;
  const core = BABYLON.MeshBuilder.CreateSphere("droneCore", { diameter: 0.5, segments: 8 }, scene);
  core.material = droneCoreMat;
  core.parent = root;
  const line = BABYLON.MeshBuilder.CreateCylinder("droneHLine", {
    diameterTop: 0.07, diameterBottom: 0.07, height: 24, tessellation: 4
  }, scene);
  line.material = hlineSafeMat;
  line.isPickable = false;
  const tick = makeHeightTick(line);
  return { mesh: root, line, tick, radius: 0.8, hp: 2, vel: new BABYLON.Vector3(0, 0, 0) };
}

function makeHeightTick(line) {
  const tick = BABYLON.MeshBuilder.CreateBox("heightTick", { width: 1.6, height: 0.14, depth: 0.14 }, scene);
  tick.material = tickSafeMat;
  tick.isPickable = false;
  tick.parent = line;
  tick.position.y = 11;
  return tick;
}

function updateHeightLine(e) {
  e.line.position.copyFrom(e.mesh.position);
  const dy = e.mesh.position.y - shipRoot.position.y;
  const near = Math.abs(dy) < 2.5;
  e.line.material = near ? hlineDangerMat : hlineSafeMat;
  if (Math.abs(dy) < 11.5) {
    e.tick.setEnabled(true);
    e.tick.position.y = clamp(-dy, -12, 12);
    e.tick.material = near ? tickDangerMat : tickSafeMat;
  } else {
    e.tick.setEnabled(false);
  }
}

/* ---------------- 爆炸粒子 ---------------- */
function makeGlowTexture() {
  const dt = new BABYLON.DynamicTexture("glowTex", 64, scene, false);
  const ctx = dt.getContext();
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dt.update();
  return dt;
}
const glowTex = makeGlowTexture();

function explode(position, size) {
  const ps = new BABYLON.ParticleSystem("boom", 300, scene);
  ps.particleTexture = glowTex;
  ps.emitter = position.clone();
  ps.minEmitBox = new BABYLON.Vector3(0, 0, 0);
  ps.maxEmitBox = new BABYLON.Vector3(0, 0, 0);
  ps.color1 = new BABYLON.Color4(1, 0.75, 0.3, 1);
  ps.color2 = new BABYLON.Color4(1, 0.35, 0.1, 1);
  ps.colorDead = new BABYLON.Color4(0.1, 0, 0, 0);
  ps.minSize = size * 0.3;
  ps.maxSize = size * 0.8;
  ps.minLifeTime = 0.35;
  ps.maxLifeTime = 0.8;
  ps.direction1 = new BABYLON.Vector3(-1, -0.8, -1);
  ps.direction2 = new BABYLON.Vector3(1, 1, 1);
  ps.minEmitPower = size * 4;
  ps.maxEmitPower = size * 12;
  ps.gravity = new BABYLON.Vector3(0, 0, 0);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
  ps.emitRate = 400;
  ps.targetStopDuration = 0.15;
  ps.start();
  setTimeout(() => ps.dispose(), 1200);
}

/* ---------------- 游戏状态 ---------------- */
let state = "menu";
let score = 0;
let hp = 100;
let highScore = 0;
try { highScore = parseInt(localStorage.getItem("spacestrike_high") || "0", 10) || 0; } catch (e) { highScore = 0; }
ui.high.textContent = highScore;

const vel = new BABYLON.Vector3(0, 0, 0);
let yaw = 0;
let pitch = 0;
let shootCooldown = 0;
let shootHeld = false;
let invuln = 0;
let shake = 0;
let spawnTimer = 1.4;
let menuTime = 0;
let multiLevel = 0;
let multiTime = 0;
let doubleTime = 0;

const bullets = [];
const rocks = [];
const drones = [];
const powerups = [];

const level = () => 1 + Math.floor(score / 150);

/* ---------------- 射击 ---------------- */
function spawnBullet(pos, dir, dmg) {
  const m = BABYLON.MeshBuilder.CreateSphere("bullet", { diameter: dmg >= 2 ? 0.5 : 0.32, segments: 5 }, scene);
  m.position.copyFrom(pos);
  m.material = dmg >= 2 ? bulletHeavyMat : bulletMat;
  m.isPickable = false;
  bullets.push({ mesh: m, vel: dir, life: 2.2, dmg });
}

function tryShoot(dt) {
  if (shootCooldown > 0) shootCooldown -= dt;
  if ((keys.has("Space") || shootHeld) && shootCooldown <= 0) {
    shootCooldown = 0.13;
    const bs = shipBasis();
    const dir = bs.fwd;
    const rgt = bs.right;
    const pattern = [
      { off: -1.1, dmg: 1 },
      { off: 1.1, dmg: 1 }
    ];
    if (multiLevel >= 1) pattern.push({ off: 0, dmg: 2 });
    if (multiLevel >= 2) pattern.push({ off: -0.55, dmg: 1 }, { off: 0.55, dmg: 1 });
    if (multiLevel >= 3) pattern.push({ off: -1.7, dmg: 1 }, { off: 1.7, dmg: 1 });
    for (const p of pattern) {
      spawnBullet(shipRoot.position.add(rgt.scale(p.off)).add(dir.scale(0.5)), dir.scale(95), p.dmg);
    }
    AudioFX.shoot();
  }
}

/* ---------------- 得分 / 伤害 ---------------- */
function addScore(n) { score += n * (doubleTime > 0 ? 2 : 1); }

function damageShip(n) {
  hp = Math.max(0, hp - n);
  invuln = 1.2;
  shake = 0.6;
  AudioFX.hit();
  if (hp <= 0) gameOver();
}

/* ---------------- 生成敌人 ---------------- */
function spawnEnemy() {
  const bs = shipBasis();
  const fwd = bs.fwd;
  const right = bs.right;
  const up = bs.up;
  const p = shipRoot.position
    .add(fwd.scale(rand(90, 170)))
    .add(right.scale(rand(-35, 35)))
    .add(up.scale(rand(-22, 22)));

  if (Math.random() < 0.25 && level() >= 2) {
    const d = createDrone();
    d.mesh.position.copyFrom(p);
    drones.push(d);
  } else {
    const r = createRock();
    r.mesh.position.copyFrom(p);
    const speed = rand(9, 16) + level() * 0.7;
    const target = shipRoot.position.add(fwd.scale(rand(-10, 20)));
    r.vel = target.subtract(p).normalize().scale(speed);
    rocks.push(r);
  }
}

/* ---------------- 道具 ---------------- */
const POWER_TYPES = {
  multi: { mat: powerMatMulti, halo: powerHaloMulti },
  repair: { mat: powerMatRepair, halo: powerHaloRepair },
  double: { mat: powerMatDouble, halo: powerHaloDouble }
};

function spawnPowerup(pos) {
  if (powerups.length >= 3) return;
  const r = Math.random();
  const type = r < 0.4 ? "multi" : (r < 0.75 ? "repair" : "double");
  const t = POWER_TYPES[type];
  const core = BABYLON.MeshBuilder.CreateSphere("power", { diameter: 0.9, segments: 10 }, scene);
  const shell = BABYLON.MeshBuilder.CreateSphere("powerShell", { diameter: 1.8, segments: 10 }, scene);
  shell.parent = core;
  core.material = t.mat;
  shell.material = t.halo;
  core.isPickable = false;
  shell.isPickable = false;
  core.position.copyFrom(pos);
  const to = shipRoot.position.subtract(pos);
  const vel = to.length() > 0.001 ? to.scale(6 / to.length()) : new BABYLON.Vector3(0, 0, 0);
  powerups.push({ mesh: core, type, vel, life: 14 });
}

function applyPowerup(type, pos) {
  if (type === "multi") {
    multiLevel = Math.min(3, multiLevel + 1);
    multiTime = 12;
  } else if (type === "repair") {
    hp = Math.min(100, hp + 30);
  } else {
    doubleTime = 10;
  }
  explode(pos, 0.9);
  AudioFX.pickup();
}

function updatePowerHud() {
  let html = "";
  if (multiTime > 0) html += '<span class="power-badge multi">多弹 x' + multiLevel + " · " + Math.ceil(multiTime) + "s</span>";
  if (doubleTime > 0) html += '<span class="power-badge double">积分 x2 · ' + Math.ceil(doubleTime) + "s</span>";
  ui.powers.innerHTML = html;
}

/* ---------------- 结算 ---------------- */
function gameOver() {
  state = "gameover";
  explode(shipRoot.position, 4);
  AudioFX.explosion();
  shipRoot.setEnabled(false);
  aimNode.setEnabled(false);
  if (score > highScore) {
    highScore = score;
    try { localStorage.setItem("spacestrike_high", String(highScore)); } catch (e) { /* ignore */ }
  }
  ui.finalScore.textContent = score;
  ui.finalHigh.textContent = highScore;
  ui.high.textContent = highScore;
  ui.gameover.classList.remove("hidden");
  ui.hud.classList.add("hidden");
  ui.crosshair.classList.add("hidden");
  ui.hint.classList.add("hidden");
  if (document.pointerLockElement) document.exitPointerLock();
}

function startGame(ev) {
  if (ev && ev.currentTarget) ev.currentTarget.blur();
  for (const b of bullets) b.mesh.dispose();
  bullets.length = 0;
  for (const r of rocks) { r.mesh.dispose(); r.line.dispose(); }
  rocks.length = 0;
  for (const d of drones) { d.mesh.dispose(); d.line.dispose(); }
  drones.length = 0;
  for (const p of powerups) p.mesh.dispose();
  powerups.length = 0;
  multiLevel = 0;
  multiTime = 0;
  doubleTime = 0;

  score = 0;
  hp = 100;
  invuln = 1;
  shootCooldown = 0;
  shake = 0;
  spawnTimer = 1.4;
  yaw = 0;
  pitch = 0;
  vel.set(0, 0, 0);
  shipRoot.position.set(0, 0, 0);
  shipRoot.rotation.set(0, 0, 0);
  shipRoot.setEnabled(true);
  aimNode.setEnabled(true);

  state = "playing";
  ui.menu.classList.add("hidden");
  ui.gameover.classList.add("hidden");
  ui.hud.classList.remove("hidden");
  ui.crosshair.classList.add("hidden");
  ui.hint.classList.remove("hidden");
  ui.high.textContent = highScore;
  AudioFX.init();
  try { canvas.requestPointerLock(); } catch (e) { /* ignore */ }
}

function backToMenu() {
  for (const b of bullets) b.mesh.dispose();
  bullets.length = 0;
  for (const r of rocks) { r.mesh.dispose(); r.line.dispose(); }
  rocks.length = 0;
  for (const d of drones) { d.mesh.dispose(); d.line.dispose(); }
  drones.length = 0;
  for (const p of powerups) p.mesh.dispose();
  powerups.length = 0;
  multiLevel = 0;
  multiTime = 0;
  doubleTime = 0;

  score = 0;
  hp = 100;
  invuln = 0;
  shake = 0;
  menuTime = 0;
  yaw = 0;
  pitch = 0;
  vel.set(0, 0, 0);
  shipRoot.position.set(0, 0, 0);
  shipRoot.rotation.set(0, 0, 0);
  shipRoot.setEnabled(true);

  state = "menu";
  ui.menu.classList.remove("hidden");
  ui.hud.classList.add("hidden");
  ui.gameover.classList.add("hidden");
  ui.crosshair.classList.add("hidden");
  ui.hint.classList.add("hidden");
  aimNode.setEnabled(false);
  if (document.pointerLockElement) document.exitPointerLock();
}

/* ---------------- 主更新 ---------------- */
function updatePlaying(dt) {
  if (multiTime > 0) {
    multiTime -= dt;
    if (multiTime <= 0) multiLevel = 0;
  }
  if (doubleTime > 0) doubleTime = Math.max(0, doubleTime - dt);

  if (keys.has("ArrowLeft")) yaw += 1.6 * dt;
  if (keys.has("ArrowRight")) yaw -= 1.6 * dt;
  if (keys.has("ArrowUp")) pitch += 1.2 * dt;
  if (keys.has("ArrowDown")) pitch -= 1.2 * dt;
  pitch = clamp(pitch, -1.15, 1.15);

  const k = Math.min(1, dt * 10);
  shipRoot.rotation.y += (yaw - shipRoot.rotation.y) * k;
  shipRoot.rotation.x += (pitch - shipRoot.rotation.x) * k;

  const bs = shipBasis();
  const fwd = bs.fwd;
  const right = bs.right;
  const up = bs.up;

  const ACC = 70;
  const acc = new BABYLON.Vector3(0, 0, 0);
  if (keys.has("KeyA")) acc.addInPlace(right.scale(-ACC));
  if (keys.has("KeyD")) acc.addInPlace(right.scale(ACC));
  if (keys.has("KeyW")) acc.addInPlace(up.scale(ACC));
  if (keys.has("KeyS")) acc.addInPlace(up.scale(-ACC));

  vel.addInPlace(acc.scale(dt));
  vel.scaleInPlace(Math.exp(-2.8 * dt));
  const boost = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const speed = boost ? 58 : 30;
  shipRoot.position.addInPlace(fwd.scale(speed * dt));
  shipRoot.position.addInPlace(vel.scale(dt));

  const camPos = shipRoot.position.subtract(fwd.scale(12)).add(up.scale(6));
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 1.5);
    camPos.addInPlace(new BABYLON.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).scale(shake * 1.2));
  }
  const ck = Math.min(1, dt * 7);
  const cpos = camera.position;
  camera.position = new BABYLON.Vector3(
    cpos.x + (camPos.x - cpos.x) * ck,
    cpos.y + (camPos.y - cpos.y) * ck,
    cpos.z + (camPos.z - cpos.z) * ck
  );
  camera.setTarget(shipRoot.position.subtract(fwd.scale(3)).add(up.scale(4)));

  updateAim(fwd);
  tryShoot(dt);

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.mesh.position.addInPlace(b.vel.scale(dt));
    if (b.life <= 0 || distTo(b.mesh.position, shipRoot.position) > 320) {
      b.mesh.dispose();
      bullets.splice(i, 1);
    }
  }

  for (let i = rocks.length - 1; i >= 0; i--) {
    const r = rocks[i];
    r.mesh.position.addInPlace(r.vel.scale(dt));
    r.mesh.rotation.x += r.ang.x * dt;
    r.mesh.rotation.y += r.ang.y * dt;
    r.mesh.rotation.z += r.ang.z * dt;
    updateHeightLine(r);
    if (distTo(r.mesh.position, shipRoot.position) > 380) {
      r.mesh.dispose();
      r.line.dispose();
      rocks.splice(i, 1);
    }
  }

  for (let i = drones.length - 1; i >= 0; i--) {
    const d = drones[i];
    const to = shipRoot.position.subtract(d.mesh.position);
    const dist = Math.max(0.001, to.length());
    const dir = to.scale(1 / dist);
    d.vel.addInPlace(dir.scale(40 * dt));
    const maxV = 15 + level() * 0.7;
    const vLen = d.vel.length();
    if (vLen > maxV) d.vel.scaleInPlace(maxV / vLen);
    d.mesh.position.addInPlace(d.vel.scale(dt));
    d.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    d.mesh.rotation.x = -Math.asin(clamp(dir.y, -1, 1));
    updateHeightLine(d);
    if (dist > 380) {
      d.mesh.dispose();
      d.line.dispose();
      drones.splice(i, 1);
    }
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.life -= dt;
    p.mesh.position.addInPlace(p.vel.scale(dt));
    p.mesh.rotation.y += dt * 2;
    const ps = 1 + Math.sin(performance.now() / 1000 * 5 + i) * 0.15;
    p.mesh.scaling.set(ps, ps, ps);
    if (p.life <= 0 || distTo(p.mesh.position, shipRoot.position) > 380) {
      p.mesh.dispose();
      powerups.splice(i, 1);
    } else if (distTo(p.mesh.position, shipRoot.position) < 2.4) {
      applyPowerup(p.type, p.mesh.position);
      p.mesh.dispose();
      powerups.splice(i, 1);
    }
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    let hit = false;
    for (let j = rocks.length - 1; j >= 0 && !hit; j--) {
      if (distTo(b.mesh.position, rocks[j].mesh.position) < rocks[j].radius) {
        rocks[j].hp -= b.dmg;
        if (rocks[j].hp <= 0) {
          explode(rocks[j].mesh.position, Math.max(1.2, rocks[j].radius));
          addScore(10 + Math.round(rocks[j].radius * 4));
          if (Math.random() < 0.12) spawnPowerup(rocks[j].mesh.position);
          rocks[j].mesh.dispose();
          rocks[j].line.dispose();
          rocks.splice(j, 1);
          AudioFX.explosion();
        } else {
          AudioFX.hit();
        }
        hit = true;
      }
    }
    for (let j = drones.length - 1; j >= 0 && !hit; j--) {
      if (distTo(b.mesh.position, drones[j].mesh.position) < drones[j].radius) {
        drones[j].hp -= b.dmg;
        if (drones[j].hp <= 0) {
          explode(drones[j].mesh.position, 1.6);
          addScore(30);
          if (Math.random() < 0.18) spawnPowerup(drones[j].mesh.position);
          drones[j].mesh.dispose();
          drones[j].line.dispose();
          drones.splice(j, 1);
          AudioFX.explosion();
        } else {
          AudioFX.hit();
        }
        hit = true;
      }
    }
    for (let j = powerups.length - 1; j >= 0 && !hit; j--) {
      if (distTo(b.mesh.position, powerups[j].mesh.position) < 1.2) {
        applyPowerup(powerups[j].type, powerups[j].mesh.position);
        powerups[j].mesh.dispose();
        powerups.splice(j, 1);
        hit = true;
      }
    }
    if (hit) {
      b.mesh.dispose();
      bullets.splice(i, 1);
    }
  }

  if (invuln > 0) {
    invuln = Math.max(0, invuln - dt);
  } else {
    let crashed = false;
    for (const r of rocks) {
      if (distTo(r.mesh.position, shipRoot.position) < r.radius + 1.1) {
        crashed = true;
        break;
      }
    }
    if (!crashed) {
      for (const d of drones) {
        if (distTo(d.mesh.position, shipRoot.position) < d.radius + 1.1) {
          crashed = true;
          break;
        }
      }
    }
    if (crashed) {
      explode(shipRoot.position, 2);
      damageShip(25);
    }
  }

  const show = invuln <= 0 || Math.floor(invuln * 14) % 2 === 0;
  if (shipRoot.isEnabled() !== show) shipRoot.setEnabled(show);

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = Math.max(0.32, 1.15 - level() * 0.08) * rand(0.7, 1.3);
    spawnEnemy();
  }

  ui.score.textContent = score;
  ui.level.textContent = level();
  ui.hull.style.width = hp + "%";
  ui.hullText.textContent = hp;
  ui.hull.classList.toggle("low", hp <= 30);
  updatePowerHud();
}

function updateMenu(dt) {
  menuTime += dt;
  shipRoot.position.y = Math.sin(menuTime * 1.2) * 0.4;
  shipRoot.rotation.y = Math.sin(menuTime * 0.4) * 0.5;
  shipRoot.rotation.x = 0;
  const a = menuTime * 0.3;
  camera.position.set(Math.sin(a) * 14, 4 + Math.sin(menuTime * 0.5) * 1.5, Math.cos(a) * 14);
  camera.setTarget(new BABYLON.Vector3(0, 0.5, 0));
}

/* ---------------- 输入 ---------------- */
const keys = new Set();
window.addEventListener("keydown", e => {
  if (e.code === "Escape") {
    if (state === "gameover" || (state === "playing" && document.pointerLockElement !== canvas)) backToMenu();
    return;
  }
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  keys.add(e.code);
});
window.addEventListener("keyup", e => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  shootHeld = false;
});

canvas.addEventListener("click", () => {
  if (state !== "playing") return;
  if (document.pointerLockElement !== canvas) {
    try { canvas.requestPointerLock(); } catch (e) { /* ignore */ }
  }
});
document.addEventListener("mousemove", e => {
  if (document.pointerLockElement !== canvas || state !== "playing") return;
  yaw -= e.movementX * 0.0022;
  pitch = clamp(pitch - e.movementY * 0.0022, -1.15, 1.15);
});
document.addEventListener("mousedown", e => {
  if (e.button === 0 && state === "playing") shootHeld = true;
});
document.addEventListener("mouseup", e => {
  if (e.button === 0) shootHeld = false;
});
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  ui.hint.classList.toggle("hidden", !(state === "playing" && !locked));
  ui.crosshair.classList.toggle("hidden", !(state === "playing" && locked));
});
$("start").addEventListener("click", startGame);
$("restart").addEventListener("click", startGame);
$("tomenu").addEventListener("click", backToMenu);

/* ---------------- 渲染循环 ---------------- */
engine.runRenderLoop(() => {
  try {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    const t = performance.now() / 1000;

    const boosting = keys.has("ShiftLeft") || keys.has("ShiftRight");
    for (const g of glows) {
      const s = 0.8 + Math.sin(t * 25 + g.position.x) * 0.15 + (boosting ? 0.5 : 0);
      g.scaling.set(s, s, s * 1.4);
    }
    if (engineLight) engineLight.intensity = 0.55 + Math.sin(t * 30) * 0.12 + (boosting ? 0.4 : 0);

    starSphere.position.copyFrom(shipRoot.position);
    starSphere.rotation.y += dt * 0.002;

    if (state === "playing") updatePlaying(dt);
    else if (state === "menu") updateMenu(dt);

    scene.render();
  } catch (e) {
    reportError("[渲染帧错误]", e.message + "\n" + (e.stack ? e.stack.split("\n").slice(1, 3).join(" | ") : ""));
  }
});
window.addEventListener("resize", () => engine.resize());
