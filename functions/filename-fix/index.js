// 文件名纠错 · 纯前端实现（复刻 clean_filename 逻辑）
// 规则：
//  - 引号智能配对：" -> “ ”，' -> ‘ ’
//  - ! -> ！     , -> ，     . -> 。 （点号统一转中文句号）
//  - $ -> 空格
//  - 删除：# % & ( ) * + -
//  - 其余字符原样保留
//  - 清洗后为空/纯空白 -> 回退 "untitled"
//  - 结果自动复制到剪贴板
(function () {
  const input = document.getElementById("srcInput");
  const fixBtn = document.getElementById("fixBtn");
  const copyBtn = document.getElementById("copyBtn");
  const output = document.getElementById("output");

  // 直接替换的字符
  const MAP = {
    "!": "！",
    ",": "，",
    ".": "。",
  };

  // 无对应中文标点、直接删除的 ASCII 符号
  const DELETE = new Set("#%&()*+-".split(""));

  function clean(raw) {
    if (!raw) return "";
    let dq = 0; // 双引号奇偶计数
    let sq = 0; // 单引号奇偶计数
    let out = "";
    for (const ch of raw) {
      if (ch === '"') {
        out += dq % 2 === 0 ? "“" : "”";
        dq++;
        continue;
      }
      if (ch === "'") {
        out += sq % 2 === 0 ? "‘" : "’";
        sq++;
        continue;
      }
      if (ch === "$") {
        out += " ";
        continue;
      }
      if (MAP[ch] !== undefined) {
        out += MAP[ch];
        continue;
      }
      if (DELETE.has(ch)) {
        continue;
      }
      out += ch;
    }
    return out.trim();
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

  function run() {
    const raw = input.value;
    let result = clean(raw);
    if (!result.trim()) {
      result = "untitled";
    }
    output.textContent = result;
    copyText(result)
      .then(function () {
        showToast("已复制：" + result);
      })
      .catch(function () {
        showToast("复制失败，请手动复制");
      });
  }

  fixBtn.addEventListener("click", run);
  input.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run();
  });
  copyBtn.addEventListener("click", function () {
    const t = output.textContent;
    if (!t || t === "—") {
      showToast("还没有结果");
      return;
    }
    copyText(t)
      .then(function () {
        showToast("已复制");
      })
      .catch(function () {
        showToast("复制失败，请手动复制");
      });
  });

  input.focus();
})();
