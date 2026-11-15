/* ============================================================================
 * SCP: MIRROR-9  /  第一人称收容行动 (Web / Three.js r160.1)
 * 中文 UI · 移动端横屏 · 虚拟摇杆 + 触摸视角 + 开火/手电 · 枪械 ViewModel
 * 程序化人形 SCP-173 · 剧情字幕 · 撤离结算 / 死亡结算
 * ==========================================================================*/
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/* ---------------------------------------------------------------- DOM refs */
const $ = (id) => document.getElementById(id);
const stage          = $('stage');
const hud            = $('hud');
const mainMenu       = $('main-menu');
const startBtn       = $('start-btn');
const startLabel     = $('start-label');
const loadStatus     = $('load-status');
const gameOver       = $('game-over');
const resultCode     = $('result-code');
const resultTitle    = $('result-title');
const deathDetail    = $('death-detail');
const restartBtn     = $('restart-btn');
const pauseOverlay   = $('pause-overlay');
const resumeBtn      = $('resume-btn');
const crosshair      = $('crosshair');
const observeBadge   = $('observe-badge');
const hudTime        = $('hud-time');
const hudDist        = $('hud-dist');
const hudBlink       = $('hud-blink');
const hudLight       = $('hud-light');
const hudAmmo        = $('hud-ammo');
const hudHint        = $('hud-hint');
const blinkEl        = $('blink');
const blinkMeter     = $('blink-meter-fill');
const muzzleEl       = $('muzzle-flash');
const toastEl        = $('toast');
const subtitleBar    = $('subtitle-bar');
const subtitleText   = $('subtitle-text');
const evacDist       = $('evac-dist');
const evacArrow      = $('evac-arrow');
const touchControls  = $('touch-controls');
const joystickZone   = $('joystick-zone');
const lookZone       = $('look-zone');
const btnFire        = $('btn-fire');
const btnLight       = $('btn-light');

$('lib-mode').textContent = '渲染引擎 THREE.JS r160.1 · ' +
  (window.M9_LIB_MODE === 'cdn' ? 'CDN 模块' : '本地模块');

/* -------------------------------------------------------------- parameters */
const QS = new URLSearchParams(location.search);
const SELFTEST    = QS.get('selftest') === '1';
const FORCE_TOUCH = QS.get('touch') === '1';
const FAST_WIN    = QS.get('fast') === '1' || QS.get('evac') === '1';
const EVAC_TEST   = QS.get('evac') === '1';
const USE_GLB     = QS.get('glb') === '1';
const PROBE       = QS.has('probe');   // 无头自检：达到条件后停止 rAF，避免空转

// 注意：桌面版 Chromium 也常返回 ('ontouchstart' in window) === true，
// 因此改用 UA + 真实触点数 + coarse pointer 判定，避免桌面误挂虚拟按键。
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Windows Phone/i.test(navigator.userAgent || '');
const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const isTouchDevice = FORCE_TOUCH || MOBILE_UA ||
  (COARSE && navigator.maxTouchPoints > 0);
document.body.classList.toggle('touch-device', isTouchDevice);

/* -------------------------------------------------------------- constants */
const EYE_HEIGHT       = 1.7;
const ROOM             = 44;
const WALL_H           = 5;
const VIEW_DISTANCE    = 60;
const KILL_DISTANCE    = 1.5;
const WALK_SPEED       = 6.4;
const ENTITY_MAX_SPEED = 11.0;
const EXTRACT_SECONDS  = FAST_WIN ? 3.0 : 60.0;
const EVAC_RADIUS      = 2.8;
const GRACE_SECONDS    = 3.0;
const CENTRE           = new THREE.Vector2(0, 0);
const UP               = new THREE.Vector3(0, 1, 0);
const SPAWN_PLAYER     = new THREE.Vector3(0, EYE_HEIGHT, 10);
const SPAWN_ENTITY     = new THREE.Vector3(8, 0, -14);
const EVAC_POS         = new THREE.Vector3(0, 0, -19.0);

let state = 'MENU';        // MENU | PLAYING | PAUSED | DEAD | EXTRACTED
let assetsReady = false;
let assetsTimedOut = false;
let loopStarted = false;
let survivalTime = 0;
let graceLeft = GRACE_SECONDS;
let isObserved = false;
let isBlinking = false;
let flashlightOn = true;
let yaw = 0, pitch = 0;
let recoil = 0;
let menuT = 0;

/* -------------------------------------------------------------- renderer  */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.FogExp2(0x05070a, 0.021);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 220);
camera.position.copy(SPAWN_PLAYER);
camera.rotation.order = 'YXZ';
scene.add(camera);

const clock = new THREE.Clock(false);
const raycaster = new THREE.Raycaster();
raycaster.far = VIEW_DISTANCE;

function applyLook() { camera.rotation.set(pitch, yaw, 0, 'YXZ'); }
applyLook();

/* ----------------------------------------------------------------- lights */
scene.add(new THREE.AmbientLight(0x404040, 1.25));
scene.add(new THREE.HemisphereLight(0x2a3446, 0x0a0a0c, 0.55));

// 战术手电筒：0xffffff / 2 / 50 / PI/6 / 0.5，挂载在相机上并投射阴影
const flashlight = new THREE.SpotLight(0xffffff, 2, 50, Math.PI / 6, 0.5, 1.0);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.camera.near = 0.4;
flashlight.shadow.camera.far = 50;
flashlight.shadow.bias = -0.0006;
flashlight.position.set(0, -0.06, 0);
camera.add(flashlight);
camera.add(flashlight.target);
flashlight.target.position.set(0, -0.02, -1);

const nearFill = new THREE.PointLight(0xa9c6ee, 0.5, 8, 1.4);
nearFill.position.set(0, -0.2, 0.2);
camera.add(nearFill);

/* ----------------------------------------------------------- asset loading */
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, done, total) => {
  loadStatus.textContent = '正在载入引擎 / 模型 / 音频  [' + done + '/' + total + ']';
};
manager.onError = (url) => { console.warn('[MIRROR-9] asset failed:', url); };
manager.onLoad = () => markAssetsReady();
setTimeout(() => { if (!assetsReady) { assetsTimedOut = true; markAssetsReady(); } }, 6000);

