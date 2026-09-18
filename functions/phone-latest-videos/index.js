// 手机最新视频取回 · 前端逻辑（纯原生 JS，无框架）
// 与后台的协议：POST /api/phone-latest-videos/stream 返回 NDJSON，每行一个事件对象，
// 事件类型见 server/routes/phone-latest-videos.js 头部注释。
(function () {
  const DEFAULT_API = "http://localhost:18789";
  const K_API = "phone-latest-videos-api";
  const K_COUNT = "phone-latest-videos-count";
  const K_DEST = "phone-latest-videos-dest";

  const apiBaseEl = document.getElementById("apiBase");
  const countInput = document.getElementById("countInput");
  const destInput = document.getElementById("destInput");
  const fetchBtn = document.getElementById("fetchBtn");
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("statusText");
  const progressWrap = document.getElementById("progressWrap");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const progressPct = document.getElementById("progressPct");
  const noteText = document.getElementById("noteText");
  const resultBox = document.getElementById("resultBox");
  const resultLabel = document.getElementById("resultLabel");
  const fileList = document.getElementById("fileList");
  const openDestBtn = document.getElementById("openDestBtn");
  const desktopBtn = document.getElementById("desktopBtn");
  const downloadsBtn = document.getElementById("downloadsBtn");
  const openAgainBtn = document.getElementById("openAgainBtn");

  let backendOnline = false;
  let busy = false;
  let lastDest = "";
  const quickPaths = { desktop: null, downloads: null };

  function getAPI() {
    return (apiBaseEl.value.trim() || DEFAULT_API).replace(/\/+$/, "");
  }

  function humanSize(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
    return (b / 1073741824).toFixed(2) + " GB";
  }

  function clampCount(v) {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = 1;
    if (n < 1) n = 1;
    if (n > 20) n = 20;
    return n;
  }

  function setDot(kind, msg) {
    dot.classList.remove("on", "warn");
    if (kind === "on") dot.classList.add("on");
    if (kind === "warn") dot.classList.add("warn");
    statusText.textContent = msg;
  }

  // ---------- 进度区 ----------
  function setIndeterminate() {
    progressWrap.hidden = false;
    progressFill.classList.add("indet");
    progressFill.classList.remove("done", "err");
    progressPct.textContent = "";
  }

  function setRatio(ratio) {
    progressWrap.hidden = false;
    progressFill.classList.remove("indet", "done", "err");
    const pct = Math.max(0, Math.min(1, ratio));
    progressFill.style.width = (pct * 100).toFixed(1) + "%";
    progressPct.textContent = Math.round(pct * 100) + "%";
  }

  function setProgressText(t, isErr) {
    progressText.textContent = t || "";
    progressText.classList.toggle("err", !!isErr);
  }

  function addNote(t) {
    if (!t) return;
    noteText.textContent = noteText.textContent
      ? noteText.textContent + "；" + t
      : t;
  }

  // ---------- 结果区 ----------
  function renderResult(ev) {
    resultBox.hidden = false;
    fileList.innerHTML = "";
    resultLabel.textContent =
      "已保存 " + ev.moved + " / " + ev.count + " 个视频 → " + ev.dest;

    const files = ev.files || [];
    files.forEach(function (f) {
      const li = document.createElement("li");

      const name = document.createElement("span");
      name.className = "fname";
      const shown = f.target ? String(f.target).split("/").pop() : f.name;
      name.textContent = shown;
      name.title = f.target || f.name;
      li.appendChild(name);

      let tagClass = "ftag";
      let tagText = "新增";
      if (f.action === "renamed") {
        tagClass = "ftag warn";
        tagText = "已重命名（同名已存在）";
      } else if (f.action === "moved") {
        tagClass = "ftag";
        tagText = "新增";
      } else {
        tagClass = "ftag err";
        tagText = "失败";
      }
      const tag = document.createElement("span");
      tag.className = tagClass;
      tag.textContent = tagText;
      if (f.error) tag.title = f.error;
      li.appendChild(tag);

      const meta = document.createElement("span");
      meta.className = "fmeta";
      meta.textContent = humanSize(f.size);
      li.appendChild(meta);

      fileList.appendChild(li);
    });

    const failed = files.filter(function (f) {
      return !f.target;
    });
    if (failed.length) {
      const detail = failed
        .map(function (f) {
          return f.name + "：" + (f.error || "未知原因");
        })
        .join("；");
      addNote("失败明细 — " + detail);
    }
  }

  function succeed(ev) {
    progressFill.classList.remove("indet", "err");
    progressFill.classList.add("done");
    progressFill.style.width = "100%";
    progressPct.textContent = "100%";
    setProgressText("完成", false);
    lastDest = ev.dest;
    renderResult(ev);
    if (ev.moved === ev.count) {
      showToast("已取回 " + ev.moved + " 个视频");
    } else {
      showToast("取回 " + ev.moved + " / " + ev.count + " 个视频");
    }
  }

  function fail(msg) {
    progressWrap.hidden = false;
    progressFill.classList.remove("indet", "done");
    progressFill.classList.add("err");
    progressPct.textContent = "";
    setProgressText(msg, true);
    showToast("失败：" + msg);
  }

  // ---------- 后台 / 手机状态 ----------
  async function checkHealth() {
    try {
      const r = await fetch(getAPI() + "/api/health", { cache: "no-store" });
      const d = await r.json();
      backendOnline = !!d.ok;
    } catch {
      backendOnline = false;
    }

    if (!backendOnline) {
      setDot("off", "后台未连接 — 请先双击 start-server.bat 启动后台");
      fetchBtn.disabled = true;
      return;
    }

    try {
      const r2 = await fetch(getAPI() + "/api/phone-latest-videos/status", {
        cache: "no-store",
      });
      const s = await r2.json();

      quickPaths.desktop = s.desktop || null;
      quickPaths.downloads = s.downloads || null;
      desktopBtn.disabled = !quickPaths.desktop;
      downloadsBtn.disabled = !quickPaths.downloads;

      if (!s.relay) {
        setDot(
          "warn",
          "手机中继未运行 — 点「取回视频」时会自动尝试启动"
        );
      } else if (!s.phone) {
        setDot(
          "off",
          "手机未连接 — 请在手机 AutoJs6 里运行 autojs-task-phone-client.js"
        );
      } else {
        setDot("on", "手机已连接，可以开始");
      }
    } catch {
      setDot("warn", "后台已连接，但读取手机状态失败");
    }

    fetchBtn.disabled = busy;
  }

  async function openFolder(target) {
    const p = String(target || "").trim();
    if (!p) {
      showToast("请先填写文件夹路径");
      return;
    }
    try {
      const r = await fetch(getAPI() + "/api/phone-latest-videos/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      const d = await r.json();
      if (!d.ok) showToast(d.message || d.error || "打开失败");
    } catch (e) {
      showToast("打开失败：" + e);
    }
  }

  // ---------- 主流程 ----------
  function handleEvent(ev) {
    if (!ev || typeof ev !== "object") return;
    switch (ev.type) {
      case "step":
        setIndeterminate();
        setProgressText(ev.text || "");
        break;
      case "progress":
        if (typeof ev.done === "number" && typeof ev.total === "number" && ev.total > 0) {
          setRatio(ev.done / ev.total);
        } else {
          setIndeterminate();
        }
        setProgressText(ev.text || "");
        break;
      case "note":
        addNote(ev.text);
        break;
      case "error":
        fail(ev.text || "未知错误");
        break;
      case "result":
        succeed(ev);
        break;
      default:
        break;
    }
  }

  async function doFetch() {
    if (busy) return;

    const count = clampCount(countInput.value);
    countInput.value = String(count);

    const dest = destInput.value.trim();
    if (!dest) {
      showToast("请填写要保存到电脑上的文件夹");
      destInput.focus();
      return;
    }

    localStorage.setItem(K_COUNT, countInput.value);
    localStorage.setItem(K_DEST, destInput.value);

    busy = true;
    fetchBtn.disabled = true;

    // 重置界面
    resultBox.hidden = true;
    fileList.innerHTML = "";
    noteText.textContent = "";
    progressFill.style.width = "0%";
    setIndeterminate();
    setProgressText("准备中…", false);

    try {
      const resp = await fetch(getAPI() + "/api/phone-latest-videos/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: count, dest: dest }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(function () {
          return {};
        });
        fail(err.error || "后台返回 HTTP " + resp.status);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });

        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let ev = null;
          try {
            ev = JSON.parse(line);
          } catch {
            ev = null;
          }
          if (ev) handleEvent(ev);
        }
      }

      const tail = buf.trim();
      if (tail) {
        try {
          handleEvent(JSON.parse(tail));
        } catch {
          // 尾部残留不是完整 JSON，忽略
        }
      }
    } catch (e) {
      fail("请求失败：" + e);
    } finally {
      busy = false;
      checkHealth();
    }
  }

  // ---------- 初始化 ----------
  apiBaseEl.value = localStorage.getItem(K_API) || DEFAULT_API;
  apiBaseEl.addEventListener("change", function () {
    const v = apiBaseEl.value.trim();
    if (v) localStorage.setItem(K_API, v);
    checkHealth();
  });

  countInput.value = localStorage.getItem(K_COUNT) || "1";
  destInput.value = localStorage.getItem(K_DEST) || "";
  countInput.addEventListener("input", function () {
    localStorage.setItem(K_COUNT, countInput.value);
  });
  destInput.addEventListener("input", function () {
    localStorage.setItem(K_DEST, destInput.value);
  });

  desktopBtn.addEventListener("click", function () {
    if (!quickPaths.desktop) return;
    destInput.value = quickPaths.desktop;
    localStorage.setItem(K_DEST, destInput.value);
  });
  downloadsBtn.addEventListener("click", function () {
    if (!quickPaths.downloads) return;
    destInput.value = quickPaths.downloads;
    localStorage.setItem(K_DEST, destInput.value);
  });

  openDestBtn.addEventListener("click", function () {
    openFolder(destInput.value);
  });
  openAgainBtn.addEventListener("click", function () {
    openFolder(lastDest || destInput.value);
  });

  fetchBtn.addEventListener("click", doFetch);

  // 回车即取回（数量框 / 目标文件夹框）
  [countInput, destInput].forEach(function (el) {
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !busy && backendOnline) {
        e.preventDefault();
        doFetch();
      }
    });
  });

  checkHealth();
  setInterval(checkHealth, 5000);
})();
