// 路由插件：文件图标更换器
// POST /api/file-icon/stream
//   multipart/form-data:
//     image      - 用户上传的 PNG/JPG（File）
//     targetPath - 目标文件/文件夹绝对路径
//   流式返回执行日志（text/plain）。
//
// 三种场景（参考 file-icon-favicon-helper 技能规则）：
//   1) 目标是 .lnk 快捷方式：解析其指向 -> 图标放到指向文件所在目录 / 指向文件夹内，
//      修改该 .lnk 的 IconLocation（本体不动，双击行为不变）。
//   2) 目标是文件夹：图标放进该文件夹，写 desktop.ini 的 IconResource + 设只读属性。
//   3) 目标是普通文件：Windows 无法单独改普通文件图标 -> 在文件同目录创建
//      带自定义图标的 .lnk 快捷方式（双击 = 打开原文件），本体图标保持不变。
// .ico 命名跟随目标名（.lnk/扩展名去掉），原图以原文件名存入同一目录。

import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 受管 Python venv（已装 Pillow），用于 PNG/JPG -> 多分辨率 .ico
const PYTHON =
  "C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe";
const PNG_TO_ICO = join(__dirname, "..", "scripts", "png_to_ico.py");
const PS1 = join(__dirname, "..", "scripts", "file_icon.ps1");

// 统一的子进程封装：收集 stdout/stderr，返回 {code, stdout, stderr}
function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) =>
      resolve({ code: -1, stdout, stderr: stderr + String(e) })
    );
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// 调 file_icon.ps1（ASCII 脚本 + 参数传路径，无内嵌编码问题）
function runPS(mode, target, icon, out) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    PS1,
    "-Mode",
    mode,
    "-Target",
    target,
    "-Icon",
    icon || "",
    "-Out",
    out || "",
  ];
  return run("powershell.exe", args);
}

