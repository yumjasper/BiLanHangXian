/* 碧蓝航线动态立绘预览器
 * 依赖：./vendor/spine-player.js（Spine 3.8 官方 Web Player，内联 spine-core / spine-webgl）
 * 数据：../index.json
 */
(function () {
  "use strict";

var INDEX_URL = "../index.json";
  var LOCAL_DATA_URL = "./index.local.js";
  var UNAVAILABLE = "暂无数据";
  var WAIT_TIMEOUT = 20000;
  var IS_FILE = location.protocol === "file:";
  var DATA_STATE = "loading";

  var ANIM_ALIASES = [
    { re: /^(normal|idle|default|stand|loop)$/i, name: "待机" },
    { re: /^(touch|special|click|reaction|interact)/i, name: "点击" },
    { re: /^(login|home|main|start)/i, name: "登录" },
    { re: /^(attack|fire|shoot|battle|skill)/i, name: "攻击" },
    { re: /^(die|dead|death)/i, name: "战损" },
    { re: /^(win|victory)/i, name: "胜利" },
    { re: /^(exp|express|smile|happy|angry|sad|shy)/i, name: "表情" }
  ];

  var dom = {
    app: document.getElementById("app"),
    sidebar: document.getElementById("sidebar"),
    openSidebar: document.getElementById("openSidebar"),
    closeSidebar: document.getElementById("closeSidebar"),
    search: document.getElementById("search"),
    clearSearch: document.getElementById("clearSearch"),
    chips: document.getElementById("chips"),
    listMeta: document.getElementById("listMeta"),
    listHint: document.getElementById("listHint"),
    shipList: document.getElementById("shipList"),
    canvasHost: document.getElementById("canvasHost"),
    empty: document.getElementById("empty"),
    crumbs: document.getElementById("crumbs"),
    hud: document.getElementById("hud"),
    skinStrip: document.getElementById("skinStrip"),
    btnPrevShip: document.getElementById("btnPrevShip"),
    btnNextShip: document.getElementById("btnNextShip"),
    btnToggle: document.getElementById("btnToggle"),
    btnReset: document.getElementById("btnReset"),
    btnShot: document.getElementById("btnShot"),
    btnFull: document.getElementById("btnFull"),
    btnAnims: document.getElementById("btnAnims"),
    animLabel: document.getElementById("animLabel"),
    animPanel: document.getElementById("animPanel"),
    animList: document.getElementById("animList"),
    btnSpines: document.getElementById("btnSpines"),
    spineLabel: document.getElementById("spineLabel"),
spinePanel: document.getElementById("spinePanel"),
    spineList: document.getElementById("spineList"),
sideHint: document.getElementById("sideHint"),
    localNotice: document.getElementById("localNotice"),
    localNoticeClose: document.getElementById("localNoticeClose"),
    toast: document.getElementById("toast")
  };

  var state = {
    ships: [],
    visible: [],
    activeChip: "all",
    keyword: "",
    shipKey: null,
    skinKey: null,
    spineIdx: 0,
    player: null,
    token: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    pointers: {},
    pinchDist: 0,
    pinchZoom: 1,
    lastPan: null,
    renderer: null,
    players: [],
    readyCount: 0,
    baseX: 0,
    baseY: 0,
    baseZoom: 1,
    anims: [],
    decisions: {},
    saved: null,
    toastTimer: 0,
    failedSkels: {}
  };

  /* ---------------- 通用工具 ---------------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

function pretty(name) {
    return String(name).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  }

function updateSideHint(isError) {
    if (!dom.sideHint) return;
    if (isError) {
      dom.sideHint.textContent = "数据未就绪";
      return;
    }
    if (DATA_STATE === "local") {
      dom.sideHint.textContent = "本地直开 · 已内联索引";
    } else if (DATA_STATE === "inline") {
      dom.sideHint.textContent = "本地服务 · 已内联索引";
    } else if (IS_FILE) {
      dom.sideHint.textContent = "本地直开模式";
    } else {
      dom.sideHint.textContent = "婚礼白 · 本地画廊";
    }
  }

  function updateLocalNotice() {
    if (!dom.localNotice) return;
    dom.localNotice.hidden = !(IS_FILE && DATA_STATE === "local");
  }

  function animLabel(name) {
    for (var i = 0; i < ANIM_ALIASES.length; i++) {
      if (ANIM_ALIASES[i].re.test(name)) return ANIM_ALIASES[i].name;
    }
    return pretty(name);
  }

function layerLabel(name, skinKey) {
    var base = String(name).replace(/\.skel$/i, "").replace(/^.*\//, "");
    var m = /^(.*?)_?(T|M|B|hx)$/i.exec(base);
    if (!m) return null;
    var suffix = m[2].toUpperCase();
    suffix = suffix === "HX" ? "和谐" : suffix;
    var skin = String(skinKey || "").replace(/_/g, "").toLowerCase();
    var stemLower = m[1].replace(/_/g, "").toLowerCase();
    var rest = m[1].replace(/_/g, "");
    if (skin && stemLower.indexOf(skin) === 0) rest = rest.slice(skin.length);
    rest = rest.replace(/[0-9]+$/, "");
    return rest ? pretty(rest) + " · " + suffix : suffix;
  }

  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("is-open");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      dom.toast.classList.remove("is-open");
    }, 2400);
  }

  function saveState() {
    state.saved = {
      ship: state.shipKey,
      skin: state.skinKey,
      spine: state.spineIdx,
      chip: state.activeChip,
      kw: state.keyword
    };
    try {
      history.replaceState(null, "", "#" + encodeURIComponent(JSON.stringify(state.saved)));
    } catch (err) {
      /* 忽略地址栏写入失败 */
    }
  }

  /* ---------------- 相机：缩放与平移 ---------------- */
  /* 注意：spine-player 的 drawFrame 每帧都会用 currentViewport 重算相机，
     直接改 camera 会被覆盖，因此这里统一改写 currentViewport。 */

  function eachPlayer(fn) {
    var list = state.players && state.players.length ? state.players : state.player ? [state.player] : [];
    list.forEach(function (p) {
      try {
        fn(p);
      } catch (err) {
        /* 忽略 */
      }
    });
  }

  function captureBase() {
    var p = state.player || (state.players && state.players[0]);
    if (!p) return;
    state.lastPan = null;
    var cv = p.config && p.config.viewport;
    if (cv && typeof cv.x === "number" && cv.width > 0) {
      state.baseViewport = {
        x: cv.x,
        y: cv.y,
        width: cv.width,
        height: cv.height,
        padLeft: cv.padLeft || 0,
        padRight: cv.padRight || 0,
        padBottom: cv.padBottom || 0,
        padTop: cv.padTop || 0
      };
    } else if (p.currentViewport) {
      var vp = p.currentViewport;
      state.baseViewport = {
        x: vp.x - (vp.padLeft || 0),
        y: vp.y - (vp.padBottom || 0),
        width: vp.width + (vp.padLeft || 0) + (vp.padRight || 0),
        height: vp.height + (vp.padBottom || 0) + (vp.padTop || 0),
        padLeft: vp.padLeft || 0,
        padRight: vp.padRight || 0,
        padBottom: vp.padBottom || 0,
        padTop: vp.padTop || 0
      };
    }
  }

  function applyTransform() {
    var base = state.baseViewport;
    if (!base) return;
    eachPlayer(function (p) {
      var vp = p.currentViewport;
      if (!vp) return;
      var pl = vp.padLeft || 0;
      var pr = vp.padRight || 0;
      var pb = vp.padBottom || 0;
      var pt = vp.padTop || 0;
      var w = base.width / state.zoom;
      var h = base.height / state.zoom;
      var cx = base.x + base.width / 2 + state.panX;
      var cy = base.y + base.height / 2 + state.panY;
      vp.width = w - pl - pr;
      vp.height = h - pb - pt;
      vp.x = cx - w / 2 + pl;
      vp.y = cy - h / 2 + pb;
    });
  }

  function viewMetrics() {
    var base = state.baseViewport;
    if (!base) return null;
    var host = dom.canvasHost;
    var cw = host.clientWidth || 1;
    var ch = host.clientHeight || 1;
    var vw = base.width / state.zoom;
    var vh = base.height / state.zoom;
    /* 播放器以 contain 等比适配视口到画布 (scale 取小值, 居中绘制) */
    var s = Math.min(cw / vw, ch / vh);
    return { cw: cw, ch: ch, wpp: 1 / s };
  }

  function visibleCenter() {
    var base = state.baseViewport;
    return {
      x: base.x + base.width / 2 + state.panX,
      y: base.y + base.height / 2 + state.panY
    };
  }

  function applyZoomAt(factor, origin) {
    var base = state.baseViewport;
    if (!base) return;
    var next = Math.max(0.3, Math.min(5, state.zoom * factor));
    if (Math.abs(next - state.zoom) < 0.001) return;
    var m0 = viewMetrics();
    var c0 = visibleCenter();
    /* 光标下的世界坐标 (屏幕 y 向下, 世界 y 向上) */
    var wx = c0.x + (origin.x - m0.cw / 2) * m0.wpp;
    var wy = c0.y - (origin.y - m0.ch / 2) * m0.wpp;
    state.zoom = next;
    var m1 = viewMetrics();
    /* 缩放后让同一世界坐标仍停留在光标下 */
    var cx = wx - (origin.x - m1.cw / 2) * m1.wpp;
    var cy = wy + (origin.y - m1.ch / 2) * m1.wpp;
    state.panX = cx - (base.x + base.width / 2);
    state.panY = cy - (base.y + base.height / 2);
    applyTransform();
  }

  function panBy(dx, dy) {
    var m = viewMetrics();
    if (!m) return;
    state.panX -= dx * m.wpp;
    state.panY += dy * m.wpp;
    applyTransform();
  }

  function resetView(silent) {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    applyTransform();
    if (!silent) toast("视图已重置");
  }

  /* ---------------- 舞台交互 ---------------- */

  function bindStageInteractions() {
    var host = dom.canvasHost;

    function relative(event) {
      var rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function pointerDistance() {
      var ids = Object.keys(state.pointers);
      if (ids.length < 2) return 0;
      var a = state.pointers[ids[0]];
      var b = state.pointers[ids[1]];
      var dx = a.x - b.x;
      var dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function pointerCenter() {
      var ids = Object.keys(state.pointers);
      var a = state.pointers[ids[0]];
      var b = state.pointers[ids[1]];
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
      };
    }

    /* 滚轮缩放：捕获阶段拦截，防止播放器内部处理 */
    host.addEventListener(
      "wheel",
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        applyZoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, relative(event));
      },
      { passive: false, capture: true }
    );

    /* 按下在 host 上；移动/抬起在 window 上：即使指针移出画布也持续拖动 */
    host.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var point = relative(event);
      state.pointers[event.pointerId] = point;
      var ids = Object.keys(state.pointers);
      if (ids.length >= 2) {
        state.dragging = false;
        state.pinchDist = pointerDistance();
        state.pinchZoom = state.zoom;
      } else {
        state.dragging = true;
        host.classList.add("is-grabbing");
      }
      try {
        host.setPointerCapture(event.pointerId);
      } catch (err) {
        /* 忽略 */
      }
      event.preventDefault();
      event.stopPropagation();
    }, true);

    window.addEventListener("pointermove", function (event) {
      if (!state.pointers[event.pointerId]) return;
      var current = relative(event);
      state.pointers[event.pointerId] = current;
      var ids = Object.keys(state.pointers);

      if (ids.length >= 2) {
        var dist = pointerDistance();
        if (state.pinchDist > 0 && dist > 0) {
          var target = Math.max(0.3, Math.min(5, (state.pinchZoom * dist) / state.pinchDist));
          if (Math.abs(target - state.zoom) > 0.001) {
            applyZoomAt(target / state.zoom, pointerCenter());
          }
        }
        event.preventDefault();
        return;
      }

      if (!state.dragging) return;
      var prev = state.lastPan || current;
      panBy(current.x - prev.x, current.y - prev.y);
      state.lastPan = current;
      event.preventDefault();
    }, { passive: false });

    function endPointer(event) {
      if (!state.pointers[event.pointerId]) return;
      delete state.pointers[event.pointerId];
      state.lastPan = null;
      var ids = Object.keys(state.pointers);
      if (!ids.length) {
        state.dragging = false;
        host.classList.remove("is-grabbing");
      } else {
        state.dragging = true;
        state.pinchDist = 0;
      }
      try {
        host.releasePointerCapture(event.pointerId);
      } catch (err) {
        /* 忽略 */
      }
    }

    window.addEventListener("pointerup", endPointer, true);
    window.addEventListener("pointercancel", endPointer, true);
    host.addEventListener("dblclick", function () {
      resetView();
    });
    host.addEventListener("dragstart", function (event) {
      event.preventDefault();
    });
  }

  /* ---------------- 数据：索引 / 筛选 / 列表 ---------------- */

