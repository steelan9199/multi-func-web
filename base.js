// 公共逻辑：各功能页共用（Toast 提示）
(function () {
  function ensureToast() {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    return el;
  }

  window.showToast = function (msg) {
    const el = ensureToast();
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(window.showToast._t);
    window.showToast._t = setTimeout(function () {
      el.classList.remove("show");
    }, 1600);
  };
})();

// 顶部固定导航条：返回功能中心（各功能页共用，由 base.js 统一注入）
(function () {
  if (document.getElementById("topbar")) return;
  const bar = document.createElement("div");
  bar.id = "topbar";
  bar.className = "topbar";

  const inner = document.createElement("div");
  inner.className = "topbar-inner";

  const back = document.createElement("a");
  back.className = "topbar-back";
  back.href = "../../index.html";
  back.textContent = "← 返回功能中心";

  const title = document.createElement("span");
  title.className = "topbar-title";
  title.textContent = document.title || "";

  inner.appendChild(back);
  inner.appendChild(title);
  bar.appendChild(inner);

  document.body.insertBefore(bar, document.body.firstChild);
  document.body.classList.add("has-topbar");
})();
