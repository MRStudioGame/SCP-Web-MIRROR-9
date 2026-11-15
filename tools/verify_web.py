"""SCP: MIRROR-9 Web — 本地端到端自检。

启动本地静态服务器 + headless Edge，验证：
  0. 静态规格（全屏 / 画布 / 安全区 / 警告淡出 / 手电筒 / 射线判定 / 材质）
  1. 桌面正常启动（中文主菜单 / Start 可用 / 3D 背景）
  2. 桌面真实游戏循环（严格观测判定 / 人形模型 / 枪 / 弹痕 / 死亡结算）
  3. 移动端（横屏控件 / nipplejs 摇杆 / 触摸视角 / 移动 / 字幕）
  4. 撤离结算（60 秒协议 / 绿色光圈）
  5. 竖屏全屏提示
  6. CDN 模块路径
  7. 点击开始触发全屏 API
  8. 开源 humanoid.glb 加载路径
用法：python tools/verify_web.py [live_base_url]
"""
import functools
import html
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import tempfile
import threading
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"


def local_server():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *a: None
    srv = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, port


def http_ok(port):
    paths = [
        "index.html", "style.css", "js/main.js", "js/libs/three.module.js",
        "js/libs/GLTFLoader.js", "js/libs/PointerLockControls.js",
        "js/libs/nipplejs.min.js", "js/utils/BufferGeometryUtils.js",
        "assets/models/scp-173.glb", "assets/models/humanoid.glb",
        "assets/sounds/gunshot.ogg",
        "assets/sounds/neck_snap.ogg", "assets/sounds/alarm.ogg",
        "assets/sounds/concrete_scrape.ogg", "assets/textures/concrete_color.jpg",
        "assets/textures/concrete_normal.jpg", "assets/textures/concrete_roughness.jpg",
    ]
    bad = 0
    for p in paths:
        try:
            r = urllib.request.urlopen("http://127.0.0.1:%d/%s" % (port, p), timeout=12)
            data = r.read()
            print("  HTTP %d  %9d B  %s" % (r.status, len(data), p))
        except Exception as e:
            print("  FAIL", p, e)
            bad += 1
    return bad == 0


def static_checks():
    """不依赖浏览器的规格校验：确保所有硬性要求都真的写进了文件。"""
    h = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    c = open(os.path.join(ROOT, "style.css"), encoding="utf-8").read()
    j = open(os.path.join(ROOT, "js/main.js"), encoding="utf-8").read()
    checks = {
        "viewport 锁定缩放": "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" in h,
        "viewport-fit=cover": "viewport-fit=cover" in h,
        "canvas width:100vw": "width: 100vw" in c,
        "canvas height:100vh": "height: 100vh" in c,
        "canvas height:100dvh": "height: 100dvh" in c,
        "canvas overflow:hidden": "overflow: hidden" in c,
        "安全区 env(safe-area-inset)": c.count("env(safe-area-inset-") >= 4 and c.count("var(--sa") >= 15,
        "警告条 opacity:0 淡出": "#subtitle-bar.faded { opacity: 0; }" in c,
        "警告条 transition .5s": "transition: opacity .5s" in c,
        "警告文案存在": "警告：SCP-173 已突破收容。利用视线锁定它，并寻找出口。" in j,
        "警告 5 秒时长": "并寻找出口。', 5.0" in j,
        "全屏 API 调用": "requestFullscreen" in j and "enterFullscreen();" in j,
        "SpotLight 挂在 camera": "camera.add(flashlight)" in j,
        "camera 加入 scene": "scene.add(camera)" in j,
        "SpotLight 投射阴影": "flashlight.castShadow = true" in j,
        "SpotLight target 有效": "flashlight.target = flashlightTarget" in j and "camera.add(flashlightTarget)" in j,
        "每帧 Raycaster 中心射线": "raycaster.setFromCamera(CENTRE, camera)" in j and "intersectObject(scp173, true)" in j,
        "命中且 <60 才冻结": "if (intersects.length > 0 && intersects[0].distance < VIEW_DISTANCE)" in j,
        "只有 isObserved 才冻结": "if (isObserved) {" in j and "entityVelocity.set(0, 0, 0)" in j,
        "否则 lerp 追击": "scp173.position.lerp(_target, Math.min(delta * 20, 1))" in j,
        "矩阵先更新再射线": "camera.updateMatrixWorld(true)" in j and "scp173.updateMatrixWorld(true)" in j,
        "材质 0x777777 / roughness 0.9": "color: 0x777777, roughness: 0.9" in j,
        "Group + Box/Cylinder": "new THREE.Group()" in j and "new THREE.BoxGeometry" in j and "new THREE.CylinderGeometry" in j,
        "开源 humanoid 路径": "assets/models/humanoid.glb" in j,
    }
    # VIEW_DISTANCE 常量值必须是 60
    m = re.search(r"const VIEW_DISTANCE\s*=\s*(\d+)", j)
    checks["视距常量 = 60"] = bool(m and m.group(1) == "60")
    # 眨眼/保护期不得再覆盖观测判定
    checks["无 isBlinking 覆盖观测"] = "if (isBlinking) seen = false" not in j
    checks["无 grace 覆盖观测"] = "graceLeft" not in j
    return checks


