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
const APP_TOKEN = ENV.FEISHU_APP_TOKEN;
const TABLE = "tblC7pve7ObFgIOl";

// Test the exact same query the verify endpoint uses
const lensCode = "AAAACACHE11111111";
const encodedLc = encodeURIComponent(`"${lensCode}"`);
const t0 = Date.now();
const lcData = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE}/records?page_size=1&filter=CurrentValue.[镜片码]=${encodedLc}`);
const t1 = Date.now();
console.log(`API call: ${t1-t0}ms`);
console.log("items:", lcData?.items?.length);
console.log("has_more:", lcData?.has_more);
console.log("total:", lcData?.total);
if (lcData?.items?.[0]) console.log("found:", JSON.stringify(lcData.items[0].fields["镜片码"]));
if (lcData?.error) console.log("error:", JSON.stringify(lcData.error));
