(function () {
  var PROGRAMS = [
    { key: "broadcast", name: "NVIDIA Broadcast", icon: "\u{1F3A4}" },
    { key: "pointerfocus", name: "PointerFocus", icon: "\u{1F5B1}\uFE0F" },
    { key: "carnac", name: "Carnac", icon: "\u2328\uFE0F" },
    { key: "obs", name: "OBS", icon: "\u{1F4F9}" },
  ];

  var backendUrlInput = document.getElementById("backendUrl");
  var backendDot = document.getElementById("backendDot");
  var backendText = document.getElementById("backendText");
  var progGrid = document.getElementById("progGrid");
  var btnStart = document.getElementById("btnStart");
  var btnStop = document.getElementById("btnStop");
  var logArea = document.getElementById("logArea");

  var busy = false;
  var cardBusy = {};

  function getBackend() {
    var v = (backendUrlInput.value || "").trim().replace(/\/+$/, "");
    return v || "http://localhost:18789";
  }

  function setBackendState(online) {
    backendDot.className = "status-dot " + (online ? "online" : "offline");
    backendText.textContent = online ? "后台在线" : "后台离线";
    var cards = progGrid.querySelectorAll(".prog-card");
    cards.forEach(function (card) {
      var key = card.getAttribute("data-key");
      var isCardBusy = cardBusy[key];
      var disabled = !online || busy || isCardBusy;
      card.style.pointerEvents = disabled ? "none" : "auto";
      card.style.opacity = disabled ? "0.5" : "1";
    });
    if (online && !busy) {
      btnStart.disabled = false;
      btnStop.disabled = false;
    } else {
      btnStart.disabled = true;
      btnStop.disabled = true;
    }
  }

  function renderStatus(status) {
    var prevBusy = {};
    progGrid.querySelectorAll(".prog-card").forEach(function (card) {
      var key = card.getAttribute("data-key");
      if (cardBusy[key]) prevBusy[key] = cardBusy[key];
    });

    progGrid.innerHTML = "";
    PROGRAMS.forEach(function (p) {
      var running = status && status[p.key];
      var isLoading = prevBusy[p.key];
      var card = document.createElement("div");
      card.className =
        "prog-card" +
        (running ? " running" : "") +
        (isLoading ? " loading" : "");
      card.setAttribute("data-key", p.key);
      card.innerHTML =
        '<div class="prog-icon">' +
        p.icon +
        "</div>" +
        '<div class="prog-info">' +
        '<div class="prog-name">' +
        p.name +
        "</div>" +
        '<div class="prog-state' +
        (running ? " running" : "") +
        '">' +
        (isLoading
          ? "\u23F3 处理中..."
          : running
            ? "\u25CF 运行中"
            : "\u25CB 未运行") +
        "</div></div>";
      card.addEventListener("click", function () {
        toggleProgram(p.key, p.name);
      });
      progGrid.appendChild(card);
    });
    setBackendState(
      backendDot.classList.contains("online") && !busy,
    );
  }

  async function toggleProgram(key, name) {
    if (busy || cardBusy[key]) return;
    cardBusy[key] = true;
    var currentStatus = await getStatusData();
    var wasRunning = currentStatus && currentStatus[key];
    var action = wasRunning ? "停止" : "启动";
    renderStatus(currentStatus);

    appendLog(
      "\u23F5 [" + new Date().toLocaleTimeString("zh-CN") + "] " +
        (wasRunning ? "\u23F9" : "\u25B6") + " " +
        action + " " + name + "...\n",
    );

    try {
      var resp = await fetch(getBackend() + "/api/recorder-control/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program: key }),
      });
      var data = await resp.json();
      if (data.ok) {
        appendLog(
          "  \u2192 " + name + " 已" + (data.running ? "启动" : "停止") + " " +
          (data.running ? "\u2705" : "\u26D4") + "\n",
        );
        window.showToast(name + " 已" + (data.running ? "启动" : "停止"));
      } else {
        appendLog(
          "  \u274C 操作失败: " + (data.error || "未知错误") + "\n",
        );
        window.showToast("操作失败: " + (data.error || "未知错误"));
      }
    } catch (e) {
      appendLog("  \u274C 请求失败: " + e.message + "\n");
      window.showToast("请求失败: " + e.message);
    }

    cardBusy[key] = false;
    await refreshStatus();
  }

  async function getStatusData() {
    try {
      var resp = await fetch(getBackend() + "/api/recorder-control/status");
      var data = await resp.json();
      if (data.ok) return data.status;
    } catch (_) {}
    return null;
  }

  function appendLog(text) {
    if (logArea.querySelector(".log-placeholder")) {
      logArea.innerHTML = "";
    }
    logArea.appendChild(document.createTextNode(text));
    logArea.scrollTop = logArea.scrollHeight;
  }

  function clearLog() {
    logArea.innerHTML = "";
  }

  async function checkBackend() {
    try {
      var resp = await fetch(getBackend() + "/api/health", {
        method: "GET",
      });
      if (resp.ok) {
        setBackendState(true);
        await refreshStatus();
        return true;
      }
    } catch (_) {}
    setBackendState(false);
    renderStatus(null);
    return false;
  }

  async function refreshStatus() {
    try {
      var resp = await fetch(getBackend() + "/api/recorder-control/status");
      var data = await resp.json();
      if (data.ok) {
        renderStatus(data.status);
      }
    } catch (_) {}
  }

  async function streamAction(endpoint, label) {
    if (busy) return;
    busy = true;
    btnStart.disabled = true;
    btnStop.disabled = true;

    clearLog();
    appendLog("[开始] " + label + "\n\n");

    try {
      var resp = await fetch(
        getBackend() + "/api/recorder-control/" + endpoint,
        {
          method: "POST",
        },
      );
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        appendLog(decoder.decode(chunk.value, { stream: true }));
      }
    } catch (e) {
      appendLog("\n[错误] " + e.message + "\n");
    }

    await refreshStatus();
    busy = false;
    setBackendState(true);
    window.showToast(label + " 操作完成");
  }

  btnStart.addEventListener("click", function () {
    streamAction("start", "启动录课");
  });
  btnStop.addEventListener("click", function () {
    streamAction("stop", "停止录课");
  });

  backendUrlInput.addEventListener("change", function () {
    localStorage.setItem("recorder-control-backendUrl", getBackend());
    checkBackend();
  });

  (function init() {
    var saved = localStorage.getItem("recorder-control-backendUrl");
    if (saved) backendUrlInput.value = saved;
    renderStatus(null);
    checkBackend();
    setInterval(function () {
      if (!busy) checkBackend();
    }, 10000);
  })();
})();
