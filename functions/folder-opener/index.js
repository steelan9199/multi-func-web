// 文件夹快速打开器 · 前端逻辑（纯原生 JS，无框架）
// 6 个路径输入框（自适应多行，长路径自动折行完整可见），每个右侧「打开」「复制」按钮。
(function () {
  const DEFAULT_API = "http://localhost:18789";
  const API_KEY = "folder-opener-api";
  const PATHS_KEY = "folder-opener-paths";
  const COUNT = 6;

  const apiBaseEl = document.getElementById("apiBase");
  const rowsEl = document.getElementById("folderRows");
  const clearAllBtn = document.getElementById("clearAllBtn");
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("statusText");
  const mask = document.getElementById("mask");
  const dlgTitle = document.getElementById("dlgTitle");
  const dlgMsg = document.getElementById("dlgMsg");
  const dlgPath = document.getElementById("dlgPath");
  const dlgOk = document.getElementById("dlgOk");
  const dlgCopy = document.getElementById("dlgCopy");

  let backendOnline = false;
  let dlgPathValue = "";
  const inputs = []; // 6 个路径框
  const buttons = []; // 6 个「打开」按钮

  function getAPI() {
    return (apiBaseEl.value.trim() || DEFAULT_API).replace(/\/+$/, "");
  }

  // ---- file:// 下也能用的复制 ----
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  // ---- 路径框自适应高度（长路径完整显示，最多 3 行后内部滚动） ----
  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }

  // ---- 路径持久化（localStorage 存一个 6 元数组） ----
  function loadSaved() {
    try {
      const arr = JSON.parse(localStorage.getItem(PATHS_KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function saveAll() {
    try {
      localStorage.setItem(
        PATHS_KEY,
        JSON.stringify(inputs.map((el) => el.value))
      );
    } catch {
      /* 隐私模式下写不进去，忽略 */
    }
  }

  // ---- 按钮可用性：后台在线 且 该行有内容 ----
  function refreshBtns() {
    inputs.forEach(function (el, i) {
      buttons[i].disabled = !backendOnline || !el.value.trim();
    });
  }

  function setStatus(ok) {
    backendOnline = ok;
    dot.classList.toggle("on", ok);
    statusText.textContent = ok
      ? "后台已连接"
      : "后台未连接 — 请先双击 start-server.bat 启动后台";
    refreshBtns();
  }

  // ---- 弹框 ----
  function showDialog(title, msg, fullPath) {
    dlgTitle.textContent = title;
    dlgMsg.textContent = msg;
    dlgPathValue = fullPath || "";
    dlgPath.textContent = dlgPathValue;
    dlgPath.style.display = dlgPathValue ? "block" : "none";
    dlgCopy.style.display = dlgPathValue ? "block" : "none";
    mask.classList.add("show");
    dlgOk.focus();
  }
  function hideDialog() {
    mask.classList.remove("show");
  }

  function markError(el) {
    el.classList.add("err");
  }
  function clearError(el) {
    el.classList.remove("err");
  }

  // ---- 构建 6 行 ----
  const saved = loadSaved();
  const sampleA = "例如：D:/software";
  const sampleB = "例如：C:/Users/Administrator/AppData/Local/DoubaoWork/User Data/Profile 1/.doubaowork/agent_mode/workspace/.user_skills";

  for (let i = 0; i < COUNT; i++) {
    const row = document.createElement("div");
    row.className = "folder-row";

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = String(i + 1);

    const input = document.createElement("textarea");
    input.rows = 1;
    input.placeholder = i === 0 ? sampleA : sampleB;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = typeof saved[i] === "string" ? saved[i] : "";
    input.title = input.value || "";

    const acts = document.createElement("div");
    acts.className = "acts";

    const openBtn = document.createElement("button");
    openBtn.className = "btn small";
    openBtn.textContent = "打开";
    openBtn.disabled = true;

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn secondary small";
    copyBtn.textContent = "复制";
    copyBtn.title = "复制这一行的路径";

    // 输入：去掉换行（路径是单行语义），同步记忆与按钮状态
    input.addEventListener("input", function () {
      if (/[\r\n]/.test(input.value)) {
        const pos = input.selectionStart;
        input.value = input.value.replace(/[\r\n]+/g, "");
        try {
          input.setSelectionRange(pos - 1, pos - 1);
        } catch {
          /* 忽略 */
        }
      }
      clearError(input);
      input.title = input.value;
      autoGrow(input);
      saveAll();
      refreshBtns();
    });
    input.addEventListener("paste", function () {
      setTimeout(function () {
        clearError(input);
        input.title = input.value;
        autoGrow(input);
        saveAll();
        refreshBtns();
      }, 0);
    });
    input.addEventListener("blur", function () {
      input.value = input.value.trim();
      input.title = input.value;
      autoGrow(input);
      saveAll();
      refreshBtns();
    });

    openBtn.addEventListener("click", function () {
      openFolder(i);
    });
    copyBtn.addEventListener("click", function () {
      const v = input.value.trim();
      if (!v) {
        showToast("第 " + (i + 1) + " 行为空，没有可复制的内容");
        return;
      }
      copyText(v).then(
        function () {
          showToast("已复制第 " + (i + 1) + " 行路径");
        },
        function () {
          showToast("复制失败，请手动选中复制");
        }
      );
    });

    acts.appendChild(openBtn);
    acts.appendChild(copyBtn);
    row.appendChild(idx);
    row.appendChild(input);
    row.appendChild(acts);
    rowsEl.appendChild(row);

    inputs.push(input);
    buttons.push(openBtn);
    autoGrow(input);
  }

  // ---- 打开某个文件夹 ----
  let busy = false;
  async function openFolder(i) {
    if (busy) return;
    const input = inputs[i];
    const btn = buttons[i];

    const raw = input.value.trim();
    if (!raw) {
      showToast("请先填写第 " + (i + 1) + " 行的文件夹路径");
      input.focus();
      return;
    }
    if (!backendOnline) {
      showToast("后台未连接，请先双击 start-server.bat");
      return;
    }

    busy = true;
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "打开中…";

    try {
      const resp = await fetch(getAPI() + "/api/folder-opener/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: raw }),
      });
      const data = await resp.json().catch(function () {
        return {};
      });

      if (resp.ok && data.ok) {
        clearError(input);
        showToast("已打开：" + shortPath(data.path || raw));
      } else {
        markError(input);
        showDialog(
          "打开失败",
          data.message || "无法打开该文件夹（" + resp.status + "）",
          data.path || raw
        );
      }
    } catch (e) {
      markError(input);
      showDialog(
        "无法连接后台",
        "请确认已双击 start-server.bat 启动本地后台，且后台地址填写正确。",
        getAPI()
      );
    } finally {
      busy = false;
      btn.textContent = oldText;
      refreshBtns();
    }
  }

  // toast 里只露尾部（文件夹名），避免超长路径把提示条撑爆
  function shortPath(p) {
    const s = String(p || "");
    return s.length > 42 ? "…" + s.slice(-40) : s;
  }

  // ---- 全部清空 ----
  clearAllBtn.addEventListener("click", function () {
    inputs.forEach(function (el) {
      el.value = "";
      el.title = "";
      clearError(el);
      autoGrow(el);
    });
    saveAll();
    refreshBtns();
    showToast("已清空 6 个路径");
  });

  // ---- 弹框关闭 / 复制 ----
  dlgOk.addEventListener("click", hideDialog);
  dlgCopy.addEventListener("click", function () {
    if (!dlgPathValue) return;
    copyText(dlgPathValue).then(
      function () {
        showToast("已复制路径");
      },
      function () {
        showToast("复制失败，请手动选中复制");
      }
    );
  });
  mask.addEventListener("click", function (e) {
    if (e.target === mask) hideDialog();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && mask.classList.contains("show")) hideDialog();
  });

  // ---- 后台地址记忆 ----
  apiBaseEl.value = localStorage.getItem(API_KEY) || DEFAULT_API;
  apiBaseEl.addEventListener("change", function () {
    const v = apiBaseEl.value.trim();
    if (v) localStorage.setItem(API_KEY, v);
    checkHealth();
  });

  // ---- 健康检测 ----
  async function checkHealth() {
    try {
      const r = await fetch(getAPI() + "/api/health", { cache: "no-store" });
      const data = await r.json();
      setStatus(!!data.ok);
    } catch {
      setStatus(false);
    }
  }

  // 窗口尺寸变化时重算高度（宽度变了折行数会变）
  window.addEventListener("resize", function () {
    inputs.forEach(autoGrow);
  });

  refreshBtns();
  checkHealth();
  setInterval(checkHealth, 5000);
})();
