/* 索引数据装载器
 *
 * 目的：让 docs/player/index.html 在「本地服务」与「直接双击打开」两种场景下都能拿到数据。
 * 原理：解析阶段同步 document.write 引入数据脚本，确保 app.js 执行前数据已就绪。
 * 注意：file:// 协议下浏览器会拦截对本地 .json 的读取，因此这里只尝试 .js 数据脚本。
 */
(function () {
  "use strict";

  function inject(src) {
    document.write('<script src="' + src + '"><\/script>');
  }

  if (location.protocol === "file:") {
    /* 直接双击：内联生成的 ES5 变量脚本，不受同源策略限制 */
    inject("./index.local.js");
  } else {
    /* 本地服务或 Pages：先尝试内联脚本，不存在时再由 app.js 回退到 fetch(../index.json) */
    inject("./index.embed.js");
  }
})();