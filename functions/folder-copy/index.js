// 文件夹复制器 · 前端逻辑（纯原生 JS，无框架）
(function () {
  const DEFAULT_API = "http://localhost:18789";
  const STORE_KEY = "folder-copy-api";
  const SRC_KEY = "folder-copy-src";
  const DEST_KEY = "folder-copy-dest";

  const apiBaseEl = document.getElementById("apiBase");
  const srcPathEl = document.getElementById("srcPath");
  const destPathEl = document.getElementById("destPath");
  const copyBtn = document.getElementById("copyBtn");
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("statusText");
  const logEl = document.getElementById("log");
  const excludeTagsEl = document.getElementById("excludeTags");
  const newExcludeInput = document.getElementById("newExcludeInput");
  const addExcludeBtn = document.getElementById("addExcludeBtn");
  const resetExcludesBtn = document.getElementById("resetExcludesBtn");
  const clearExcludesBtn = document.getElementById("clearExcludesBtn");

  let backendOnline = false;
  let defaultExcludes = []; // 从后台拉取的默认排除项（用于"恢复默认"）
  let currentExcludes = []; // 当前排除项列表（与后台文件同步）
  let saving = false; // 防止重复提交

  function getAPI() {
    return (apiBaseEl.value.trim() || DEFAULT_API).replace(/\/+$/, "");
  }

  function log(msg) {
    logEl.textContent += msg;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStatus(ok) {
    backendOnline = ok;
    dot.classList.toggle("on", ok);
    statusText.textContent = ok
      ? "后台已连接"
      : "后台未连接 — 请先双击 start-server.bat 启动后台";
    copyBtn.disabled = !ok;
  }

  // ---- 排除项渲染 ----
  function renderExcludes() {
    excludeTagsEl.innerHTML = "";
    if (currentExcludes.length === 0) {
      const empty = document.createElement("span");
      empty.className = "exclude-empty";
      empty.textContent = "（无排除项，将完整复制）";
      excludeTagsEl.appendChild(empty);
      return;
    }
    currentExcludes.forEach(function (item, idx) {
      const tag = document.createElement("span");
      tag.className = "exclude-tag";

      const name = document.createElement("span");
      name.textContent = item;

      const remove = document.createElement("span");
      remove.className = "remove";
      remove.textContent = "×";
      remove.title = "删除此项";
      remove.addEventListener("click", function () {
        removeExclude(idx);
      });

      tag.appendChild(name);
      tag.appendChild(remove);
      excludeTagsEl.appendChild(tag);
    });
  }

  // ---- 同步排除项到后台文件 ----
  async function syncExcludes(newList) {
    if (saving) return;
    saving = true;
    try {
      const r = await fetch(getAPI() + "/api/folder-copy/excludes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludes: newList }),
      });
      const data = await r.json();
      if (data.ok) {
        currentExcludes = data.excludes;
        renderExcludes();
      } else {
        showToast("保存失败：" + (data.error || "未知错误"));
        renderExcludes(); // 回滚显示
      }
    } catch (e) {
      showToast("保存失败，请检查后台连接");
      renderExcludes(); // 回滚显示
    } finally {
      saving = false;
    }
  }

  // ---- 删除排除项 ----
  function removeExclude(idx) {
    if (saving) return;
    const item = currentExcludes[idx];
    const newList = currentExcludes.slice();
    newList.splice(idx, 1);
    // 先更新界面（乐观更新）
    currentExcludes = newList;
    renderExcludes();
    // 再同步到后台
    syncExcludes(newList);
  }

  // ---- 添加排除项 ----
  function addExclude() {
    if (saving) return;
    const val = newExcludeInput.value.trim();
    if (!val) {
      showToast("请输入要排除的名称");
      return;
    }
    // 去重（大小写不敏感）
    const exists = currentExcludes.some(
      (n) => n.toLowerCase() === val.toLowerCase()
    );
    if (exists) {
      showToast("该项已存在");
      return;
    }
    const newList = currentExcludes.concat([val]);
    newExcludeInput.value = "";
    // 先更新界面
    currentExcludes = newList;
    renderExcludes();
    // 再同步到后台
    syncExcludes(newList);
  }

  // ---- 恢复默认 ----
  async function resetExcludes() {
    if (saving) return;
    if (defaultExcludes.length === 0) {
      showToast("尚未加载到默认排除项");
      return;
    }
    const newList = defaultExcludes.slice();
    // 先更新界面
    currentExcludes = newList;
    renderExcludes();
    // 再同步到后台
    syncExcludes(newList);
    showToast("已恢复默认排除项");
  }

  // ---- 清空 ----
  function clearExcludes() {
    if (saving) return;
    if (currentExcludes.length === 0) return;
    const newList = [];
    // 先更新界面
    currentExcludes = newList;
    renderExcludes();
    // 再同步到后台
    syncExcludes(newList);
    showToast("已清空排除项");
  }

  // ---- 加载排除项 ----
  async function loadExcludes() {
    try {
      const r = await fetch(getAPI() + "/api/folder-copy/excludes", {
        cache: "no-store",
      });
      const data = await r.json();
      if (data.ok && Array.isArray(data.excludes)) {
        // 首次加载时，把后台返回的作为"当前"和"默认"参考
        currentExcludes = data.excludes.slice();
        // defaultExcludes 用于"恢复默认"——如果后台文件是空的或首次初始化，
        // 我们也保存一份当前值作为恢复参考
        if (defaultExcludes.length === 0) {
          defaultExcludes = data.excludes.slice();
        }
        renderExcludes();
      }
    } catch (e) {
      excludeTagsEl.innerHTML =
        '<span class="exclude-empty">加载失败，请检查后台连接</span>';
    }
  }

  async function checkHealth() {
    try {
      const r = await fetch(getAPI() + "/api/health", { cache: "no-store" });
      const data = await r.json();
      setStatus(!!data.ok);
    } catch {
      setStatus(false);
    }
  }

  async function doCopy() {
    const src = srcPathEl.value.trim();
    const dest = destPathEl.value.trim();

    if (!src) {
      showToast("请填写源文件夹路径");
      return;
    }
    if (!dest) {
      showToast("请填写目标目录路径");
      return;
    }

    copyBtn.disabled = true;
    logEl.textContent = "";
    log("【开始复制】\n");

    try {
      const resp = await fetch(getAPI() + "/api/folder-copy/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src, dest }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        log("【后台返回错误】" + (err.error || resp.status) + "\n");
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        log(decoder.decode(value, { stream: true }));
      }
      log("\n【复制完成】\n");
    } catch (e) {
      log("【请求失败】" + e + "\n");
    } finally {
      copyBtn.disabled = !backendOnline;
    }
  }

  // 初始化后台地址：优先用上次记忆的值
  apiBaseEl.value = localStorage.getItem(STORE_KEY) || DEFAULT_API;
  apiBaseEl.addEventListener("change", () => {
    const v = apiBaseEl.value.trim();
    if (v) localStorage.setItem(STORE_KEY, v);
    checkHealth();
    loadExcludes();
  });

  // 初始化路径：优先用上次输入的值
  srcPathEl.value = localStorage.getItem(SRC_KEY) || "";
  destPathEl.value = localStorage.getItem(DEST_KEY) || "";
  srcPathEl.addEventListener("input", function () {
    localStorage.setItem(SRC_KEY, srcPathEl.value);
  });
  destPathEl.addEventListener("input", function () {
    localStorage.setItem(DEST_KEY, destPathEl.value);
  });

  copyBtn.addEventListener("click", doCopy);
  addExcludeBtn.addEventListener("click", addExclude);
  resetExcludesBtn.addEventListener("click", resetExcludes);
  clearExcludesBtn.addEventListener("click", clearExcludes);

  // 输入框回车添加
  newExcludeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addExclude();
    }
  });

  // 路径输入框 Ctrl+Enter 快捷复制
  [srcPathEl, destPathEl].forEach((el) => {
    el.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (!copyBtn.disabled) doCopy();
      }
    });
  });

  checkHealth();
  loadExcludes();
  setInterval(checkHealth, 5000);
})();
