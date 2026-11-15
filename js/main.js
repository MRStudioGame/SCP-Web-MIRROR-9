/* ============================================================================
 * SCP: MIRROR-9  /  第一人称收容行动 (Web / Three.js r160.1)
 * 中文 UI · 强制横屏 + 全屏 API · 虚拟摇杆 + 触摸视角 + 开火/手电
 * 枪械 ViewModel · 程序化混凝土人形 SCP-173 · 严格射线观测判定
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
const SELFTEST     = QS.get('selftest') === '1';
const FORCE_TOUCH  = QS.get('touch') === '1';
const FAST_WIN     = QS.get('fast') === '1' || QS.get('evac') === '1';
const EVAC_TEST    = QS.get('evac') === '1';
const USE_GLB      = QS.get('glb') === '1';
const USE_HUMANOID = QS.get('humanoid') === '1';
const AUTOSTART    = QS.get('autostart') === '1';
const PROBE        = QS.has('probe');   // 无头自检：达到条件后停止 rAF，避免空转

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
const VIEW_DISTANCE    = 60;     // 观测视距，与射线判定一致
const KILL_DISTANCE    = 1.5;
const WALK_SPEED       = 6.4;
const ENTITY_MAX_SPEED = 11.0;
const EXTRACT_SECONDS  = FAST_WIN ? 3.0 : 60.0;
const EVAC_RADIUS      = 2.8;
const CENTRE           = new THREE.Vector2(0, 0);   // 屏幕中心 (0,0) NDC
const UP               = new THREE.Vector3(0, 1, 0);
const SPAWN_PLAYER     = new THREE.Vector3(0, EYE_HEIGHT, 10);
const SPAWN_ENTITY     = new THREE.Vector3(8, 0, -14);
const EVAC_POS         = new THREE.Vector3(0, 0, -19.0);

let state = 'MENU';        // MENU | PLAYING | PAUSED | DEAD | EXTRACTED
let assetsReady = false;
let assetsTimedOut = false;
let loopStarted = false;
let survivalTime = 0;
let isObserved = false;    // 每帧由 Raycaster 重新判定
let isBlinking = false;
let flashlightOn = true;
let yaw = 0, pitch = 0;
let recoil = 0;
let menuT = 0;
let probeLookedAway = false;
let fullscreenCalls = 0;
window.__M9_TOUCH_YAW_DELTA = 0;

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
scene.add(camera);   // 关键：相机必须在场景图中，其子对象光源才会生效

const clock = new THREE.Clock(false);
const raycaster = new THREE.Raycaster();
raycaster.far = VIEW_DISTANCE;

function applyLook() { camera.rotation.set(pitch, yaw, 0, 'YXZ'); }
applyLook();

/* ----------------------------------------------------------------- lights */
scene.add(new THREE.AmbientLight(0x404040, 1.25));
scene.add(new THREE.HemisphereLight(0x2a3446, 0x0a0a0c, 0.55));

// 战术手电筒：必须作为 Camera 的子对象才会跟随视角。
// r160 使用物理光照单位（candela），intensity=2 在数米外几乎不可见，
// 这正是「手电筒不亮」的真实原因 —— 这里提到 18 并保留 distance/angle/penumbra。
// 注意：不能把 target 直接设成 camera 本身。光源也是 camera 的子对象时，
// 两者世界坐标重合会让 SpotLight 的方向退化为零向量，反而完全不亮。
// 正确做法是把一个位于相机正前方的 Object3D 挂到 camera 上并设为 target，
// 语义等价于「target 跟随相机」，同时保持光照方向有效。
const flashlight = new THREE.SpotLight(0xffffff, 18, 50, Math.PI / 6, 0.5, 1.0);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.camera.near = 0.4;
flashlight.shadow.camera.far = 50;
flashlight.shadow.bias = -0.0006;
flashlight.position.set(0, 0, 0);
camera.add(flashlight);
const flashlightTarget = new THREE.Object3D();
flashlightTarget.position.set(0, -0.02, -1);
camera.add(flashlightTarget);
flashlight.target = flashlightTarget;

const nearFill = new THREE.PointLight(0xa9c6ee, 3.2, 9, 1.4);
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
const occluders  = [];   // 场景几何：射击弹痕命中集合（不再覆盖观测判定）
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