// Start 按钮从一开始就可用：任何资源超时都不会把玩家锁在菜单外。
startBtn.disabled = false;
startLabel.textContent = '开始收容行动';

function markAssetsReady() {
  if (assetsReady) return;
  assetsReady = true;
  startLabel.textContent = '开始收容行动';
  loadStatus.textContent = assetsTimedOut
    ? '资源就绪（部分可选资源超时 · 已启用降级）'
    : '资源已就绪 · ' + (window.M9_LIB_MODE === 'cdn' ? 'CDN' : '本地') + '模块';
}

const texLoader = new THREE.TextureLoader(manager);
const tex = {};
function loadTextures() {
  tex.color = texLoader.load('./assets/textures/concrete_color.jpg');
  tex.normal = texLoader.load('./assets/textures/concrete_normal.jpg');
  tex.rough = texLoader.load('./assets/textures/concrete_roughness.jpg');
  tex.color.colorSpace = THREE.SRGBColorSpace;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  [tex.color, tex.normal, tex.rough].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 6);
    t.anisotropy = Math.min(8, maxAniso);
  });
}
loadTextures();

function concreteMaterial(repX, repY, tint) {
  const c = tex.color.clone(); c.needsUpdate = true; c.repeat.set(repX, repY);
  const n = tex.normal.clone(); n.needsUpdate = true; n.repeat.set(repX, repY);
  const r = tex.rough.clone(); r.needsUpdate = true; r.repeat.set(repX, repY);
  return new THREE.MeshStandardMaterial({
    color: tint, map: c, normalMap: n, roughnessMap: r,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.9, metalness: 0.02,
  });
}

const floorMat  = concreteMaterial(9, 9, 0xa9a9a4);
const wallMat   = concreteMaterial(4, 2, 0x8d8d89);
const pillarMat = concreteMaterial(1, 3, 0x9b9b96);
const crateMat  = new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.78, metalness: 0.35 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.72, emissive: 0x2a2000, emissiveIntensity: 0.4 });

/* --------------------------------------------------------------- the cell  */
const occluders  = [];   // 遮挡视线 + 接收弹痕
const shootables = [];
const colliders  = [];   // {x,z,hx,hz} 简单圆柱碰撞

function addBox(w, h, d, x, y, z, mat, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = !!opts.cast;
  m.receiveShadow = true;
  scene.add(m);
  if (opts.occlude !== false) occluders.push(m);
  shootables.push(m);
  if (opts.collide !== false) colliders.push({ x, z, hx: w / 2, hz: d / 2 });
  return m;
}

function buildCell() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor); shootables.push(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), wallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_H;
  ceiling.receiveShadow = true;
  scene.add(ceiling); shootables.push(ceiling);

  const half = ROOM / 2;
  addBox(ROOM, WALL_H, 0.6, 0, WALL_H / 2, -half, wallMat);
  addBox(ROOM, WALL_H, 0.6, 0, WALL_H / 2,  half, wallMat);
  addBox(0.6, WALL_H, ROOM, -half, WALL_H / 2, 0, wallMat);
  addBox(0.6, WALL_H, ROOM,  half, WALL_H / 2, 0, wallMat);

  const px = [-14, -5, 6, 15];
  const pz = [-13, -2, 9];
  for (const x of px) for (const z of pz) {
    if (Math.abs(x) < 8 && Math.abs(z) < 4) continue;
    addBox(1.25, WALL_H, 1.25, x, WALL_H / 2, z, pillarMat, { cast: true });
  }

  const crates = [[-9, 0.7, 2, 2.2, 1.4, 2.2], [11, 0.7, -6, 2.6, 1.4, 2.6],
                  [-17, 0.5, -8, 1.8, 1.0, 1.8], [16, 0.5, 13, 2.0, 1.0, 2.0],
                  [2, 0.5, -18, 2.4, 1.0, 1.6]];
  for (const [x, y, z, w, h, d] of crates) {
    addBox(w, h, d, x, y, z, crateMat, { cast: true });
  }

  for (let i = -4; i <= 4; i++) {
    addBox(0.7, 0.02, 0.16, i * 1.05, 0.012, -11, stripeMat, { occlude: false, collide: false });
  }

  const lampPositions = [[-16, 4.4, -16], [16, 4.4, -16], [-16, 4.4, 16], [16, 4.4, 16], [0, 4.4, 0]];
  for (const [x, y, z] of lampPositions) {
    const l = new THREE.PointLight(0xff3a2a, 9, 20, 1.7);
    l.position.set(x, y, z); scene.add(l);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5a3c }));
    bulb.position.set(x, y, z); scene.add(bulb);
  }
  const centreLamp = new THREE.PointLight(0x9fb6d8, 6, 18, 1.8);
  centreLamp.position.set(0, 4.2, -6);
  scene.add(centreLamp);
}
buildCell();

/* ------------------------------------------------------- 撤离点（绿色光圈） */
const evacGroup = new THREE.Group();
evacGroup.position.copy(EVAC_POS);
scene.add(evacGroup);
let evacRing, evacBeam, evacGlow;

function buildEvacPad() {
  evacRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.75, 0.11, 12, 56),
    new THREE.MeshBasicMaterial({ color: 0x52ffb0, transparent: true, opacity: 0.95 })
  );
  evacRing.rotation.x = -Math.PI / 2;
  evacRing.position.y = 0.08;
  evacGroup.add(evacRing);

  evacGlow = new THREE.Mesh(
    new THREE.CircleGeometry(1.66, 48),
    new THREE.MeshBasicMaterial({ color: 0x1dff9c, transparent: true, opacity: 0.16,
                                  side: THREE.DoubleSide, depthWrite: false })
  );
  evacGlow.rotation.x = -Math.PI / 2;
  evacGlow.position.y = 0.03;
  evacGroup.add(evacGlow);

  evacBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.9, 4.2, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x38ffa6, transparent: true, opacity: 0.14,
                                  side: THREE.DoubleSide, depthWrite: false,
                                  blending: THREE.AdditiveBlending })
  );
  evacBeam.position.y = 2.1;
  evacGroup.add(evacBeam);

  const light = new THREE.PointLight(0x3dffa4, 5.5, 14, 1.6);
  light.position.y = 1.1;
  evacGroup.add(light);
}
buildEvacPad();

