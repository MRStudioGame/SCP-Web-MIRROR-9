#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pack a loose glTF (external .bin + .png) into a single spec-compliant GLB.

Used for the REAL open-source SCP-173 statue:

  Source : https://github.com/Yni-Viar/scp-173
           src/Assets/Models/Scp173Main/Statue.gltf (+ .bin + 3 PBR PNGs)
  Author : Yni Viar
  License: CC-BY 3.0 or later for the statue model (repository itself CC0-1.0)
           -> commercial use allowed WITH ATTRIBUTION (see ASSET_MANIFEST.md)

The upstream Sketchfab "Containment Breach" models are ripped / NC / require
login, so they are deliberately NOT used. This converter only repackages the
licensed community asset; it does not alter geometry or textures.
"""
import os
import sys
import json
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "_src173")
OUT = os.path.join(ROOT, "assets", "models", "scp-173.glb")


def align4(buf):
    while len(buf) % 4:
        buf.append(0)


def main():
    with open(os.path.join(SRC, "Statue.gltf"), "r", encoding="utf-8") as f:
        gltf = json.load(f)

    bin_data = bytearray()
    views = list(gltf.get("bufferViews", []))

    # ---- 1. inline the single geometry buffer -------------------------------
    for buf in gltf.get("buffers", []):
        uri = buf.pop("uri", None)
        if not uri:
            continue
        raw = open(os.path.join(SRC, os.path.basename(uri)), "rb").read()
        if len(raw) != buf["byteLength"]:
            raise ValueError("buffer length mismatch: %s (%d != %d)" %
                             (uri, len(raw), buf["byteLength"]))
        bin_data.extend(raw)
        buf["buffer"] = 0
    if len(gltf.get("buffers", [])) != 1:
        raise ValueError("expected exactly one geometry buffer")
    gltf["buffers"][0]["byteLength"] = len(bin_data)

    # ---- 2. inline every image as an extra bufferView ------------------------
    for img in gltf.get("images", []):
        uri = img.pop("uri", None)
        if not uri:
            continue
        raw = open(os.path.join(SRC, os.path.basename(uri)), "rb").read()
        if raw[:8] != b"\x89PNG\r\n\x1a\n" or b"IEND" not in raw[-16:]:
            raise ValueError("incomplete/corrupt PNG: " + uri)
        align4(bin_data)
        off = len(bin_data)
        bin_data.extend(raw)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(raw)})
        img["bufferView"] = len(views) - 1
        img.setdefault("mimeType", "image/png")
        print("  embedded %-38s %8d bytes" % (os.path.basename(uri), len(raw)))

    gltf["bufferViews"] = views
    align4(bin_data)
    gltf["buffers"][0]["byteLength"] = len(bin_data)

    # ---- 3. emit GLB (JSON chunk + BIN chunk) -------------------------------
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_data)
    out = (struct.pack("<III", 0x46546C67, 2, total) +
           struct.pack("<II", len(js), 0x4E4F534A) + js +
           struct.pack("<II", len(bin_data), 0x004E4942) + bytes(bin_data))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(out)

    print("WROTE", OUT)
    print("  bytes      :", len(out))
    print("  meshes     :", len(gltf.get("meshes", [])))
    print("  primitives :", sum(len(m.get("primitives", [])) for m in gltf.get("meshes", [])))
    print("  materials  :", len(gltf.get("materials", [])))
    print("  images     :", len(gltf.get("images", [])))
    print("  bufferViews:", len(views))
    return 0


if __name__ == "__main__":
    sys.exit(main())
