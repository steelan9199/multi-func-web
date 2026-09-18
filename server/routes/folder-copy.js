// 路由插件：文件夹复制器
// GET  /api/folder-copy/excludes
//   返回当前排除项列表（从持久化文件读取）
// PUT  /api/folder-copy/excludes
//   JSON body: { excludes: ["node_modules", ...] }
//   更新排除项并写入持久化文件
// POST /api/folder-copy/stream
//   JSON body: { src: "源文件夹路径", dest: "目标目录路径" }
//   流式返回执行日志（text/plain），使用当前持久化的排除项。
//
// 功能：将源文件夹整体复制到目标目录下（结果路径 = dest / basename(src)），
//       自动排除用户指定的忽略项（可在前端编辑，实时保存到文件）。

import { cp, stat, readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { basename, join, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 默认排除项（首次使用时写入文件）
const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "output",
  ".cache",
  ".temp",
  ".tmp",
  ".env",
  ".env.local",
  "secret.txt",
  "credentials.json",
  ".vscode",
  ".idea",
];

// 持久化文件路径：server/data/folder-copy-excludes.json
const DATA_DIR = join(__dirname, "..", "data");
const EXCLUDES_FILE = join(DATA_DIR, "folder-copy-excludes.json");

// ---- 工具：读取排除项（文件不存在则用默认并初始化） ----
async function loadExcludes() {
  if (!existsSync(EXCLUDES_FILE)) {
    // 首次使用：写入默认值
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }
    await writeFile(EXCLUDES_FILE, JSON.stringify(DEFAULT_EXCLUDES, null, 2), "utf-8");
    return DEFAULT_EXCLUDES.slice();
  }
  try {
    const raw = await readFile(EXCLUDES_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data.map((n) => String(n).trim()).filter(Boolean);
    }
    return DEFAULT_EXCLUDES.slice();
  } catch {
    return DEFAULT_EXCLUDES.slice();
  }
}

// ---- 工具：保存排除项到文件 ----
async function saveExcludes(excludes) {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
  const cleaned = excludes.map((n) => String(n).trim()).filter(Boolean);
  await writeFile(EXCLUDES_FILE, JSON.stringify(cleaned, null, 2), "utf-8");
  return cleaned;
}

export default function (app) {
  // ---- GET: 返回当前排除项 ----
  app.get("/api/folder-copy/excludes", async (c) => {
    try {
      const excludes = await loadExcludes();
      return c.json({ ok: true, excludes });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });

  // ---- PUT: 更新排除项并持久化 ----
  app.put("/api/folder-copy/excludes", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      return c.json({ ok: false, error: "解析 JSON 失败: " + e }, 400);
    }

    if (!Array.isArray(body.excludes)) {
      return c.json({ ok: false, error: "excludes 必须是数组" }, 400);
    }

    try {
      const excludes = await saveExcludes(body.excludes);
      return c.json({ ok: true, excludes });
    } catch (e) {
      return c.json({ ok: false, error: "保存失败: " + e }, 500);
    }
  });

  // ---- POST: 执行复制（流式日志） ----
  app.post("/api/folder-copy/stream", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      return c.json({ ok: false, error: "解析 JSON 失败: " + e }, 400);
    }

    const srcRaw = String(body.src || "").trim();
    const destRaw = String(body.dest || "").trim();

    if (!srcRaw) {
      return c.json({ ok: false, error: "缺少源文件夹路径 src" }, 400);
    }
    if (!destRaw) {
      return c.json({ ok: false, error: "缺少目标目录路径 dest" }, 400);
    }

    // 从持久化文件读取当前排除项
    let excludes;
    try {
      excludes = await loadExcludes();
    } catch (e) {
      excludes = DEFAULT_EXCLUDES.slice();
    }

    // 构建黑名单 Set（小写）
    const blacklist = new Set(excludes.map((n) => n.toLowerCase()));

    // 统一正斜杠，解析为绝对路径
    const src = resolve(srcRaw.replace(/\\/g, "/"));
    const destDir = resolve(destRaw.replace(/\\/g, "/"));
    const dest = join(destDir, basename(src));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (s) => controller.enqueue(encoder.encode(s));
        const fail = (msg) => {
          send("\n[失败] " + msg + "\n");
          controller.close();
        };

        try {
          // ---- 1. 解析源路径（处理软链接） ----
          // 先尝试用 realpath 解析为真实目录——如果源是符号链接，
          // fs.cp 会试图在目标处重建链接而非复制内容，导致 filter 不递归。
          let realSrc;
          try {
            realSrc = await realpath(src);
          } catch {
            realSrc = src;
          }
          if (realSrc !== src) {
            send("[源] " + src + " （符号链接）\n");
            send("[真实路径] " + realSrc + "\n");
          } else {
            send("[源] " + src + "\n");
          }
          send("[目标目录] " + destDir + "\n");
          send("[结果路径] " + dest + "\n\n");

          let srcStat;
          try {
            srcStat = await stat(realSrc);
          } catch {
            return fail("源文件夹不存在，请检查路径");
          }
          if (!srcStat.isDirectory()) {
            return fail("源路径不是文件夹");
          }

          // ---- 2. 确保目标目录存在 ----
          if (!existsSync(destDir)) {
            send("[提示] 目标目录不存在，将自动创建\n");
          }

          // ---- 3. 检测目标是否已存在同名文件夹 ----
          if (existsSync(dest)) {
            send("[注意] 目标处已存在同名文件夹，将合并/覆盖同名文件\n");
          }

          // ---- 4. 执行复制 ----
          send("[排除项] " + (excludes.length ? excludes.join(", ") : "（无）") + "\n");
          send("[复制中] 正在复制文件…\n");

          let copiedCount = 0;
          let skippedCount = 0;

          await cp(realSrc, dest, {
            recursive: true,
            preserveTimestamps: true,
            force: true,
            errorOnExist: false,
            filter: (from) => {
              // 源根目录始终放行（用 realSrc 比较，因为 cp 接收的是 realSrc）
              if (from === realSrc) return true;
              const name = basename(from).toLowerCase();
              if (blacklist.has(name)) {
                skippedCount++;
                return false;
              }
              copiedCount++;
              return true;
            },
          });

          send("\n[完成] 复制成功！\n");
          send("[统计] 复制项数: " + copiedCount + "（含目录）\n");
          send("[统计] 排除项数: " + skippedCount + "\n");
          send("[结果] " + dest + "\n");

          controller.close();
        } catch (e) {
          fail(String(e.message || e));
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
