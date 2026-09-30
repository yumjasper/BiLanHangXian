/* 碧蓝航线动态立绘预览器
 * 依赖：./vendor/spine-player.js（Spine 3.8 官方 Web Player，内联 spine-core / spine-webgl）
 * 数据：../index.json
 */
(function () {
  "use strict";

  var INDEX_URL = "../index.json";
  var UNAVAILABLE = "暂无数据";
  var WAIT_TIMEOUT = 20000;

  var ANIM_ALIASES = [
    { re: /^(idle|default|stand|normal|loop)$/i, name: "待机" },
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
    renderer: null,
    anims: [],
    decisions: {},
    saved: null,
    toastTimer: 0
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

  function camera() {
    return state.renderer && state.renderer.camera ? state.renderer.camera : null;
  }

  function currentZoom() {
    var cam = camera();
    return cam ? cam.zoom / state.zoom : 0;
  }

  function applyZoomAt(factor, origin) {
    var cam = camera();
    var next = Math.max(0.3, Math.min(5, state.zoom * factor));
    if (!cam || Math.abs(next - state.zoom) < 0.001) return;
    var host = dom.canvasHost;
    var unitX = (origin.x - host.clientWidth / 2) * currentZoom();
    var unitY = -(origin.y - host.clientHeight / 2) * currentZoom();
    var ratio = state.zoom / next;
    state.panX += unitX * (1 - ratio);
    state.panY += unitY * (1 - ratio);
    state.zoom = next;
    applyTransform();
  }

  function panBy(dx, dy) {
    var unit = currentZoom();
    state.panX -= dx * unit;
    state.panY += dy * unit;
    applyTransform();
  }

  function applyTransform() {
    var cam = camera();
    if (!cam) return;
    cam.position.x += state.panX;
    cam.position.y += state.panY;
    cam.zoom *= state.zoom;
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

    host.addEventListener(
      "wheel",
      function (event) {
        event.preventDefault();
        applyZoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, relative(event));
      },
      { passive: false }
    );

    host.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var point = relative(event);
      state.pointers[event.pointerId] = point;
      try {
        host.setPointerCapture(event.pointerId);
      } catch (err) {
        /* 忽略 */
      }
      var ids = Object.keys(state.pointers);
      if (ids.length === 1) {
        state.dragging = true;
      } else if (ids.length >= 2) {
        state.dragging = false;
        state.pinchDist = pointerDistance();
        state.pinchZoom = state.zoom;
      }
    });

    host.addEventListener("pointermove", function (event) {
      var prev = state.pointers[event.pointerId];
      if (!prev) return;
      var current = relative(event);
      state.pointers[event.pointerId] = current;
      var ids = Object.keys(state.pointers);

      if (ids.length >= 2) {
        var dist = pointerDistance();
        if (state.pinchDist > 0 && dist > 0) {
          var target = Math.max(0.3, Math.min(5, (state.pinchZoom * dist) / state.pinchDist));
          var center = {
            x: (state.pointers[ids[0]].x + state.pointers[ids[1]].x) / 2,
            y: (state.pointers[ids[0]].y + state.pointers[ids[1]].y) / 2
          };
          if (Math.abs(target - state.zoom) > 0.001) {
            applyZoomAt(target / state.zoom, center);
          }
        }
        event.preventDefault();
        return;
      }

      if (!state.dragging) return;
      panBy(current.x - prev.x, current.y - prev.y);
      event.preventDefault();
    });

    function endPointer(event) {
      if (!state.pointers[event.pointerId]) return;
      delete state.pointers[event.pointerId];
      var ids = Object.keys(state.pointers);
      if (!ids.length) {
        state.dragging = false;
      } else {
        state.dragging = true;
        state.pinchDist = 0;
      }
    }

    host.addEventListener("pointerup", endPointer);
    host.addEventListener("pointercancel", endPointer);
    host.addEventListener("pointerleave", endPointer);
    host.addEventListener("dblclick", function () {
      resetView();
    });
    host.addEventListener("dragstart", function (event) {
      event.preventDefault();
    });
  }

  /* ---------------- 数据：索引 / 筛选 / 列表 ---------------- */

  function loadIndex() {
    return fetch(INDEX_URL, { cache: "no-cache" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
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
    items.forEach(function (ship) {
      var decision = decide(ship);
      var btn = el("button", "ship" + (ship.key === state.shipKey ? " is-active" : ""));
      btn.type = "button";
      btn.dataset.key = ship.key;

      if (decision.spine && decision.skin) {
        var img = el("img", "ship-thumb");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        img.src = "../" + ship.key + "/" + decision.skin.key + "/" + decision.spine.pages[0];
        img.addEventListener("error", function () {
          if (img.dataset.retried) return;
          img.dataset.retried = "1";
          img.classList.add("is-fallback");
          if (decision.spine.pages.length > 1) {
            img.src = "../" + ship.key + "/" + decision.skin.key + "/" + decision.spine.pages[1];
          }
        });
        btn.appendChild(img);
      } else {
        btn.appendChild(el("div", "ship-thumb"));
      }

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

  function whenReady(token) {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      (function poll() {
        if (token !== state.token) {
          reject(new Error("superseded"));
          return;
        }
var player = state.player;
        if (player && player.assetManager && player.assetManager.isLoadingComplete()) {
          if (player.skeleton && player.animationState) {
            resolve(player);
          } else if (player.assetManager.hasErrors()) {
            reject(new Error("资源解析失败"));
          } else {
            setTimeout(poll, 60);
          }
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

  function destroyPlayer() {
    var player = state.player;
    state.player = null;
    state.renderer = null;
    if (!player) return;
    try {
      player.stopRequestAnimationFrame = true;
    } catch (err) {
      /* 忽略 */
    }
    var container = player.parent;
    if (container && container.parentNode) container.parentNode.removeChild(container);
    if (player.assetManager) {
      try {
        player.assetManager.dispose();
      } catch (err) {
        /* 忽略 */
      }
    }
  }

  function showLoadError(message) {
    var box = el("div", "spine-player-error", message);
    box.style.position = "absolute";
    box.style.inset = "0";
    box.style.zIndex = "6";
    dom.canvasHost.appendChild(box);
    toast(message);
  }

  function startPlayer(token) {
    var base = "../" + state.shipKey + "/" + state.skinKey + "/";
    var spineItem = state.currentSpine;
    if (!spineItem) return;

    destroyPlayer();
    var container = el("div");
    container.style.position = "absolute";
    container.style.inset = "0";
    dom.canvasHost.appendChild(container);
    resetView(true);

    state.player = new spine.SpinePlayer(container, {
      skelUrl: base + spineItem.skelName,
      atlasUrl: base + spineItem.atlasName,
      showControls: false,
      alpha: true,
      backgroundColor: "#00000000",
      fullScreenBackgroundColor: "#00000000",
      premultipliedAlpha: true,
      defaultMix: 0.25,
      success: function () {
        var player = state.player;
        if (token === state.token && player) {
          state.renderer = player.sceneRenderer;
          applyTransform();
        }
      },
      error: function (reason) {
        if (token === state.token) showLoadError("资源加载失败：" + reason);
      }
    });
    state.renderer = state.player.sceneRenderer;
    applyTransform();
  }

  function onPlayerReady(player) {
    var animations = (player.skeleton.data.animations || []).map(function (anim) {
      return anim.name;
    });
    state.anims = animations;

    var preferred = null;
    for (var i = 0; i < animations.length; i++) {
      if (/idle/i.test(animations[i])) {
        preferred = animations[i];
        break;
      }
    }
    if (!preferred) preferred = animations[0] || null;

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

    player.paused = true;
    dom.btnToggle.textContent = "▶";
    dom.btnToggle.classList.remove("is-active");

    resetView(true);
    renderAnimList(preferred);
    renderHud(player);
    renderCrumbs();
    updateNav();
    dom.empty.classList.add("is-hidden");
  }

  function loadCurrent() {
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
        showLoadError(err && err.message ? err.message : "加载失败");
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
      usable.forEach(function (item) {
        var chip = el("button", "skin-chip" + (item.key === skin.key ? " is-active" : ""));
        chip.type = "button";
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
      skin.spines.forEach(function (spineItem, index) {
        var chip = el("button", "skin-chip" + (index === state.spineIdx ? " is-active" : ""));
        chip.type = "button";
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

  function playAnimation(name) {
    var player = state.player;
    if (!player || !player.animationState) return;
    try {
      player.setAnimation(name);
      player.config.animation = name;
    } catch (err) {
      toast("无法播放该动作");
      return;
    }
    dom.animLabel.textContent = animLabel(name);
    renderAnimList(name);
    if (player.paused) player.play();
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
    state.decisions[ship.key] = { skin: skin, spine: state.currentSpine };
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
    state.decisions[shipKey] = { skin: skin, spine: state.currentSpine };
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
      player.play();
      dom.btnToggle.textContent = "⏸";
      dom.btnToggle.classList.add("is-active");
    } else {
      player.pause();
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
        box.textContent =
          "无法读取 ../index.json\n" +
          (err && err.message ? err.message : "") +
          "\n请通过 Web 服务器（如 GitHub Pages）打开本页面。";
        dom.shipList.appendChild(box);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();