/* ------------------------------------------- SCP-173：精细混凝土人形      */
/* THREE.Group + BoxGeometry / CylinderGeometry，主材质 0x777777 / roughness 0.9。
   粗壮脖子、分节四肢、手掌五指、肋骨、眉骨、经典橙色涂料、钢筋与裂纹。 */
let scp173 = null;
const entityVelocity = new THREE.Vector3();
const _prev   = new THREE.Vector3();
const _step   = new THREE.Vector3();
const _target = new THREE.Vector3();

function buildSCP173() {
  const g = new THREE.Group();
  g.name = 'SCP173_ConcreteHumanoid';
  const concrete = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.9, metalness: 0.02 });
  const joint    = new THREE.MeshStandardMaterial({ color: 0x66645f, roughness: 0.9 });
  const stain    = new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 0.95 });
  const paint    = new THREE.MeshStandardMaterial({ color: 0xb0491f, roughness: 0.85 });
  const dark     = new THREE.MeshStandardMaterial({ color: 0x1b1917, roughness: 0.95 });
  const rebar    = new THREE.MeshStandardMaterial({ color: 0x31302d, roughness: 0.55, metalness: 0.62 });

  const put = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = shadow; m.receiveShadow = true;
    m.name = 'SCP173_part';
    g.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, shadow = true) =>
    put(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz, shadow);
  const cyl = (rt, rb, h, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 20, shadow = true) =>
    put(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rx, ry, rz, shadow);

  /* 底座：粗糙混凝土圆盘 + 边缘碎块 */
  cyl(1.02, 1.10, 0.18, concrete, 0, 0.09, 0, 0, 0, 0, 36);
  cyl(1.06, 1.06, 0.05, stain, 0, 0.19, 0, 0, 0, 0, 36, false);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    box(0.18, 0.10, 0.22, joint, Math.cos(a) * 0.96, 0.11, Math.sin(a) * 0.96, 0, a, 0, false);
  }

  /* 双腿：脚掌/脚趾/踝/小腿/膝/大腿/髋 —— 全部圆柱+方块分节 */
  for (const s of [-1, 1]) {
    const X = s * 0.34;
    box(0.44, 0.20, 0.78, concrete, X, 0.29, 0.18, 0, 0, s * 0.03);
    for (let t = 0; t < 4; t++) {
      box(0.095, 0.10, 0.16, joint, X - 0.15 + t * 0.10, 0.25, 0.60, 0, 0, 0, false);
    }
    cyl(0.20, 0.23, 0.26, joint, X, 0.50, 0.02, 0, 0, s * 0.04, 16);
    cyl(0.27, 0.20, 1.00, concrete, X, 1.03, -0.02, -0.05, 0, s * 0.05, 20);
    cyl(0.235, 0.235, 0.20, joint, X, 1.55, -0.04, 0, 0, 0, 18);
    cyl(0.32, 0.25, 0.92, concrete, X, 2.01, -0.06, 0.08, 0, s * 0.06, 20);
    cyl(0.28, 0.28, 0.22, joint, X, 2.48, -0.02, 0, 0, 0, 18);
    box(0.10, 0.62, 0.035, stain, X + s * 0.26, 1.05, 0.18, 0, 0, s * 0.05, false);
  }

  /* 骨盆 / 躯干：前倾的胸腔、分节脊柱、肋骨、胸肌、腹部裂纹 */
  box(1.00, 0.42, 0.60, concrete, 0, 2.60, -0.02);
  box(0.30, 0.30, 0.52, joint, -0.52, 2.58, -0.02, 0, 0, -0.16);
  box(0.30, 0.30, 0.52, joint,  0.52, 2.58, -0.02, 0, 0,  0.16);
  box(1.02, 0.34, 0.60, concrete, 0, 2.96, 0.02, 0.10);
  box(1.22, 1.02, 0.72, concrete, 0, 3.56, 0.10, 0.14);
  box(1.36, 0.30, 0.78, concrete, 0, 4.02, 0.14, 0.14);
  for (const s of [-1, 1]) {
    box(0.46, 0.30, 0.16, joint, s * 0.29, 3.72, 0.49, 0.14);
    for (let r = 0; r < 4; r++) {
      box(0.60, 0.055, 0.07, joint, s * 0.36, 3.24 + r * 0.20, 0.44,
          0.14, 0, s * 0.24, false);
    }
  }
  for (let v = 0; v < 5; v++) {
    cyl(0.11, 0.11, 0.13, joint, 0, 3.06 + v * 0.22, -0.30, 0.14, 0, 0, 12, false);
  }
  box(0.055, 0.62, 0.03, dark, -0.22, 3.42, 0.48, 0.14, 0, -0.16, false);
  box(0.040, 0.34, 0.03, dark,  0.19, 3.10, 0.47, 0.14, 0,  0.22, false);
  box(0.50, 0.09, 0.035, paint, 0.05, 3.86, 0.50, 0.14, 0, 0, false);

  /* 标志性粗脖：三段圆柱 + 四束颈部肌腱 */
  cyl(0.40, 0.44, 0.30, concrete, 0, 4.24, 0.10, 0.10, 0, 0, 28);
  cyl(0.35, 0.38, 0.34, concrete, 0, 4.54, 0.14, 0.10, 0, 0, 28);
  cyl(0.375, 0.375, 0.09, stain, 0, 4.72, 0.16, 0.10, 0, 0, 28, false);
  for (const [dx, dz] of [[-0.26, 0.10], [0.26, 0.10], [-0.20, -0.22], [0.20, -0.22]]) {
    cyl(0.075, 0.09, 0.52, joint, dx, 4.44, dz, 0.10, 0, dx * 0.2, 12, false);
  }

  /* 头部：前倾、后脑、眉骨、眼窝、橙漆、颧骨、下颌、裂纹 */
  box(0.72, 0.82, 0.66, concrete, 0, 5.20, 0.22, 0.17);
  box(0.62, 0.52, 0.20, joint, 0, 5.02, -0.16, 0.17);
  box(0.78, 0.14, 0.16, concrete, 0, 5.50, 0.54, 0.17);
  for (const s of [-1, 1]) {
    box(0.22, 0.14, 0.07, dark, s * 0.18, 5.30, 0.57, 0.17);
    box(0.13, 0.075, 0.05, paint, s * 0.18, 5.30, 0.605, 0.17, 0, 0, false);
    box(0.10, 0.30, 0.05, paint, s * 0.31, 5.08, 0.55, 0.17, 0, 0, false);
    box(0.20, 0.16, 0.16, joint, s * 0.30, 4.94, 0.42, 0.17);
  }
  box(0.26, 0.09, 0.05, paint, 0.02, 5.53, 0.60, 0.17, 0, 0, false);
  box(0.52, 0.20, 0.44, concrete, 0, 4.80, 0.28, 0.17);
  box(0.30, 0.045, 0.04, dark, 0, 4.86, 0.51, 0.17, 0, 0, false);
  box(0.035, 0.30, 0.03, dark, 0.27, 5.24, 0.56, 0.17, 0, 0.30, false);

  /* 手臂：肩 / 上臂 / 肘 / 前臂 / 掌 / 每手五指两节（前伸抓握姿态） */
  for (const s of [-1, 1]) {
    box(0.40, 0.34, 0.58, concrete, s * 0.78, 3.96, 0.12, 0, 0, s * 0.16);
    cyl(0.25, 0.25, 0.24, joint, s * 0.88, 3.90, 0.14, 0, 0, s * 0.30, 18);
    cyl(0.225, 0.195, 0.82, concrete, s * 0.98, 3.52, 0.26, 0.28, 0, s * 0.28, 18);
    cyl(0.205, 0.205, 0.16, joint, s * 1.06, 3.12, 0.44, 0.28, 0, s * 0.20, 18);
    cyl(0.185, 0.150, 0.74, concrete, s * 1.10, 2.76, 0.62, 0.66, 0, s * 0.10, 18);
    box(0.30, 0.16, 0.34, concrete, s * 1.10, 2.44, 0.86, 0.40);
    for (let f = 0; f < 5; f++) {
      const fx = s * 1.10 + (f - 2) * 0.062;
      cyl(0.032, 0.028, 0.20, concrete, fx, 2.32, 1.02, 0.62, 0, 0, 8, false);
      cyl(0.026, 0.020, 0.14, joint, fx, 2.20, 1.14, 0.92, 0, 0, 8, false);
    }
    cyl(0.045, 0.045, 0.22, concrete, s * 1.10, 2.38, 0.94, 0, 0, s * 1.1, 10, false);
  }

  /* 混凝土裂纹 / 污渍 / 背部外露钢筋 */
  for (const [x, y, z, w, h, rz] of [
    [-0.34, 3.70, 0.48, 0.035, 0.44, -0.30], [0.28, 3.34, 0.47, 0.030, 0.30, 0.42],
    [-0.10, 2.82, 0.33, 0.34, 0.030, 0.05], [0.36, 4.00, 0.44, 0.028, 0.22, -0.25],
  ]) {
    box(w, h, 0.025, stain, x, y, z, 0.14, 0, rz, false);
  }
  for (const [x0, y0, z0, x1, y1, z1] of [
    [-0.32, 2.86, -0.40, -0.50, 3.40, -0.58],
    [ 0.32, 2.72, -0.40,  0.52, 3.24, -0.58],
    [-0.20, 3.90, -0.36, -0.34, 4.20, -0.50],
    [ 0.20, 3.86, -0.36,  0.36, 4.16, -0.50],
  ]) {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.026, a.distanceTo(b), 10), rebar
    );
    rod.position.copy(a).add(b).multiplyScalar(0.5);
    rod.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    rod.castShadow = true; rod.receiveShadow = true;
    rod.name = 'SCP173_part'; g.add(rod);
  }

  /* 命中代理体：模型由上百个分离部件组成，中心射线可能从部件缝隙穿过，
     导致「明明盯着它却判定未观测」。这里加一个材质不可见、不投影、
     但可被 Raycaster 命中的包围体，让视线判定只看「准星是否落在 173 轮廓内」。 */
  const hitProxy = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 5.6, 1.9),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitProxy.position.set(0, 2.8, 0);
  hitProxy.name = 'SCP173_HitProxy';
  g.add(hitProxy);

  // 统一缩放到约 3.5m 的雕像高度，避免头部穿过 5m 高的天花板
  g.scale.setScalar(0.62);
  g.userData.M9ConcreteColor = '0x777777';
  g.userData.M9Roughness = 0.9;
  g.userData.M9PartCount = g.children.length;
  g.userData.M9Source = 'procedural BoxGeometry + CylinderGeometry';
  return g;
}

