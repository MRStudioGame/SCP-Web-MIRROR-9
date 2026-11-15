import re, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)
h = open('index.html', encoding='utf-8').read()
j = open('js/main.js', encoding='utf-8').read()
c = open('style.css', encoding='utf-8').read()
paths = set(re.findall(r'["\'](\./[^"\']+)["\']', h + j + c))
miss = 0
for p in sorted(paths):
    if not os.path.exists(p):
        print('MISSING', p); miss += 1
print('TOTAL_REFS', len(paths), 'MISSING', miss)
checks = {
    'FpsRig load': './assets/models/FpsRig.glb' in j,
    'Xbot load': './assets/models/Xbot.glb' in j,
    'reload anim': 'gunActions.reload' in j,
    'shoot anim': 'gunActions.shoot' in j,
    'ammo mag': 'MAG_SIZE' in j,
    'entity idle/walk/run': 'entityActions.idle' in j and 'entityActions.walk' in j and 'entityActions.run' in j,
    'entity hit proxy': 'SCP173_HitProxy' in j,
    'recoil state': 'recoil = 1' in j,
    'setGunState': 'setGunState' in j,
    'setEntityState': 'setEntityState' in j,
}
for k, v in checks.items():
    print(('PASS' if v else 'FAIL'), k)
print('STATIC_ALL', all(checks.values()))
