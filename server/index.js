// 功能网页本地后台 · Hono 网关
// 职责：启动服务 + 自动装载 routes/*.js + CORS + 健康检查。
// 以后加功能：只需在 routes/ 下新增一个 <id>.js（默认导出 function(app)），主干不动。
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 端口优先级：命令行/系统环境变量 PORT > 下方默认值。
// 改端口最简方式：双击前编辑 start-server.bat 里的 PORT，或运行 `start-server.bat 9000`。
const PORT = Number(process.env.PORT) || 18789;

const app = new Hono();

// 本地工具：放行所有来源（页面以 file:// 打开时 origin 为 null，需要 * 才能跨域 fetch）
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

// 健康检查：前端据此判断后台是否在线
app.get("/api/health", (c) => c.json({ ok: true, time: Date.now() }));

// 自动装载所有路由插件
const routesDir = join(__dirname, "routes");
for (const file of readdirSync(routesDir)) {
  if (!file.endsWith(".js")) continue;
  const mod = await import(pathToFileURL(join(routesDir, file)).href);
  const register = mod.default;
  if (typeof register === "function") {
    register(app);
    console.log(`[router] loaded: ${file}`);
  }
}

// 静态文件服务：直接用 http://localhost:PORT/ 打开首页（挂在 API 之后，不影响 /api/*）
// start-server.bat 的 cwd 是 server/，所以 root 用 ../ 指向项目根。
app.use("*", serveStatic({ root: "../", index: "index.html" }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`功能网页后台已启动: http://localhost:${info.port}`);
});
