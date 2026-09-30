# azurlane_spinepainting

[![Test](https://github.com/ww-rm/azurlane_spinepainting/actions/workflows/test.yaml/badge.svg)](https://github.com/ww-rm/azurlane_spinepainting/actions/workflows/test.yaml)

这是碧蓝航线动态立绘资源仓库.

详细使用方法见页面 [https://ww-rm.github.io/azurlane_spinepainting/](https://ww-rm.github.io/azurlane_spinepainting/)

## 在线预览

无需下载, 打开浏览器即可在线观看并交互查看仓库内所有舰娘的动态立绘:

- 预览页面: [https://ww-rm.github.io/azurlane_spinepainting/player/index.html](https://ww-rm.github.io/azurlane_spinepainting/player/index.html)

预览页面为纯静态实现 (位于 `docs/player/`), 直接读取 `index.json` 与各舰娘 Spine 资源, 自带 Spine 3.8 官方运行库, 支持关键字搜索、动作切换、多图层切换、拖拽平移缩放、截图与全屏, 并可将当前定位写入 URL 便于分享.

## 本地运行

仓库根目录提供了 `start.bat`, **双击即可一键启动**:

- 自动拉起本地静态服务 (默认端口 `13383`), 并打开预览页;
- 优先使用 Python, 未安装则自动回退到 Node;
- 端口已被占用时直接打开页面, 不重复启动;
- 关闭命令行窗口即可停止服务.

也可以手动启动:

```bash
python -m http.server 13383 --directory docs --bind 127.0.0.1
# 然后访问 http://127.0.0.1:13383/player/index.html
```

注意: 直接双击 `docs/player/index.html` 以 `file://` 协议打开时, 多数浏览器会因 CORS 拒绝读取 `.skel` / `.atlas` / `.png` 资源, 导致立绘无法渲染, 因此建议通过上面的本地服务访问.

## 命令行渲染

需要将某个立绘渲染成图片 (例如交给其他 Agent 作为参考) 时, 不必手动截图, 直接使用渲染 CLI:

```bash
python tools/render_cli.py --ship yuekechengii --skin yuekechengii_2 --out yk.png
```

详见 [docs/render-cli.md](docs/render-cli.md).

## Acknowledgements

- [AzurLaneData](https://github.com/AzurLaneTools/AzurLaneData)