function animEvac(delta) {
  if (!evacRing) return;
  evacRing.rotation.z += delta * 0.85;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.003);
  evacBeam.material.opacity = 0.10 + pulse * 0.10;
  evacGlow.material.opacity = 0.12 + pulse * 0.12;
  evacGroup.position.y = Math.sin(performance.now() * 0.0016) * 0.02;
}

/* ------------------------------------------- SCP-173：程序化混凝土人形   */
/* 规格：BoxGeometry + CylinderGeometry，主材质 0x888888 / roughness 0.9，
   粗壮脖子与四肢、头部涂鸦、前倾姿态。不再依赖可能渲染成白板的外部 GLB。 */
let scp173 = null;
const entityVelocity = new THREE.Vector3();
const _prev  = new THREE.Vector3();
const _step  = new THREE.Vector3();
const _target = new THREE.Vector3();

function buildSCP173() {
  const g = new THREE.Group();
  g.name = 'SCP173_ConcreteHumanoid';
  const concrete = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9, metalness: 0.02 });
  const stain    = new THREE.MeshStandardMaterial({ color: 0x5a5751, roughness: 0.95 });
  const paint    = new THREE.MeshStandardMaterial({ color: 0x9c3a1e, roughness: 0.85 });
  const dark     = new THREE.MeshStandardMaterial({ color: 0x1b1917, roughness: 0.95 });

  const put = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true;
    m.name = 'SCP173_part';
    g.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, rx, ry, rz) =>
    put(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  const cyl = (rt, rb, h, mat, x, y, z, rx, ry, rz, seg = 20) =>
    put(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rx, ry, rz);

  // 底座 / 双脚
  cyl(0.98, 1.04, 0.16, concrete, 0, 0.08, 0, 0, 0, 0, 32);
  for (const s of [-1, 1]) {
    cyl(0.235, 0.275, 1.02, concrete, s * 0.32, 0.66, 0.02, 0, 0, s * 0.035, 18);
    box(0.40, 0.22, 0.72, concrete, s * 0.32, 0.17, 0.17);
    box(0.34, 0.12, 0.30, stain, s * 0.32, 0.12, 0.46);
  }
  // 骨盆 / 躯干 / 肩
  box(0.94, 0.44, 0.54, concrete, 0, 1.34, 0);
  box(1.06, 1.12, 0.64, concrete, 0, 1.98, 0.02, -0.07);
  box(1.34, 0.28, 0.70, concrete, 0, 2.48, 0.02, -0.07);
  box(0.58, 0.20, 0.10, stain, 0, 1.62, 0.34);
  // 粗壮的脖子（SCP-173 的标志）
  cyl(0.31, 0.35, 0.38, concrete, 0, 2.70, 0.02, 0.06, 0, 0, 24);
  cyl(0.335, 0.335, 0.08, stain, 0, 2.86, 0.02, 0.06, 0, 0, 24);
  // 头部（略前倾）
  box(0.66, 0.76, 0.60, concrete, 0, 3.18, 0.10, 0.13);
  box(0.46, 0.20, 0.08, stain, 0, 2.94, 0.41, 0.13);
  for (const s of [-1, 1]) {
    box(0.17, 0.11, 0.05, dark, s * 0.16, 3.27, 0.41, 0.13);
    box(0.10, 0.05, 0.05, paint, s * 0.16, 3.27, 0.435, 0.13);
    box(0.09, 0.26, 0.05, paint, s * 0.29, 3.08, 0.40, 0.13);
  }
  box(0.22, 0.09, 0.05, paint, 0.04, 3.48, 0.38, 0.13);
  // 手臂：上臂 / 肘 / 前臂 / 手掌 / 手指（前伸姿态）
  for (const s of [-1, 1]) {
    cyl(0.205, 0.185, 0.78, concrete, s * 0.79, 2.16, 0.06, 0.30, 0, s * 0.26, 18);
    cyl(0.19, 0.19, 0.14, stain, s * 0.90, 1.80, 0.20, 0.30, 0, s * 0.26, 18);
    cyl(0.165, 0.135, 0.70, concrete, s * 0.96, 1.52, 0.38, 0.72, 0, s * 0.10, 18);
    box(0.26, 0.15, 0.32, concrete, s * 0.96, 1.20, 0.62, 0.3);
    for (let f = 0; f < 4; f++) {
      cyl(0.030, 0.022, 0.24, concrete,
        s * 0.96 + (f - 1.5) * 0.062, 1.10, 0.80, 0.55, 0, 0, 8);
    }
    // 肩部混凝土块
    box(0.34, 0.30, 0.52, concrete, s * 0.70, 2.42, 0.04, 0, 0, s * 0.14);
  }
  // 躯干污渍 / 油漆手印
  box(0.20, 0.34, 0.04, stain, -0.30, 2.10, 0.35, -0.07);
  box(0.14, 0.20, 0.04, paint, 0.24, 1.84, 0.35, -0.07);
  box(0.10, 0.28, 0.04, stain, 0.40, 2.26, 0.34, -0.07);
  // 背部钢筋（细节）
  for (const [x0, y0, z0, x1, y1, z1] of [[-0.3, 1.5, -0.34, -0.48, 1.9, -0.52],
                                          [0.3, 1.3, -0.34, 0.52, 1.7, -0.52]]) {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const r = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.026, a.distanceTo(b), 10),
      new THREE.MeshStandardMaterial({ color: 0x31302d, roughness: 0.55, metalness: 0.62 })
    );
    r.position.copy(a).add(b).multiplyScalar(0.5);
    r.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    r.castShadow = true; r.name = 'SCP173_part'; g.add(r);
  }
  return g;
}

function installEntity(root) {
  scp173 = root;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
  });
  root.position.copy(SPAWN_ENTITY);
  root.name = 'SCP173';
  scene.add(root);
  shootables.push(root);
}

if (USE_GLB) {
  const gltfLoader = new GLTFLoader(manager);
  gltfLoader.load('./assets/models/SCP173.glb',
    (gltf) => installEntity(gltf.scene),
    undefined,
    (err) => { console.warn('[MIRROR-9] GLB 失败，回退程序化人形:', err); installEntity(buildSCP173()); });
} else {
  installEntity(buildSCP173());
}

