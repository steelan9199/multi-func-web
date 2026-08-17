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