def edge_dom(url, budget, window=None):
    cmd = [EDGE, "--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader",
           "--use-gl=angle", "--use-angle=swiftshader", "--no-first-run",
           "--no-default-browser-check", "--disable-extensions", "--no-sandbox",
           "--user-data-dir=" + tempfile.mkdtemp(prefix="m9v_"),
           "--virtual-time-budget=%d" % budget, "--dump-dom", url]
    if window:
        cmd.insert(1, "--window-size=%d,%d" % window)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=200)
        return r.stdout or ""
    except Exception as e:
        print("  EDGE_ERROR", e)
        return ""


def selftest(dom):
    m = re.search(r'data-m9-selftest="([^"]*)"', dom)
    if not m:
        return None
    return json.loads(html.unescape(m.group(1)))


def report(title, checks):
    print("  " + title)
    for k, v in checks.items():
        print("    %s %s" % ("PASS" if v else "FAIL", k))
    return all(checks.values())


def main():
    live = sys.argv[1] if len(sys.argv) > 1 else None
    srv, port = local_server()
    base = live or ("http://127.0.0.1:%d/index.html" % port)
    sep = "&" if "?" in base else "?"
    boot_url = base + sep + "probe=1"
    def url(q): return base + sep + q + "&probe=1"
    results = {}

    try:
        print("=== 0. 本地静态资源 ===")
        results["assets"] = http_ok(port)

        print("=== 0b. 静态规格校验 ===")
        try:
            results["static"] = report("static", static_checks())
        except Exception as e:
            print("  STATIC_ERROR", e)
            results["static"] = False

        print("=== 1. 桌面启动 / 中文主菜单 ===")
        d = edge_dom(boot_url, 5000)
        results["boot"] = report("boot", {
            "canvas 已创建": "<canvas" in d,
            "中文主菜单标题": "SCP:" in d and "MIRROR-9" in d,
            "中文开始按钮": "开始收容行动" in d,
            "开始按钮可用": not bool(re.search(r'id="start-btn"[^>]*disabled', d)),
            "中文剧情简介": "撑过 60 秒" in d,
            "竖屏提示存在": "请将手机横屏" in d,
            "无引擎故障": bool(re.search(r'id="boot-error" class="hidden"', d)),
            "中文 UI": all(x in d for x in ["存活时间", "撤离点", "手电筒", "开火"]),
        })

        print("=== 2. 桌面真实游戏循环 / 严格观测判定 / 死亡结算 ===")
        d = edge_dom(url("selftest=1"), 20000)
        st = selftest(d)
        if st:
            print("    STATE", json.dumps(st, ensure_ascii=False))
            results["loop"] = report("loop", {
                "帧循环运行": st["frames"] > 20,
                "173 实体已载入": st["entityLoaded"],
                "人形部件 > 90": st["humanoidParts"] > 90,
                "材质 0x777777 / 0.9": st["entityColor"] == "0x777777" and st["entityRoughness"] == 0.9,
                "枪械 ViewModel 已挂载": st["viewModel"],
                "开火 + 弹痕": st["shotsFired"] >= 1 and st["bulletHoles"] >= 1,
                "观测冻结分支命中": st.get("freezeFrames", 0) > 0,
                "未观测追击分支命中": st.get("chaseFrames", 0) > 0,
                "视距 = 60": st["viewDistance"] == 60,
                "手电筒是 camera 子对象": st["flashlightParent"] == "camera",
                "手电筒 target 挂 camera": st["flashlightTargetParent"] == "camera",
                "手电筒亮度已修正": st["flashlightIntensity"] > 2,
                "手电筒投射阴影": st["flashlightShadow"],
                "camera 在 scene 中": st["sceneHasCamera"],
                "逼近至致命距离": st["dist"] < 3,
                "死亡状态触发": st["death"],
                "死亡界面显示": bool(re.search(r'id="game-over" class="[^"]*active', d)),
                "死亡文案中文": "收容失效" in d,
            })
        else:
            print("    FAIL 未找到自检属性")
            results["loop"] = False

        print("=== 3. 移动端：摇杆 / 触摸视角 / 字幕 ===")
        d = edge_dom(url("touch=1&selftest=1"), 18000)
        st = selftest(d)
        if st:
            print("    STATE", json.dumps(st, ensure_ascii=False))
            results["mobile"] = report("mobile", {
                "触控层已显示": st["touchUI"],
                "nipplejs 摇杆已创建": st["joystickLib"] and st["nippleDom"],
                "摇杆驱动位移": st["posZ"] < 9.0,
                "右侧滑动改变 yaw": st.get("touchYawDelta", 0) > 0.1,
                "开火/手电按钮存在": 'id="btn-fire"' in d and 'id="btn-light"' in d,
                "剧情字幕已播放": "警告：SCP-173 已突破收容" in st["subtitle"] or "警告：SCP-173 已突破收容" in d,
                "菜单已隐藏": st["menuHidden"],
                "中文死亡文案": "收容失效" in d,
            })
        else:
            print("    FAIL 未找到自检属性")
            results["mobile"] = False

        print("=== 4. 撤离结算（60 秒协议 / 绿色光圈） ===")
        d = edge_dom(url("evac=1&selftest=1"), 12000)
        st = selftest(d)
        if st:
            print("    STATE", json.dumps(st, ensure_ascii=False))
            results["win"] = report("win", {
                "结算状态触发": st["win"],
                "结算文案": "收容成功，你活下来了" in d,
                "成功主题生效": bool(re.search(r'id="game-over" class="[^"]*win', d)),
                "注视期间保持冻结": st.get("freezeFrames", 0) > 0 and st.get("chaseFrames", 0) == 0,
            })
        else:
            print("    FAIL 未找到自检属性")
            results["win"] = False

        print("=== 5. 竖屏全屏提示 ===")
        d = edge_dom(url("touch=1"), 4500, window=(420, 820))
        results["portrait"] = report("portrait", {
            "body.portrait 生效": bool(re.search(r'<body class="[^"]*portrait', d)),
            "横屏提示文案": "请将手机横屏" in d,
        })

        print("=== 6. CDN 模块路径 ===")
        d = edge_dom(url("cdn=1"), 7000)
        results["cdn"] = report("cdn", {
            "canvas 已创建": "<canvas" in d,
            "中文菜单": "开始收容行动" in d,
            "开始按钮可用": not bool(re.search(r'id="start-btn"[^>]*disabled', d)),
            "无引擎故障": bool(re.search(r'id="boot-error" class="hidden"', d)),
        })

        print("=== 7. 点击开始触发全屏 API ===")
        d = edge_dom(url("autostart=1"), 6000)
        results["fullscreen"] = report("fullscreen", {
            "requestFullscreen 已调用": 'data-m9-fullscreen="requested"' in d,
            "主菜单已隐藏": bool(re.search(r'id="main-menu" style="[^"]*display:\s*none', d)),
            "无引擎故障": bool(re.search(r'id="boot-error" class="hidden"', d)),
        })

        print("=== 8. 开源 humanoid.glb 加载路径 ===")
        d = edge_dom(url("humanoid=1"), 9000)
        results["humanoid"] = report("humanoid", {
            "GLB 已加载并混凝土化": 'data-m9-humanoid="loaded"' in d,
            "canvas 已创建": "<canvas" in d,
            "无引擎故障": bool(re.search(r'id="boot-error" class="hidden"', d)),
        })

    finally:
        srv.shutdown()
        srv.server_close()

    print("\n=== 汇总 ===")
    for k, v in results.items():
        print("  %s %s" % ("PASS" if v else "FAIL", k))
    print("  ALL_PASS", all(results.values()))
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
