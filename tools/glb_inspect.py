#!/usr/bin/env python3
"""Inspect a glTF 2.0 binary (.glb): structure, meshes, skins, materials, animations."""
import sys, struct, json

def inspect(path):
    b = open(path, 'rb').read()
    magic, ver, total = struct.unpack('<III', b[:12])
    assert magic == 0x46546C67, 'not a GLB'
    off = 12
    json_chunk = bin_chunk = None
    while off < len(b):
        ln, ty = struct.unpack('<II', b[off:off+8]); off += 8
        data = b[off:off+ln]; off += ln
        if ty == 0x4E4F534A: json_chunk = data
        elif ty == 0x004E4942: bin_chunk = data
    g = json.loads(json_chunk)
    print(f'\n=== {path} ===')
    print(f'magic=GLB version={ver} declaredTotal={total} actual={len(b)}')
    print(f'generators: {g.get("asset",{}).get("generator")}')
    print(f'meshes={len(g.get("meshes",[]))} skins={len(g.get("skins",[]))} '
          f'animations={len(g.get("animations",[]))} materials={len(g.get("materials",[]))} '
          f'nodes={len(g.get("nodes",[]))}')
    # scene root nodes
    sc = g.get('scenes', [{}])[0]
    print('scene.nodes=', sc.get('nodes'))
    # mesh primitive counts + material names
    for i, m in enumerate(g.get('meshes', [])):
        mats = [p.get('material') for p in m.get('primitives', [])]
        print(f'  mesh[{i}] "{m.get("name")}" prims={len(m.get("primitives",[]))} mats={mats}')
    # materials
    for i, mat in enumerate(g.get('materials', [])):
        pbr = mat.get('pbrMetallicRoughness', {})
        base = pbr.get('baseColorFactor')
        mr = (pbr.get('metallicFactor'), pbr.get('roughnessFactor'))
        print(f'  mat[{i}] "{mat.get("name")}" base={base} metallicRough={mr} '
              f'doubleside={mat.get("doubleSided")}')
    # animations: name + channel count + sampler input/output
    for i, a in enumerate(g.get('animations', [])):
        ch = a.get('channels', [])
        # try to infer frame count from sampler inputs
        frames = '?'
        try:
            samp = a['samplers'][0]
            acc = g['accessors'][samp['input']]
            frames = acc['count']
        except Exception:
            pass
        # which nodes are targeted
        nodes = set()
        for c in ch:
            tn = c.get('target', {}).get('node')
            if tn is not None: nodes.add(tn)
        print(f'  anim[{i}] "{a.get("name")}" channels={len(ch)} frames~{frames} targetNodes={sorted(nodes)}')
    # skins -> skeleton joints
    for i, s in enumerate(g.get('skins', [])):
        print(f'  skin[{i}] joints={len(s.get("joints",[]))} inverseBindMatrices={s.get("inverseBindMatrices")}')

for p in sys.argv[1:]:
    try:
        inspect(p)
    except Exception as e:
        print(f'FAIL {p}: {e}')
