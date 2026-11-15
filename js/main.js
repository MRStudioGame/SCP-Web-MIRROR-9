/* ============================================================================
 * SCP: MIRROR-9  /  Web containment simulation
 * Three.js r160.1 — FPS controller, tactical flashlight, GLTF entity,
 * per-frame centre-screen raycaster observation logic, shooting, UI state machine
 * ==========================================================================*/
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/* ---------------------------------------------------------------- DOM refs */
const $ = (id) => document.getElementById(id);
const stage        = $('stage');
const hud          = $('hud');
const mainMenu     = $('main-menu');
const startBtn     = $('start-btn');
const startLabel   = $('start-label');
const loadStatus   = $('load-status');
const gameOver     = $('game-over');
const restartBtn   = $('restart-btn');
const pauseOverlay = $('pause-overlay');
const resumeBtn    = $('resume-btn');
const crosshair    = $('crosshair');
const observeBadge = $('observe-badge');
const hudTime      = $('hud-time');
const hudDist      = $('hud-dist');
const hudBlink     = $('hud-blink');
const hudLight     = $('hud-light');
const hudAmmo      = $('hud-ammo');
const blinkEl      = $('blink');
const blinkMeter   = $('blink-meter-fill');
const muzzleEl     = $('muzzle-flash');
const toastEl      = $('toast');

$('lib-mode').textContent = 'RENDERER: THREE.JS r160.1 · ' +
  (window.M9_LIB_MODE === 'cdn' ? 'CDN MODULES' : 'LOCAL MODULES');

/* -------------------------------------------------------------- constants */
const EYE_HEIGHT       = 1.7;
const ROOM             = 44;
const WALL_H           = 5;
const VIEW_DISTANCE    = 60;
const KILL_DISTANCE    = 1.5;
const WALK_SPEED       = 6.4;
const ENTITY_MAX_SPEED = 11.0;      // m/s cap on the lerp step, keeps it playable
const CENTRE           = new THREE.Vector2(0, 0);
const SPAWN_PLAYER     = new THREE.Vector3(0, EYE_HEIGHT, 10);
const SPAWN_ENTITY     = new THREE.Vector3(8, 0, -14);
const GRACE_SECONDS    = 3.0;

let state = 'MENU';                 // MENU | PLAYING | PAUSED | DEAD
let assetsReady = false;
let loopStarted = false;
let survivalTime = 0;
let graceLeft = GRACE_SECONDS;
let isObserved = false;
let isBlinking = false;
let flashlightOn = true;
let assetsTimedOut = false;

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
scene.add(camera);

const clock = new THREE.Clock(false);
const raycaster = new THREE.Raycaster();
raycaster.far = VIEW_DISTANCE;

/* ----------------------------------------------------------------- lights */
const ambient = new THREE.AmbientLight(0x404040, 1.25);
scene.add(ambient);
scene.add(new THREE.HemisphereLight(0x2a3446, 0x0a0a0c, 0.55));

// Tactical flashlight mounted on the camera (spec: 0xffffff / 2 / 50 / PI/6 / 0.5)
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

// Small near-field fill so the player is never left in total darkness.
const nearFill = new THREE.PointLight(0xa9c6ee, 0.5, 8, 1.4);
nearFill.position.set(0, -0.2, 0.2);
camera.add(nearFill);

/* ----------------------------------------------------------- asset loading */
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, done, total) => {
  loadStatus.textContent = 'LOADING ENGINE / MODEL / AUDIO  [' + done + '/' + total + ']';
};
manager.onError = (url) => { console.warn('[MIRROR-9] asset failed:', url); };
manager.onLoad = () => markAssetsReady();
setTimeout(() => { if (!assetsReady) { assetsTimedOut = true; markAssetsReady(); } }, 9000);