/* ------------------------------------------------- 第一人称持枪 ViewModel */
const viewModel = new THREE.Group();
viewModel.name = 'M9_ViewModel';
const VM_BASE = new THREE.Vector3(0.36, -0.32, -0.66);
let vmFlash;

function buildViewModel() {
  const dark  = new THREE.MeshStandardMaterial({ color: 0x191b1e, roughness: 0.62, metalness: 0.52 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2e3339, roughness: 0.44, metalness: 0.78 });
  const grip  = new THREE.MeshStandardMaterial({ color: 0x0e1012, roughness: 0.95 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    viewModel.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, rx, ry, rz) =>
    add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  const cyl = (r, h, mat, x, y, z, rx) =>
    add(new THREE.CylinderGeometry(r, r, h, 14), mat, x, y, z, rx);

  // 机匣 / 上机匣 / 护木
  box(0.17, 0.14, 0.44, dark, 0, 0, 0);
  box(0.15, 0.045, 0.42, metal, 0, 0.085, -0.01);
  box(0.13, 0.10, 0.30, grip, 0, -0.025, -0.26);
  // 枪管 / 消焰器
  cyl(0.028, 0.44, metal, 0, 0.005, -0.46, Math.PI / 2);
  cyl(0.042, 0.10, dark, 0, 0.005, -0.68, Math.PI / 2);
  // 弹匣 / 握把 / 扳机护圈 / 枪托
  box(0.105, 0.22, 0.115, dark, 0, -0.18, 0.015, 0.18);
  box(0.09, 0.20, 0.10, grip, 0, -0.17, 0.19, -0.32);
  box(0.10, 0.035, 0.13, metal, 0, -0.10, 0.10);
  box(0.13, 0.13, 0.26, dark, 0, -0.015, 0.33);
  box(0.16, 0.055, 0.07, grip, 0, 0.02, 0.47);
  // 瞄具
  box(0.055, 0.055, 0.13, metal, 0, 0.14, -0.06);
  box(0.04, 0.04, 0.04, dark, 0, 0.14, -0.24);
  box(0.025, 0.05, 0.025, metal, 0, 0.14, -0.60);

  // 枪口闪光（3D）
  vmFlash = new THREE.Mesh(
    new THREE.ConeGeometry(0.075, 0.24, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.95,
                                  depthWrite: false, blending: THREE.AdditiveBlending })
  );
  vmFlash.rotation.x = -Math.PI / 2;
  vmFlash.position.set(0, 0.005, -0.80);
  vmFlash.visible = false;
  viewModel.add(vmFlash);
  viewModel.add(new THREE.PointLight(0xffcf8a, 0, 3));

  viewModel.position.copy(VM_BASE);
  viewModel.rotation.set(0.02, -0.09, -0.02);
  camera.add(viewModel);
}
buildViewModel();

function updateViewModel(delta) {
  recoil = Math.max(0, recoil - delta * 7.5);
  const moving = Math.min(1, moveVelocity.length() / WALK_SPEED);
  const bob = Math.sin(performance.now() * 0.011) * 0.008 * moving;
  viewModel.position.set(
    VM_BASE.x + Math.sin(performance.now() * 0.0055) * 0.004 * moving,
    VM_BASE.y + bob - recoil * 0.022,
    VM_BASE.z + recoil * 0.13
  );
  viewModel.rotation.set(0.02 + recoil * 0.20, -0.09, -0.02 + recoil * 0.05);
  vmFlash.visible = recoil > 0.55;
  if (vmFlash.visible) vmFlash.scale.setScalar(0.7 + recoil * 0.7);
}

/* ------------------------------------------------------------------ audio  */
function makeAudio(src, loop, volume) {
  const a = new Audio(src);
  a.loop = loop; a.volume = volume; a.preload = 'auto';
  a.load();
  return a;
}
const sounds = {
  scrape:   makeAudio('./assets/sounds/concrete_scrape.ogg', true, 0),
  alarm:    makeAudio('./assets/sounds/alarm.ogg', true, 0.10),
  neckSnap: makeAudio('./assets/sounds/neck_snap.ogg', false, 0.95),
  gunshot:  makeAudio('./assets/sounds/gunshot.ogg', false, 0.55),
};
function playOneShot(key, volume) {
  try {
    const base = sounds[key];
    const a = base.cloneNode();
    a.volume = volume !== undefined ? volume : base.volume;
    a.play().catch(() => {});
  } catch (_) { /* 音频可选 */ }
}
function startAmbience() {
  try { sounds.alarm.play().catch(() => {}); } catch (_) {}
  try { sounds.scrape.play().catch(() => {}); } catch (_) {}
}
function stopAmbience() {
  try { sounds.alarm.pause(); } catch (_) {}
  sounds.scrape.volume = 0;
}

