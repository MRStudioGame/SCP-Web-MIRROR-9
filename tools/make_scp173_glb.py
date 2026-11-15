#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate assets/models/SCP173.glb -- a real, spec-compliant glTF 2.0 binary.

This is ORIGINAL procedural sculpture geometry (not a Sketchfab file).
The Sketchfab No.1 hit could not be downloaded (HTTP 401, see ASSET_MANIFEST.md),
so the game ships a genuinely loadable GLB instead of a placeholder or a
renamed foreign asset. Built from scratch: multi-part concrete sculpture with
PBR materials, per-vertex normals and UVs, indexed triangle primitives.
"""
import os
import json
import math
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "SCP173.glb")


# ------------------------------------------------------------------ vec math
def norm(v):
    l = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / l, v[1] / l, v[2] / l)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def mat_from_y_to(d):
    """3x3 rotation taking +Y onto unit vector d (Rodrigues)."""
    d = norm(d)
    up = (0.0, 1.0, 0.0)
    c = max(-1.0, min(1.0, dot(up, d)))
    if c > 0.999999:
        return ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    if c < -0.999999:
        return ((1, 0, 0), (0, -1, 0), (0, 0, -1))
    ax = norm(cross(up, d))
    s = math.sqrt(1.0 - c * c)
    t = 1.0 - c
    x, y, z = ax
    return ((t * x * x + c, t * x * y - s * z, t * x * z + s * y),
            (t * x * y + s * z, t * y * y + c, t * y * z - s * x),
            (t * x * z - s * y, t * y * z + s * x, t * z * z + c))


def apply(m, p, o=(0.0, 0.0, 0.0)):
    return (m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + o[0],
            m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + o[1],
            m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + o[2])


# ------------------------------------------------------------- mesh builders
class Part:
    def __init__(self, material):
        self.material = material
        self.p = []
        self.n = []
        self.u = []
        self.i = []

    def push(self, p, n, u):
        self.p.append(tuple(p))
        self.n.append(tuple(norm(n)))
        self.u.append(tuple(u))
        return len(self.p) - 1

    def tri(self, a, b, c):
        self.i += [a, b, c]


def sphere(part, center, radii, seg=36, rings=24, tilt=0.0, squash=None):
    """Ellipsoid with analytic normals; optional X-axis tilt."""
    rx, ry, rz = radii
    ct, st = math.cos(tilt), math.sin(tilt)
    grid = []
    for j in range(rings + 1):
        v = j / rings
        phi = v * math.pi
        row = []
        for k in range(seg + 1):
            u = k / seg
            th = u * math.tau
            x = math.sin(phi) * math.cos(th) * rx
            y = math.cos(phi) * ry
            z = math.sin(phi) * math.sin(th) * rz
            # tilted about X
            y2, z2 = y * ct - z * st, y * st + z * ct
            nx, ny, nz = x / (rx * rx), y / (ry * ry), z / (rz * rz)
            ny2, nz2 = ny * ct - nz * st, ny * st + nz * ct
            p = (center[0] + x, center[1] + y2, center[2] + z2)
            if squash:
                p = (p[0] * squash[0], p[1] * squash[1], p[2] * squash[2])
            row.append(part.push(p, (nx, ny2, nz2), (u, 1.0 - v)))
        grid.append(row)
    for j in range(rings):
        for k in range(seg):
            a, b, c, d = grid[j][k], grid[j + 1][k], grid[j + 1][k + 1], grid[j][k + 1]
            part.tri(a, c, b)
            part.tri(a, d, c)


def cone(part, p0, p1, r0, r1, seg=32, caps=True):
    """Tapered cylinder along an arbitrary axis."""
    axis = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
    h = math.sqrt(sum(c * c for c in axis)) or 1.0
    m = mat_from_y_to(axis)
    rings = []
    for t, r in ((0.0, r0), (1.0, r1)):
        row = []
        for k in range(seg + 1):
            u = k / seg
            th = u * math.tau
            local = (math.cos(th) * r, t * h, math.sin(th) * r)
            nl = (math.cos(th), 0.0, math.sin(th))
            row.append(part.push(apply(m, local, p0), apply(m, nl), (u, t)))
        rings.append(row)
    for k in range(seg):
        a, b = rings[0][k], rings[0][k + 1]
        c, q = rings[1][k], rings[1][k + 1]
        part.tri(a, q, b)
        part.tri(a, c, q)
    if caps:
        for t, r, row, sign in ((0.0, r0, rings[0], -1.0), (1.0, r1, rings[1], 1.0)):
            if r <= 0:
                continue
            centre = part.push((p0[0] + axis[0] * t, p0[1] + axis[1] * t,
                                p0[2] + axis[2] * t),
                               (axis[0] * sign, axis[1] * sign, axis[2] * sign), (0.5, 0.5))
            for k in range(seg):
                a = part.push(part.p[row[k]],
                              (axis[0] * sign, axis[1] * sign, axis[2] * sign),
                              (0.5 + 0.5 * math.cos(k / seg * math.tau),
                               0.5 + 0.5 * math.sin(k / seg * math.tau)))
                b = part.push(part.p[row[k + 1]],
                              (axis[0] * sign, axis[1] * sign, axis[2] * sign),
                              (0.5 + 0.5 * math.cos((k + 1) / seg * math.tau),
                               0.5 + 0.5 * math.sin((k + 1) / seg * math.tau)))
                if sign > 0:
                    part.tri(centre, b, a)
                else:
                    part.tri(centre, a, b)


def box(part, center, size):
    hx, hy, hz = (s / 2.0 for s in size)
    faces = [
        ((0, 0, 1), [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]),
        ((0, 0, -1), [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)]),
        ((1, 0, 0), [(hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz)]),
        ((-1, 0, 0), [(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)]),
        ((0, 1, 0), [(-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz)]),
        ((0, -1, 0), [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)]),
    ]
    uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
    for n, verts in faces:
        base = [part.push((center[0] + v[0], center[1] + v[1], center[2] + v[2]), n, uv)
                for v, uv in zip(verts, uvs)]
        part.tri(base[0], base[1], base[2])
        part.tri(base[0], base[2], base[3])


def lathe(part, profile, seg=40, center=(0, 0, 0)):
    """Surface of revolution; profile = [(y, radius), ...]."""
    grid = []
    for j, (y, r) in enumerate(profile):
        v = j / (len(profile) - 1)
        if j == 0:
            dy, dr = profile[1][0] - y, profile[1][1] - r
        elif j == len(profile) - 1:
            dy, dr = y - profile[j - 1][0], r - profile[j - 1][1]
        else:
            dy, dr = profile[j + 1][0] - profile[j - 1][0], profile[j + 1][1] - profile[j - 1][1]
        row = []
        for k in range(seg + 1):
            u = k / seg
            th = u * math.tau
            nx, nz = math.cos(th), math.sin(th)
            # surface normal from profile tangent: (radial*dy, -dr, radial*dy) style
            nn = norm((nx * dy, -dr, nz * dy))
            row.append(part.push((center[0] + nx * r, center[1] + y, center[2] + nz * r),
                                 nn, (u, 1.0 - v)))
        grid.append(row)
    for j in range(len(profile) - 1):
        for k in range(seg):
            a, b, c, d = grid[j][k], grid[j + 1][k], grid[j + 1][k + 1], grid[j][k + 1]
            part.tri(a, b, c)
            part.tri(a, c, d)


# --------------------------------------------------------------- build statue
MAT_CONCRETE, MAT_DARK, MAT_PAINT, MAT_REBAR = 0, 1, 2, 3
parts = [Part(i) for i in range(4)]
C, D, P, R = parts


def build():
    # --- concrete plinth
    cone(C, (0, 0.00, 0), (0, 0.14, 0), 0.82, 0.78, 48)
    box(C, (0, 0.075, 0), (1.70, 0.15, 1.20))

    # --- torso: tapered concrete mass
    lathe(C, [(0.14, 0.40), (0.30, 0.50), (0.58, 0.46), (0.86, 0.40),
              (1.10, 0.46), (1.36, 0.58), (1.54, 0.62), (1.66, 0.52),
              (1.74, 0.26), (1.78, 0.16)], 48)

    # --- neck + elongated forward-tilted head
    cone(C, (0, 1.72, 0.02), (0, 1.98, 0.05), 0.17, 0.15, 28)
    sphere(C, (0, 2.18, 0.10), (0.33, 0.44, 0.31), 40, 28, tilt=0.16)
    # jaw / chin mass
    sphere(C, (0, 1.96, 0.20), (0.24, 0.16, 0.22), 28, 18)

    # --- shoulders, arms, hands (signature long reaching pose)
    for s in (-1, 1):
        sphere(C, (s * 0.58, 1.52, 0.02), (0.24, 0.22, 0.24), 24, 18)
        elbow = (s * 0.76, 1.02, 0.14)
        wrist = (s * 0.70, 0.56, 0.46)
        cone(C, (s * 0.58, 1.50, 0.02), elbow, 0.17, 0.13, 24)
        sphere(C, elbow, (0.14, 0.14, 0.14), 18, 12)
        cone(C, elbow, wrist, 0.13, 0.10, 24)
        cone(C, wrist, (s * 0.68, 0.46, 0.60), 0.12, 0.11, 20)
        # fingers
        for f in range(4):
            off = (f - 1.5) * 0.055
            a = (s * 0.68 + off, 0.46, 0.60)
            b = (s * 0.68 + off * 1.2, 0.32 + f * 0.012, 0.74)
            cone(C, a, b, 0.030, 0.020, 10)
        # thumb
        cone(C, (s * 0.68 - 0.03, 0.47, 0.57),
             (s * 0.68 - 0.14, 0.40, 0.66), 0.038, 0.024, 10)

    # --- eye sockets + mouth fissure (dark recesses)
    for s in (-1, 1):
        sphere(D, (s * 0.135, 2.26, 0.375), (0.085, 0.105, 0.035), 20, 14)
    box(D, (0, 2.02, 0.395), (0.20, 0.035, 0.035))
    box(D, (0, 1.90, 0.375), (0.11, 0.020, 0.030))

    # --- rust / dried handprint marks
    sphere(P, (0.20, 2.34, 0.26), (0.10, 0.15, 0.045), 18, 12, tilt=0.16)
    sphere(P, (-0.25, 2.13, 0.22), (0.075, 0.12, 0.040), 16, 12)
    box(P, (0.13, 1.36, 0.57), (0.22, 0.30, 0.035))
    for s in (-1, 1):
        sphere(P, (s * 0.70, 0.50, 0.62), (0.11, 0.09, 0.05), 16, 12)

    # --- exposed rebar stubs
    for s, (x0, y0, z0, x1, y1, z1) in [
        (-1, (-0.32, 1.30, -0.28, -0.52, 1.46, -0.46)),
        (1, (0.34, 1.12, -0.30, 0.55, 1.24, -0.50)),
        (-1, (-0.20, 0.72, -0.34, -0.34, 0.60, -0.56)),
        (1, (0.22, 1.62, -0.10, 0.36, 1.80, -0.22)),
    ]:
        cone(R, (x0, y0, z0), (x1, y1, z1), 0.035, 0.028, 12)


# ------------------------------------------------------------- glTF assembly
def build_glb():
    blob = bytearray()
    views = []
    accessors = []

    def add_view(data, target):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(data)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target})
        return len(views) - 1

    def pack_floats(rows, width):
        return struct.pack("<" + "f" * (len(rows) * width), *[v for r in rows for v in r])

    def pack_uints(rows):
        flat = [int(v) for r in rows for v in r]
        return struct.pack("<" + "I" * len(flat), *flat)

    primitives = []
    for part in parts:
        if not part.i:
            continue
        pv = add_view(pack_floats(part.p, 3), 34962)
        nv = add_view(pack_floats(part.n, 3), 34962)
        uv = add_view(pack_floats(part.u, 2), 34962)
        iv = add_view(pack_uints([(x,) for x in part.i]), 34963)

        mn = [min(p[k] for p in part.p) for k in range(3)]
        mx = [max(p[k] for p in part.p) for k in range(3)]
        pi = len(accessors)
        accessors.append({"bufferView": pv, "componentType": 5126, "count": len(part.p),
                          "type": "VEC3", "min": mn, "max": mx})
        ni = len(accessors)
        accessors.append({"bufferView": nv, "componentType": 5126, "count": len(part.n), "type": "VEC3"})
        ui = len(accessors)
        accessors.append({"bufferView": uv, "componentType": 5126, "count": len(part.u), "type": "VEC2"})
        ai = len(accessors)
        accessors.append({"bufferView": iv, "componentType": 5125, "count": len(part.i), "type": "SCALAR"})
        primitives.append({"attributes": {"POSITION": pi, "NORMAL": ni, "TEXCOORD_0": ui},
                           "indices": ai, "material": part.material, "mode": 4})

    while len(blob) % 4:
        blob.append(0)

    def pbr(rgb, rough, metal=0.0):
        return {"pbrMetallicRoughness": {
            "baseColorFactor": list(rgb) + [1.0],
            "metallicFactor": metal, "roughnessFactor": rough},
            "doubleSided": False}

    gltf = {
        "asset": {"version": "2.0",
                  "generator": "MIRROR-9 procedural glTF pipeline (original geometry)"},
        "scene": 0,
        "scenes": [{"nodes": [0], "name": "MIRROR9"}],
        "nodes": [{"name": "SCP-173", "mesh": 0}],
        "meshes": [{"name": "SCP173_ConcreteSculpture", "primitives": primitives}],
        "materials": [
            dict(pbr((0.62, 0.61, 0.58), 0.9), name="Concrete_PBR_Rough09"),
            dict(pbr((0.055, 0.05, 0.048), 0.95), name="Recessed_Dark"),
            dict(pbr((0.36, 0.115, 0.065), 0.85), name="Oxide_Handprints"),
            dict(pbr((0.20, 0.19, 0.18), 0.55, 0.65), name="Exposed_Rebar"),
        ],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": views,
        "accessors": accessors,
    }

    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    out = (struct.pack("<III", 0x46546C67, 2, total) +
           struct.pack("<II", len(js), 0x4E4F534A) + js +
           struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    return out, gltf


if __name__ == "__main__":
    build()
    data, gltf = build_glb()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(data)
    verts = sum(len(p.p) for p in parts)
    tris = sum(len(p.i) // 3 for p in parts)

    # winding audit: geometric face normal must agree with the stored vertex normals
    ok = 0
    bad = 0
    for part in parts:
        for t in range(0, len(part.i), 3):
            i0, i1, i2 = part.i[t], part.i[t + 1], part.i[t + 2]
            p0, p1, p2 = part.p[i0], part.p[i1], part.p[i2]
            e1 = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
            e2 = (p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2])
            gn = cross(e1, e2)
            if sum(c * c for c in gn) < 1e-14:
                continue
            gn = norm(gn)
            vn = norm(tuple(sum(part.n[i][k] for i in (i0, i1, i2)) for k in range(3)))
            if dot(gn, vn) > 0:
                ok += 1
            else:
                bad += 1

    print("WROTE", OUT)
    print("  bytes      :", len(data))
    print("  vertices   :", verts)
    print("  triangles  :", tris)
    print("  primitives :", len(gltf["meshes"][0]["primitives"]))
    print("  materials  :", len(gltf["materials"]))
    print("  winding    : outward=%d inward=%d  RATIO=%.4f" % (ok, bad, ok / max(1, ok + bad)))