function loadIndex() {
    var inline = window.__SPINE_INDEX__;
    if (inline && typeof inline === "object" && Object.keys(inline).length) {
      DATA_STATE = "inline";
      return Promise.resolve(inline);
    }
    if (IS_FILE) {
      var local = window.__SPINE_INDEX_LOCAL__;
      if (local && typeof local === "object" && Object.keys(local).length) {
        DATA_STATE = "local";
        return Promise.resolve(local);
      }
      DATA_STATE = "blocked";
      return Promise.reject(new Error("本地直开模式下浏览器禁止读取 index.json"));
    }
    return fetch(INDEX_URL, { cache: "no-cache" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      DATA_STATE = "fetch";
      return response.json();
    });
  }

  function buildShips(root) {
    return Object.keys(root)
      .map(function (key) {
        var entry = root[key] || {};
        var skins = Object.keys(entry.skins || {}).map(function (skinKey) {
          var skin = entry.skins[skinKey] || {};
          return {
            key: skinKey,
            chName: skin.chName || UNAVAILABLE,
            spines: skin.spines || []
          };
        });
        var directories = skins.filter(function (skin) {
          return skin.spines.length > 0;
        }).length;
        return {
          key: key,
          chName: entry.chName || UNAVAILABLE,
          hxName: entry.hxName || "",
          skins: skins,
          spineCount: skins.reduce(function (sum, skin) {
            return sum + skin.spines.length;
          }, 0),
          available: directories > 0,
          haystack: (key + " " + (entry.chName || "") + " " + (entry.hxName || "")).toLowerCase()
        };
      })
      .sort(function (a, b) {
        return a.key.localeCompare(b.key, "en");
      });
  }

  function filterShips() {
    var items = state.ships.slice();
    if (state.activeChip === "has") {
      items = items.filter(function (ship) {
        return ship.available;
      });
    }
    var keyword = state.keyword.trim().toLowerCase();
    if (keyword) {
      items = items.filter(function (ship) {
        return ship.haystack.indexOf(keyword) >= 0;
      });
    }
    return items;
  }

  function getShip(shipKey) {
    for (var i = 0; i < state.ships.length; i++) {
      if (state.ships[i].key === shipKey) return state.ships[i];
    }
    return null;
  }

  function getSkin(ship, skinKey) {
    if (!ship || !skinKey) return null;
    for (var i = 0; i < ship.skins.length; i++) {
      if (ship.skins[i].key === skinKey) return ship.skins[i];
    }
    return null;
  }

  function pickSpine(skin) {
    if (!skin || !skin.spines.length) return null;
    var list = skin.spines;
    for (var i = 0; i < list.length; i++) {
      if (/_hx\.skel$/i.test(list[i].skelName)) return list[i];
    }
    for (var j = 0; j < list.length; j++) {
      if (/T\.skel$/i.test(list[j].skelName)) return list[j];
    }
    return list[0];
  }

  function decide(ship) {
    if (state.decisions[ship.key]) return state.decisions[ship.key];
    var chosen = null;
    if (state.saved && state.saved.ship === ship.key) {
      var restored = getSkin(ship, state.saved.skin);
      if (restored && restored.spines.length) chosen = restored;
    }
    if (!chosen) {
      for (var i = 0; i < ship.skins.length; i++) {
        if (ship.skins[i].spines.length) {
          chosen = ship.skins[i];
          break;
        }
      }
    }
    var decision = { skin: chosen, spine: pickSpine(chosen) };
    state.decisions[ship.key] = decision;
    return decision;
  }

  function renderChips() {
    clear(dom.chips);
    var chips = [
      { key: "all", label: "全部 " + state.ships.length },
      {
        key: "has",
        label:
          "有资源 " +
          state.ships.filter(function (ship) {
            return ship.available;
          }).length
      }
    ];
    chips.forEach(function (chip) {
      var btn = el("button", "chip" + (chip.key === state.activeChip ? " is-active" : ""), chip.label);
      btn.type = "button";
      btn.addEventListener("click", function () {
        state.activeChip = chip.key;
        renderChips();
        applyFilter();

        /* bare 模式：供 CLI 自动化渲染，隐藏全部 UI 只留立绘 */
        if (/[?&]bare=1/.test(location.search)) {
          document.body.classList.add("bare-mode");
        }
        initWeddingFx();

        updateSideHint(false);
        updateLocalNotice();
        saveState();
      });
      dom.chips.appendChild(btn);
    });
  }

  function renderList() {
    clear(dom.shipList);
    var items = state.visible;
    if (!items.length) {
      var empty = el("div", "list-empty");
      empty.style.whiteSpace = "pre-line";
      empty.textContent = "没有匹配的资源\n可以试试舰娘名、皮肤名或目录名";
      dom.shipList.appendChild(empty);
      dom.listMeta.textContent = "0 位舰娘";
      dom.listHint.textContent = "";
      return;
    }

    var fragment = document.createDocumentFragment();
    items.forEach(function (ship, shipIdx) {
      var decision = decide(ship);
      var btn = el("button", "ship" + (ship.key === state.shipKey ? " is-active" : ""));
      btn.type = "button";
      btn.dataset.key = ship.key;
      btn.style.setProperty("--i", Math.min(shipIdx, 20));

var thumbBox = el("div", "thumb-box");
      var initial = String(ship.chName || ship.key || "?").trim().slice(0, 1);
      if (decision.spine && decision.skin) {
        var img = el("img", "ship-thumb");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        img.src = "../" + ship.key + "/" + decision.skin.key + "/" + decision.spine.pages[0];
        img.addEventListener("error", function () {
          if (img.parentNode) img.parentNode.removeChild(img);
        });
        thumbBox.appendChild(img);
      }
      thumbBox.appendChild(el("div", "thumb-ph", initial));
      btn.appendChild(thumbBox);

      var info = el("div", "ship-info");
      info.appendChild(el("div", "ship-name", ship.chName + (ship.hxName ? " · " + ship.hxName : "")));
      info.appendChild(el("div", "ship-sub", ship.key));
      btn.appendChild(info);

      var badge = el("div", "ship-badge", ship.available ? String(ship.spineCount) : "—");
      badge.title = ship.available ? ship.spineCount + " 组立绘文件" : "仓库中暂无该舰娘的立绘文件";
      btn.appendChild(badge);

      btn.addEventListener("click", function () {
        selectShip(ship.key);
      });
      fragment.appendChild(btn);
    });
    dom.shipList.appendChild(fragment);

    dom.listMeta.textContent = items.length + " 位舰娘";
    dom.listHint.textContent =
      items.filter(function (ship) {
        return ship.available;
      }).length + " 位有资源";
  }

  function applyFilter() {
    state.visible = filterShips();
    renderList();
    updateNav();
  }

  /* ---------------- 播放器装配 ---------------- */

  function collectAssetErrors(list) {
    var names = [];
    (list || []).forEach(function (p) {
      try {
        var errs = p.assetManager && p.assetManager.getErrors ? p.assetManager.getErrors() : null;
        if (errs) {
          Object.keys(errs).forEach(function (key) {
            var val = errs[key];
            var detail = val && val.message ? val.message : typeof val === "object" ? JSON.stringify(val) : String(val);
            var line = key + (detail ? " (" + detail + ")" : "");
            if (names.indexOf(line) < 0) names.push(line);
          });
        }
      } catch (err) {
        /* 忽略 */
      }
    });
    return names;
  }

  function whenReady(token) {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      var errorSince = 0;
      (function poll() {
        if (token !== state.token) {
          reject(new Error("superseded"));
          return;
        }
        var list = state.players && state.players.length ? state.players : state.player ? [state.player] : [];
        var player = state.player;
        if (!list.length) {
          setTimeout(poll, 60);
          return;
        }
        // 单层解析失败时由运行库 error 回调触发降级重载 (swapBrokenLayer),
        // 这里只负责网络类资产错误的容忍与整体就绪判定
        var assetErrors = collectAssetErrors(list).filter(function (line) {
          return line.indexOf("could not load skeleton") < 0;
        });
        if (assetErrors.length) {
          // 容忍 1 秒内的瞬时错误 (快速切换时上一次请求被中断是正常现象),
          // 若随后加载恢复则继续等待; 持续报错才判定失败
          if (!errorSince) errorSince = Date.now();
          if (Date.now() - errorSince > 1000) {
            reject(new Error("资源加载失败：" + assetErrors.join("；")));
            return;
          }
          setTimeout(poll, 60);
          return;
        }
        errorSince = 0;
        var broken = null;
        for (var j = 0; j < list.length; j++) {
          if (list[j].__parseFailed || !(list[j].skeleton && list[j].animationState)) { broken = list[j]; break; }
        }
        var allDone = true;
        for (var i = 0; i < list.length; i++) {
          if (!(list[i].assetManager && list[i].assetManager.isLoadingComplete())) {
            allDone = false;
            break;
          }
        }
        if (allDone && broken) {
          // 资产全部下载完成但仍缺骨架: 该层解析失败, 走降级流程
          swapBrokenLayer(broken, token);
          reject(new Error("superseded"));
          return;
        }
        if (allDone && !broken) {
          fitUnionViewport();
          captureBase();
          applyTransform();
          if (player) resolve(player);
          else reject(new Error("资源解析失败"));
          return;
        }
        if (Date.now() - started > WAIT_TIMEOUT) {
          reject(new Error("加载超时"));
          return;
        }
        setTimeout(poll, 60);
      })();
    });
  }

  function swapBrokenLayer(player, token) {
    // 找到解析失败层对应的图层项
    var layers = state.currentSpineLayers || [];
    var failedItem = null;
    for (var i = 0; i < layers.length; i++) {
      if (layers[i] && player.config && player.config.skelUrl &&
          player.config.skelUrl.indexOf(layers[i].skelName) >= 0) {
        failedItem = layers[i];
        break;
      }
    }
    var failedName = failedItem ? failedItem.skelName : "?";
    state.failedSkels[failedName] = true;
    var stem = String(failedName).replace(/\.skel$/i, "").replace(/_hx$/i, "");

    // 优先切换到同组互斥变体 (_hx / 基础层)
    var swap = null;
    var isHx = /_hx\.skel$/i.test(failedName);
    for (var k = 0; k < layers.length; k++) {
      var it = layers[k];
      if (!it) continue;
      var itStem = String(it.skelName).replace(/\.skel$/i, "").replace(/_hx$/i, "");
      if (itStem === stem && /_hx\.skel$/i.test(it.skelName) === !isHx) { swap = it; break; }
    }
    if (swap && !state.failedSkels[swap.skelName]) {
      toast("「" + (layerLabel(failedName) || failedName) + "」解析失败，已切换为替代图层");
      // 仅替换 state.currentSpineLayers 中的该项后整体重载
      state.currentSpineLayers = layers.map(function (it) {
        var itStem = String((it && it.skelName) || "").replace(/\.skel$/i, "").replace(/_hx$/i, "");
        return itStem === stem ? swap : it;
      });
      loadCurrent(0);
      return;
    }

    // 无可用替代变体: 剔除该层, 渲染其余图层 (只剩一层时剔除后为空, 才整页报错)
    var remaining = layers.filter(function (it) {
      return it && String(it.skelName) !== failedName;
    });
    if (remaining.length) {
      toast("「" + (layerLabel(failedName) || failedName) + "」无法解析，已跳过该图层");
      state.currentSpineLayers = remaining;
      loadCurrent(0);
      return;
    }
    showLoadError("该立绘的骨架文件无法解析（" + failedName + "），文件可能已损坏");
  }

  function destroyOne(player) {
    if (!player) return;
    try {
      player.stopRequestAnimationFrame = true;
    } catch (err) {
      /* 忽略 */
    }
    var container = player.parent;
    if (container && container.parentNode) container.parentNode.removeChild(container);
    // 不主动 dispose GL 资源: 后台标签页 rAF 被暂停时, 已排队的 drawFrame 会在
    // 资源释放后恢复执行, 触发 "bindTexture: deleted object" 等崩溃; 移除 DOM 后交给 GC
  }

  function destroyPlayer() {
    var list = state.players || [];
    for (var i = 0; i < list.length; i++) destroyOne(list[i]);
    state.players = [];
    state.player = null;
    state.renderer = null;
    state.readyCount = 0;
    state.errored = 0;
  }

  function fitUnionViewport() {
    var list = state.players || [];
    if (!list.length) return;
    var ready = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].skeleton && list[i].skeleton.data) ready.push(list[i]);
    }
    if (ready.length !== list.length) return;

    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    ready.forEach(function (p) {
      var d = p.skeleton.data;
      x1 = Math.min(x1, d.x);
      y1 = Math.min(y1, d.y);
      x2 = Math.max(x2, d.x + d.width);
      y2 = Math.max(y2, d.y + d.height);
    });
    var vw = x2 - x1, vh = y2 - y1;
    if (!(vw > 0) || !(vh > 0)) return;

    ready.forEach(function (p) {
      p.config.viewport = {
        x: x1,
        y: y1,
        width: vw,
        height: vh,
        padLeft: 0,
        padRight: 0,
        padTop: 0,
        padBottom: 0,
        transitionTime: 0.0001
      };
    });
  }

  function makeOne(container, base, spineItem, token) {
    return new spine.SpinePlayer(container, {
      skelUrl: base + spineItem.skelName,
      atlasUrl: base + spineItem.atlasName,
      showControls: false,
      alpha: true,
      backgroundColor: "#00000000",
      fullScreenBackgroundColor: "#00000000",
      premultipliedAlpha: true,
      defaultMix: 0.25,
      success: function (player) {
        if (token !== state.token || !player) return;
        state.readyCount = (state.readyCount || 0) + 1;
        if (!state.renderer && player.sceneRenderer) state.renderer = player.sceneRenderer;
        fitUnionViewport();
        captureBase();
        applyTransform();
      },
      error: function (reason) {
        if (token !== state.token || !player) return;
        var msg = String(reason || "");
        // 运行库在骨架解析失败时每帧都会重调 showError, 这里只打标记,
        // 由 whenReady 轮询检测 broken 层后统一走 swapBrokenLayer 降级
        if (msg.indexOf("could not load skeleton") >= 0) {
          player.__parseFailed = true;
          return;
        }
        showLoadError("资源加载失败：" + msg);
      }
    });
  }