/* --------------------------------------------------------------- controls  */
const controls = new PointerLockControls(camera, document.body);
const keys = { forward: false, backward: false, left: false, right: false };
const joy  = { x: 0, y: 0 };
const moveVelocity = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _fwd  = new THREE.Vector3();
const _rightV = new THREE.Vector3();

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = true; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = true; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'KeyF': toggleFlashlight(); break;
    case 'Space': if (state === 'PLAYING') fire(); break;
  }
});
document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = false; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = false; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
  }
});
document.addEventListener('mousemove', (e) => {
  if (state !== 'PLAYING' || isTouchDevice) return;
  yaw   -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.4, Math.min(1.4, pitch));
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

controls.addEventListener('unlock', () => {
  if (state === 'PLAYING' && !isTouchDevice && !SELFTEST) {
    state = 'PAUSED';
    pauseOverlay.classList.remove('hidden');
    stopAmbience();
  }
});
controls.addEventListener('lock', () => {
  if (state === 'PAUSED') {
    state = 'PLAYING';
    pauseOverlay.classList.add('hidden');
    clock.getDelta();
  }
});

/* ------------------------------------- 移动端：摇杆 / 视角 / 开火 / 手电  */
function initFallbackJoystick() {
  const knob = document.createElement('div');
  knob.id = 'fallback-knob';
  joystickZone.appendChild(knob);
  const R = 56;
  let active = null, cx = 0, cy = 0;

  function centre() {
    const r = joystickZone.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
  }
  function move(px, py) {
    let dx = px - cx, dy = py - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    joy.x = dx / R; joy.y = -dy / R;
  }
  function end() { active = null; joy.x = 0; joy.y = 0; knob.style.transform = ''; }

  joystickZone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    active = t.identifier; centre(); move(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  joystickZone.addEventListener('touchmove', (e) => {
    if (active === null) return;
    for (const t of e.changedTouches) if (t.identifier === active) move(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  joystickZone.addEventListener('touchend', end);
  joystickZone.addEventListener('touchcancel', end);
  joystickZone.addEventListener('mousedown', (e) => {
    active = 'mouse'; centre(); move(e.clientX, e.clientY); e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => { if (active === 'mouse') move(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (active === 'mouse') end(); });
}

function initTouchLook() {
  let lastX = 0, lastY = 0, active = null;
  lookZone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    active = t.identifier; lastX = t.clientX; lastY = t.clientY;
    e.preventDefault();
  }, { passive: false });
  lookZone.addEventListener('touchmove', (e) => {
    if (active === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== active) continue;
      const dx = t.clientX - lastX, dy = t.clientY - lastY;
      lastX = t.clientX; lastY = t.clientY;
      yaw   -= dx * 0.0042;
      pitch -= dy * 0.0042;
      pitch = Math.max(-1.4, Math.min(1.4, pitch));
    }
    e.preventDefault();
  }, { passive: false });
  const end = () => { active = null; };
  lookZone.addEventListener('touchend', end);
  lookZone.addEventListener('touchcancel', end);
  // 桌面强制 touch=1 时允许鼠标拖拽观察
  let dragging = false, mx = 0, my = 0;
  lookZone.addEventListener('mousedown', (e) => { dragging = true; mx = e.clientX; my = e.clientY; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - mx) * 0.0042;
    pitch = Math.max(-1.4, Math.min(1.4, pitch - (e.clientY - my) * 0.0042));
    mx = e.clientX; my = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
}

let fireTimer = null;
function beginFire(e) {
  if (e) e.preventDefault();
  if (state !== 'PLAYING') return;
  btnFire.classList.add('pressed');
  fire();
  clearInterval(fireTimer);
  fireTimer = setInterval(() => { if (state === 'PLAYING') fire(); }, 170);
}
function endFire() {
  btnFire.classList.remove('pressed');
  clearInterval(fireTimer); fireTimer = null;
}

function initTouchControls() {
  touchControls.classList.remove('hidden');
  hudHint.textContent = '[左摇杆] 移动 · [右半屏滑动] 观察 · [开火 / 手电筒] 操作';

  if (window.nipplejs) {
    try {
      const j = window.nipplejs.create({
        zone: joystickZone, mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'rgba(255,255,255,0.55)', size: 118, restOpacity: 0.75,
      });
      j.on('move', (_evt, data) => {
        if (!data || !data.vector) return;
        joy.x = data.vector.x;
        joy.y = data.vector.y;
      });
      j.on('end', () => { joy.x = 0; joy.y = 0; });
      window.__M9_JOYSTICK = j;
      console.info('[MIRROR-9] nipplejs joystick active');
    } catch (err) {
      console.warn('[MIRROR-9] nipplejs failed, built-in joystick:', err);
      initFallbackJoystick();
    }
  } else {
    console.warn('[MIRROR-9] nipplejs unavailable, built-in joystick active');
    initFallbackJoystick();
  }

  initTouchLook();
  btnFire.addEventListener('pointerdown', beginFire);
  btnFire.addEventListener('pointerup', endFire);
  btnFire.addEventListener('pointercancel', endFire);
  btnFire.addEventListener('pointerleave', endFire);
  btnFire.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  btnLight.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleFlashlight(); });
}
if (isTouchDevice) initTouchControls();

/* ------------------------------------------------------------ blink cycle  */
let blinkPeriod = 10, blinkClock = blinkPeriod, blinkLeft = 0, toastTimer = null;

function showToast(msg, dur = 1.4) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), dur * 1000);
}
function updateBlink(delta) {
  if (blinkLeft > 0) {
    blinkLeft -= delta;
    if (blinkLeft <= 0) { blinkLeft = 0; isBlinking = false; blinkEl.classList.remove('closed'); }
  } else {
    blinkClock -= delta;
    if (blinkClock <= 0) {
      // CI 探针使用确定性的高频眨眼，确保未观测追击分支可被快速验证
      blinkPeriod = SELFTEST ? 1.0 : (7 + Math.random() * 6);
      blinkClock = blinkPeriod; blinkLeft = SELFTEST ? 0.48 : 0.17;
      isBlinking = true; blinkEl.classList.add('closed');
      showToast('// 眨眼反射', 0.8);
    }
  }
  const ratio = Math.max(0, Math.min(1, 1 - blinkClock / blinkPeriod));
  blinkMeter.style.width = (ratio * 100).toFixed(1) + '%';
  hudBlink.textContent = isBlinking ? '已闭合' : (ratio > 0.82 ? '即将眨眼' : '稳定');
  hudBlink.style.color = (isBlinking || ratio > 0.82) ? '#e8a33d' : '';
}

/* -------------------------------------------------------- 剧情字幕系统    */
const subtitleQueue = [];
let subtitleTimer = 0;
function queueSubtitles() {
  subtitleQueue.length = 0;
  subtitleQueue.push(['警告：SCP-173 已突破收容。利用视线锁定它，并寻找出口。', 6.0]);
  subtitleQueue.push(['保持视线接触，它才不会移动。注意眨眼条。', 4.5]);
  subtitleQueue.push(['撤离点已标记：跟随绿色光柱，或撑过 60 秒。', 5.0]);
  subtitleTimer = 0;
  nextSubtitle();
}
function nextSubtitle() {
  if (!subtitleQueue.length) { subtitleBar.classList.add('hidden'); return; }
  const [text, dur] = subtitleQueue.shift();
  subtitleText.textContent = text;
  subtitleBar.classList.remove('hidden');
  subtitleBar.style.animation = 'none';
  void subtitleBar.offsetWidth;
  subtitleBar.style.animation = '';
  subtitleTimer = dur;
}
function updateSubtitles(delta) {
  if (subtitleBar.classList.contains('hidden')) return;
  subtitleTimer -= delta;
  if (subtitleTimer <= 0) nextSubtitle();
}
function hideSubtitles() {
  subtitleQueue.length = 0;
  subtitleBar.classList.add('hidden');
}

