# -*- coding: utf-8 -*-
"""为本地预览生成内联索引数据。

用途
----
docs/player/index.html 默认通过 fetch 读取 ../index.json。
但浏览器在 file:// 协议下会拦截对本地 .json 的读取（同源策略），
导致直接双击打开页面时无法获得数据。

本脚本把 index.json 转换为两个纯 JavaScript 数据文件：

- docs/player/index.local.js  (ES5 变量，供 file:// 直接双击打开时使用)
- docs/player/index.embed.js  (JSON 变量，供本地服务 / Pages 场景加速首屏)

用法
----
    python tools/build-player-data.py

每次 index.json 更新后重新运行即可。
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
PLAYER = os.path.join(DOCS, "player")
SOURCE = os.path.join(DOCS, "index.json")


def log(message):
    sys.stdout.write(message + "\n")


def main():
    if not os.path.isfile(SOURCE):
        log("[x] 找不到索引文件: %s" % SOURCE)
        return 1

    with open(SOURCE, "rb") as fh:
        raw = fh.read()

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("gbk", "replace")

    try:
        data = json.loads(text)
    except ValueError as exc:
        log("[x] index.json 解析失败: %s" % exc)
        return 1

    if not os.path.isdir(PLAYER):
        os.makedirs(PLAYER)

    compact = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    ships = len(data)
    skins = sum(len(entry.get("skins") or {}) for entry in data.values())
    spines = sum(
        len(skin.get("spines") or [])
        for entry in data.values()
        for skin in (entry.get("skins") or {}).values()
    )

    header = (
        "/* 由 tools/build-player-data.py 自动生成，请勿手工修改。\n"
        " * 来源: docs/index.json\n"
        " * 舰娘 %d / 皮肤 %d / 立绘 %d\n"
        " */\n" % (ships, skins, spines)
    )

    local_path = os.path.join(PLAYER, "index.local.js")
    with open(local_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(header)
        fh.write("window.__SPINE_INDEX_LOCAL__ = ")
        fh.write(compact)
        fh.write(";\n")

    embed_path = os.path.join(PLAYER, "index.embed.js")
    with open(embed_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(header)
        fh.write("window.__SPINE_INDEX__ = ")
        fh.write(compact)
        fh.write(";\n")

    log("[v] 舰娘 %d / 皮肤 %d / 立绘 %d" % (ships, skins, spines))
    log("[v] %s (%.1f KB)" % (local_path, os.path.getsize(local_path) / 1024.0))
    log("[v] %s (%.1f KB)" % (embed_path, os.path.getsize(embed_path) / 1024.0))
    log("完成：现在可以直接双击 docs/player/index.html 浏览全部立绘。")
    return 0


if __name__ == "__main__":
    sys.exit(main())