function markAssetsReady() {
  if (assetsReady) return;
  assetsReady = true;
  startBtn.disabled = false;
  startLabel.textContent = 'ENTER CONTAINMENT CELL';
  loadStatus.textContent = assetsTimedOut
    ? 'ASSETS READY (SOME OPTIONAL ASSETS TIMED OUT — FALLBACK ACTIVE)'
    : 'ALL ASSETS READY · ' + (window.M9_LIB_MODE === 'cdn' ? 'CDN' : 'LOCAL') + ' MODULES';
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

const floorMat = concreteMaterial(9, 9, 0xa9a9a4);
const wallMat  = concreteMaterial(4, 2, 0x8d8d89);
const pillarMat = concreteMaterial(1, 3, 0x9b9b96);
const crateMat = new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.78, metalness: 0.35 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.72, emissive: 0x2a2000, emissiveIntensity: 0.4 });

/* --------------------------------------------------------------- the cell  */
const occluders = [];   // blocks observation ray + receives bullet impacts
const shootables = [];

function addBox(w, h, d, x, y, z, mat, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = !!opts.cast;
  m.receiveShadow = true;
  scene.add(m);
  if (opts.occlude !== false) occluders.push(m);
  shootables.push(m);
  return m;
}

function buildCell() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  shootables.push(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), wallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_H;
  ceiling.receiveShadow = true;
  scene.add(ceiling);
  shootables.push(ceiling);

  const half = ROOM / 2;
  addBox(ROOM, WALL_H, 0.6, 0, WALL_H / 2, -half, wallMat);
  addBox(ROOM, WALL_H, 0.6, 0, WALL_H / 2,  half, wallMat);
  addBox(0.6, WALL_H, ROOM, -half, WALL_H / 2, 0, wallMat);
  addBox(0.6, WALL_H, ROOM,  half, WALL_H / 2, 0, wallMat);

  // Structural pillars -- real cover that can break line of sight.
  const px = [-14, -5, 6, 15];
  const pz = [-13, -2, 9];
  for (const x of px) {
    for (const z of pz) {
      if (Math.abs(x) < 8 && Math.abs(z) < 4) continue;
      addBox(1.25, WALL_H, 1.25, x, WALL_H / 2, z, pillarMat, { cast: true });
    }
  }

  // Crates and low barriers.
  const crates = [[-9, 0.7, 2, 2.2, 1.4, 2.2], [11, 0.7, -6, 2.6, 1.4, 2.6],
                  [-17, 0.5, -8, 1.8, 1.0, 1.8], [16, 0.5, 13, 2.0, 1.0, 2.0],
                  [2, 0.5, -18, 2.4, 1.0, 1.6]];
  for (const [x, y, z, w, h, d] of crates) {
    addBox(w, h, d, x, y, z, crateMat, { cast: true });
  }

  // Hazard stripes around the containment pad.
  for (let i = -4; i <= 4; i++) {
    addBox(0.7, 0.02, 0.16, i * 1.05, 0.012, -14 + 3, stripeMat, { occlude: false });
  }

  // Emergency lighting: red pools keep the room readable without flattening it.
  const lampPositions = [[-16, 4.4, -16], [16, 4.4, -16], [-16, 4.4, 16], [16, 4.4, 16],
                         [0, 4.4, 0]];
  for (const [x, y, z] of lampPositions) {
    const l = new THREE.PointLight(0xff3a2a, 9, 20, 1.7);
    l.position.set(x, y, z);
    scene.add(l);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5a3c })
    );
    bulb.position.set(x, y, z);
    scene.add(bulb);
  }
  const centreLamp = new THREE.PointLight(0x9fb6d8, 6, 18, 1.8);
  centreLamp.position.set(0, 4.2, -6);
  scene.add(centreLamp);
}
buildCell();

/* ------------------------------------------------------- SCP-173 entity   */
let scp173 = null;
const entityVelocity = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _step = new THREE.Vector3();
const _target = new THREE.Vector3();

function dressEntity(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m || !m.isMeshStandardMaterial) return;
      if (m.name === 'Concrete_PBR_Rough09') {
        const c = tex.color.clone(); c.needsUpdate = true; c.repeat.set(2, 2);
        const n = tex.normal.clone(); n.needsUpdate = true; n.repeat.set(2, 2);
        const r = tex.rough.clone(); r.needsUpdate = true; r.repeat.set(2, 2);
        m.map = c; m.normalMap = n; m.roughnessMap = r;
        m.color.set(0xffffff);
        m.roughness = 0.9;
        m.normalScale = new THREE.Vector2(0.7, 0.7);
      }
      m.needsUpdate = true;
    });
  });
}

