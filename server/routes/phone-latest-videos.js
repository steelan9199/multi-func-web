// 路由插件：手机最新视频取回
//
// GET  /api/phone-latest-videos/status
//   返回 { ok, relay, phone, skillDir, home, desktop, downloads }
//   - relay / phone：手机中继（localhost:9421）是否在跑、手机是否已连上
//   - desktop / downloads：解析好的常用目录，供前端「快捷按钮」使用
//
// POST /api/phone-latest-videos/stream
//   JSON body: { count: 1~20, dest: "要保存到电脑上的哪个文件夹" }
//   流式返回 NDJSON（每行一个 JSON 对象），事件类型：
//     { type:"step",     text }                          阶段提示
//     { type:"progress", done, total, text }             进度（进度条用）
//     { type:"note",     text }                          附带说明
//     { type:"error",    text }                          失败（终态）
//     { type:"result",   ok, dest, count, moved, opened, files:[...] }  成功（终态）
//
// POST /api/phone-latest-videos/open
//   JSON body: { path }  在资源管理器中打开该文件夹
//
// 实现要点
//   1) 依赖手机任务技能 autojs-mobile-automation-yashu-public：
//      复用其手机端模板 download-latest-videos（扫 DCIM/Camera，按修改时间取最新 N 个 → 上传到
//      技能目录的 scripts/uploads/），本路由再把这批文件搬运到用户指定目录。
//   2) 中继未运行时会尝试补位启动（已在跑则绝不重启，避免踢掉已连接的手机）。
//   3) 同名文件不覆盖：自动追加 _1 / _2 后缀，两份都保留。
//   4) 跨盘移动用 rename，遇 EXDEV 回退 copy + unlink。
//   5) 只有全部搬运成功才自动打开目标文件夹，避免弹出空/半截的文件夹。

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const RELAY_PORT = 9421;
const RELAY_HEALTH = "http://localhost:" + RELAY_PORT + "/health";
const SKILL_ID = "autojs-mobile-automation-yashu-public";

// 技能目录候选：WorkBuddy 下那份是软链接，真身在 skills-manager 下。
// uploads 回包给出的是真实路径，故优先解析到真身，避免路径形态不一致。
const SKILL_CANDIDATES = [
  "C:/Users/Administrator/.workbuddy/skills/" + SKILL_ID,
  "D:/CToD/Users/Administrator/.skills-manager/skills/" + SKILL_ID,
];

let cachedSkillDir;
function resolveSkillDir() {
  if (cachedSkillDir !== undefined) return cachedSkillDir;
  for (const p of SKILL_CANDIDATES) {
    try {
      const real = realpathSync(p);
      if (existsSync(join(real, "scripts", "run-task.js"))) {
        cachedSkillDir = real;
        return real;
      }
    } catch {
      // 换下一个候选
    }
  }
  cachedSkillDir = null;
  return null;
}

function toSlash(p) {
  return String(p).replace(/\\/g, "/");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// ---- 路径清洗：去空白/去引号/展开 %VAR%/反斜杠转正斜杠/折叠多余斜杠（与 folder-opener 同款） ----
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

  // 3) 统一改用正斜杠；UNC 前缀 \\server\share 保留双斜杠
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

// ---- 中继健康检查（带 2.5s 超时，避免卡死） ----
async function healthOnce() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch(RELAY_HEALTH, { signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 确保中继在跑：已在跑直接复用（绝不重启）；没在跑才补位启动
async function ensureRelay(send) {
  let h = await healthOnce();
  if (h && h.status === "ok") return h;

  const skillDir = resolveSkillDir();
  if (!skillDir) return null;

  send({ type: "note", text: "手机中继没在运行，正在尝试自动启动…" });
  try {
    const child = spawn(
      process.execPath,
      [join(skillDir, "scripts", "autojs-relay-server.js")],
      { cwd: skillDir, detached: true, stdio: "ignore", windowsHide: true }
    );
    child.on("error", () => {});
    child.unref();
  } catch {
    return null;
  }

  for (let i = 0; i < 16; i++) {
    await sleep(500);
    h = await healthOnce();
    if (h && h.status === "ok") return h;
  }
  return h;
}

// ---- 跑技能目录里的 run-task.js（不经过 shell，参数由 Node 自己转义） ----
function runTask(skillDir, argsArr) {
  return new Promise((resolveP) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(
        process.execPath,
        [join(skillDir, "scripts", "run-task.js")].concat(argsArr),
        { cwd: skillDir, windowsHide: true }
      );
    } catch (e) {
      return resolveP({ code: -1, stdout: "", stderr: String(e) });
    }
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) =>
      resolveP({ code: -1, stdout: out, stderr: err + String(e) })
    );
    child.on("close", (code) => resolveP({ code, stdout: out, stderr: err }));
  });
}

// run-task.js 正常只打印一行 JSON；从后往前找第一个能解析的行，容错夹杂的其它输出
function parseLastJson(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t.startsWith("{")) continue;
    try {
      return JSON.parse(t);
    } catch {
      // 继续往前找
    }
  }
  return null;
}

