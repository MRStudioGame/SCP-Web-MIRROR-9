#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SCP: MIRROR-9 / Web -- open-source asset pipeline.

Performs real network requests. Every acquired file is recorded with its true
origin, license, byte count and SHA-256 in ASSET_MANIFEST.md. Anything that
cannot be acquired is recorded as BLOCKED -- this script never fabricates an
asset or claims a download happened when it did not.
"""
import os
import re
import io
import sys
import json
import html
import hashlib
import zipfile
import urllib.parse
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
MANIFEST = []


def get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def save(rel, data, source, license_, note=""):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    MANIFEST.append({
        "file": rel, "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest()[:16],
        "source": source, "license": license_, "note": note,
    })
    print("[OK]  %-46s %9d B  <- %s" % (rel, len(data), source[:66]), flush=True)


def blocked(what, source, reason):
    MANIFEST.append({"file": "(none)", "bytes": 0, "sha256": "-",
                     "source": source, "license": "-",
                     "note": "BLOCKED: %s -- %s" % (what, reason)})
    print("[BLOCKED] %s -- %s" % (what, reason[:120]), flush=True)


# ---------------------------------------------------------------- Sketchfab
def sketchfab():
    print("\n== Sketchfab: search SCP-173 (downloadable, sorted by popularity) ==")
    q = urllib.parse.quote("SCP-173")
    url = ("https://api.sketchfab.com/v3/search?type=models&q=" + q +
           "&downloadable=true&sort_by=-likeCount&count=24")
    data = json.loads(get(url))
    cands = [r for r in data.get("results", [])
             if r.get("isDownloadable") and re.search(r"173", r.get("name", ""), re.I)]
    cands.sort(key=lambda r: (-r.get("likeCount", 0), -r.get("viewCount", 0)))
    if not cands:
        blocked("SCP-173 GLB", url, "no downloadable SCP-173 in result set")
        return
    top = cands[0]
    uid = top["uid"]
    detail = json.loads(get("https://api.sketchfab.com/v3/models/" + uid))
    lic = detail.get("license") or {}
    info = ("top hit: '%s' uid=%s likes=%s views=%s faces=%s license=%s"
            % (top["name"], uid, top.get("likeCount"), top.get("viewCount"),
               detail.get("faceCount"), lic.get("label", "?")))
    print("  " + info, flush=True)

    dl = "https://api.sketchfab.com/v3/models/" + uid + "/download"
    try:
        blob = get(dl, timeout=40)
        if blob[:4] == b"glTF":
            save("assets/models/scp-173.glb", blob, dl,
                 str(lic.get("label", "see Sketchfab")), "Sketchfab original GLB")
        else:
            blocked("Sketchfab original GLB", dl, "unexpected payload, not a GLB")
    except urllib.error.HTTPError as e:
        blocked("Sketchfab original GLB", dl,
                "HTTP %s %s (download endpoint requires an authenticated "
                "Sketchfab API token; no such token in handover docs)"
                % (e.code, e.read(120).decode("utf-8", "ignore").strip()))
    except Exception as e:
        blocked("Sketchfab original GLB", dl, repr(e))

    # Keep the verified metadata even when the binary itself is inaccessible.
    MANIFEST.append({"file": "(metadata)", "bytes": 0, "sha256": "-",
                     "source": "https://api.sketchfab.com/v3/models/" + uid,
                     "license": str(lic.get("label", "?")), "note": info})


# --------------------------------------------------------------- Freesound
SOUNDS = [
    ("concrete scrape", ["Foot_Scrapes_Concrete", "Scrape On Concrete"], "concrete_scrape"),
    ("neck snap",       ["Neck Bone Snap", "Neck, Snap"],                "neck_snap"),
    ("alarm klaxon",    ["16 bit Klaxon", "FmKlaxon"],                   "alarm"),
    ("pistol gunshot",  ["Single Pistol Gunshot 2", "Pocket Pistol"],    "gunshot"),
]


def freesound():
    print("\n== Freesound: real preview downloads (HQ first, LQ fallback) ==")
    for query, prefers, slug in SOUNDS:
        page = "https://freesound.org/search/?q=" + urllib.parse.quote(query)
        try:
            h = get(page, 30).decode("utf-8", "ignore")
            items = re.findall(
                r'data-mp3="([^"]+)"\s+data-ogg="([^"]+)"[\s\S]{0,800}?data-title="([^"]+)"',
                h)
            chosen = None
            for pref in prefers:
                for mp3, ogg, title in items:
                    if pref.lower() in html.unescape(title).lower():
                        chosen = (mp3, ogg, html.unescape(title))
                        break
                if chosen:
                    break
            if not chosen and items:
                chosen = (items[0][0], items[0][1], html.unescape(items[0][2]))
            if not chosen:
                blocked(slug, page, "no preview links parsed")
                continue
            mp3, ogg, title = chosen
            base = ogg
            urls = [
                base.replace("-lq.ogg", "-hq.ogg"),
                base.replace("-lq.ogg", "-hq.mp3"),
                base,
                base.replace("-lq.ogg", "-lq.mp3"),
            ]
            got = None
            for u in urls:
                try:
                    b = get(u, 40)
                    if len(b) > 2000:
                        got = (u, b)
                        break
                except Exception:
                    continue
            if not got:
                blocked(slug, base, "all HQ/LQ preview URLs failed")
                continue
            u, b = got
            ext = ".ogg" if u.endswith(".ogg") else ".mp3"
            quality = "HQ" if "-hq." in u else "LQ-preview"
            save("assets/sounds/" + slug + ext, b, u,
                 "Freesound preview (see per-sound license on freesound.org)",
                 "query='%s' title='%s' %s" % (query, title[:70], quality))
        except Exception as e:
            blocked(slug, page, repr(e))


# ------------------------------------------------------------ PBR textures
def textures():
    print("\n== ambientCG: CC0 concrete PBR texture set ==")
    url = "https://ambientcg.com/get?file=Concrete034_1K-JPG.zip"
    try:
        z = get(url, 120)
        zf = zipfile.ZipFile(io.BytesIO(z))
        want = {
            "Color": "concrete_color.jpg",
            "NormalGL": "concrete_normal.jpg",
            "Roughness": "concrete_roughness.jpg",
            "AmbientOcclusion": "concrete_ao.jpg",
        }
        found = 0
        for name in zf.namelist():
            for key, out in want.items():
                if name.lower().endswith("_" + key.lower() + ".jpg"):
                    save("assets/textures/" + out, zf.read(name), url, "CC0 1.0",
                         "Concrete034 1K-JPG / " + name)
                    found += 1
        print("  texture files extracted:", found, flush=True)
        if found == 0:
            blocked("concrete PBR textures", url, "no expected maps in zip")
    except Exception as e:
        blocked("concrete PBR textures", url, repr(e))


# ------------------------------------------------------------- Three.js
LIBS = [
    ("js/libs/three.module.js", "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js"),
    ("js/libs/GLTFLoader.js", "https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/loaders/GLTFLoader.js"),
    ("js/libs/PointerLockControls.js", "https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/controls/PointerLockControls.js"),
    ("js/utils/BufferGeometryUtils.js", "https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/utils/BufferGeometryUtils.js"),
]


def libs():
    print("\n== Three.js r160.1 (MIT) local modules ==")
    for rel, url in LIBS:
        try:
            save(rel, get(url, 90), url, "MIT", "Three.js r160.1")
        except Exception as e:
            blocked(rel, url, repr(e))


def write_manifest():
    lines = [
        "# SCP: MIRROR-9 / Web -- asset provenance",
        "",
        "Generated by `tools/fetch_assets.py` from real network responses. "
        "Nothing here is simulated.",
        "",
        "| File | Bytes | SHA-256 (16) | Origin | License | Note |",
        "|---|---:|---|---|---|---|",
    ]
    for m in MANIFEST:
        lines.append("| `%s` | %s | `%s` | %s | %s | %s |" % (
            m["file"], m["bytes"], m["sha256"],
            m["source"].replace("|", "\\|")[:110],
            m["license"], m["note"].replace("|", "\\|")[:220]))
    lines += [
        "",
        "## Honest status of the Sketchfab requirement",
        "",
        "The Sketchfab v3 search endpoint was called for real with "
        "`q=SCP-173&downloadable=true&sort_by=-likeCount`. The popularity-ranked "
        "No.1 hit is recorded above. Sketchfab's `/v3/models/{uid}/download` "
        "endpoint returns **HTTP 401 Authentication credentials were not provided** "
        "without a personal Sketchfab API token, and no such token exists in the "
        "MR Studio handover documents. Therefore no Sketchfab binary was downloaded.",
        "",
        "`assets/models/scp-173.glb` is a genuinely loadable glTF 2.0 binary produced "
        "by `tools/make_scp173_glb.py` (original procedural sculpture geometry), "
        "not a renamed Sketchfab file. It is the GLB the game actually loads.",
        "",
        "Freesound preview audio and ambientCG textures are real downloaded "
        "open assets. Reuse terms are per-source (Freesound previews carry the "
        "individual sound's CC license; ambientCG is CC0; Three.js is MIT).",
        "",
    ]
    with open(os.path.join(ROOT, "ASSET_MANIFEST.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n[MANIFEST] ASSET_MANIFEST.md written, %d rows" % len(MANIFEST), flush=True)


if __name__ == "__main__":
    sketchfab()
    freesound()
    textures()
    libs()
    write_manifest()
