// 路由插件：本地 Markdown 一键发公众号
// GET  /api/wechat-publish/config  -> 返回当前可编辑配置（供前端渲染）
// POST /api/wechat-publish/stream  -> 写临时配置 + spawn node 发布脚本 + 流式返回日志
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 发布技能目录（仅读取与执行其 scripts/index.js，不修改技能内任何文件）
const SKILL_DIR =
  "C:/Users/Administrator/.workbuddy/skills/wechat-publisher-yashu";
// 本功能独立副本配置（首次从技能 config.default.json 初始化，之后由网页编辑）
const CONFIG_PATH = join(
  __dirname,
  "..",
  "..",
  "functions",
  "wechat-publish",
  "config.json"
);

export default function (app) {
  // 读取当前配置
  app.get("/api/wechat-publish/config", async (c) => {
    try {
      const raw = await readFile(CONFIG_PATH, "utf8");
      return c.json({ ok: true, config: raw });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  // 发送：合并路径覆盖 markdownFilePath -> 写临时配置 -> spawn 脚本 -> 流式日志
  app.post("/api/wechat-publish/stream", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "请求体不是合法 JSON" }, 400);
    }

    const { filePath, config } = body || {};
    if (!filePath || !config) {
      return c.json({ ok: false, error: "缺少 filePath 或 config" }, 400);
    }
    if (!String(filePath).toLowerCase().endsWith(".md")) {
      return c.json({ ok: false, error: "文件路径必须以 .md 结尾" }, 400);
    }

    let cfg;
    try {
      cfg = typeof config === "string" ? JSON.parse(config) : config;
    } catch {
      return c.json({ ok: false, error: "config 不是合法 JSON" }, 400);
    }
    // 用户输入的路径是权威值，覆盖配置里的 markdownFilePath
    cfg.markdownFilePath = filePath;

    // 写临时配置到系统临时目录（不污染技能目录、不污染本功能 config.json）
    let tmpConfig;
    try {
      const dir = await mkdtemp(join(tmpdir(), "wxpub-"));
      tmpConfig = join(dir, "config.json");
      await writeFile(tmpConfig, JSON.stringify(cfg, null, 2), "utf8");
    } catch (e) {
      return c.json({ ok: false, error: "写临时配置失败: " + e }, 500);
    }

    const nodeBin = process.execPath; // 与启动后台同一个 node，已满足 >=20.20.1
    const script = join(SKILL_DIR, "scripts", "index.js");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (s) => controller.enqueue(encoder.encode(s));
        send(`[启动] ${nodeBin} ${script}\n`);
        send(`[配置] ${tmpConfig}\n`);
        send(`[目标] ${filePath}\n`);

        const child = spawn(nodeBin, [script, "--config", tmpConfig], {
          cwd: join(SKILL_DIR, "scripts"),
          env: process.env,
        });

        // 发布脚本的进度/结果均走 console.error（stderr），原样转发即可
        child.stdout.on("data", (d) => controller.enqueue(encoder.encode(d.toString())));
        child.stderr.on("data", (d) => controller.enqueue(encoder.encode(d.toString())));
        child.on("error", (e) => send(`[error] ${e.message}\n`));
        child.on("close", (code) => {
          send(`\n[结束] 进程退出码: ${code}\n`);
          controller.close();
        });
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