function layerRank(item) {
    var name = String((item && item.skelName) || "").replace(/\.[^.]+$/, "").replace(/_hx$/i, "");
    if (/T$/i.test(name)) return 3;
    if (/M$/i.test(name)) return 1;
    if (/B$/i.test(name)) return 0;
    return 2;
  }

  function buildRenderLayers(spines, selectedSkel) {
    // _hx (和谐) 层是对应基础层的替代版本而非叠加层;
    // 同屏渲染两个相同骨架会引发视口竞态与解析失败, 每组只保留一个变体:
    // 用户选中该组时用选中变体, 否则用基础层 (无基础层时回退和谐层)
    var selStem = String(selectedSkel || "").replace(/\.skel$/i, "").replace(/_hx$/i, "");
    var groups = {};
    var order = [];
    (spines || []).forEach(function (item) {
      if (!item) return;
      var isHx = /_hx\.skel$/i.test(item.skelName);
      var stem = String(item.skelName).replace(/\.skel$/i, "").replace(/_hx$/i, "");
      if (!groups[stem]) {
        groups[stem] = { base: null, hx: null };
        order.push(stem);
      }
      if (isHx) {
        if (!groups[stem].hx) groups[stem].hx = item;
      } else {
        if (!groups[stem].base) groups[stem].base = item;
      }
    });
    var result = [];
    order.forEach(function (stem) {
      var g = groups[stem];
      if (stem === selStem && g.hx && /_hx\.skel$/i.test(String(selectedSkel || ""))) {
        result.push(g.hx);
      } else {
        result.push(g.base || g.hx);
      }
    });
    return result.filter(Boolean);
  }

  function startPlayer(token) {
    var base = "../" + state.shipKey + "/" + state.skinKey + "/";
    var layers =
      state.currentSpineLayers && state.currentSpineLayers.length
        ? state.currentSpineLayers
        : [state.currentSpine];
    if (!layers.length || !layers[0]) return;

    destroyPlayer();
    state.players = [];
    resetView(true);

    var ordered = layers.filter(Boolean).slice().sort(function (a, b) {
      return layerRank(a) - layerRank(b);
    });

    ordered.forEach(function (item, index) {
      var container = el("div", "layer");
      container.style.position = "absolute";
      container.style.inset = "0";
      container.style.zIndex = String(index + 1);
      dom.canvasHost.appendChild(container);
      var p = makeOne(container, base, item, token);
      state.players.push(p);
      if (index === 0) state.player = p;
    });
  }

  function showLoadError(message) {
    var old = dom.canvasHost.querySelectorAll(".load-error-overlay");
    for (var i = 0; i < old.length; i++) {
      if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
    }
    var box = el("div", "spine-player-error load-error-overlay", message + "（点击此处重试）");
    box.title = "点击重试";
    box.style.cursor = "pointer";
    box.style.position = "absolute";
    box.style.inset = "0";
    box.style.zIndex = "6";
    box.addEventListener("click", function () {
      loadCurrent(0);
    });
    dom.canvasHost.appendChild(box);
    toast(message);
  }

  function onPlayerReady(player) {
    var animations = (player.skeleton.data.animations || []).map(function (anim) {
      return anim.name;
    });
    state.anims = animations;

    var preferred = pickIdleAnimation(animations);

    if (preferred) {
      try {
        player.setAnimation(preferred);
        player.config.animation = preferred;
      } catch (err) {
        /* 忽略 */
      }
      dom.animLabel.textContent = animLabel(preferred);
    } else {
      dom.animLabel.textContent = "无动作";
    }

    /* 默认自动播放：加载完成后立即播放待机动作 */
    player.paused = false;
    eachPlayer(function (p) { p.play(); });
    dom.btnToggle.textContent = "⏸";
    dom.btnToggle.classList.add("is-active");

    resetView(true);
    renderAnimList(preferred);
    renderHud(player);
    renderCrumbs();
    updateNav();
    dom.empty.classList.add("is-hidden");

    /* 婚礼白动效：立绘入场浮现 + 金光迸发 */
    if (!document.body.classList.contains("bare-mode")) {
      var host = dom.canvasHost;
      var layers = host ? host.querySelectorAll(".layer") : [];
      for (var li = 0; li < layers.length; li++) {
        var layer = layers[li];
        layer.style.animation = "none";
        void layer.offsetWidth;
        layer.style.animation = "";
      }
      playBurst();
    }
  }

  var LOAD_RETRY_MAX = 2;

  function loadCurrent(retryCount) {
    var retries = retryCount || 0;
    var token = ++state.token;
    renderCrumbs();
    renderSkinStrip();
    closePopups();
    return Promise.resolve()
      .then(function () {
        if (token !== state.token) return null;
        startPlayer(token);
        return whenReady(token);
      })
      .then(function (player) {
        if (!player) return;
        onPlayerReady(player);
      })
      .catch(function (err) {
        if (state.token !== token) return;
        if (err && err.message === "superseded") return;
        // 资源加载偶发失败 (本地服务瞬时 404/连接中断等) 时自动重试
        var msg = err && err.message ? err.message : "加载失败";
        var isLoadError = msg.indexOf("资源加载失败") === 0 || msg === "加载超时" || msg === "资源解析失败";
        if (isLoadError && retries < LOAD_RETRY_MAX) {
          toast("加载失败，正在重试 (" + (retries + 1) + "/" + LOAD_RETRY_MAX + ")…");
          setTimeout(function () {
            if (state.token === token) loadCurrent(retries + 1);
          }, 500);
          return;
        }
        showLoadError(msg);
      });
  }

  function renderHud(player) {
    clear(dom.hud);
    var data = player.skeleton.data;
    var lines = [];
    if (data && data.width && data.height) {
      lines.push("画布 " + Math.round(data.width) + " × " + Math.round(data.height));
    }
    if (data && data.version) lines.push("Spine " + data.version);
    lines.push("动作 " + state.anims.length + " 个");
    lines.forEach(function (text) {
      dom.hud.appendChild(el("div", "hud-item", text));
    });
  }

  function renderCrumbs() {
    clear(dom.crumbs);
    var ship = getShip(state.shipKey);
    if (!ship) {
      dom.crumbs.appendChild(el("span", "crumb dim", "请选择舰娘"));
      return;
    }
    var skin = getSkin(ship, state.skinKey);
    dom.crumbs.appendChild(el("span", "crumb", ship.chName + (ship.hxName ? " · " + ship.hxName : "")));
    dom.crumbs.appendChild(el("span", "sep", "/"));
    dom.crumbs.appendChild(el("span", "crumb dim", skin ? skin.chName : "无皮肤"));
if (skin && skin.spines.length > 1) {
      var spineItem = skin.spines[state.spineIdx];
      dom.crumbs.appendChild(el("span", "sep", "/"));
      dom.crumbs.appendChild(
        el(
          "span",
          "crumb dim",
          (spineItem && layerLabel(spineItem.skelName, skin.key)) || "图层 " + (state.spineIdx + 1)
        )
      );
    }
  }

  function updateNav() {
    var list = state.visible;
    var pos = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === state.shipKey) {
        pos = i;
        break;
      }
    }
    dom.btnPrevShip.disabled = pos <= 0;
    dom.btnNextShip.disabled = pos < 0 || pos >= list.length - 1;
  }

  /* ---------------- 皮肤 / 图层 / 动作 ---------------- */

  function renderSkinStrip() {
    clear(dom.skinStrip);
    var ship = getShip(state.shipKey);
    var skin = getSkin(ship, state.skinKey);
    if (!ship || !skin) {
      dom.btnSpines.disabled = true;
      dom.spineLabel.textContent = "图层";
      return;
    }

    var usable = ship.skins.filter(function (item) {
      return item.spines.length > 0;
    });
    if (usable.length > 1) {
      usable.forEach(function (item, chipIdx) {
        var chip = el("button", "skin-chip" + (item.key === skin.key ? " is-active" : ""));
        chip.type = "button";
        chip.style.setProperty("--i", chipIdx);
        chip.appendChild(document.createTextNode(item.chName));
        chip.appendChild(el("span", "tag", item.key));
        chip.addEventListener("click", function () {
          if (item.key === state.skinKey) return;
          selectSkin(ship.key, item.key, 0);
        });
        dom.skinStrip.appendChild(chip);
      });
    }

if (skin.spines.length > 1) {
      var layerBase = usable.length > 1 ? usable.length : 0;
      skin.spines.forEach(function (spineItem, index) {
        var chip = el("button", "skin-chip" + (index === state.spineIdx ? " is-active" : ""));
        chip.type = "button";
        chip.style.setProperty("--i", layerBase + index);
        chip.appendChild(document.createTextNode(layerLabel(spineItem.skelName, skin.key) || "图层 " + (index + 1)));
        chip.addEventListener("click", function () {
          if (index === state.spineIdx) return;
          applySpine(index);
        });
        dom.skinStrip.appendChild(chip);
      });
    }

    dom.spineLabel.textContent = skin.spines.length > 1 ? "图层 " + (state.spineIdx + 1) + "/" + skin.spines.length : "图层";
    dom.btnSpines.disabled = skin.spines.length <= 1;
  }

  function renderSpinePopup() {
    clear(dom.spineList);
    var ship = getShip(state.shipKey);
    var skin = getSkin(ship, state.skinKey);
    if (!skin || skin.spines.length <= 1) {
      dom.spineList.appendChild(el("div", "opt", "该立绘只有一层"));
      return;
    }
    skin.spines.forEach(function (spineItem, index) {
      var opt = el("button", "opt" + (index === state.spineIdx ? " is-active" : ""));
      opt.type = "button";
      opt.appendChild(el("span", "dot"));
opt.appendChild(el("span", null, layerLabel(spineItem.skelName, skin.key) || "图层 " + (index + 1)));
      opt.appendChild(el("span", "meta", spineItem.skelName));
      opt.title = spineItem.skelName;
      opt.addEventListener("click", function () {
        closePopups();
        if (index !== state.spineIdx) applySpine(index);
      });
      dom.spineList.appendChild(opt);
    });
  }

  function renderAnimList(current) {
    clear(dom.animList);
    if (!state.anims.length) {
      dom.animList.appendChild(el("div", "opt", "该立绘没有动作"));
      return;
    }
    state.anims.forEach(function (name) {
      var opt = el("button", "opt" + (name === current ? " is-active" : ""));
      opt.type = "button";
      opt.appendChild(el("span", "dot"));
      opt.appendChild(el("span", null, animLabel(name)));
      opt.appendChild(el("span", "meta", name));
      opt.title = name;
      opt.addEventListener("click", function () {
        closePopups();
        playAnimation(name);
      });
      dom.animList.appendChild(opt);
    });
  }

  function pickIdleAnimation(animations) {
    if (!animations || !animations.length) return null;
    // 待机动作优先: exact normal/idle, 再 idle 子串, 再 normal 子串, 最后退回列表第一个
    for (var i = 0; i < animations.length; i++) {
      if (/^(normal|idle)$/i.test(animations[i])) return animations[i];
    }
    for (var j = 0; j < animations.length; j++) {
      if (/idle/i.test(animations[j])) return animations[j];
    }
    for (var k = 0; k < animations.length; k++) {
      if (/normal/i.test(animations[k])) return animations[k];
    }
    return animations[0];
  }

  function playAnimation(name) {
    var main = state.player;
    if (!main || !main.animationState) return;
    // 先校验动作是否存在于主图层, 避免运行库在 clearTracks 之后才因找不到动作抛错,
    // 导致轨道被清空、骨架重置、画面静止 (表现为"无法播放该动作")
    var exists = (main.skeleton.data.animations || []).some(function (a) { return a.name === name; });
    if (!exists) {
      toast("无法播放该动作");
      return;
    }
    var ok = false;
    try {
      main.setAnimation(name);
      main.config.animation = name;
      ok = true;
    } catch (err) {
      toast("无法播放该动作");
      return;
    }
    if (!ok) return;
    eachPlayer(function (p) {
      if (p === main) return;
      if ((p.skeleton.data.animations || []).some(function (a) { return a.name === name; })) {
        p.setAnimation(name);
        p.config.animation = name;
      }
    });
    dom.animLabel.textContent = animLabel(name);
    renderAnimList(name);
    if (main.paused) eachPlayer(function (p) { p.play(); });
    dom.btnToggle.textContent = "⏸";
    dom.btnToggle.classList.add("is-active");
    resetView(true);
  }

  function applySpine(index) {
    var ship = getShip(state.shipKey);
    var skin = getSkin(ship, state.skinKey);
    if (!skin || !skin.spines[index]) return;
    state.spineIdx = index;
    state.currentSpine = skin.spines[index];
    state.currentSpineLayers = buildRenderLayers(skin.spines, state.currentSpine && state.currentSpine.skelName);
    state.decisions[ship.key] = { skin: skin, spine: state.currentSpine };
    state.failedSkels = {};
    loadCurrent();
    renderList();
    saveState();
  }

  function selectSkin(shipKey, skinKey, spineIdx) {
    var ship = getShip(shipKey);
    var skin = getSkin(ship, skinKey);
    if (!skin || !skin.spines.length) {
      toast("该皮肤暂无立绘文件");
      return;
    }
    state.shipKey = shipKey;
    state.skinKey = skinKey;
    state.spineIdx = Math.min(spineIdx || 0, skin.spines.length - 1);
    state.currentSpine = skin.spines[state.spineIdx];
    state.currentSpineLayers = buildRenderLayers(skin.spines, state.currentSpine && state.currentSpine.skelName);
    state.decisions[shipKey] = { skin: skin, spine: state.currentSpine };
    state.failedSkels = {};
    loadCurrent();
    renderList();
    updateNav();
    saveState();
  }

  function selectShip(shipKey) {
    var ship = getShip(shipKey);
    if (!ship) return;
    if (shipKey === state.shipKey && state.currentSpine) {
      toast("已经是当前舰娘");
      return;
    }
    var decision = decide(ship);
    if (decision.skin && decision.spine) {
      selectSkin(shipKey, decision.skin.key, state.saved && state.saved.ship === shipKey ? state.saved.spine : 0);
      scrollToActive();
      if (window.innerWidth <= 900) dom.app.classList.remove("sidebar-open");
      return;
    }

    state.shipKey = shipKey;
    state.skinKey = null;
    state.spineIdx = 0;
    state.currentSpine = null;
    state.token++;
    destroyPlayer();
    dom.empty.classList.remove("is-hidden");
    renderSkinStrip();
    renderCrumbs();
    updateNav();
    renderList();
    saveState();
    toast("「" + ship.chName + "」在仓库中暂无立绘文件");
  }

  function scrollToActive() {
    var node = dom.shipList.querySelector('.ship[data-key="' + state.shipKey + '"]');
    if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
  }

  function step(delta) {
    var list = state.visible;
    var pos = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === state.shipKey) {
        pos = i;
        break;
      }
    }
    if (pos < 0) {
      if (list.length) selectShip(list[0].key);
      return;
    }
    var next = pos + delta;
    if (next < 0 || next >= list.length) {
      toast(delta < 0 ? "已经是第一个" : "已经是最后一个");
      return;
    }
    selectShip(list[next].key);
  }

  /* ---------------- 控制条 ---------------- */

  function closePopups() {
    dom.animPanel.classList.remove("is-open");
    dom.spinePanel.classList.remove("is-open");
  }

  function togglePlay() {
    var player = state.player;
    if (!player) return;
    if (player.paused) {
      var current = player.animationState && player.animationState.getCurrent(0);
      if (!current && state.anims.length) {
        playAnimation(state.anims[0]);
        return;
      }
      eachPlayer(function (p) { p.play(); });
      dom.btnToggle.textContent = "⏸";
      dom.btnToggle.classList.add("is-active");
    } else {
      eachPlayer(function (p) { p.pause(); });
      dom.btnToggle.textContent = "▶";
      dom.btnToggle.classList.remove("is-active");
    }
  }

  function fullscreen() {
    var host = dom.canvasHost;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (host.requestFullscreen) {
      host.requestFullscreen();
    }
  }

  function capture() {
    var renderer = state.renderer;
    var player = state.player;
    if (!renderer || !renderer.canvas) {
      toast("暂无可保存的画面");
      return;
    }
    try {
      if (player && player.skeleton && player.animationState) {
        var current = player.animationState.getCurrent(0);
        if (current && current.animation) {
          var span = current.animationEnd - current.animationStart;
          var time = current.animationLast + span * 0.35;
          current.trackTime = time;
          if (current.animation.apply) {
            current.animation.apply(player.skeleton, current.animationLast, time, true, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
          }
          player.skeleton.updateWorldTransform();
        }
      }
      if (player) player.drawFrame(false);
      var link = document.createElement("a");
      link.href = renderer.canvas.toDataURL("image/png");
      link.download = (state.shipKey || "spine") + "_" + (state.skinKey || "skin") + ".png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast("已保存当前画面");
    } catch (err) {
      toast("保存失败：画布数据不可导出");
    } finally {
      (function restore() {
        var player2 = state.player;
        if (!player2) return;
        var current2 = player2.animationState && player2.animationState.getCurrent(0);
        if (current2 && current2.animation) {
          var span2 = current2.animationEnd - current2.animationStart;
          current2.trackTime = current2.animationLast + span2 * 0.35;
        }
        applyTransform();
      })();
    }
  }

  function bindControls() {
    dom.btnToggle.addEventListener("click", togglePlay);
    dom.btnPrevShip.addEventListener("click", function () {
      step(-1);
    });
    dom.btnNextShip.addEventListener("click", function () {
      step(1);
    });
    dom.btnReset.addEventListener("click", function () {
      resetView(true);
      if (state.anims.length && state.player) playAnimation(state.anims[0]);
      toast("已重置视图与动作");
    });
    dom.btnShot.addEventListener("click", capture);
    dom.btnFull.addEventListener("click", fullscreen);

    dom.btnAnims.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = dom.animPanel.classList.contains("is-open");
      closePopups();
      if (!open) dom.animPanel.classList.add("is-open");
    });

    dom.btnSpines.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = dom.spinePanel.classList.contains("is-open");
      closePopups();
      if (!open) {
        renderSpinePopup();
        dom.spinePanel.classList.add("is-open");
      }
    });

    [dom.animPanel, dom.spinePanel].forEach(function (panel) {
      panel.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    });
    document.addEventListener("click", closePopups);

    dom.openSidebar.addEventListener("click", function () {
      dom.app.classList.add("sidebar-open");
    });