function installEntity(root) {
  scp173 = root;
  root.position.copy(SPAWN_ENTITY);
  root.name = 'SCP173';
  root.userData.M9ConcreteColor = root.userData.M9ConcreteColor || '0x777777';
  root.userData.M9Roughness = root.userData.M9Roughness === undefined ? 0.9 : root.userData.M9Roughness;
  root.userData.M9PartCount = root.userData.M9PartCount || root.children.length;
  scene.add(root);
  shootables.push(root);
  // 射线判定需要最新的世界矩阵
  root.updateMatrixWorld(true);
}

// 可选：下载自 KhronosGroup/glTF-Sample-Models 的真实 humanoid（CesiumMan）。
// 整体替换为混凝土材质并放大成雕像尺寸；不播放骨骼动画。
function concreteHumanoid(root) {
  const statue = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.9, metalness: 0.02 });
  const paint  = new THREE.MeshStandardMaterial({ color: 0xb0491f, roughness: 0.85 });
  let meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = statue;
    o.castShadow = true; o.receiveShadow = true;
    o.name = 'SCP173_part';
    meshes++;
  });
  root.scale.setScalar(1.95);
  // 叠加 173 的标志性橙色涂鸦与粗脖轮廓
  for (let i = 0; i < 3; i++) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.30, 0.03), paint);
    mark.position.set((i - 1) * 0.20, 3.2 - i * 0.16, 0.62);
    mark.name = 'SCP173_part'; root.add(mark);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.46, 24), statue);
  neck.position.set(0, 3.05, 0); neck.name = 'SCP173_part'; root.add(neck);
  // 与程序化模型一致的命中代理体（放在 traverse 之后，避免材质被混凝土化覆盖）
  const hitProxy = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 2.0, 0.9),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitProxy.position.set(0, 1.0, 0);
  hitProxy.name = 'SCP173_HitProxy';
  root.add(hitProxy);
  root.userData.M9ConcreteColor = '0x777777';
  root.userData.M9Roughness = 0.9;
  root.userData.M9PartCount = meshes + 5;
  root.userData.M9Source = 'KhronosGroup/glTF-Sample-Models CesiumMan (concrete re-skin)';
  document.body.setAttribute('data-m9-humanoid', 'loaded');
  return root;
}