/* -------------------------------------------------------------- shooting   */
const decals = [];
const _up = new THREE.Vector3(0, 0, 1);
const _normal = new THREE.Vector3();

function spawnBulletHole(hit) {
  if (decals.length > 64) {
    const old = decals.shift();
    scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose();
  }
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.045 + Math.random() * 0.02, 10),
    new THREE.MeshBasicMaterial({ color: 0x080808, transparent: true, opacity: 0.92,
                                  side: THREE.DoubleSide, depthWrite: false })
  );
  if (hit.face) {
    _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    mesh.quaternion.setFromUnitVectors(_up, _normal);
    mesh.position.copy(hit.point).addScaledVector(_normal, 0.012);
  } else {
    mesh.position.copy(hit.point);
    mesh.quaternion.copy(camera.quaternion);
  }
  scene.add(mesh);
  decals.push({ mesh, life: 14 });
}

function fire() {
  if (state !== 'PLAYING') return;
  playOneShot('gunshot', 0.55);
  recoil = 1;
  muzzleEl.classList.remove('fire');
  void muzzleEl.offsetWidth;
  muzzleEl.classList.add('fire');
  crosshair.classList.add('fired');
  setTimeout(() => crosshair.classList.remove('fired'), 100);

  const flashLight = new THREE.PointLight(0xffd9a0, 3.2, 9, 1.5);
  flashLight.position.set(0.25, -0.18, -0.7);
  camera.add(flashLight);
  setTimeout(() => camera.remove(flashLight), 70);

  raycaster.setFromCamera(CENTRE, camera);
  const hits = raycaster.intersectObjects(shootables, true);
  if (hits.length) spawnBulletHole(hits[0]);
  if (window.__M9_SELFTEST) window.__M9_SELFTEST.shotsFired++;
}

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || state !== 'PLAYING') return;
  if (e.target && e.target.closest && e.target.closest(
      '#touch-controls, #main-menu, #game-over, #pause-overlay')) return;
  fire();
});

/* --------------------------------------------------------------- 手电筒    */
function toggleFlashlight() {
  flashlightOn = !flashlightOn;
  flashlight.visible = flashlightOn;
  nearFill.visible = flashlightOn;
  hudLight.textContent = flashlightOn ? '开启' : '关闭';
  btnLight.classList.toggle('off', !flashlightOn);
  showToast(flashlightOn ? '手电筒已开启' : '手电筒已关闭', 0.9);
}

/* ----------------------------------------------------------- state machine */
function clearDecals() {
  for (const d of decals) {
    scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose();
  }
  decals.length = 0;
}
function resetRun() {
  camera.position.copy(SPAWN_PLAYER);
  yaw = 0; pitch = 0; applyLook();
  moveVelocity.set(0, 0, 0);
  entityVelocity.set(0, 0, 0);
  if (scp173) {
    scp173.position.copy(SPAWN_ENTITY);
    scp173.lookAt(camera.position.x, 0, camera.position.z);
  }
  survivalTime = 0;
  graceLeft = GRACE_SECONDS;
  blinkPeriod = 10; blinkClock = blinkPeriod; blinkLeft = 0;
  isBlinking = false; isObserved = false;
  blinkEl.classList.remove('closed');
  clearDecals();
  recoil = 0;
  joy.x = 0; joy.y = 0;
  flashlightOn = true;
  flashlight.visible = true; nearFill.visible = true;
  hudLight.textContent = '开启';
  btnLight.classList.remove('off');
  gameOver.classList.remove('active', 'win');
  pauseOverlay.classList.add('hidden');
}

function startGame() {
  if (state === 'PLAYING') return;
  mainMenu.style.display = 'none';
  hud.classList.remove('hidden');
  if (isTouchDevice) touchControls.classList.remove('hidden');
  resetRun();
  state = 'PLAYING';
  startAmbience();
  queueSubtitles();
  showToast('// 收容突破 · 保持视线接触', 2.0);
  if (!isTouchDevice && !SELFTEST) {
    try { controls.lock(); } catch (err) { console.warn('[MIRROR-9] pointer lock unavailable', err); }
  }
  if (!loopStarted) {
    loopStarted = true;
    clock.start();
    requestAnimationFrame(loop);
  }
}
startBtn.addEventListener('click', startGame);

resumeBtn.addEventListener('click', () => {
  if (state !== 'PAUSED') return;
  state = 'PLAYING';
  pauseOverlay.classList.add('hidden');
  clock.getDelta();
  startAmbience();
  try { controls.lock(); } catch (_) {}
});

restartBtn.addEventListener('click', () => {
  resetRun();
  state = 'PLAYING';
  startAmbience();
  queueSubtitles();
  if (!isTouchDevice && !SELFTEST) { try { controls.lock(); } catch (_) {} }
});

function PlayerDeath() {
  if (state === 'DEAD' || state === 'EXTRACTED') return;
  state = 'DEAD';
  playOneShot('neckSnap', 0.95);
  stopAmbience();
  endFire();
  hideSubtitles();
  resultCode.textContent = '// 终止事件 09 · 颈椎折断';
  resultTitle.textContent = '收容失效';
  deathDetail.textContent = 'SCP-173 已突破视线锁定范围 · 存活 ' + survivalTime.toFixed(1) + ' 秒';
  restartBtn.textContent = '重新开始行动';
  gameOver.classList.remove('win');
  gameOver.classList.add('active');
  if (controls.isLocked) controls.unlock();
}

function PlayerExtracted(reason) {
  if (state === 'DEAD' || state === 'EXTRACTED') return;
  state = 'EXTRACTED';
  stopAmbience();
  endFire();
  hideSubtitles();
  resultCode.textContent = '// 行动完成 · 撤离成功';
  resultTitle.textContent = '收容成功，你活下来了';
  deathDetail.textContent = reason + ' · 存活 ' + survivalTime.toFixed(1) + ' 秒';
  restartBtn.textContent = '再来一次';
  gameOver.classList.add('win', 'active');
  if (controls.isLocked) controls.unlock();
}

