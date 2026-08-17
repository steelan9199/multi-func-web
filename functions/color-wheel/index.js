// 色轮取色器 · 纯前端实现
//  - canvas 绘制 HSL 色盘（角度=色相，半径=饱和度，中心白、外缘饱和）
//  - 鼠标移动用 getImageData 读取指针所在像素的 RGBA，实时显示
//  - 按 C 在 HEX / RGB 之间切换
//  - 单击把当前值复制到剪贴板
(function () {
  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const bubble = document.getElementById("bubble");
  const bubbleText = document.getElementById("bubbleText");
  const bubbleSwatch = document.getElementById("bubbleSwatch");
  const chip = document.getElementById("chip");
  const valEl = document.getElementById("val");
  const modeLabel = document.getElementById("modeLabel");
  const posLabel = document.getElementById("posLabel");

  const CSS_SIZE = 320;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(CSS_SIZE * dpr);
  const H = Math.round(CSS_SIZE * dpr);
  canvas.width = W;
  canvas.height = H;
  const cx = W / 2;
  const cy = H / 2;
  const R = (CSS_SIZE / 2 - 6) * dpr; // 半径，外留 6px 边

  let mode = "hex"; // 'hex' | 'rgb'
  let current = null; // { r, g, b, px, py } 或 null

  function hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0,
      g = 0,
      b = 0;
    if (h < 60) {
      r = c;
      g = x;
    } else if (h < 120) {
      r = x;
      g = c;
    } else if (h < 180) {
      g = c;
      b = x;
    } else if (h < 240) {
      g = x;
      b = c;
    } else if (h < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }

  function drawWheel() {
    const img = ctx.createImageData(W, H);
    const data = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * W + x) * 4;
        if (r <= R) {
          let s = r / R;
          if (s > 1) s = 1;
          const h = (Math.atan2(dy, dx) * 180) / Math.PI + 360;
          const hh = h % 360;
          const rgb = hsvToRgb(hh, s, 1);
          data[idx] = rgb[0];
          data[idx + 1] = rgb[1];
          data[idx + 2] = rgb[2];
          data[idx + 3] = 255;
        } else {
          data[idx + 3] = 0; // 圈外透明
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // 描边
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = "#e2e5ea";
    ctx.stroke();
  }

  function toHex(r, g, b) {
    const h = function (n) {
      return n.toString(16).padStart(2, "0").toUpperCase();
    };
    return "#" + h(r) + h(g) + h(b);
  }
  function toRgb(r, g, b) {
    return "rgb(" + r + ", " + g + ", " + b + ")";
  }
  function format(c) {
    return mode === "hex"
      ? toHex(c.r, c.g, c.b)
      : toRgb(c.r, c.g, c.b);
  }

  function updateReadout() {
    if (!current) {
      valEl.textContent = "—";
      chip.style.background = "#fff";
      posLabel.textContent = "—";
      return;
    }
    const text = format(current);
    valEl.textContent = text;
    chip.style.background = toHex(current.r, current.g, current.b);
    posLabel.textContent = "x:" + current.px + " y:" + current.py;
  }

  function showBubble(e) {
    bubbleSwatch.style.background = toHex(current.r, current.g, current.b);
    bubbleText.textContent = format(current);
    bubble.style.display = "flex";
    let left = e.clientX + 16;
    let top = e.clientY + 16;
    const bw = bubble.offsetWidth || 120;
    const bh = bubble.offsetHeight || 32;
    if (left + bw > window.innerWidth) left = e.clientX - bw - 16;
    if (top + bh > window.innerHeight) top = e.clientY - bh - 16;
    bubble.style.left = left + "px";
    bubble.style.top = top + "px";
  }

  function hideBubble() {
    bubble.style.display = "none";
  }

  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const px = Math.floor((e.clientX - rect.left) * sx);
    const py = Math.floor((e.clientY - rect.top) * sy);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) {
      current = null;
      updateReadout();
      hideBubble();
      return;
    }
    const d = ctx.getImageData(px, py, 1, 1).data;
    if (d[3] === 0) {
      // 圈外
      current = null;
      updateReadout();
      hideBubble();
      return;
    }
    current = {
      r: d[0],
      g: d[1],
      b: d[2],
      px: Math.round(px / sx),
      py: Math.round(py / sy),
    };
    updateReadout();
    showBubble(e);
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
        document.execCommand("copy")
          ? resolve()
          : reject(new Error("copy failed"));
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  canvas.addEventListener("mousemove", pick);
  canvas.addEventListener("mouseleave", function () {
    current = null;
    updateReadout();
    hideBubble();
  });
  canvas.addEventListener("click", function () {
    if (!current) return;
    const text = format(current);
    copyText(text)
      .then(function () {
        showToast("已复制：" + text);
      })
      .catch(function () {
        showToast("复制失败，请手动复制");
      });
  });
  // 触摸支持
  canvas.addEventListener(
    "touchmove",
    function (e) {
      if (e.touches.length) {
        pick(e.touches[0]);
        e.preventDefault();
      }
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length) {
        pick(e.touches[0]);
        e.preventDefault();
      }
    },
    { passive: false }
  );
  canvas.addEventListener("touchend", function () {
    hideBubble();
  });

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "c" || e.key === "C") {
      mode = mode === "hex" ? "rgb" : "hex";
      modeLabel.textContent =
        "格式：" + (mode === "hex" ? "HEX" : "RGB");
      updateReadout();
      if (current) {
        bubbleSwatch.style.background = toHex(
          current.r,
          current.g,
          current.b
        );
        bubbleText.textContent = format(current);
      }
    }
  });

  drawWheel();
  updateReadout();
})();