function buildFallbackEntity() {
  // GLTF failed -> high-detail assembly from BoxGeometry + CylinderGeometry,
  // concrete MeshStandardMaterial with roughness 0.9 (per spec).
  const g = new THREE.Group();
  g.name = 'SCP173_ProceduralFallback';
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8f8d86, roughness: 0.9, metalness: 0.02 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141313, roughness: 0.95 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x6a2418, roughness: 0.88 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  add(new THREE.CylinderGeometry(0.82, 0.88, 0.16, 32), concrete, 0, 0.08, 0);
  add(new THREE.BoxGeometry(1.0, 1.35, 0.66), concrete, 0, 0.85, 0);
  add(new THREE.BoxGeometry(1.35, 0.30, 0.70), concrete, 0, 1.50, 0);
  add(new THREE.CylinderGeometry(0.16, 0.19, 0.30, 20), concrete, 0, 1.72, 0.03);
  add(new THREE.BoxGeometry(0.62, 0.82, 0.58), concrete, 0, 2.16, 0.10, 0.14);
  add(new THREE.BoxGeometry(0.44, 0.26, 0.10), concrete, 0, 1.94, 0.38);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.16, 0.20, 0.06), dark, s * 0.14, 2.26, 0.40);
    add(new THREE.CylinderGeometry(0.16, 0.13, 0.62, 16), concrete, s * 0.72, 1.24, 0.10, 0.32, 0, s * 0.20);
    add(new THREE.CylinderGeometry(0.12, 0.09, 0.60, 16), concrete, s * 0.70, 0.76, 0.38, 0.55, 0, s * 0.06);
    add(new THREE.BoxGeometry(0.22, 0.12, 0.30), concrete, s * 0.68, 0.48, 0.58);
    for (let f = 0; f < 4; f++) {
      add(new THREE.CylinderGeometry(0.028, 0.019, 0.22, 8), concrete,
          s * 0.68 + (f - 1.5) * 0.055, 0.34, 0.72, 0.5);
    }
    add(new THREE.BoxGeometry(0.18, 0.28, 0.04), rust, s * 0.30, 2.14, 0.40, 0.14);
  }
  add(new THREE.BoxGeometry(0.20, 0.30, 0.04), rust, 0.13, 1.30, 0.35);
  for (const [x0, y0, z0, x1, y1, z1] of [[-0.3, 1.3, -0.3, -0.5, 1.5, -0.5],
                                          [0.3, 1.1, -0.3, 0.55, 1.25, -0.52]]) {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, a.distanceTo(b), 10),
      new THREE.MeshStandardMaterial({ color: 0x333230, roughness: 0.55, metalness: 0.65 }));
    cyl.position.copy(a).add(b).multiplyScalar(0.5);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    cyl.castShadow = true; g.add(cyl);
  }
  return g;
}

function installEntity(root) {
  scp173 = root;
  dressEntity(root);
  root.position.copy(SPAWN_ENTITY);
  scene.add(root);
  shootables.push(root);
}

const gltfLoader = new GLTFLoader(manager);
gltfLoader.load(
  './assets/models/SCP173.glb',
  (gltf) => { installEntity(gltf.scene); console.info('[MIRROR-9] GLB entity loaded'); },
  undefined,
  (err) => {
    console.warn('[MIRROR-9] GLB failed, using procedural fallback:', err);
    installEntity(buildFallbackEntity());
  }
);

/* ------------------------------------------------------------------ audio  */
function makeAudio(src, loop, volume) {
  const a = new Audio(src);
  a.loop = loop; a.volume = volume; a.preload = 'auto';
  a.load();
  return a;
}
const sounds = {
  scrape:    makeAudio('./assets/sounds/concrete_scrape.ogg', true, 0),
  alarm:     makeAudio('./assets/sounds/alarm.ogg', true, 0.10),
  neckSnap:  makeAudio('./assets/sounds/neck_snap.ogg', false, 0.95),
  gunshot:   makeAudio('./assets/sounds/gunshot.ogg', false, 0.55),
};
function playOneShot(key, volume) {
  try {
    const base = sounds[key];
    const a = base.cloneNode();
    a.volume = volume !== undefined ? volume : base.volume;
    a.play().catch(() => {});
  } catch (_) { /* audio is optional */ }
}
function startAmbience() {
  try { sounds.alarm.play().catch(() => {}); } catch (_) {}
  try { sounds.scrape.play().catch(() => {}); } catch (_) {}
}