/* ---------------------------------------------------------- movement step  */
function updatePlayer(delta) {
  let ix = Number(keys.right) - Number(keys.left) + joy.x;
  let iz = Number(keys.forward) - Number(keys.backward) + joy.y;
  const len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; }

  // 由 yaw 解析出前 / 右向量，不依赖矩阵更新时机
  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _rightV.set(Math.cos(yaw), 0, -Math.sin(yaw));
  _wish.set(0, 0, 0).addScaledVector(_fwd, iz).addScaledVector(_rightV, ix)
       .multiplyScalar(WALK_SPEED);
  moveVelocity.lerp(_wish, Math.min(1, delta * 12));
  camera.position.addScaledVector(moveVelocity, delta);

  const lim = ROOM / 2 - 1.1;
  camera.position.x = Math.max(-lim, Math.min(lim, camera.position.x));
  camera.position.z = Math.max(-lim, Math.min(lim, camera.position.z));

  // 圆柱 vs AABB 推出，避免卡进柱子/箱子
  const r = 0.38;
  for (const c of colliders) {
    const nx = Math.max(c.x - c.hx, Math.min(camera.position.x, c.x + c.hx));
    const nz = Math.max(c.z - c.hz, Math.min(camera.position.z, c.z + c.hz));
    let dx = camera.position.x - nx, dz = camera.position.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      camera.position.x += dx / d * (r - d);
      camera.position.z += dz / d * (r - d);
    } else {
      const toL = camera.position.x - (c.x - c.hx), toR = (c.x + c.hx) - camera.position.x;
      const toB = camera.position.z - (c.z - c.hz), toT = (c.z + c.hz) - camera.position.z;
      const m = Math.min(toL, toR, toB, toT);
      if (m === toL) camera.position.x = c.x - c.hx - r;
      else if (m === toR) camera.position.x = c.x + c.hx + r;
      else if (m === toB) camera.position.z = c.z - c.hz - r;
      else camera.position.z = c.z + c.hz + r;
    }
  }
  camera.position.y = EYE_HEIGHT;
}

/* ---------------------------------------------- core observation mechanic  */
function updateEntity(delta) {
  if (!scp173) return;

  raycaster.setFromCamera(CENTRE, camera);
  const entityHits = raycaster.intersectObject(scp173, true);
  let seen = entityHits.length > 0 && entityHits[0].distance < VIEW_DISTANCE;

  if (seen) {
    const blockers = raycaster.intersectObjects(occluders, true);
    if (blockers.length && blockers[0].distance < entityHits[0].distance - 0.08) seen = false;
  }
  if (isBlinking) seen = false;
  if (graceLeft > 0) { graceLeft -= delta; seen = true; }
  if (Math.hypot(scp173.position.x - camera.position.x,
                 scp173.position.z - camera.position.z) < KILL_DISTANCE + 0.8) seen = false;

  if (EVAC_TEST) seen = true;              // 撤离流程探针：冻结实体
  isObserved = seen;
  if (window.__M9_SELFTEST) {
    const s = window.__M9_SELFTEST;
    if (seen) s.freezeFrames = (s.freezeFrames || 0) + 1;
    else s.chaseFrames = (s.chaseFrames || 0) + 1;
  }
  _prev.copy(scp173.position);

  if (seen) {
    entityVelocity.set(0, 0, 0);
    sounds.scrape.volume = Math.max(0, sounds.scrape.volume - delta * 1.5);
  } else {
    _target.set(camera.position.x, scp173.position.y, camera.position.z);
    scp173.position.lerp(_target, Math.min(delta * 20, 1));
    _step.subVectors(scp173.position, _prev);
    const maxStep = ENTITY_MAX_SPEED * delta;
    if (_step.length() > maxStep) { _step.setLength(maxStep); scp173.position.copy(_prev).add(_step); }
    entityVelocity.copy(_step).divideScalar(Math.max(delta, 1e-4));
    scp173.lookAt(camera.position.x, scp173.position.y, camera.position.z);
    sounds.scrape.volume = Math.min(0.42, sounds.scrape.volume + delta * 1.8);
  }

  const dx = scp173.position.x - camera.position.x;
  const dz = scp173.position.z - camera.position.z;
  const dist = Math.hypot(dx, dz);

  hudDist.textContent = dist.toFixed(1) + ' m';
  observeBadge.textContent = seen ? '已观测 · 冻结' : '未观测 · 移动中';
  observeBadge.className = 'badge ' + (seen ? 'observed' : 'unseen');
  crosshair.classList.toggle('observed', seen);
  crosshair.classList.toggle('danger', !seen && dist < 5);

  if (dist < KILL_DISTANCE) PlayerDeath();
}

/* ------------------------------------------------------- 撤离 / 结算判定  */
function updateEvacHud() {
  const dx = EVAC_POS.x - camera.position.x;
  const dz = EVAC_POS.z - camera.position.z;
  const dist = Math.hypot(dx, dz);
  evacDist.textContent = dist.toFixed(0) + ' m';
  const worldAngle = Math.atan2(dx, -dz);   // 0 = 正前方 (-Z)
  evacArrow.style.transform = 'rotate(' + ((worldAngle - yaw) * 180 / Math.PI).toFixed(1) + 'deg)';
  return dist;
}
function checkWin() {
  if (state !== 'PLAYING') return;
  if (survivalTime >= EXTRACT_SECONDS) {
    PlayerExtracted('协议时限达成，撤离通道已开启');
  } else if (Math.hypot(EVAC_POS.x - camera.position.x,
                        EVAC_POS.z - camera.position.z) < EVAC_RADIUS) {
    PlayerExtracted('已抵达撤离点');
  }
}

/* ------------------------------------------------------------- HUD / decal */
let hudAccum = 0;
const fmtTime = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' +
                        String(Math.floor(s % 60)).padStart(2, '0');