dom.closeSidebar.addEventListener("click", function () {
      dom.app.classList.remove("sidebar-open");
    });

    if (dom.localNoticeClose) {
      dom.localNoticeClose.addEventListener("click", function () {
        dom.localNotice.hidden = true;
      });
    }
    dom.app.addEventListener("click", function (event) {
      if (event.target === dom.app) dom.app.classList.remove("sidebar-open");
    });

    var timer = 0;
    dom.search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.keyword = dom.search.value;
        applyFilter();
        saveState();
      }, 120);
    });
    dom.clearSearch.addEventListener("click", function () {
      dom.search.value = "";
      state.keyword = "";
      applyFilter();
      saveState();
      dom.search.focus();
    });

    document.addEventListener("keydown", function (event) {
      var tag = (event.target && event.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (event.key === "Escape") dom.search.blur();
        return;
      }
      var key = event.key;
      if (key === " " || event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (key === "a" || key === "A" || key === "ArrowLeft") {
        step(-1);
      } else if (key === "d" || key === "D" || key === "ArrowRight") {
        step(1);
      } else if (key === "r" || key === "R") {
        resetView();
      } else if (key === "s" || key === "S") {
        capture();
      } else if (key === "h" || key === "H") {
        dom.app.classList.toggle("sidebar-open");
      } else if (key === "f" || key === "F") {
        fullscreen();
      } else if (key === "Escape") {
        closePopups();
      }
    });

    document.addEventListener("fullscreenchange", function () {
      applyTransform();
    });
    window.addEventListener("resize", function () {
      applyTransform();
      updateNav();
    });
  }

  /* ---------------- 初始化 ---------------- */

  function readUrlState() {
    var raw = location.hash ? location.hash.slice(1) : "";
    if (!raw) return null;
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch (err) {
      return null;
    }
  }

  function init() {
    if (!(window.spine && window.spine.SpinePlayer)) {
      dom.listMeta.textContent = "播放器未就绪";
      var tip = el("div", "list-empty", "Spine 播放器脚本未能加载，请检查 vendor/spine-player.js。");
      dom.shipList.appendChild(tip);
      return;
    }

    bindControls();
    bindStageInteractions();

    loadIndex()
      .then(function (root) {
        state.ships = buildShips(root);
        state.saved = readUrlState();
        if (state.saved) {
          if (state.saved.kw) {
            state.keyword = state.saved.kw;
            dom.search.value = state.saved.kw;
          }
          if (state.saved.chip) state.activeChip = state.saved.chip;
        }
        renderChips();
        applyFilter();

        /* bare 模式：供 CLI 自动化渲染，隐藏全部 UI 只留立绘 */
        if (/[?&]bare=1/.test(location.search)) {
          document.body.classList.add("bare-mode");
        }
        initWeddingFx();

        updateSideHint(false);
        updateLocalNotice();

        var initial = null;
        if (state.saved && state.saved.ship) initial = getShip(state.saved.ship);
        if (!initial) {
          for (var i = 0; i < state.ships.length; i++) {
            if (state.ships[i].available) {
              initial = state.ships[i];
              break;
            }
          }
        }
        if (!initial) initial = state.ships[0];
        if (initial) {
          selectShip(initial.key);
          scrollToActive();
        }
      })
.catch(function (err) {
        dom.listMeta.textContent = "索引加载失败";
        dom.listHint.textContent = "";
        var box = el("div", "list-empty");
        box.style.whiteSpace = "pre-line";
        var reason = err && err.message ? err.message : "";
if (DATA_STATE === "blocked") {
          box.textContent =
            "本地直开模式下未能获取 index.json 数据\n\n" +
            "可能原因：\n" +
            "1. 内联数据文件尚未生成（docs/player/index.local.js）\n" +
            "2. 浏览器出于安全策略拦截了本地文件读取\n\n" +
            "解决办法（任选其一）：\n" +
            "1. 生成内联数据：python tools/build-player-data.py\n" +
            "2. 双击仓库根目录的 start-local-preview.cmd\n" +
            "3. 手动启动服务：python -m http.server 13383 --directory docs";
        } else {
          box.textContent =
            "无法读取 ../index.json\n" +
            reason +
            "\n请通过本地服务或 GitHub Pages 打开本页面。";
        }
        dom.shipList.appendChild(box);
        updateSideHint(true);
      });
  }

  /* ---------------- 婚礼白动效 ---------------- */

  function initPetals() {
    var host = document.getElementById("fxPetals");
    if (!host) return;
    var COUNT = 16;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < COUNT; i++) {
      var p = el("span", "petal" + (i % 5 === 0 ? " gold" : ""));
      var dur = 9 + Math.random() * 9;
      p.style.left = Math.random() * 100 + "vw";
      p.style.animationDuration = dur + "s";
      p.style.animationDelay = -Math.random() * dur + "s";
      var scale = 0.6 + Math.random() * 0.9;
      p.style.width = 14 * scale + "px";
      p.style.height = 14 * scale + "px";
      frag.appendChild(p);
    }
    host.appendChild(frag);
  }

  function initBokeh() {
    var host = document.getElementById("fxBokeh");
    if (!host) return;
    var COUNT = 12;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < COUNT; i++) {
      var b = el("span", "bokeh");
      var size = 22 + Math.random() * 74;
      b.style.width = size + "px";
      b.style.height = size + "px";
      b.style.left = Math.random() * 100 + "vw";
      b.style.top = Math.random() * 100 + "vh";
      var fd = 6 + Math.random() * 7;
      b.style.animationDuration = fd + "s, " + (3 + Math.random() * 4) + "s";
      b.style.animationDelay = -Math.random() * fd + "s, -" + Math.random() * 4 + "s";
      frag.appendChild(b);
    }
    host.appendChild(frag);
  }

  function initRipple() {
    document.addEventListener("pointerdown", function (ev) {
      var target = ev.target;
      if (!target || !target.classList) return;
      if (!target.classList.contains("ctl") && !target.classList.contains("icon-btn") &&
          !target.classList.contains("chip") && !target.classList.contains("skin-chip")) return;
      var rect = target.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height) * 1.1;
      var r = el("span", "ripple");
      r.style.width = r.style.height = size + "px";
      r.style.left = ev.clientX - rect.left - size / 2 + "px";
      r.style.top = ev.clientY - rect.top - size / 2 + "px";
      target.appendChild(r);
      setTimeout(function () {
        if (r.parentNode) r.parentNode.removeChild(r);
      }, 700);
    });
  }

  function initSparkles() {
    var last = 0;
    document.addEventListener("pointermove", function (ev) {
      var now = Date.now();
      if (now - last < 60) return;
      last = now;
      var s = el("span", "sparkle");
      s.style.left = ev.clientX - 4 + "px";
      s.style.top = ev.clientY - 4 + "px";
      document.body.appendChild(s);
      setTimeout(function () {
        if (s.parentNode) s.parentNode.removeChild(s);
      }, 900);
    });
  }

  function playBurst() {
    var host = document.getElementById("fxBurst");
    if (!host) return;
    clear(host);
    var ring = el("span", "burst-ring");
    host.appendChild(ring);
    for (var i = 0; i < 14; i++) {
      var sp = el("span", "burst-spark");
      var angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.5;
      var dist = 90 + Math.random() * 150;
      sp.style.setProperty("--sx", Math.cos(angle) * dist + "px");
      sp.style.setProperty("--sy", Math.sin(angle) * dist + "px");
      sp.style.animationDelay = Math.random() * 0.12 + "s";
      host.appendChild(sp);
    }
    setTimeout(function () {
      clear(host);
    }, 1300);
  }

  function initParallax() {
    var host = document.getElementById("canvasHost");
    var frame = document.querySelector(".stage-frame");
    var veil = document.querySelector(".stage-veil");
    var raf = null;
    document.addEventListener("pointermove", function (ev) {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        var nx = ev.clientX / window.innerWidth - 0.5;
        var ny = ev.clientY / window.innerHeight - 0.5;
        if (host) host.style.transform = "perspective(1200px) translate3d(" + (nx * -8) + "px," + (ny * -6) + "px,0)";
        if (frame) frame.style.transform = "translate3d(" + (nx * -14) + "px," + (ny * -10) + "px,0)";
        if (veil) veil.style.transform = "translate3d(" + (nx * 6) + "px," + (ny * 4) + "px,0)";
      });
    });
  }

  function initWeddingFx() {
    if (document.body.classList.contains("bare-mode")) return;
    initPetals();
    initBokeh();
    initRipple();
    initSparkles();
    initParallax();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();