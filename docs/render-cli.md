# 动态立绘渲染 CLI

`tools/render_cli.py` 把预览页的渲染能力封装为命令行工具。其他 Agent 或脚本调用它，即可直接拿到某个舰娘皮肤的**最终合成渲染图**，无需人工打开浏览器截图。

## 为什么需要它

仓库里的资产是**散件图集**：一个立绘由多个 `.skel` 图层文件 + `.atlas` 图集 + 多张 PNG 页组成，且 `.skel` 为加密/混淆的二进制（文件头非标准 Spine 二进制）。

这意味着：

- 直接拼图集 PNG 得到的是散乱图元，**不是**完整立绘；
- 纯 Python 无法解析 skel 的骨架与动画；
- 只有官方 Spine 3.8 运行时能正确渲染，且需叠加全部图层、按 `T/M/B/hx` 排序。

因此本工具驱动无头 Chrome 打开既有 `docs/player` 页面，复用已实现的多层叠加与图层排序逻辑，保证输出与你肉眼在预览页看到的完全一致。

## 环境要求

- Python 3.8+（仅用到标准库 + Pillow）
- Chrome 或 Edge 任一（自动探测，无需安装 Playwright）
- 无头模式，不打扰你的正常浏览

## 本地服务

CLI 需要访问本地静态服务才能读取资源。仓库根目录的 `start.bat` 可一键启动（双击即可）：

- 服务地址 `http://127.0.0.1:13383`，根目录为 `docs/`
- 优先用 Python，未安装则回退 Node
- 端口已占用时直接复用，不重复启动

也可以手动启动，CLI 会自动复用已运行的服务：

```bash
python -m http.server 13383 --directory docs --bind 127.0.0.1
```

不要以 `file://` 协议直接打开页面，浏览器会因 CORS 拒绝读取 `.skel` / `.atlas` / `.png`。

## 用法

```bash
# 列出全部舰娘与皮肤（共 127 舰娘 / 141 皮肤）
python tools/render_cli.py --list

# 按中文名渲染指定皮肤
python tools/render_cli.py --ship 约克城II --skin 白昼美人鱼

# 按 key 渲染（推荐，避免中文编码问题）
python tools/render_cli.py --ship yuekechengii --skin yuekechengii_2 --out shot.png

# 渲染某舰娘的全部皮肤
python tools/render_cli.py --ship yuekechengii --all-skins --out-dir out/

# 只查看资源信息，不渲染
python tools/render_cli.py --ship yuekechengii --skin yuekechengii_2 --info
```

## 参数

| 参数 | 说明 |
| --- | --- |
| `--ship` | 舰娘 key 或中文名，如 `yuekechengii` / `约克城II` |
| `--skin` | 皮肤 key 或中文名，如 `yuekechengii_2` / `白昼美人鱼` |
| `--all-skins` | 渲染该舰娘全部皮肤 |
| `--out` | 输出图片路径，默认 `out/<skin>.png` |
| `--out-dir` | 输出目录，默认 `out/` |
| `--width` / `--height` | 渲染窗口尺寸，默认 1500x950 |
| `--wait` | 渲染等待毫秒，默认 16000（资源大时可增大） |
| `--port` | 本地服务端口，默认 13383 |
| `--keep-ui` | 保留界面 UI，不裁剪（默认输出纯净立绘） |
| `--list` | 列出全部舰娘与皮肤 |
| `--info` | 只输出资源信息，不渲染 |

## 输出

- 默认输出为**纯净立绘**：自动隐藏侧栏、标题、控制栏、HUD 等全部界面元素。
- 渲染结果保存为 PNG；批量模式会额外生成 `meta.json`，记录每个皮肤的图层构成与路径。
- 单个渲染时，命令行会打印一行 JSON，含舰娘名、皮肤名、图层列表、资源目录与输出路径，便于程序解析。

## bare 模式

工具通过给页面加 `?bare=1` 触发 `body.bare-mode`，由 CSS 隐藏全部 UI。相比按坐标裁剪，这种方式与窗口尺寸无关，任何分辨率下输出都干净。

相关样式位于 `docs/player/style.css` 末尾，如需调整隐藏范围可自行增删选择器。

## 示例：三个代表性皮肤

这三个覆盖了不同的图层组织方式：

### 约克城II · 白昼美人鱼

`yuekechengii_2T` + `yuekechengii_2B` 两层，验证背景层不会盖住人物。

```bash
python tools/render_cli.py --ship yuekechengii --skin yuekechengii_2 --out yk.png
```

### 怨仇 · 办公室的“意外”

`yuanchou_2` + `yuanchou_2_hx` 两层，含和谐层，按权重排在最后。

```bash
python tools/render_cli.py --ship yuanchou --skin yuanchou_2 --out yc.png
```

### 绫濑 · 兔子小姐的更衣时间

单层，但图集拆成 `linglai_2.png` 与 `linglai_22.png` 两张，验证单图层多图集页场景。

```bash
python tools/render_cli.py --ship linglai --skin linglai_2 --out ll.png
```

## 给 Agent 的调用建议

1. 先用 `--list` 或 `--info` 确认目标皮肤是否存在、有几个图层。
2. 优先用 **key** 而非中文名传参，避免 shell 编码问题（例如皮肤名含中文引号时）。
3. 批量任务用 `--all-skins` 配合 `--out-dir`，输出目录下的 `meta.json` 可直接读取。
4. 若渲染结果为空白或明显缺层，增大 `--wait` 后重试（大资源加载较慢）。

## 实现要点

- 自动拉起 `docs/` 静态服务（端口占用时复用已有服务，退出时清理自建进程）。
- 通过 URL hash 定位舰娘与皮肤，复用页面自身的定位逻辑。
- 复用 `fitUnionViewport()` 的视口并集与 `layerRank()` 的图层排序，确保多图层像素级对齐、叠放顺序正确。
- 无 Playwright / Selenium 依赖，仅需系统已有的 Chrome 或 Edge。
