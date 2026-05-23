import http from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { handleEvent } from "./lib/bot.js";
import * as feishu from "./lib/feishu.js";
import * as api from "./lib/api.js";

// 加载 .env
const __dir = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const env = { ...process.env };
  try {
    const lines = readFileSync(resolve(__dir, ".env"), "utf8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch {}
  return env;
}

const ENV = loadEnv();
feishu.init(ENV);
api.init({ apiBase: ENV.ORDER_API_BASE, apiToken: ENV.ORDER_API_TOKEN });

const PORT = Number(ENV.PORT) || 3230;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", time: new Date().toISOString() }));
  }

  if (req.method === "POST" && url.pathname === "/feishu/event") {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const result = await handleEvent(payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result || {}));
      } catch (e) {
        console.error("event error:", e.message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`🤖 飞书订单Agent 启动: http://localhost:${PORT}`);
  console.log(`   → 订单API: ${ENV.ORDER_API_BASE}`);
  console.log(`   → Bot App: ${ENV.BOT_APP_ID || "（未配置）"}`);
});