/* --------------------------------------------------------------- controls  */
const controls = new PointerLockControls(camera, document.body);
const keys = { forward: false, backward: false, left: false, right: false, sprint: false };
const moveVelocity = new THREE.Vector3();
const moveDirection = new THREE.Vector3();

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = true; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = true; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'ShiftLeft': case 'ShiftRight': keys.sprint = true; break;
    case 'KeyF':
      flashlightOn = !flashlightOn;
      flashlight.visible = flashlightOn;
      nearFill.visible = flashlightOn;
      hudLight.textContent = flashlightOn ? 'ON' : 'OFF';
      showToast(flashlightOn ? 'FLASHLIGHT ON' : 'FLASHLIGHT OFF', 0.9);
      break;
  }
});
document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = false; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = false; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
    case 'ShiftLeft': case 'ShiftRight': keys.sprint = false; break;
  }
});

controls.addEventListener('unlock', () => {
  if (state === 'PLAYING') {
    state = 'PAUSED';
    pauseOverlay.classList.remove('hidden');
    sounds.scrape.volume = 0;
  }
});
controls.addEventListener('lock', () => {
  if (state === 'PAUSED') {
    state = 'PLAYING';
    pauseOverlay.classList.add('hidden');
    clock.getDelta(); // discard time spent paused
  }
});

/* ------------------------------------------------------------ blink cycle  */
let blinkPeriod = 10;
let blinkClock = blinkPeriod;
let blinkLeft = 0;
let toastTimer = null;

function showToast(msg, dur = 1.4) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), dur * 1000);
}

function updateBlink(delta) {
  if (blinkLeft > 0) {
    blinkLeft -= delta;
    if (blinkLeft <= 0) {
      blinkLeft = 0;
      isBlinking = false;
      blinkEl.classList.remove('closed');
    }
  } else {
    blinkClock -= delta;
    if (blinkClock <= 0) {
      blinkPeriod = 7 + Math.random() * 6;
      blinkClock = blinkPeriod;
      blinkLeft = 0.17;
      isBlinking = true;
      blinkEl.classList.add('closed');
      showToast('// BLINK REFLEX', 0.8);
    }
  }
  const ratio = Math.max(0, Math.min(1, 1 - blinkClock / blinkPeriod));
  blinkMeter.style.width = (ratio * 100).toFixed(1) + '%';
  hudBlink.textContent = isBlinking ? 'CLOSED' : (ratio > 0.82 ? 'IMMINENT' : 'STABLE');
  hudBlink.style.color = (isBlinking || ratio > 0.82) ? '#e8a33d' : '';
}

/* -------------------------------------------------------------- shooting   */
const decals = [];
const _up = new THREE.Vector3(0, 0, 1);
const _normal = new THREE.Vector3();

function spawnBulletHole(hit) {
  if (decals.length > 64) {
    const old = decals.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose(); old.mesh.material.dispose();
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
  playOneShot('gunshot', 0.55);
  muzzleEl.classList.remove('fire');
  void muzzleEl.offsetWidth;
  muzzleEl.classList.add('fire');
  crosshair.classList.add('fired');
  setTimeout(() => crosshair.classList.remove('fired'), 90);

  const flashLight = new THREE.PointLight(0xffd9a0, 3.2, 9, 1.5);
  flashLight.position.set(0.15, -0.12, -0.5);
  camera.add(flashLight);
  setTimeout(() => camera.remove(flashLight), 70);

  raycaster.setFromCamera(CENTRE, camera);
  const hits = raycaster.intersectObjects(shootables, true);
  if (hits.length) spawnBulletHole(hits[0]);
}

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || state !== 'PLAYING' || !controls.isLocked) return;
  fire();
});

/* ----------------------------------------------------------- state machine */
function resetRun() {
  camera.position.copy(SPAWN_PLAYER);
  camera.rotation.set(0, 0, 0);
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
  for (const d of decals) {
    scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose();
  }
  decals.length = 0;
}

