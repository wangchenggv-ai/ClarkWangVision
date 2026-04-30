import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV = {};
for (const p of [resolve(__dirname, "../shared/.env"), resolve(__dirname, ".env")]) {
  try {
    const lines = readFileSync(p, "utf-8").split("\n");
    for (const line of lines) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/); if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
    break;
  } catch {}
}

const feishuMod = await import("./lib/feishu.js");
feishuMod.init({ base: "https://open.feishu.cn/open-apis", appToken: ENV.FEISHU_APP_TOKEN, env: ENV });
const { feishuApi } = feishuMod;

const encoded = encodeURIComponent('"AAAACACHE11111111"');
const data = await feishuApi("GET", `/bitable/v1/apps/${ENV.FEISHU_APP_TOKEN}/tables/tblC7pve7ObFgIOl/records?page_size=5&filter=CurrentValue.[镜片码]=${encoded}`);
console.log("found:", data?.items?.length, "total:", data?.total);
if (data?.items?.[0]) console.log("record:", JSON.stringify(data.items[0].fields));
