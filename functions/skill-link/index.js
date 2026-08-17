// 技能链接生成器 · 逻辑
(function () {
  const PREFIX =
    "https://github.com/steelan9199/wechat-publisher/tree/main/skills/";
  const STORAGE_KEY = "skill_link_history";

  document.getElementById("prefixText").textContent = PREFIX;

  const input = document.getElementById("skillName");
  const genBtn = document.getElementById("genBtn");
  const listEl = document.getElementById("list");
  const emptyTip = document.getElementById("emptyTip");
  const clearBtn = document.getElementById("clearBtn");

  let history = loadHistory();

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      /* file:// 下可能不可用，忽略 */
    }
  }

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
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("copy failed"));
      } catch (e) {
        document.body.removeChild(ta);
        reject(e);
      }
    });
  }

  function render() {
    listEl.innerHTML = "";
    if (history.length === 0) {
      emptyTip.style.display = "block";
      return;
    }
    emptyTip.style.display = "none";
    history.forEach(function (url) {
      const li = document.createElement("li");

      const a = document.createElement("a");
      a.className = "link-text";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = url;

      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.textContent = "复制";
      copyBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        copyText(url)
          .then(function () {
            showToast("已复制");
          })
          .catch(function () {
            showToast("复制失败，请手动复制");
          });
      });

      li.appendChild(a);
      li.appendChild(copyBtn);
      listEl.appendChild(li);
    });
  }

  function generate() {
    let name = input.value.trim();
    if (!name) {
      showToast("请输入技能名");
      input.focus();
      return;
    }
    // 去掉 name 两边的单引号或者双引号
    name = name.replace(/^['"]|['"]$/g, "");
    const url = PREFIX + name;

    // 去重：若已存在则移到最前
    history = history.filter(function (u) {
      return u !== url;
    });
    history.unshift(url);
    saveHistory();
    render();

    copyText(url)
      .then(function () {
        showToast("已复制：" + name);
      })
      .catch(function () {
        showToast("复制失败，请手动复制");
      });

    input.value = "";
    input.focus();
  }

  genBtn.addEventListener("click", generate);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") generate();
  });
  clearBtn.addEventListener("click", function () {
    history = [];
    saveHistory();
    render();
    showToast("已清空记录");
  });

  render();
  input.focus();
})();