function updateHud(delta) {
  hudAccum += delta;
  updateEvacHud();
  if (hudAccum < 0.1) return;
  hudAccum = 0;
  hudTime.textContent = fmtTime(survivalTime) + ' / ' + fmtTime(EXTRACT_SECONDS);
  hudAmmo.textContent = '∞';
}
function updateDecals(delta) {
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    d.life -= delta;
    if (d.life < 2) d.mesh.material.opacity = Math.max(0, d.life / 2) * 0.92;
    if (d.life <= 0) {
      scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose();
      decals.splice(i, 1);
    }
  }
}

/* ------------------------------------------------------------- game loop   */
function loop() {
  const delta = Math.min(clock.getDelta(), 0.05);
  applyLook();

  if (state === 'PLAYING') {
    survivalTime += delta;
    updateBlink(delta);
    updatePlayer(delta);
    updateEntity(delta);
    updateViewModel(delta);
    updateSubtitles(delta);
    updateHud(delta);
    updateDecals(delta);
    checkWin();
  }
  animEvac(delta);
  renderer.render(scene, camera);

  if (window.__M9_SELFTEST) {
    const st = window.__M9_SELFTEST;
    st.frames++;
    st.state = state;
    st.observed = isObserved;
    st.entityLoaded = !!scp173;
    st.survival = Number(survivalTime.toFixed(2));
    st.yaw = Number(yaw.toFixed(3));
    st.posZ = Number(camera.position.z.toFixed(2));
    st.death = state === 'DEAD';
    st.win = state === 'EXTRACTED';
    st.bulletHoles = decals.length;
    st.touchUI = !touchControls.classList.contains('hidden');
    st.viewModel = !!viewModel.parent;
    st.joystickLib = !!window.__M9_JOYSTICK;
    st.nippleDom = !!document.querySelector('#joystick-zone .nipple');
    st.humanoidParts = scp173 ? scp173.children.length : 0;
    st.subtitle = subtitleText.textContent;
    st.menuHidden = mainMenu.style.display === 'none';
    if (scp173) {
      st.dist = Number(Math.hypot(scp173.position.x - camera.position.x,
                                  scp173.position.z - camera.position.z).toFixed(2));
    }
    document.body.setAttribute('data-m9-selftest', JSON.stringify(st));
  }
  // 无头自检：结算/死亡或帧数封顶后停止循环，让浏览器虚拟时间立即耗尽
  const probeState = window.__M9_SELFTEST;
  const stop = probeState &&
    (state === 'DEAD' || state === 'EXTRACTED' || probeState.frames > 600);
  if (!stop) requestAnimationFrame(loop);
}

/* ------------------------------- 菜单阶段的 3D 预览（暗化模糊背景） ------ */
let lastPreview = performance.now();
let previewFrames = 0;
function previewLoop() {
  if (state !== 'MENU') return;           // Start 之后交给游戏主循环
  previewFrames++;
  if (!(PROBE && previewFrames > 90)) requestAnimationFrame(previewLoop);
  const now = performance.now();
  const delta = Math.min((now - lastPreview) / 1000, 0.05);
  lastPreview = now;
  menuT += delta;
  camera.position.set(Math.sin(menuT * 0.16) * 2.6, EYE_HEIGHT + 0.14,
                      11.5 + Math.cos(menuT * 0.16) * 1.2);
  yaw = Math.sin(menuT * 0.2) * 0.30;
  pitch = -0.055;
  applyLook();
  animEvac(delta);
  renderer.render(scene, camera);
}
requestAnimationFrame(previewLoop);

/* ---------------------------------------------------- 屏幕方向 / 尺寸适配  */
function updateOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  document.body.classList.toggle('portrait', portrait && isTouchDevice);
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', updateOrientation);
window.addEventListener('orientationchange', () => setTimeout(updateOrientation, 120));
updateOrientation();

console.info('[MIRROR-9] 引擎就绪 · 模块=' + window.M9_LIB_MODE +
             ' · 触屏=' + isTouchDevice + ' · nipplejs=' + !!window.nipplejs +
             ' · 阴影=' + renderer.shadowMap.enabled);

/* ------------------------------------------------------------- CI probe    */
// ?selftest=1 直接跑真实游戏循环；?touch=1 强制移动端控件；?evac=1 测结算。
if (SELFTEST) {
  window.__M9_SELFTEST = {
    frames: 0, state: 'BOOT', observed: false, entityLoaded: false,
    dist: -1, survival: 0, death: false, win: false,
    shotsFired: 0, bulletHoles: 0, touchUI: false, viewModel: false,
    humanoidParts: 0, subtitle: '', menuHidden: false, yaw: 0, posZ: 0,
    freezeFrames: 0, chaseFrames: 0,
  };
  mainMenu.style.display = 'none';
  hud.classList.remove('hidden');
  if (isTouchDevice) touchControls.classList.remove('hidden');
  resetRun();
  queueSubtitles();
  graceLeft = 0.3;
  blinkPeriod = 1.0; blinkClock = 1.0;
  state = 'PLAYING';
  loopStarted = true;
  clock.start();
  controls.isLocked = true;
  document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  controls.isLocked = false;
  if (FORCE_TOUCH) {
    joy.x = 0; joy.y = EVAC_TEST ? 0 : 1;    // 验证摇杆 -> Vector3 移动路径
    // 用合成 TouchEvent 真实触发右半屏滑动，验证 yaw 旋转链路
    try {
      const mk = (type, x, y) => {
        const t = new Touch({ identifier: 7, target: lookZone, clientX: x, clientY: y });
        return new TouchEvent(type, { touches: [t], changedTouches: [t],
                                      bubbles: true, cancelable: true });
      };
      lookZone.dispatchEvent(mk('touchstart', 500, 300));
      lookZone.dispatchEvent(mk('touchmove', 590, 320));
      lookZone.dispatchEvent(mk('touchend', 590, 320));
    } catch (err) { console.warn('[MIRROR-9] synthetic touch probe skipped', err); }
  }
  requestAnimationFrame(loop);
}

/* 调试接口（无副作用，便于自动化验证） */
window.__M9_DEBUG = {
  joy, fire, toggleFlashlight,
  getPos: () => camera.position.toArray(),
  getYaw: () => yaw,
  getState: () => state,
};
