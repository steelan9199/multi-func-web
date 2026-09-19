// 技能链接 + 常用链接 · 逻辑（纯原生 JS，无框架）
// 左栏：技能链接生成器（localStorage 存生成记录）
// 右栏：常用链接收藏（localStorage 存链接数组；行内可编辑，长链接自适应高度完整显示）
(function () {
  const PREFIX =
    "https://github.com/steelan9199/wechat-publisher/tree/main/skills/";
  const NAME_KEY = "skill_link_name"; // 上次输入的技能名
  const STORAGE_KEY = "skill_link_history"; // 左栏生成记录
  const FAV_KEY = "link_favorites"; // 右栏常用链接

  // ==================== 通用 ====================

  // file:// 下也能用的复制
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

  // 输入框自适应高度：长链接折行后完整显示（最多 3 行，再多内部滚动）
  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }

  // 链接是单行语义，粘贴带进来的换行直接去掉
  function stripNewlines(el) {
    if (/[\r\n]/.test(el.value)) {
      const pos = el.selectionStart;
      el.value = el.value.replace(/[\r\n]+/g, "");
      try {
        el.setSelectionRange(pos - 1, pos - 1);
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  // 规整链接：去换行/制表/首尾空白；若被成对引号或尖括号包裹则剥掉
  function cleanUrl(u) {
    let s = String(u || "").replace(/[\r\n\t]+/g, "").trim();
    while (s.length > 1 && /^['"<]/.test(s) && /['">]$/.test(s)) {
      s = s.slice(1, -1).trim();
    }
    return s;
  }

  // toast 里只露开头，避免超长链接把提示条撑爆
  function shortText(s) {
    s = String(s || "");
    return s.length > 46 ? s.slice(0, 44) + "…" : s;
  }

  function flashHit(el) {
    if (!el) return;
    el.classList.add("hit");
    setTimeout(function () {
      el.classList.remove("hit");
    }, 1400);
  }

  // ==================== 左栏：技能链接生成器 ====================

  const input = document.getElementById("skillName");
  const genBtn = document.getElementById("genBtn");
  const listEl = document.getElementById("list");
  const emptyTip = document.getElementById("emptyTip");
  const clearBtn = document.getElementById("clearBtn");

  document.getElementById("prefixText").textContent = PREFIX;

  let history = loadHistory();

  // 回填上次输入的技能名，并在输入时实时记忆
  input.value = localStorage.getItem(NAME_KEY) || "";
  input.addEventListener("input", function () {
    try {
      localStorage.setItem(NAME_KEY, input.value);
    } catch (e) {
      /* 隐私模式下写不进去，忽略 */
    }
  });

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

  function renderHistory() {
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
    history.splice(6);
    saveHistory();
    renderHistory();

    copyText(url)
      .then(function () {
        showToast("已复制：" + name);
      })
      .catch(function () {
        showToast("复制失败，请手动复制");
      });

    input.focus();
  }

  genBtn.addEventListener("click", generate);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") generate();
  });
  clearBtn.addEventListener("click", function () {
    history = [];
    saveHistory();
    renderHistory();
    showToast("已清空生成记录");
  });

  // ==================== 右栏：常用链接 ====================

  const addInput = document.getElementById("addInput");
  const addBtn = document.getElementById("addBtn");
  const favList = document.getElementById("favList");
  const favEmpty = document.getElementById("favEmpty");
  const favCount = document.getElementById("favCount");

  let favs = loadFavs();

  function loadFavs() {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr)
        ? arr.filter(function (x) {
            return typeof x === "string";
          })
        : [];
    } catch (e) {
      return [];
    }
  }

  function saveFavs() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    } catch (e) {
      /* 隐私模式下写不进去，忽略 */
    }
  }

  // 右栏所有行内输入框（用于按行号定位 / 高亮）；不含顶部「新增」框
  function rowInputs() {
    return favList.querySelectorAll("textarea.path-input");
  }

  function renderFavs() {
    favList.innerHTML = "";
    favs.forEach(function (url, i) {
      favList.appendChild(buildFavRow(url, i));
    });
    // 必须等输入框真正挂到 DOM 之后再量高度：document 外读 scrollHeight 会得到 0
    rowInputs().forEach(autoGrow);
    favEmpty.style.display = favs.length ? "none" : "block";
    favCount.textContent = "共 " + favs.length + " 条";
  }

  function buildFavRow(url, i) {
    const row = document.createElement("div");
    row.className = "path-row";

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = String(i + 1);

    const ta = document.createElement("textarea");
    ta.className = "path-input";
    ta.rows = 1;
    ta.value = url;
    ta.title = url;
    ta.dataset.prev = url; // 已提交的值，用于重复时还原
    ta.placeholder = "粘贴或修改链接…";
    ta.autocomplete = "off";
    ta.spellcheck = false;

    ta.addEventListener("input", function () {
      stripNewlines(ta);
      ta.title = ta.value;
      favs[i] = ta.value;
      saveFavs();
      autoGrow(ta);
    });
    ta.addEventListener("paste", function () {
      setTimeout(function () {
        stripNewlines(ta);
        ta.title = ta.value;
        favs[i] = ta.value;
        saveFavs();
        autoGrow(ta);
      }, 0);
    });
    ta.addEventListener("keydown", function (e) {
      // 行内框是单行语义：回车 = 提交
      if (e.key === "Enter") {
        e.preventDefault();
        ta.blur();
      }
    });
    ta.addEventListener("blur", function () {
      commitFav(i, ta);
    });

    const acts = document.createElement("div");
    acts.className = "acts";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn secondary small";
    copyBtn.textContent = "复制";
    copyBtn.title = "复制这条链接";
    copyBtn.addEventListener("click", function () {
      const v = ta.value.trim();
      if (!v) {
        showToast("这一行为空，没有可复制的内容");
        return;
      }
      copyText(v).then(
        function () {
          showToast("已复制：" + shortText(v));
        },
        function () {
          showToast("复制失败，请手动选中复制");
        }
      );
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger small";
    delBtn.textContent = "删除";
    delBtn.title = "删除这条链接";
    delBtn.addEventListener("click", function () {
      removeFav(i, "已删除第 " + (i + 1) + " 条");
    });

    acts.appendChild(copyBtn);
    acts.appendChild(delBtn);
    row.appendChild(idx);
    row.appendChild(ta);
    row.appendChild(acts);
    // 注意：此处不能 autoGrow —— 元素还没进 DOM，量不出高度，由 renderFavs 统一处理
    return row;
  }

  // 提交一行：空则删除，重复则还原并高亮已有那条
  function commitFav(i, ta) {
    const v = cleanUrl(ta.value);
    const prev = ta.dataset.prev || "";

    if (!v) {
      removeFav(i, prev ? "内容已清空，该条已删除" : "已移除空白行");
      return;
    }

    const dup = favs.findIndex(function (x, j) {
      return j !== i && cleanUrl(x) === v;
    });
    if (dup >= 0) {
      ta.value = prev;
      ta.title = prev;
      favs[i] = prev;
      saveFavs();
      autoGrow(ta);
      flashHit(rowInputs()[dup]);
      showToast("与第 " + (dup + 1) + " 条重复，已还原");
      return;
    }

    if (v !== ta.value) {
      ta.value = v;
      autoGrow(ta);
    }
    ta.title = v;
    ta.dataset.prev = v;
    favs[i] = v;
    saveFavs();
  }

  function removeFav(i, msg) {
    favs.splice(i, 1);
    saveFavs();
    renderFavs();
    if (msg) showToast(msg);
  }

  function addFav() {
    const v = cleanUrl(addInput.value);
    if (!v) {
      showToast("请先粘贴链接");
      addInput.focus();
      return;
    }

    const dup = favs.findIndex(function (x) {
      return cleanUrl(x) === v;
    });
    if (dup >= 0) {
      const el = rowInputs()[dup];
      flashHit(el);
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      showToast("该链接已存在（第 " + (dup + 1) + " 条）");
      addInput.select();
      return;
    }

    favs.unshift(v);
    saveFavs();
    renderFavs();

    addInput.value = "";
    autoGrow(addInput);
    favList.scrollTop = 0;
    showToast("已添加：" + shortText(v));
    addInput.focus();
  }

  addInput.addEventListener("input", function () {
    stripNewlines(addInput);
    autoGrow(addInput);
  });
  addInput.addEventListener("paste", function () {
    setTimeout(function () {
      stripNewlines(addInput);
      autoGrow(addInput);
    }, 0);
  });
  addInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addFav();
    }
  });
  addBtn.addEventListener("click", addFav);

  // 窗口尺寸变化时重算高度（宽度变了折行数会变）
  window.addEventListener("resize", function () {
    autoGrow(addInput);
    rowInputs().forEach(autoGrow);
  });

  // ==================== 初始化 ====================
  renderHistory();
  renderFavs();
  autoGrow(addInput);
  input.focus();
})();
