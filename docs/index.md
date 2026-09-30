---
title: azurlane_spinepainting
permalink: /index.html
---

[![Test](https://github.com/ww-rm/azurlane_spinepainting/actions/workflows/test.yaml/badge.svg)](https://github.com/ww-rm/azurlane_spinepainting/actions/workflows/test.yaml)

这是碧蓝航线动态立绘资源仓库.

点击返回[网站首页](/).

---

## 在线预览

无需下载, 打开浏览器即可在线观看并交互查看仓库内所有舰娘的动态立绘.

- 预览入口: [/azurlane_spinepainting/player/index.html](/azurlane_spinepainting/player/index.html)
- 预览页面直接读取 `index.json` 与各舰娘资源文件, 无需后端服务.
- 支持能力:
  - 左侧列表按舰娘/皮肤/图层组织, 支持关键字搜索与"仅有资源"过滤.
  - 自动识别运行时动作 (待机/点击/技能等), 可切换播放.
  - 多图层立绘 (T/M/B/hx) 逐个切换查看.
  - 鼠标拖拽平移、滚轮缩放、一键重置视图.
  - 一键截图当前立绘为 PNG, 一键全屏.
  - 键盘快捷键: 空格播放/暂停, A/D 或 ←/→ 切换舰娘, R 重置视图, S 截图, H 收起侧栏, F 全屏, Esc 关闭弹窗.
  - 当前舰娘/皮肤/图层会写入 URL hash, 可直接分享定位链接.

---

## 获取资源索引

请求:

`/azurlane_spinepainting/index.json`

响应:

```json
{
    "<shipName>": {
        "chName": "<舰娘中文名>",
        "hxName[可选]": "<舰娘和谐名>",
        "skins": {
            "<skinName>": {
                "chName": "<皮肤中文名>",
                "spines": [
                    {
                        "skelName": "<skel文件名>",
                        "atlasName": "<atlas文件名>",
                        "pages": ["<png1文件名>", "<png2文件名>"]
                    }
                ]
            }
        }
    }
}
```

Pydantic 解析示例:

```python
class Spine(BaseModel):
    skelName: str
    atlasName: str
    pages: List[str]

class Skin(BaseModel):
    chName: str
    spines: List[Spine]

class Ship(BaseModel):
    chName: str
    hxName: Optional[str] = None
    skins: Dict[str, Skin]

class ShipData(BaseModel):
    root: Dict[str, Ship]
```

访问测试:

- [/azurlane_spinepainting/index.json](/azurlane_spinepainting/index.json)

## 加载资源文件

请求:

`/azurlane_spinepainting/<shipName>/<skinName>/<文件名>`

访问测试:

- [/azurlane_spinepainting/yanzhan/yanzhan_g/yanzhan_g.skel](/azurlane_spinepainting/yanzhan/yanzhan_g/yanzhan_g.skel)
- [/azurlane_spinepainting/yanzhan/yanzhan_g/yanzhan_g.atlas](/azurlane_spinepainting/yanzhan/yanzhan_g/yanzhan_g.atlas)
- [/azurlane_spinepainting/yanzhan/yanzhan_g/yanzhan_g.png](/azurlane_spinepainting/yanzhan/yanzhan_g/yanzhan_g.png)