export default function (app) {
  app.post("/api/file-icon/stream", async (c) => {
    let body;
    try {
      body = await c.req.parseBody({ all: false });
    } catch (e) {
      return c.json({ ok: false, error: "解析表单失败: " + e }, 400);
    }

    const image = body.image;
    const targetPath = String(body.targetPath || "").trim();

    if (!targetPath) {
      return c.json({ ok: false, error: "缺少目标路径 targetPath" }, 400);
    }
    if (!image || typeof image === "string") {
      return c.json({ ok: false, error: "请选择一张 PNG/JPG 图片" }, 400);
    }
    const imgName = image.name || "upload.png";
    const imgExt = extname(imgName).toLowerCase();
    if (![".png", ".jpg", ".jpeg"].includes(imgExt)) {
      return c.json(
        { ok: false, error: "图片仅支持 PNG / JPG（当前: " + imgExt + "）" },
        400
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (s) => controller.enqueue(encoder.encode(s));
        const fail = (msg) => {
          send("\n[失败] " + msg + "\n");
          controller.close();
        };

        try {
          // ---- 1. 判定目标类型 ----
          send("[目标] " + targetPath + "\n");
          let st;
          try {
            st = await stat(targetPath);
          } catch {
            return fail("路径不存在，请检查后重试");
          }

          const isDir = st.isDirectory();
          const isLnk = !isDir && extname(targetPath).toLowerCase() === ".lnk";
          let mode; // 'lnk' | 'folder' | 'file'
          if (isLnk) mode = "lnk";
          else if (isDir) mode = "folder";
          else mode = "file";

          // ---- 2. 确定 .ico 存放目录与命名 ----
          let iconDir; // .ico 与原图存放目录
          let baseName; // .ico 主名（跟随目标名）

          if (mode === "lnk") {
            send("[解析] 正在读取快捷方式指向…\n");
            const r = await runPS("resolve", targetPath);
            if (r.code !== 0 || !r.stdout.trim()) {
              return fail(
                "读取快捷方式失败: " + (r.stderr.trim() || "退出码 " + r.code)
              );
            }
            const resolved = r.stdout.trim();
            send("[解析] 快捷方式指向 -> " + resolved + "\n");
            let rst = null;
            try {
              rst = await stat(resolved);
            } catch {
              send("[警告] 指向的目标不存在，图标仍将生成但可能无法生效\n");
            }
            iconDir = rst && rst.isDirectory() ? resolved : dirname(resolved);
            baseName = basename(targetPath, ".lnk");
          } else if (mode === "folder") {
            iconDir = targetPath;
            baseName = basename(targetPath);
          } else {
            iconDir = dirname(targetPath);
            baseName = basename(targetPath, extname(targetPath));
          }

          // 清理主名里可能残留的扩展名（如 .url.lnk 之类极端情况不处理，仅去尾点）
          baseName = baseName.replace(/[.]+$/, "") || "app_icon";
          const iconPath = join(iconDir, baseName + ".ico");
          const imagePath = join(iconDir, imgName);
          send("[目录] 图标与原图将保存到: " + iconDir + "\n");
          send("[图标] " + iconPath + "\n");
          send("[原图] " + imagePath + "\n");

          // ---- 3. 保存原图 ----
          const buf = Buffer.from(await image.arrayBuffer());
          await writeFile(imagePath, buf);
          send("[完成] 原图已保存\n");

          // ---- 4. PNG/JPG -> 多分辨率 .ico ----
          send("[转换] 正在生成多分辨率 .ico（16-256）…\n");
          const cv = await run(PYTHON, [PNG_TO_ICO, imagePath, iconPath]);
          if (cv.code !== 0 || !cv.stdout.includes("ICO_WRITTEN")) {
            return fail(
              "转换 .ico 失败: " + (cv.stderr.trim() || cv.stdout.trim())
            );
          }
          // 脚本可能用了兜底文件名（被占用时），以真实路径为准
          const m = cv.stdout.match(/ICO_WRITTEN\s+(.+)/);
          const actualIcon = m ? m[1].trim() : iconPath;
          if (actualIcon !== iconPath) {
            send("[提示] 原 .ico 被占用，已改用: " + actualIcon + "\n");
          }
          send("[完成] " + cv.stdout.trim() + "\n");

          // ---- 5. 应用图标 ----
          if (mode === "lnk") {
            send("[应用] 正在修改快捷方式图标字段…\n");
            const r = await runPS("setlnk", targetPath, actualIcon);
            if (r.code !== 0) {
              return fail("修改快捷方式失败: " + r.stderr.trim());
            }
            send("[完成] 快捷方式图标已更新（指向与双击行为不变）\n");
          } else if (mode === "folder") {
            send("[应用] 正在写入 desktop.ini 并设置文件夹属性…\n");
            const r = await runPS("folder", targetPath, actualIcon);
            if (r.code !== 0) {
              return fail("修改文件夹图标失败: " + r.stderr.trim());
            }
            send("[完成] 文件夹图标已更新（desktop.ini + 只读属性）\n");
          } else {
            const lnkPath = join(iconDir, baseName + ".lnk");
            send("[应用] 普通文件无法单独改图标，正在创建快捷方式…\n");
            send("[快捷方式] " + lnkPath + "\n");
            const r = await runPS("createlnk", targetPath, actualIcon, lnkPath);
            if (r.code !== 0) {
              return fail("创建快捷方式失败: " + r.stderr.trim());
            }
            send("[完成] 快捷方式已创建，双击 = 打开原文件（本体图标不变，Windows 平台限制）\n");
          }

          // ---- 6. 收尾提示 ----
          send(
            "\n[提示] 若资源管理器图标未刷新：请打开命令提示符或 PowerShell，执行 taskkill /f /im explorer.exe && start explorer.exe（会重启资源管理器以刷新图标）。\n"
          );
          send("[提示] .ico 与原图所在目录请勿删除/移动，否则图标会回退为默认\n");
          send("\n[成功] 全部完成 ✔\n");
          controller.close();
        } catch (e) {
          fail(String(e));
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });
}