// ---- 同名不覆盖：重命名后移动；跨盘 rename 失败回退 copy+unlink ----
async function moveWithRename(srcPath, destDir, fileName) {
  const safe = basename(fileName);
  let target = join(destDir, safe);
  let renamed = false;

  if (existsSync(target)) {
    const ext = extname(safe);
    const stem = basename(safe, ext);
    let i = 1;
    while (existsSync(join(destDir, stem + "_" + i + ext))) i++;
    target = join(destDir, stem + "_" + i + ext);
    renamed = true;
  }

  try {
    await rename(srcPath, target);
  } catch (e) {
    if (e && e.code === "EXDEV") {
      await cp(srcPath, target);
      await unlink(srcPath);
    } else {
      throw e;
    }
  }
  return { target, renamed };
}

function openExplorer(target) {
  try {
    const child = spawn("explorer.exe", [target], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export default function (app) {
  // ---- 状态：中继/手机是否就绪 + 常用目录 ----
  app.get("/api/phone-latest-videos/status", async (c) => {
    const skillDir = resolveSkillDir();
    const h = await healthOnce();
    const home = homedir();
    const pickDir = (p) => (existsSync(p) ? toSlash(p) : null);

    return c.json({
      ok: true,
      relay: !!(h && h.status === "ok"),
      phone: !!(h && h.phone === "connected"),
      skillDir: skillDir ? toSlash(skillDir) : null,
      home: toSlash(home),
      desktop: pickDir(join(home, "Desktop")) || pickDir(join(home, "OneDrive", "Desktop")),
      downloads: pickDir(join(home, "Downloads")),
    });
  });

  // ---- 打开文件夹（复用 folder-opener 的校验风格） ----
  app.post("/api/phone-latest-videos/open", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      return c.json({ ok: false, error: "解析 JSON 失败: " + e }, 400);
    }

    const shown = normalizePath(body.path);
    if (!shown) {
      return c.json({ ok: false, code: "EMPTY", message: "缺少文件夹路径" }, 400);
    }

    const forResolve = /^[A-Za-z]:$/.test(shown) ? shown + "/" : shown;
    let native;
    try {
      native = resolve(forResolve);
    } catch {
      return c.json(
        { ok: false, code: "BAD_PATH", message: "路径格式无法识别：" + shown, path: shown },
        400
      );
    }

    let st;
    try {
      st = await stat(native);
    } catch {
      return c.json(
        { ok: false, code: "NOT_FOUND", message: "文件夹不存在：" + shown, path: shown },
        404
      );
    }
    if (!st.isDirectory()) {
      return c.json(
        { ok: false, code: "NOT_DIR", message: "这不是文件夹：" + shown, path: shown },
        400
      );
    }

    const opened = openExplorer(native);
    if (!opened) {
      return c.json(
        { ok: false, code: "SPAWN_FAIL", message: "调用资源管理器失败", path: shown },
        500
      );
    }
    return c.json({ ok: true, code: "OPENED", path: shown });
  });

  // ---- 取视频并搬运（NDJSON 流式） ----
  app.post("/api/phone-latest-videos/stream", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      return c.json({ ok: false, error: "解析 JSON 失败: " + e }, 400);
    }

    const count = clampInt(body.count, 1, 20, 1);
    const destRaw = String(body.dest == null ? "" : body.dest).trim();
    if (!destRaw) {
      return c.json(
        { ok: false, error: "请填写「保存到电脑上的文件夹」" },
        400
      );
    }

    const destNative = resolve(normalizePath(destRaw));
    const destShown = toSlash(destNative);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (obj) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          } catch {
            closed = true;
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // 客户端可能已断开
          }
        };

        try {
          // ---- 1. 技能目录 ----
          const skillDir = resolveSkillDir();
          if (!skillDir) {
            send({
              type: "error",
              text:
                "没找到手机任务技能目录（" +
                SKILL_ID +
                "），请确认该技能已安装后再试。",
            });
            return close();
          }

          // ---- 2. 中继 + 手机连接 ----
          send({ type: "step", text: "检查手机连接…" });
          const h = await ensureRelay(send);
          if (!h || h.status !== "ok") {
            send({
              type: "error",
              text:
                "手机中继服务没能启动（localhost:" +
                RELAY_PORT +
                "）。请到 WorkBuddy 里用一次手机技能，让它把中继拉起来后再试。",
            });
            return close();
          }
          if (h.phone !== "connected") {
            send({
              type: "error",
              text:
                "后台通了，但手机还没连上。请在手机的 AutoJs6 里运行 autojs-task-phone-client.js，" +
                "等悬浮球变绿后再点一次。",
            });
            return close();
          }
          send({ type: "step", text: "手机已连接" });

          // ---- 3. 目标目录（不存在就建） ----
          try {
            await mkdir(destNative, { recursive: true });
            const st = await stat(destNative);
            if (!st.isDirectory()) {
              send({ type: "error", text: "目标路径不是文件夹：" + destShown });
              return close();
            }
          } catch (e) {
            send({
              type: "error",
              text: "创建/访问目标文件夹失败：" + destShown + "（" + String(e.message || e) + "）",
            });
            return close();
          }
          send({ type: "step", text: "保存位置已就绪：" + destShown });

          // ---- 4. 下发手机任务（复用 download-latest-videos 模板） ----
          send({ type: "step", text: "正在从手机取最新 " + count + " 个视频…" });
          const run = await runTask(skillDir, [
            "download-latest-videos",
            "--wait",
            "0",
            "--args",
            JSON.stringify({ count: count }),
          ]);
          const submitted = parseLastJson(run.stdout);
          if (!submitted || !submitted.taskId) {
            send({
              type: "error",
              text:
                "下发手机任务失败：" +
                (String(run.stderr).trim() ||
                  String(run.stdout).trim() ||
                  "没有任何输出"),
            });
            return close();
          }

          // ---- 5. 轮询进度 ----
          const taskId = submitted.taskId;
          const deadline = Date.now() + 20 * 60 * 1000;
          let taskResult = null;
          let taskState = null;
          let lastProgress = "";

          while (Date.now() < deadline) {
            await sleep(1200);
            const r = await runTask(skillDir, ["--status", taskId]);
            const st = parseLastJson(r.stdout);
            if (!st || !st.success || !st.task) continue;
            taskState = st.task;

            const prog = st.task.progress;
            if (prog && prog !== lastProgress) {
              lastProgress = prog;
              const m = /^(\d+)\s*\/\s*(\d+)\s*(.*)$/.exec(String(prog).trim());
              if (m) {
                send({
                  type: "progress",
                  done: Number(m[1]),
                  total: Number(m[2]),
                  text: m[3] || String(prog),
                });
              } else {
                send({ type: "progress", text: String(prog) });
              }
            }

            if (st.task.finished) {
              taskResult = st.task.result;
              break;
            }
          }

          if (!taskState || !taskState.finished) {
            send({
              type: "error",
              text:
                "等手机取视频超时了（超过 20 分钟）。任务单号 " +
                taskId +
                "，可在 WorkBuddy 里查它的状态。",
            });
            return close();
          }
          if (taskState.status !== "success") {
            send({
              type: "error",
              text:
                "手机端任务" +
                (taskState.status === "stopped" ? "被中断" : "失败") +
                "（任务单 " +
                taskId +
                "）。",
            });
            return close();
          }

          let res = null;
          try {
            res = JSON.parse(taskResult);
          } catch {
            res = null;
          }
          if (!res || !res.ok) {
            send({
              type: "error",
              text: "手机端取视频失败：" + ((res && res.err) || "未知原因"),
            });
            return close();
          }

          const files = Array.isArray(res.files) ? res.files : [];
          if (files.length === 0) {
            send({
              type: "error",
              text: "手机上没找到视频（只扫系统相机 DCIM/Camera）。",
            });
            return close();
          }

          const noteParts = [];
          if (res.note) noteParts.push(String(res.note));
          if (noteParts.length) {
            send({ type: "note", text: noteParts.join("；") });
          }

          // ---- 6. 搬运到目标目录 ----
          const uploadDir = join(skillDir, "scripts", "uploads");
          const out = [];

          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const name = String(f.name || basename(String(f.path || "")));
            send({
              type: "progress",
              done: i,
              total: files.length,
              text: "搬运 " + i + "/" + files.length + "：" + name,
            });

            const srcPath =
              f.path && existsSync(f.path)
                ? f.path
                : join(uploadDir, basename(String(f.path || name)));

            if (!existsSync(srcPath)) {
              out.push({
                name: name,
                size: f.size || 0,
                target: null,
                action: "missing",
                error: "中转文件不存在（可能已被中转区清理）",
              });
              continue;
            }

            try {
              const r = await moveWithRename(srcPath, destNative, name);
              out.push({
                name: name,
                size: f.size || 0,
                target: toSlash(r.target),
                action: r.renamed ? "renamed" : "moved",
                error: null,
              });
            } catch (e) {
              out.push({
                name: name,
                size: f.size || 0,
                target: null,
                action: "failed",
                error: String(e.message || e),
              });
            }
          }

          send({
            type: "progress",
            done: files.length,
            total: files.length,
            text: "搬运完成",
          });

          // ---- 7. 全成功才自动打开 ----
          const movedOnes = out.filter((x) => x.target);
          let opened = false;
          if (movedOnes.length > 0 && movedOnes.length === out.length) {
            opened = openExplorer(destNative);
            send({
              type: "step",
              text: opened
                ? "已为你打开目标文件夹"
                : "自动打开文件夹失败，可用下方按钮手动打开",
            });
          } else if (movedOnes.length > 0) {
            send({
              type: "note",
              text:
                "有 " +
                (out.length - movedOnes.length) +
                " 个没搬运成功，已跳过自动打开文件夹。",
            });
          }

          send({
            type: "result",
            ok: true,
            dest: destShown,
            count: out.length,
            moved: movedOnes.length,
            opened: opened,
            files: out,
          });
          return close();
        } catch (e) {
          send({ type: "error", text: String(e.message || e) });
          return close();
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
