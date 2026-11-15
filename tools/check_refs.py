#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""静态自检：本地资源引用完整性 + 本轮四项重构需求的规格字面量。"""
import os
import re

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)

h = open('index.html', encoding='utf-8').read()
j = open('js/main.js', encoding='utf-8').read()
c = open('style.css', encoding='utf-8').read()
m = open('ASSET_MANIFEST.md', encoding='utf-8').read()

# ---------------------------------------------------------------- 引用完整性
paths = set(re.findall(r'["\'](\./[^"\']+)["\']', h + j + c))
miss = 0
for p in sorted(paths):
    if not os.path.exists(p):
        print('MISSING', p)
        miss += 1
print('TOTAL_REFS', len(paths), 'MISSING', miss)

checks = {
    # 一：真实开源 SCP-173 模型 + scp173Group 赋值 + 程序化雕像兜底
    'real SCP173.glb ref': './assets/models/SCP173.glb' in j,
    'GLTFLoader used': 'new GLTFLoader(manager)' in j,
    'scp173Group assignment': 'scp173Group = gltf.scene' in j,
    'procedural statue fallback': 'installEntity(buildSCP173())' in j,
    'concrete roughness 0.9': 'm.roughness = 0.9' in j and 'roughness: 0.9' in j,
    'CC-BY 3.0 attribution': 'CC-BY 3.0' in m,
    # 二：瞬移机制（禁止平移）
    'raycaster from centre': 'raycaster.setFromCamera(CENTRE, camera)' in j,
    'view distance 60': 'VIEW_DISTANCE' in j and 'intersects[0].distance < VIEW_DISTANCE' in j,
    'freeze has zero motion': 'teleportTimer = 0;' in j,
    'Clock deltaTime': 'clock.getDelta()' in j and 'new THREE.Clock' in j,
    '0.1s teleport timer': 'TELEPORT_INTERVAL  = 0.1' in j,
    'frustum blind spot': 'computeBlindSpotTarget' in j and 'halfH' in j,
    'position.copy teleport': 'position.copy(_teleportTarget)' in j,
    'no smooth lerp chase': 'position.lerp(_target)' not in j,
    'scrape sound per teleport': 'playConcreteScrape()' in j,
    'kill distance 1.5': 'KILL_DISTANCE      = 1.5' in j,
    'neck snap animation': 'updateDeathAnimation' in j and 'deathAnimT = 0' in j,
    # 三：武器 / 手电筒
    'gun under camera': 'camera.add(viewModel)' in j,
    'MathUtils.lerp recoil': 'THREE.MathUtils.lerp' in j and 'recoilKick' in j,
    'yellow muzzle PointLight': '0xffcc33' in j and 'MuzzleFlash_PointLight' in j,
    'MuzzleFlash mesh': "name = 'MuzzleFlash'" in j,
    '30 round magazine': 'MAG_SIZE = 30' in j,
    'R key reload': "case 'KeyR': startReload()" in j and 'function startReload()' in j,
    'flashlight is camera child': 'camera.add(flashlight)' in j and 'ensureFlashlightRig' in j,
    'flashlight castShadow': 'flashlight.castShadow = true' in j,
    'scene.add(camera)': 'scene.add(camera)' in j,
    # 四：移动端 UI
    'start game button': '开始游戏' in h and 'id="start-btn"' in h,
    'nipplejs joystick': 'nipplejs' in h and 'window.nipplejs' in j,
    'touchmove look': "'touchmove'" in j and 'initTouchLook' in j,
    'mobile reload button': 'btn-reload' in h and 'btn-reload' in j,
    'safe-area-inset': 'env(safe-area-inset-top' in c and 'viewport-fit=cover' in h,
    # 兼容原有能力（回归检查）
    'FpsRig load': './assets/models/FpsRig.glb' in j,
    'Xbot load': './assets/models/Xbot.glb' in j,
    'reload anim': 'gunActions.reload' in j,
    'shoot anim': 'gunActions.shoot' in j,
    'entity hit proxy': 'SCP173_HitProxy' in j,
    'setGunState': 'setGunState' in j,
    'setEntityState': 'setEntityState' in j,
}

for k, v in checks.items():
    print(('PASS' if v else 'FAIL'), k)
print('STATIC_ALL', all(checks.values()) and miss == 0)
