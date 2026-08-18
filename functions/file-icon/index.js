// 文件图标更换器 · 前端逻辑（纯原生 JS，无框架）
(function () {
  const DEFAULT_API = "http://localhost:18789";
  const STORE_KEY = "file-icon-api";

  const apiBaseEl = document.getElementById("apiBase");
  const targetPathEl = document.getElementById("targetPath");
  const pickerEl = document.getElementById("picker");
  const imageEl = document.getElementById("image");
  const previewEl = document.getElementById("preview");
  const pickIconEl = document.getElementById("pickIcon");
  const pickTipEl = document.getElementById("pickTip");
  const pickNameEl = document.getElementById("pickName");
  const sendBtn = document.getElementById("sendBtn");
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("statusText");
  const logEl = document.getElementById("log");

  let backendOnline = false;
  let previewUrl = null;
  let currentFile = null; // 统一保存当前选中的图片（点击选择或拖放）

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
    sendBtn.disabled = !ok;
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

  // 统一设置当前图片：更新预览与文件名提示
  function setSelectedFile(file) {
    currentFile = file;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if (file) {
      previewUrl = URL.createObjectURL(file);
      previewEl.src = previewUrl;
      previewEl.style.display = "block";
      pickIconEl.style.display = "none";
      pickTipEl.style.display = "none";
      pickNameEl.textContent = "✔ " + file.name;
      pickNameEl.style.display = "block";
    } else {
      previewEl.style.display = "none";
      pickIconEl.style.display = "";
      pickTipEl.style.display = "";
      pickNameEl.style.display = "none";
      pickNameEl.textContent = "";
    }
  }

  // 点击选择
  pickerEl.addEventListener("click", () => imageEl.click());
  imageEl.addEventListener("change", () => {
    setSelectedFile(imageEl.files && imageEl.files[0]);
  });

  // 拖拽支持（大拖放区）
  ["dragenter", "dragover"].forEach((ev) =>
    pickerEl.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      pickerEl.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    pickerEl.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      pickerEl.classList.remove("dragover");
    })
  );
  pickerEl.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const f = files[0];
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!["png", "jpg", "jpeg"].includes(ext)) {
      showToast("仅支持 PNG / JPG 图片（当前: " + ext + "）");
      return;
    }
    // 同步到隐藏 input，保证后续逻辑一致
    try {
      const dt = new DataTransfer();
      dt.items.add(f);
      imageEl.files = dt.files;
    } catch (_) {
      /* 旧浏览器无法赋值 files，仅用 currentFile */
    }
    setSelectedFile(f);
  });

  async function send() {
    // Windows「复制文件地址」常带首尾双引号，自动去掉
    const targetPath = targetPathEl.value.trim().replace(/^"+|"+$/g, "");
    const file = currentFile || (imageEl.files && imageEl.files[0]);

    if (!targetPath) {
      showToast("请先填写目标路径");
      return;
    }
    if (!file) {
      showToast("请先拖入或选择一张 PNG / JPG 图片");
      return;
    }

    const fd = new FormData();
    fd.append("targetPath", targetPath);
    fd.append("image", file, file.name);

    sendBtn.disabled = true;
    logEl.textContent = "";
    log("【开始更换】\n");

    try {
      const resp = await fetch(getAPI() + "/api/file-icon/stream", {
        method: "POST",
        body: fd,
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
      log("\n【流结束】\n");
    } catch (e) {
      log("【请求失败】" + e + "\n");
    } finally {
      sendBtn.disabled = !backendOnline;
    }
  }

  // 初始化后台地址：优先用上次记忆的值
  apiBaseEl.value = localStorage.getItem(STORE_KEY) || DEFAULT_API;
  apiBaseEl.addEventListener("change", () => {
    const v = apiBaseEl.value.trim();
    if (v) localStorage.setItem(STORE_KEY, v);
    checkHealth();
  });

  sendBtn.addEventListener("click", send);

  checkHealth();
  setInterval(checkHealth, 5000);
})();