startBtn.addEventListener('click', () => {
  if (!assetsReady) return;
  mainMenu.style.display = 'none';
  hud.classList.remove('hidden');
  resetRun();
  state = 'PLAYING';
  controls.lock();                       // must run inside the click gesture
  startAmbience();
  showToast('// CONTAINMENT BREACH — KEEP VISUAL CONTACT', 2.4);
  if (!loopStarted) {
    loopStarted = true;
    clock.start();
    requestAnimationFrame(loop);         // game loop starts on Start (spec)
  }
});

resumeBtn.addEventListener('click', () => { if (state === 'PAUSED') controls.lock(); });

restartBtn.addEventListener('click', () => {
  gameOver.classList.remove('active');
  resetRun();
  state = 'PLAYING';
  controls.lock();
  showToast('// RE-ENTERING CELL', 1.6);
});

function PlayerDeath() {
  if (state === 'DEAD') return;
  state = 'DEAD';
  playOneShot('neckSnap', 0.95);
  sounds.scrape.volume = 0;
  $('death-detail').textContent =
    'SURVIVED ' + survivalTime.toFixed(1) + ' s · SUBJECT BREACHED VISUAL CONTACT PERIMETER';
  gameOver.classList.add('active');
  if (controls.isLocked) controls.unlock();
}

/* ---------------------------------------------------------- movement step  */
function updatePlayer(delta) {
  const damping = Math.min(1, 10 * delta);
  moveVelocity.x -= moveVelocity.x * damping;
  moveVelocity.z -= moveVelocity.z * damping;

  moveDirection.z = Number(keys.forward) - Number(keys.backward);
  moveDirection.x = Number(keys.right) - Number(keys.left);
  moveDirection.normalize();

  const speed = WALK_SPEED * (keys.sprint ? 1.5 : 1);
  if (keys.forward || keys.backward) moveVelocity.z -= moveDirection.z * speed * delta * 10;
  if (keys.left || keys.right)       moveVelocity.x -= moveDirection.x * speed * delta * 10;

  controls.moveRight(-moveVelocity.x * delta);
  controls.moveForward(-moveVelocity.z * delta);

  const lim = ROOM / 2 - 1.1;
  camera.position.x = Math.max(-lim, Math.min(lim, camera.position.x));
  camera.position.z = Math.max(-lim, Math.min(lim, camera.position.z));
  camera.position.y = EYE_HEIGHT;
}

/* ---------------------------------------------- core observation mechanic  */
function updateEntity(delta) {
  if (!scp173) return;

  // 1) cast a ray from exact screen centre (0,0 NDC).
  raycaster.setFromCamera(CENTRE, camera);
  const entityHits = raycaster.intersectObject(scp173, true);
  let seen = entityHits.length > 0 && entityHits[0].distance < VIEW_DISTANCE;

  // 2) world geometry between the player and the entity breaks line of sight.
  if (seen) {
    const blockers = raycaster.intersectObjects(occluders, true);
    if (blockers.length && blockers[0].distance < entityHits[0].distance - 0.08) seen = false;
  }
  // 3) eyelids closed = not observed.
  if (isBlinking) seen = false;
  // 4) short activation grace at the start of a run.
  if (graceLeft > 0) { graceLeft -= delta; seen = true; }
  // 5) inside the final lunge envelope its own silhouette already covers the
  //    crosshair, so eye contact must not freeze it there -- otherwise the
  //    < 1.5 m termination could never be reached from any approach angle.
  if (Math.hypot(scp173.position.x - camera.position.x,
                 scp173.position.z - camera.position.z) < KILL_DISTANCE + 0.8) {
    seen = false;
  }

  isObserved = seen;
  _prev.copy(scp173.position);

  if (seen) {
    // OBSERVED -> frozen, velocity = 0
    entityVelocity.set(0, 0, 0);
    sounds.scrape.volume = Math.max(0, sounds.scrape.volume - delta * 1.5);
  } else {
    // UNOBSERVED -> Vector3.lerp toward the camera at deltaTime * 20,
    // with a physical max-speed clamp so the encounter is survivable.
    _target.set(camera.position.x, scp173.position.y, camera.position.z);
    scp173.position.lerp(_target, Math.min(delta * 20, 1));
    _step.subVectors(scp173.position, _prev);
    const maxStep = ENTITY_MAX_SPEED * delta;
    if (_step.length() > maxStep) {
      _step.setLength(maxStep);
      scp173.position.copy(_prev).add(_step);
    }
    entityVelocity.copy(_step).divideScalar(Math.max(delta, 1e-4));
    scp173.lookAt(camera.position.x, scp173.position.y, camera.position.z);
    sounds.scrape.volume = Math.min(0.42, sounds.scrape.volume + delta * 1.8);
  }

  const dx = scp173.position.x - camera.position.x;
  const dz = scp173.position.z - camera.position.z;
  const dist = Math.hypot(dx, dz);

  // HUD
  hudDist.textContent = dist.toFixed(1) + ' m';
  observeBadge.textContent = seen ? 'OBSERVED / FROZEN' : 'UNOBSERVED / MOVING';
  observeBadge.className = 'badge ' + (seen ? 'observed' : 'unseen');
  crosshair.classList.toggle('observed', seen);
  crosshair.classList.toggle('danger', !seen && dist < 5);

  if (dist < KILL_DISTANCE) PlayerDeath();
}

