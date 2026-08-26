// 路由插件：录课助手
// GET  /api/recorder-control/status -> 检查4个录课程序的运行状态
// POST /api/recorder-control/start  -> 按顺序启动4个程序，流式返回日志
// POST /api/recorder-control/stop   -> 按反序关闭4个程序，流式返回日志
//
// 启动顺序：NVIDIA Broadcast → PointerFocus → Carnac → Recordly（每步间隔3秒）
// 关闭顺序：Recordly → Carnac → PointerFocus → NVIDIA Broadcast（反向）
// 音频链路：麦克风 → NVIDIA Broadcast（降噪） → Recordly（录制）

import { spawn } from "node:child_process";

var PROGRAMS = {
  broadcast: {
    name: "NVIDIA Broadcast",
    icon: "\u{1F3A4}",
    startPS:
      'Start-Process -FilePath "C:\\Windows\\explorer.exe" -ArgumentList "C:\\Program Files\\NVIDIA Corporation\\NVIDIA Broadcast\\NVIDIA Broadcast.exe"',
    stopPS:
      'Stop-Process -Name "NVIDIA Broadcast" -Force -ErrorAction SilentlyContinue',
  },
  pointerfocus: {
    name: "PointerFocus",
    icon: "\u{1F5B1}\uFE0F",
    startPS:
      'Start-Process -FilePath "D:\\software\\PointerFocus\\pointerfocus2.4\\PointerFocus\\PointerFocus.exe" -WorkingDirectory "D:\\software\\PointerFocus\\pointerfocus2.4\\PointerFocus\\"',
    stopPS:
      'Stop-Process -Name "PointerFocus" -Force -ErrorAction SilentlyContinue',
  },
  carnac: {
    name: "Carnac",
    icon: "\u2328\uFE0F",
    startPS:
      'Start-Process -FilePath "C:\\Windows\\explorer.exe" -ArgumentList "C:\\Users\\Administrator\\AppData\\Local\\carnac\\Carnac.exe"',
    stopPS: 'Stop-Process -Name "Carnac" -Force -ErrorAction SilentlyContinue',
  },
  recordly: {
    name: "Recordly",
    icon: "\u{1F4F9}",
    startPS:
      'Start-Process -FilePath "C:\\Windows\\explorer.exe" -ArgumentList "C:\\Users\\Administrator\\AppData\\Local\\Programs\\recordly\\Recordly.exe"',
    stopPS: 'Stop-Process -Name "Recordly" -Force -ErrorAction SilentlyContinue',
  },
};

var START_ORDER = ["broadcast", "pointerfocus", "carnac", "recordly"];
var STOP_ORDER = ["recordly", "carnac", "pointerfocus", "broadcast"];

function runPS(command) {
  return new Promise(function (resolve) {
    var child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true }
    );
    var stdout = "";
    var stderr = "";
    child.stdout.on("data", function (d) {
      stdout += d.toString();
    });
    child.stderr.on("data", function (d) {
      stderr += d.toString();
    });
    child.on("error", function (e) {
      resolve({ code: -1, stdout: stdout, stderr: stderr + String(e) });
    });
    child.on("close", function (code) {
      resolve({ code: code, stdout: stdout, stderr: stderr });
    });
  });
}

function checkStatus() {
  return new Promise(function (resolve) {
    var child = spawn("cmd", ["/c", "tasklist"], { windowsHide: true });
    var output = "";
    child.stdout.on("data", function (d) {
      output += d.toString();
    });
    child.stderr.on("data", function () {});
    child.on("error", function () {
      resolve(null);
    });
    child.on("close", function () {
      var lower = output.toLowerCase();
      resolve({
        broadcast: lower.includes("nvidia broadcast"),
        pointerfocus: lower.includes("pointerfocus"),
        carnac: lower.includes("carnac"),
        recordly: lower.includes("recordly"),
      });
    });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

export default function (app) {
  app.get("/api/recorder-control/status", async function (c) {
    var status = await checkStatus();
    if (!status) {
      return c.json({ ok: false, error: "无法检查进程状态" }, 500);
    }
    return c.json({ ok: true, status: status });
  });

  app.post("/api/recorder-control/start", async function (c) {
    var encoder = new TextEncoder();
    var stream = new ReadableStream({
      async start(controller) {
        var send = function (s) {
          controller.enqueue(encoder.encode(s));
        };

        send("[开始] 正在启动录课环境...\n\n");

        for (var i = 0; i < START_ORDER.length; i++) {
          var key = START_ORDER[i];
          var prog = PROGRAMS[key];
          send(
            "[" +
              (i + 1) +
              "/" +
              START_ORDER.length +
              "] 启动 " +
              prog.icon +
              " " +
              prog.name +
              "...\n"
          );

          var r = await runPS(prog.startPS);
          if (r.code !== 0) {
            send("[警告] " + prog.name + " 启动命令返回码: " + r.code + "\n");
            if (r.stderr.trim()) {
              send("[stderr] " + r.stderr.trim() + "\n");
            }
          }

          if (i < START_ORDER.length - 1) {
            send("[等待] 3 秒...\n\n");
            await sleep(3000);
          }
        }

        send("\n[验证] 检查进程状态...\n");
        await sleep(2000);
        var status = await checkStatus();
        if (status) {
          for (var j = 0; j < START_ORDER.length; j++) {
            var k = START_ORDER[j];
            var p = PROGRAMS[k];
            var running = status[k];
            send(
              "  " +
                p.icon +
                " " +
                p.name +
                ": " +
                (running ? "\u2713 运行中" : "\u2717 未检测到") +
                "\n"
            );
          }

          var allRunning = Object.values(status).every(Boolean);
          if (allRunning) {
            send("\n[成功] 录课环境已就绪，祝录制顺利！\n");
          } else {
            send("\n[警告] 部分程序未成功启动，请检查上方状态\n");
          }
        } else {
          send("[警告] 无法验证进程状态\n");
        }

        controller.close();
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

  app.post("/api/recorder-control/stop", async function (c) {
    var encoder = new TextEncoder();
    var stream = new ReadableStream({
      async start(controller) {
        var send = function (s) {
          controller.enqueue(encoder.encode(s));
        };

        send("[开始] 正在关闭录课环境...\n\n");

        for (var i = 0; i < STOP_ORDER.length; i++) {
          var key = STOP_ORDER[i];
          var prog = PROGRAMS[key];
          send(
            "[" +
              (i + 1) +
              "/" +
              STOP_ORDER.length +
              "] 关闭 " +
              prog.icon +
              " " +
              prog.name +
              "...\n"
          );

          var r = await runPS(prog.stopPS);
          if (r.code !== 0 && r.stderr.trim()) {
            send("[提示] " + r.stderr.trim() + "\n");
          }
        }

        send("\n[验证] 检查进程状态...\n");
        await sleep(2000);
        var status = await checkStatus();
        if (status) {
          var anyRunning = Object.values(status).some(Boolean);
          if (!anyRunning) {
            send("[成功] 四个录课程序已全部关闭\n");
          } else {
            for (var j = 0; j < STOP_ORDER.length; j++) {
              var k = STOP_ORDER[j];
              var p = PROGRAMS[k];
              if (status[k]) {
                send(
                  "  " +
                    p.icon +
                    " " +
                    p.name +
                    ": 仍在运行，可能需要手动关闭\n"
                );
              }
            }
          }
        } else {
          send("[警告] 无法验证进程状态\n");
        }

        controller.close();
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
