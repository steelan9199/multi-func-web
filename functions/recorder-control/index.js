(function () {
  var PROGRAMS = [
    { key: "broadcast", name: "NVIDIA Broadcast", icon: "\u{1F3A4}" },
    { key: "pointerfocus", name: "PointerFocus", icon: "\u{1F5B1}\uFE0F" },
    { key: "carnac", name: "Carnac", icon: "\u2328\uFE0F" },
    { key: "recordly", name: "Recordly", icon: "\u{1F4F9}" },
  ];

  var backendUrlInput = document.getElementById("backendUrl");
  var backendDot = document.getElementById("backendDot");
  var backendText = document.getElementById("backendText");
  var progGrid = document.getElementById("progGrid");
  var btnStart = document.getElementById("btnStart");
  var btnStop = document.getElementById("btnStop");
  var logArea = document.getElementById("logArea");

  var busy = false;

  function getBackend() {
    var v = (backendUrlInput.value || "").trim().replace(/\/+$/, "");
    return v || "http://localhost:18789";
  }

  function setBackendState(online) {
    backendDot.className = "status-dot " + (online ? "online" : "offline");
    backendText.textContent = online ? "后台在线" : "后台离线";
    if (online && !busy) {
      btnStart.disabled = false;
      btnStop.disabled = false;
    } else {
      btnStart.disabled = true;
      btnStop.disabled = true;
    }
  }

  function renderStatus(status) {
    progGrid.innerHTML = "";
    PROGRAMS.forEach(function (p) {
      var running = status && status[p.key];
      var card = document.createElement("div");
      card.className = "prog-card" + (running ? " running" : "");
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
        (running ? "\u25CF 运行中" : "\u25CB 未运行") +
        "</div></div>";
      progGrid.appendChild(card);
    });
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
