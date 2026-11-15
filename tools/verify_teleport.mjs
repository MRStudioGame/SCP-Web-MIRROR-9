/* 直接抽取 js/main.js 中真实的 computeBehindCameraTarget 并执行，
   验证「相机背面落点 + 每次逼近 + 最终进入 1.5m 击杀范围」的收敛性。
   不复制算法，测的就是交付代码本身。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../js/libs/three.module.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(ROOT, 'js', 'main.js'), 'utf8');
const hit = src.match(/function computeBehindCameraTarget\(out\) \{[\s\S]*?\n\}/);
if (!hit) throw new Error('computeBehindCameraTarget not found in js/main.js');

const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 220);
camera.position.set(0, 1.7, 10);
camera.rotation.order = 'YXZ';
camera.rotation.set(0, 0.55, 0, 'YXZ');
camera.updateMatrixWorld(true);

const scp173Group = new THREE.Object3D();
scp173Group.position.set(8, 0, -14);

const scope = {
  THREE, Math, camera, scp173Group,
  KILL_DISTANCE: 1.5, TELEPORT_STEP: 1.9, ROOM: 44,
  _camFwd: new THREE.Vector3(), _camRight: new THREE.Vector3(), yaw: 0.55,
};
const compute = new Function(
  ...Object.keys(scope),
  hit[0] + '\nreturn computeBehindCameraTarget;'
)(...Object.values(scope));

const halfV = THREE.MathUtils.degToRad(camera.fov * 0.5);
const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();

const out = new THREE.Vector3();
let prev = Math.hypot(scp173Group.position.x - camera.position.x,
                     scp173Group.position.z - camera.position.z);
let minAngle = Math.PI, maxAngle = 0, steps = 0, killed = false, monotonic = true;

for (let i = 0; i < 30; i++) {
  compute(out);
  const dx = out.x - camera.position.x, dz = out.z - camera.position.z;
  const d = Math.hypot(dx, dz);
  const angle = Math.acos(THREE.MathUtils.clamp(
    (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-6), -1, 1));
  minAngle = Math.min(minAngle, angle);
  maxAngle = Math.max(maxAngle, angle);
  if (d > prev + 1e-6) monotonic = false;
  prev = d;
  scp173Group.position.copy(out);
  steps++;
  if (d < 1.5) { killed = true; break; }
}

console.log('halfH(deg)       =', (halfH * 180 / Math.PI).toFixed(2));
console.log('behind angle rng =', (minAngle * 180 / Math.PI).toFixed(2), '..',
            (maxAngle * 180 / Math.PI).toFixed(2), '(must be > 90deg = behind hemisphere)');
console.log('teleport steps   =', steps, 'to reach kill range 1.5m');
console.log('distance shrink monotonic =', monotonic);
console.log('kill triggered   =', killed);
const ok = minAngle > Math.PI / 2 && minAngle > halfH && monotonic && killed && steps <= 20;
console.log(ok ? 'TELEPORT_LOGIC_OK' : 'TELEPORT_LOGIC_FAIL');
process.exit(ok ? 0 : 1);