if (USE_HUMANOID || USE_GLB) {
  const url = USE_HUMANOID ? './assets/models/humanoid.glb' : './assets/models/SCP173.glb';
  const gltfLoader = new GLTFLoader(manager);
  gltfLoader.load(url,
    (gltf) => installEntity(USE_HUMANOID ? concreteHumanoid(gltf.scene) : gltf.scene),
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

  box(0.17, 0.14, 0.44, dark, 0, 0, 0);
  box(0.15, 0.045, 0.42, metal, 0, 0.085, -0.01);
  box(0.13, 0.10, 0.30, grip, 0, -0.025, -0.26);
  cyl(0.028, 0.44, metal, 0, 0.005, -0.46, Math.PI / 2);
  cyl(0.042, 0.10, dark, 0, 0.005, -0.68, Math.PI / 2);
  box(0.105, 0.22, 0.115, dark, 0, -0.18, 0.015, 0.18);
  box(0.09, 0.20, 0.10, grip, 0, -0.17, 0.19, -0.32);
  box(0.10, 0.035, 0.13, metal, 0, -0.10, 0.10);
  box(0.13, 0.13, 0.26, dark, 0, -0.015, 0.33);
  box(0.16, 0.055, 0.07, grip, 0, 0.02, 0.47);
  box(0.055, 0.055, 0.13, metal, 0, 0.14, -0.06);
  box(0.04, 0.04, 0.04, dark, 0, 0.14, -0.24);
  box(0.025, 0.05, 0.025, metal, 0, 0.14, -0.60);

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
      const dYaw = dx * 0.0042;
      yaw   -= dYaw;
      pitch -= dy * 0.0042;
      pitch = Math.max(-1.4, Math.min(1.4, pitch));
      window.__M9_TOUCH_YAW_DELTA += Math.abs(dYaw);
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
    const dYaw = (e.clientX - mx) * 0.0042;
    yaw -= dYaw;
    pitch = Math.max(-1.4, Math.min(1.4, pitch - (e.clientY - my) * 0.0042));
    window.__M9_TOUCH_YAW_DELTA += Math.abs(dYaw);
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
/* 眨眼只做视觉氛围与 HUD 提示，不再覆盖 Raycaster 的观测判定：
   盯着 173 就必定冻结，这是本次修复的核心。 */
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
      blinkPeriod = SELFTEST ? 1.6 : (7 + Math.random() * 6);
      blinkClock = blinkPeriod; blinkLeft = SELFTEST ? 0.12 : 0.17;
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
/* 顶部小警告条：5 秒后加 .faded -> CSS opacity:0 / transition:.5s 自动淡出 */
const subtitleQueue = [];
let subtitleTimer = 0;
let subtitleFadeLeft = 0;

function queueSubtitles() {
  subtitleQueue.length = 0;
  subtitleQueue.push(['警告：SCP-173 已突破收容。利用视线锁定它，并寻找出口。', 5.0]);
  subtitleQueue.push(['移开视线它就会逼近，准星保持锁定。', 3.5]);
  subtitleQueue.push(['撤离点已标记：跟随绿色光柱，或撑过 60 秒。', 3.5]);
  subtitleTimer = 0;
  subtitleFadeLeft = 0;
  nextSubtitle();
}
function nextSubtitle() {
  if (!subtitleQueue.length) { subtitleBar.classList.add('hidden', 'faded'); return; }
  const [text, dur] = subtitleQueue.shift();
  subtitleText.textContent = text;
  subtitleBar.classList.remove('hidden', 'faded');
  subtitleBar.style.animation = 'none';
  void subtitleBar.offsetWidth;
  subtitleBar.style.animation = '';
  subtitleTimer = dur;
  subtitleFadeLeft = 0;
}
function updateSubtitles(delta) {
  if (subtitleBar.classList.contains('hidden')) return;
  if (subtitleFadeLeft > 0) {
    subtitleFadeLeft -= delta;
    if (subtitleFadeLeft <= 0) nextSubtitle();
    return;
  }
  subtitleTimer -= delta;
  if (subtitleTimer <= 0.5 && !subtitleBar.classList.contains('faded')) {
    subtitleBar.classList.add('faded');     // 5 秒后自动淡出
  }
  if (subtitleTimer <= 0) subtitleFadeLeft = 0.55;
}
function hideSubtitles() {
  subtitleQueue.length = 0;
  subtitleBar.classList.add('hidden', 'faded');
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

  camera.updateMatrixWorld(true);
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

/* ----------------------------------------------------------- 强制全屏 API  */
/* 点击【开始收容行动】时在用户手势的同步上下文中调用，地址栏才会真正收起。 */
function enterFullscreen() {
  fullscreenCalls++;
  document.body.setAttribute('data-m9-fullscreen', 'requested');
  const el = document.documentElement;
  try {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen ||
               el.mozRequestFullScreen || el.msRequestFullscreen || null;
    if (fn) {
      const p = fn.call(el);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch (_) { /* 浏览器策略拒绝时降级为 100dvh 全屏 CSS */ }
  try {
    if (window.screen && screen.orientation && screen.orientation.lock) {
      const p = screen.orientation.lock('landscape');
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch (_) { /* iOS Safari 不支持 orientation.lock */ }
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
  // 出生即正对 SCP-173：中心射线必须真的落在它身上，否则开局就被判定为
  // 「未观测」而立刻遭到追击（这正是盯不住它的体验灾难来源）。
  yaw = Math.atan2(-(SPAWN_ENTITY.x - SPAWN_PLAYER.x),
                   -(SPAWN_ENTITY.z - SPAWN_PLAYER.z));
  pitch = 0;
  applyLook();
  moveVelocity.set(0, 0, 0);
  entityVelocity.set(0, 0, 0);
  if (scp173) {
    scp173.position.copy(SPAWN_ENTITY);
    scp173.lookAt(camera.position.x, 0, camera.position.z);
    scp173.updateMatrixWorld(true);
  }
  survivalTime = 0;
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
  probeLookedAway = false;
  window.__M9_TOUCH_YAW_DELTA = 0;
}

function startGame() {
  if (state === 'PLAYING') return;
  enterFullscreen();                 // 必须在 click 同步栈里
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
  if (AUTOSTART) setTimeout(() => { window.__M9_AUTOSTART_STOP = true; }, 400);
}
startBtn.addEventListener('click', startGame);

resumeBtn.addEventListener('click', () => {
  if (state !== 'PAUSED') return;
  enterFullscreen();
  state = 'PLAYING';
  pauseOverlay.classList.add('hidden');
  clock.getDelta();
  startAmbience();
  try { controls.lock(); } catch (_) {}
});

restartBtn.addEventListener('click', () => {
  enterFullscreen();
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

  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _rightV.set(Math.cos(yaw), 0, -Math.sin(yaw));
  _wish.set(0, 0, 0).addScaledVector(_fwd, iz).addScaledVector(_rightV, ix)
       .multiplyScalar(WALK_SPEED);
  moveVelocity.lerp(_wish, Math.min(1, delta * 12));
  camera.position.addScaledVector(moveVelocity, delta);

  const lim = ROOM / 2 - 1.1;
  camera.position.x = Math.max(-lim, Math.min(lim, camera.position.x));
  camera.position.z = Math.max(-lim, Math.min(lim, camera.position.z));

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

/* -------------------------------------- 核心观测判定（严格每帧 Raycaster） */
/* 规则：只有 isObserved === true 时 173 才冻结；否则必定向玩家移动。
   不再让眨眼、保护期、近距离、遮挡物等任何逻辑覆盖这条判定。 */
function updateEntity(delta) {
  if (!scp173) return;

  // 相机与实体的世界矩阵必须先更新，否则射线用的是上一帧的朝向/位置
  camera.updateMatrixWorld(true);
  scp173.updateMatrixWorld(true);

  raycaster.setFromCamera(CENTRE, camera);          // CENTRE = new THREE.Vector2(0, 0)
  const intersects = raycaster.intersectObject(scp173, true);
  isObserved = false;
  if (intersects.length > 0 && intersects[0].distance < VIEW_DISTANCE) {
    isObserved = true;
  }

  if (window.__M9_SELFTEST) {
    const s = window.__M9_SELFTEST;
    if (isObserved) s.freezeFrames = (s.freezeFrames || 0) + 1;
    else s.chaseFrames = (s.chaseFrames || 0) + 1;
    s.rayHits = intersects.length;
  }
  _prev.copy(scp173.position);

  if (isObserved) {
    // 被注视：velocity = 0，完全冻结
    entityVelocity.set(0, 0, 0);
    sounds.scrape.volume = Math.max(0, sounds.scrape.volume - delta * 1.5);
  } else {
    // 未被注视：以 deltaTime * 20 的极高速度向 Camera.position 逼近
    _target.set(camera.position.x, scp173.position.y, camera.position.z);
    scp173.position.lerp(_target, Math.min(delta * 20, 1));
    _step.subVectors(scp173.position, _prev);
    const maxStep = ENTITY_MAX_SPEED * delta;
    if (_step.length() > maxStep) { _step.setLength(maxStep); scp173.position.copy(_prev).add(_step); }
    entityVelocity.copy(_step).divideScalar(Math.max(delta, 1e-4));
    scp173.lookAt(camera.position.x, scp173.position.y, camera.position.z);
    scp173.updateMatrixWorld(true);
    sounds.scrape.volume = Math.min(0.42, sounds.scrape.volume + delta * 1.8);
  }

  const dx = scp173.position.x - camera.position.x;
  const dz = scp173.position.z - camera.position.z;
  const dist = Math.hypot(dx, dz);

  hudDist.textContent = dist.toFixed(1) + ' m';
  observeBadge.textContent = isObserved ? '已观测 · 冻结' : '未观测 · 移动中';
  observeBadge.className = 'badge ' + (isObserved ? 'observed' : 'unseen');
  crosshair.classList.toggle('observed', isObserved);
  crosshair.classList.toggle('danger', !isObserved && dist < 5);

  if (dist < KILL_DISTANCE) PlayerDeath();
}

/* ---------------------------------------------- CI 探针：真实转头制造未观测 */
/* 前 0.9 秒保持注视（验证冻结分支），随后通过真实 touchmove 事件 / 等价转头
   移开视线（验证追击分支与死亡结算）。撤离探针不转头，靠注视冻结撑过时限。 */
function applyProbeLook() {
  if (!SELFTEST || EVAC_TEST || probeLookedAway) return;
  if (survivalTime < 0.9) return;
  probeLookedAway = true;
  if (FORCE_TOUCH) {
    try {
      const mk = (type, x, y) => {
        const t = new Touch({ identifier: 7, target: lookZone, clientX: x, clientY: y });
        return new TouchEvent(type, { touches: [t], changedTouches: [t],
                                      bubbles: true, cancelable: true });
      };
      lookZone.dispatchEvent(mk('touchstart', 400, 300));
      lookZone.dispatchEvent(mk('touchmove', 720, 300));   // dx=320 -> yaw -= 1.344
      lookZone.dispatchEvent(mk('touchend', 720, 300));
    } catch (err) {
      console.warn('[MIRROR-9] synthetic touch probe fallback', err);
      yaw -= 1.35;
    }
  } else {
    yaw -= 1.35;   // 桌面：等价于一次鼠标转头
  }
}

/* ------------------------------------------------------- 撤离 / 结算判定  */
function updateEvacHud() {
  const dx = EVAC_POS.x - camera.position.x;
  const dz = EVAC_POS.z - camera.position.z;
  const dist = Math.hypot(dx, dz);
  evacDist.textContent = dist.toFixed(0) + ' m';
  const worldAngle = Math.atan2(dx, -dz);
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
  if (state === 'PLAYING') applyProbeLook();
  applyLook();
  camera.updateMatrixWorld(true);

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
    st.humanoidParts = scp173 ? (scp173.userData.M9PartCount || scp173.children.length) : 0;
    st.entityColor = scp173 ? scp173.userData.M9ConcreteColor : '';
    st.entityRoughness = scp173 ? scp173.userData.M9Roughness : -1;
    st.entitySource = scp173 ? scp173.userData.M9Source : '';
    st.subtitle = subtitleText.textContent;
    st.subtitleFaded = subtitleBar.classList.contains('faded');
    st.menuHidden = mainMenu.style.display === 'none';
    st.flashlightParent = flashlight.parent === camera ? 'camera' : (flashlight.parent ? flashlight.parent.type : 'none');
    st.flashlightIntensity = flashlight.intensity;
    st.flashlightShadow = flashlight.castShadow;
    st.flashlightTargetParent = flashlight.target.parent === camera ? 'camera' : 'other';
    st.sceneHasCamera = camera.parent === scene;
    st.fullscreenCalls = fullscreenCalls;
    st.touchYawDelta = Number(window.__M9_TOUCH_YAW_DELTA.toFixed(3));
    st.viewDistance = VIEW_DISTANCE;
    if (scp173) {
      st.dist = Number(Math.hypot(scp173.position.x - camera.position.x,
                                  scp173.position.z - camera.position.z).toFixed(2));
    }
    document.body.setAttribute('data-m9-selftest', JSON.stringify(st));
  }
  const probeState = window.__M9_SELFTEST;
  const stop = (probeState &&
    (state === 'DEAD' || state === 'EXTRACTED' || probeState.frames > 600)) ||
    (AUTOSTART && window.__M9_AUTOSTART_STOP);
  if (!stop) requestAnimationFrame(loop);
}

/* ------------------------------- 菜单阶段的 3D 预览（暗化模糊背景） ------ */
let lastPreview = performance.now();
let previewFrames = 0;
function previewLoop() {
  if (state !== 'MENU') return;           // Start 之后交给游戏主循环
  previewFrames++;
  // 无头自检时预览只渲染少量帧即可，避免软件渲染拖垮整轮验证
  if (!(PROBE && previewFrames > 10)) requestAnimationFrame(previewLoop);
  const now = performance.now();
  const delta = Math.min((now - lastPreview) / 1000, 0.05);
  lastPreview = now;
  menuT += delta;
  camera.position.set(Math.sin(menuT * 0.16) * 2.6, EYE_HEIGHT + 0.14,
                      11.5 + Math.cos(menuT * 0.16) * 1.2);
  yaw = Math.sin(menuT * 0.2) * 0.30;
  pitch = -0.055;
  applyLook();
  camera.updateMatrixWorld(true);
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
window.addEventListener('fullscreenchange', () => setTimeout(updateOrientation, 120));
updateOrientation();

console.info('[MIRROR-9] 引擎就绪 · 模块=' + window.M9_LIB_MODE +
             ' · 触屏=' + isTouchDevice + ' · nipplejs=' + !!window.nipplejs +
             ' · 阴影=' + renderer.shadowMap.enabled +
             ' · 手电筒=' + flashlight.intensity + 'cd');

/* ------------------------------------------------------------- CI probe    */
// ?selftest=1 直接跑真实游戏循环；?touch=1 强制移动端控件；?evac=1 测结算。
if (SELFTEST) {
  window.__M9_SELFTEST = {
    frames: 0, state: 'BOOT', observed: false, entityLoaded: false,
    dist: -1, survival: 0, death: false, win: false,
    shotsFired: 0, bulletHoles: 0, touchUI: false, viewModel: false,
    humanoidParts: 0, subtitle: '', menuHidden: false, yaw: 0, posZ: 0,
    freezeFrames: 0, chaseFrames: 0, rayHits: 0,
  };
  mainMenu.style.display = 'none';
  hud.classList.remove('hidden');
  if (isTouchDevice) touchControls.classList.remove('hidden');
  resetRun();
  queueSubtitles();
  blinkPeriod = 1.6; blinkClock = 1.6;
  state = 'PLAYING';
  loopStarted = true;
  clock.start();
  controls.isLocked = true;
  document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  controls.isLocked = false;
  if (FORCE_TOUCH) joy.y = EVAC_TEST ? 0 : 1;   // 验证摇杆 -> Vector3 移动路径
  requestAnimationFrame(loop);
}

// ?autostart=1 走真实 Start 按钮 click 路径，用于验证全屏 API 调用
if (AUTOSTART && !SELFTEST) startBtn.click();

/* 调试接口（无副作用，便于自动化验证） */
window.__M9_DEBUG = {
  joy, fire, toggleFlashlight, enterFullscreen,
  getPos: () => camera.position.toArray(),
  getYaw: () => yaw,
  getState: () => state,
  getObserved: () => isObserved,
  getFlashlight: () => ({ intensity: flashlight.intensity,
                          parentIsCamera: flashlight.parent === camera,
                          castShadow: flashlight.castShadow,
                          targetParentIsCamera: flashlight.target.parent === camera }),
};
