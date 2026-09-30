#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""碧蓝航线动态立绘渲染 CLI。

把 docs/player 的浏览器渲染能力封装为命令行工具，供其他 Agent / 脚本
直接获取某个舰娘皮肤的「最终合成渲染结果」，无需人工截图。

为什么必须走浏览器：
    仓库内的 .skel 为加密/混淆的二进制（文件头非标准 Spine 二进制），
    纯 Python 无法解析骨架与动画，只有官方 Spine 3.8 运行时能正确渲染。
    因此本工具驱动无头 Chrome 打开既有 player 页面，复用已实现的多层
    叠加、图层排序（T/M/B/hx）与视口并集逻辑，保证输出与肉眼看一致。

用法：
    python tools/render_cli.py --list
    python tools/render_cli.py --ship 约克城II --skin 白昼美人鱼
    python tools/render_cli.py --ship yuekechengii --skin yuekechengii_2 --out shot.png
    python tools/render_cli.py --ship 怨仇 --all-skins --out-dir out/
"""

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
PLAYER = os.path.join(DOCS, "player")
INDEX = os.path.join(DOCS, "index.json")
DEFAULT_PORT = 13383

CHROME_CANDIDATES = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
]


def log(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def die(msg, code=1):
    sys.stderr.write("[x] " + msg + "\n")
    sys.exit(code)


# ---------------- 索引 ----------------

def load_index():
    if not os.path.isfile(INDEX):
        die("找不到索引文件: %s" % INDEX)
    with open(INDEX, "rb") as fh:
        raw = fh.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("gbk", "replace")
    return json.loads(text)


def resolve(data, ship_q=None, skin_q=None):
    """按 key 或中文名/拼音模糊解析出 (ship_key, skin_key, chName, skinName)。"""
    ship_key = None
    if ship_q:
        if ship_q in data:
            ship_key = ship_q
        else:
            hits = [k for k, v in data.items()
                    if v.get("chName") == ship_q or ship_q in k]
            if not hits:
                die("未找到舰娘: %s（可用 --list 查看）" % ship_q)
            ship_key = hits[0]
    if not ship_key:
        return None

    ship = data[ship_key]
    skins = ship.get("skins") or {}
    if not skin_q:
        # 未指定皮肤 -> 取第一个
        skin_key = next(iter(skins), None)
        if not skin_key:
            die("舰娘 %s 没有可用皮肤" % ship_key)
        return ship_key, skin_key, ship.get("chName"), skins[skin_key].get("chName")

    if skin_q in skins:
        skin_key = skin_q
    else:
        hits = [k for k, v in skins.items() if v.get("chName") == skin_q or skin_q in k]
        if not hits:
            die("舰娘 %s 下未找到皮肤: %s（该舰娘有: %s）"
                % (ship.get("chName"), skin_q, ", ".join(skins.keys())))
        skin_key = hits[0]
    return ship_key, skin_key, ship.get("chName"), skins[skin_key].get("chName")


# ---------------- 本地服务 ----------------

def port_open(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.4)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def ensure_server(port):
    """确保 docs/ 静态服务在运行；已在跑则复用，否则拉起并返回进程。"""
    if port_open(port):
        return None
    if not shutil.which("python") and not shutil.which("python3"):
        die("需要 python 以启动本地静态服务")
    py = shutil.which("python") or shutil.which("python3")
    proc = subprocess.Popen(
        [py, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", DOCS],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    for _ in range(40):
        if port_open(port):
            return proc
        time.sleep(0.25)
    proc.kill()
    die("本地静态服务启动失败")
    return None


def find_chrome():
    for p in CHROME_CANDIDATES:
        if os.path.isfile(p):
            return p
    for name in ("chrome", "msedge", "google-chrome"):
        w = shutil.which(name)
        if w:
            return w
    return None


# ---------------- 渲染 ----------------

def build_url(port, ship_key, skin_key, bare=True):
    state = {"ship": ship_key, "skin": skin_key}
    url = "http://127.0.0.1:%d/player/index.html?bare=1#%s" % (
        port, urllib.parse.quote(json.dumps(state, ensure_ascii=False))
    )
    return url


def render(chrome, url, out_png, width=1500, height=950, wait=16000):
    """用无头 Chrome 打开 player 页面并截图。"""
    tmp = out_png
    cmd = [
        chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "--window-size=%d,%d" % (width, height),
        "--virtual-time-budget=%d" % wait,
        "--screenshot=%s" % tmp,
        url,
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=180)
    except subprocess.TimeoutExpired:
        die("渲染超时")

    if not os.path.isfile(tmp) or os.path.getsize(tmp) < 5000:
        die("渲染失败，未生成有效截图: %s" % tmp)
    return tmp


def crop_art(src, dst, quality=None):
    """裁掉左侧导航栏与控制栏，只保留立绘舞台区域。"""
    try:
        from PIL import Image
    except ImportError:
        shutil.copyfile(src, dst)
        return dst

    im = Image.open(src).convert("RGB")
    w, h = im.size
    left = int(w * 0.02)
    top = int(h * 0.02)
    right = int(w * 0.98)
    bottom = int(h * 0.98)
    im = im.crop((left, top, right, bottom))

    if dst.lower().endswith(".jpg") or dst.lower().endswith(".jpeg"):
        im.save(dst, "JPEG", quality=quality or 88, optimize=True, progressive=True)
    else:
        im.save(dst, "PNG", optimize=True)
    return dst


def spine_info(data, ship_key, skin_key):
    skin = data[ship_key]["skins"][skin_key]
    return {
        "ship": ship_key,
        "shipName": data[ship_key].get("chName"),
        "skin": skin_key,
        "skinName": skin.get("chName"),
        "layers": [s.get("skelName") for s in skin.get("spines", [])],
        "dir": "%s/%s/%s" % ("docs", ship_key, skin_key),
    }


def cmd_list(data):
    rows = []
    for k, v in data.items():
        skins = v.get("skins") or {}
        for sk, sv in skins.items():
            rows.append((v.get("chName"), k, sv.get("chName"), sk))
    log("共 %d 个舰娘 / %d 个皮肤" % (len(data), len(rows)))
    for ch, k, schn, sk in rows:
        log("  %-12s %-22s | %-24s %s" % (ch, k, schn, sk))


# ---------------- 主流程 ----------------

def main():
    ap = argparse.ArgumentParser(description="碧蓝航线动态立绘渲染 CLI")
    ap.add_argument("--ship", help="舰娘 key 或中文名，如 约克城II / yuekechengii")
    ap.add_argument("--skin", help="皮肤 key 或中文名，如 白昼美人鱼 / yuekechengii_2")
    ap.add_argument("--all-skins", action="store_true", help="渲染该舰娘全部皮肤")
    ap.add_argument("--out", help="输出图片路径（默认 out/<skin>.png）")
    ap.add_argument("--out-dir", default="out", help="输出目录，默认 out/")
    ap.add_argument("--width", type=int, default=1500)
    ap.add_argument("--height", type=int, default=950)
    ap.add_argument("--wait", type=int, default=16000, help="渲染等待毫秒")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--keep-ui", action="store_true", help="保留界面 UI，不裁剪")
    ap.add_argument("--list", action="store_true", help="列出全部舰娘与皮肤")
    ap.add_argument("--info", action="store_true", help="只输出资源信息不渲染")
    args = ap.parse_args()

    data = load_index()

    if args.list:
        cmd_list(data)
        return 0

    if not args.ship:
        ap.print_help()
        return 1

    chrome = find_chrome()
    if not chrome:
        die("未找到 Chrome/Edge 浏览器")

    targets = []
    if args.all_skins:
        ship_key = None
        if args.ship in data:
            ship_key = args.ship
        else:
            for k, v in data.items():
                if v.get("chName") == args.ship:
                    ship_key = k
                    break
        if not ship_key:
            die("未找到舰娘: %s" % args.ship)
        for sk in (data[ship_key].get("skins") or {}).keys():
            targets.append(resolve(data, ship_key, sk))
    else:
        targets.append(resolve(data, args.ship, args.skin))

    outdir = args.out_dir if not os.path.isabs(args.out_dir) else args.out_dir
    outdir = os.path.join(ROOT, outdir) if not os.path.isabs(outdir) else outdir
    if not os.path.isdir(outdir):
        os.makedirs(outdir)

    proc = ensure_server(args.port)
    try:
        results = []
        for ship_key, skin_key, chn, schn in targets:
            info = spine_info(data, ship_key, skin_key)
            if args.info:
                log(json.dumps(info, ensure_ascii=False, indent=2))
                results.append(info)
                continue

            url = build_url(args.port, ship_key, skin_key)
            log("[>] %s · %s  (%d 图层)" % (chn, schn, len(info["layers"])))

            tmp = os.path.join(tempfile.gettempdir(), "blhx_%s.png" % skin_key)
            render(chrome, url, tmp, args.width, args.height, args.wait)

            if args.out and len(targets) == 1:
                dst = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
            else:
                dst = os.path.join(outdir, "%s_%s.png" % (ship_key, skin_key))
            ddir = os.path.dirname(dst)
            if ddir and not os.path.isdir(ddir):
                os.makedirs(ddir)

            if args.keep_ui:
                shutil.copyfile(tmp, dst)
            else:
                crop_art(tmp, dst)
            try:
                os.remove(tmp)
            except OSError:
                pass

            info["render"] = dst
            info["url"] = url
            results.append(info)
            log("[v] -> %s (%d KB)" % (dst, os.path.getsize(dst) // 1024))

        if len(results) > 1 or args.info:
            meta = os.path.join(outdir, "meta.json")
            with open(meta, "w", encoding="utf-8") as fh:
                json.dump(results, fh, ensure_ascii=False, indent=2)
            log("[v] 元数据 -> %s" % meta)
        elif results:
            log(json.dumps(results[0], ensure_ascii=False))
        return 0
    finally:
        if proc:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
