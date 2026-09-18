// 路由插件：文件夹快速打开器
//
// POST /api/folder-opener/open
//   JSON body: { path: "文件夹路径" }
//   校验该路径是否存在且为文件夹：
//     - 存在且是文件夹 → 调用 explorer.exe 打开
//     - 不存在         → 404 { ok:false, code:"NOT_FOUND", message, path }
//     - 是文件不是目录 → 400 { ok:false, code:"NOT_DIR",   message, path }
//
// 路径约定：对外统一使用正斜杠 `/`（前端显示、错误提示、返回给用户都按 `/`），
//          仅在校验与交给 explorer.exe 时用 path.resolve 转成系统原生分隔符。

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

// ---- 路径清洗：去空白/去引号/展开 %VAR%/反斜杠转正斜杠/折叠多余斜杠 ----
function normalizePath(raw) {
  let p = String(raw == null ? "" : raw).trim();

  // 1) 去掉粘贴时成对包裹的引号（"D:\xxx" / 'D:\xxx'）
  if (
    p.length >= 2 &&
    ((p[0] === '"' && p[p.length - 1] === '"') ||
      (p[0] === "'" && p[p.length - 1] === "'"))
  ) {
    p = p.slice(1, -1).trim();
  }

  // 2) 展开 %USERPROFILE% 这类环境变量（大小写都试）
  p = p.replace(/%([^%]+)%/g, (m, name) => {
    const val = process.env[name] ?? process.env[name.toUpperCase()];
    return val == null ? m : val;
  });

  // 3) 统一改用正斜杠（本功能约定尽量用 `/`）；UNC 前缀 \\server\share 保留双斜杠
  const isUNC = /^\\\\/.test(p);
  p = p.replace(/\\/g, "/");
  if (isUNC) p = "//" + p.replace(/^\/+/, "");

  // 4) 折叠连续斜杠
  if (p.startsWith("//")) {
    p = "//" + p.slice(2).replace(/\/{2,}/g, "/");
  } else {
    p = p.replace(/\/{2,}/g, "/");
  }

  // 5) 去掉末尾多余的 `/`（保留 "C:/" 这种盘符根）
  if (p.length > 1 && !/^[A-Za-z]:\/$/.test(p)) {
    p = p.replace(/\/+$/, "");
  }

  return p;
}

export default function (app) {
  app.post("/api/folder-opener/open", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      return c.json({ ok: false, error: "解析 JSON 失败: " + e }, 400);
    }

    const shown = normalizePath(body.path);

    if (!shown) {
      return c.json(
        { ok: false, code: "EMPTY", message: "请输入文件夹路径", path: "" },
        400
      );
    }

    // 裸盘符 "D:" 视为 "D:/"
    const forResolve = /^[A-Za-z]:$/.test(shown) ? shown + "/" : shown;

    let native;
    try {
      native = path.resolve(forResolve);
    } catch (e) {
      return c.json(
        {
          ok: false,
          code: "BAD_PATH",
          message: "路径格式无法识别：" + shown,
          path: shown,
        },
        400
      );
    }

    // ---- 校验：存在？是文件夹？ ----
    let st;
    try {
      st = await stat(native);
    } catch {
      return c.json(
        {
          ok: false,
          code: "NOT_FOUND",
          message: "文件夹不存在：" + shown,
          path: shown,
        },
        404
      );
    }

    if (!st.isDirectory()) {
      return c.json(
        {
          ok: false,
          code: "NOT_DIR",
          message: "这不是文件夹（是一个文件）：" + shown,
          path: shown,
        },
        400
      );
    }

    // ---- 打开：交给系统资源管理器 ----
    try {
      const child = spawn("explorer.exe", [native], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.on("error", () => {});
      child.unref();
    } catch (e) {
      return c.json(
        {
          ok: false,
          code: "SPAWN_FAIL",
          message: "调用资源管理器失败：" + String(e.message || e),
          path: shown,
        },
        500
      );
    }

    // explorer.exe 即使成功也常返回非 0 退出码，故此处不做退出码判定
    return c.json({ ok: true, code: "OPENED", path: shown });
  });
}