let hudAccum = 0;
function updateHud(delta) {
  hudAccum += delta;
  if (hudAccum < 0.1) return;
  hudAccum = 0;
  const t = Math.floor(survivalTime);
  hudTime.textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' +
                        String(t % 60).padStart(2, '0');
  hudAmmo.textContent = '∞ / ∞';
}

function updateDecals(delta) {
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    d.life -= delta;
    if (d.life < 2) d.mesh.material.opacity = Math.max(0, d.life / 2) * 0.92;
    if (d.life <= 0) {
      scene.remove(d.mesh);
      d.mesh.geometry.dispose(); d.mesh.material.dispose();
      decals.splice(i, 1);
    }
  }
}

/* ------------------------------------------------------------- game loop   */
function loop() {
  requestAnimationFrame(loop);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (state === 'PLAYING') {
    survivalTime += delta;
    updateBlink(delta);
    updatePlayer(delta);
    updateEntity(delta);
    updateHud(delta);
    updateDecals(delta);
  }
  renderer.render(scene, camera);

  // Headless / CI probe. Inert unless ?selftest=1 is present.
  if (window.__M9_SELFTEST) {
    const st = window.__M9_SELFTEST;
    st.frames++;
    st.state = state;
    st.observed = isObserved;
    st.entityLoaded = !!scp173;
    st.survival = Number(survivalTime.toFixed(2));
    if (scp173) {
      st.dist = Number(Math.hypot(scp173.position.x - camera.position.x,
                                  scp173.position.z - camera.position.z).toFixed(2));
    }
    if (state === 'DEAD') st.death = true;
    document.body.setAttribute('data-m9-selftest', JSON.stringify(st));
  }
}

/* ----------------------------------------------------------------- resize  */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

console.info('[MIRROR-9] engine initialised · mode=' + window.M9_LIB_MODE +
             ' · shadowMap=' + renderer.shadowMap.enabled);

/* ------------------------------------------------------------- CI probe    */
// ?selftest=1 boots the real game loop without requiring pointer lock, so a
// headless browser can verify the observation/kill mechanic end to end.
if (new URLSearchParams(location.search).get('selftest') === '1') {
  window.__M9_SELFTEST = {
    frames: 0, state: 'BOOT', observed: false, entityLoaded: false,
    dist: -1, survival: 0, death: false, shotsFired: 0, bulletHoles: 0,
  };
  mainMenu.style.display = 'none';
  hud.classList.remove('hidden');
  resetRun();
  graceLeft = 0.3;                 // shorten activation grace for CI only
  state = 'PLAYING';
  loopStarted = true;
  clock.start();
  // exercise the shooting path once without requiring pointer lock
  controls.isLocked = true;
  document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  controls.isLocked = false;
  window.__M9_SELFTEST.shotsFired = 1;
  window.__M9_SELFTEST.bulletHoles = decals.length;
  requestAnimationFrame(loop);
}
