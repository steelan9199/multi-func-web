// 本地 Markdown 发公众号 · 前端逻辑（纯原生 JS，无框架）
(function () {
  // 后台地址默认端口 18789，可由页面输入框修改并记忆到 localStorage。
  const DEFAULT_API = "http://localhost:18789";
  const STORE_KEY = "wechat-publish-api";

  const apiBaseEl = document.getElementById("apiBase");
  const filePathEl = document.getElementById("filePath");
  const configEl = document.getElementById("config");
  const sendBtn = document.getElementById("sendBtn");
  const reloadBtn = document.getElementById("reloadBtn");
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("statusText");
  const logEl = document.getElementById("log");

  let backendOnline = false;

  // 取当前后台地址（去掉尾部斜杠）
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

  async function loadConfig() {
    try {
      const r = await fetch(getAPI() + "/api/wechat-publish/config");
      const data = await r.json();
      if (data.ok) {
        configEl.value = data.config;
      } else {
        configEl.value = "/* 读取配置失败: " + data.error + " */";
      }
    } catch (e) {
      configEl.value = "/* 无法连接后台: " + e + " */";
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

  async function send() {
    const filePath = filePathEl.value.trim();
    const config = configEl.value;
    if (!filePath) {
      showToast("请先填写 .md 文件路径");
      return;
    }
    if (!filePath.toLowerCase().endsWith(".md")) {
      showToast("文件路径必须以 .md 结尾");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(config);
    } catch (e) {
      showToast("配置不是合法 JSON: " + e.message);
      return;
    }

    sendBtn.disabled = true;
    logEl.textContent = "";
    log("【开始发送】\n");

    try {
      const resp = await fetch(getAPI() + "/api/wechat-publish/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, config: parsed }),
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
  // 地址变更立即保存并重新检测
  apiBaseEl.addEventListener("change", () => {
    const v = apiBaseEl.value.trim();
    if (v) localStorage.setItem(STORE_KEY, v);
    checkHealth();
  });

  sendBtn.addEventListener("click", send);
  reloadBtn.addEventListener("click", loadConfig);

  checkHealth();
  loadConfig();
  // 每 5 秒复查一次后台状态
  setInterval(checkHealth, 5000);
})();
