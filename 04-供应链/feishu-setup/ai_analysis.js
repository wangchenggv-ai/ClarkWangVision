/**
 * 规则5：汇总数据快照 -> 调用 Coze API -> 写入 AI 分析记录表
 *
 * 用法: node ai_analysis.js
 * 需要 .env 中有 COZE_PAT
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split("=");
    env[k.trim()] = v.join("=").trim();
  }
  return env;
}

const env = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const COZE_PAT = env.COZE_PAT;
const COZE_BOT_ID = "7622147528649392169";

const TABLES = {
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  blank_inventory: "tbladv6bQTXlNOlM",
  mold: "tblkZ4ODg3v63prW",
  production: "tbltSntfaR9KCI7B",
  forecast: "tblFLAHOXLSgWS6Q",
  ai_analysis: "tbl8W9F9K2RbaL0k",
  order: "tblk9Ch4gk2uQ1zG",
  after_sales: "tblzr1b8kH9yERZt", // PLACEHOLDER — fill in after running migrate_tables.js
};

let TOKEN = "";

async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function listRecords(tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const json = await res.json();
    if (json.code !== 0) break;
    if (json.data.items) records.push(...json.data.items);
    if (!json.data.has_more) break;
    pageToken = json.data.page_token;
  }
  return records;
}

// --- 1. Build snapshot ---

async function buildSnapshot() {
  console.log("Collecting data snapshot ...");

  const promises = [
    listRecords(TABLES.sku),
    listRecords(TABLES.finished_inventory),
    listRecords(TABLES.blank_inventory),
    listRecords(TABLES.mold),
    listRecords(TABLES.production),
    listRecords(TABLES.forecast),
    listRecords(TABLES.order),
    TABLES.after_sales ? listRecords(TABLES.after_sales) : Promise.resolve([]),
  ];
  const [skuData, inventory, blanks, molds, production, forecasts, orders, afterSales] = await Promise.all(promises);

  const pick = (items, keys) =>
    items.map((r) => {
      const o = {};
      for (const k of keys) o[k] = r.fields[k] ?? "";
      return o;
    });

  const snapshot = {
    date: new Date().toISOString().slice(0, 10),
    SKU_master: pick(skuData, ["SKU\u7F16\u53F7", "SKU\u540D\u79F0", "\u7C7B\u578B", "\u5B89\u5168\u5E93\u5B58", "\u6700\u5927\u5E93\u5B58\uFF083\u6708\u91CF\uFF09"]),
    finished_inventory: pick(inventory, ["SKU", "\u5F53\u524D\u5E93\u5B58", "\u5728\u4EA7\u91CF", "\u72B6\u6001"]),
    blank_inventory: pick(blanks, ["SKU", "\u5F53\u524D\u6BDB\u576F\u5E93\u5B58", "\u5728\u4EA7\u6BDB\u576F\u91CF"]),
    mold_status: pick(molds, ["\u6A21\u82AF\u7F16\u53F7", "SKU", "\u603B\u5BFF\u547D\uFF08\u6B21\uFF09", "\u5DF2\u4F7F\u7528\u6B21\u6570", "\u5269\u4F59\u6B21\u6570", "\u72B6\u6001"]),
    production_plan: pick(production, ["\u5468\u6B21", "SKU", "\u5EFA\u8BAE\u4EA7\u91CF", "\u72B6\u6001", "\u89E6\u53D1\u539F\u56E0"]),
    forecast: pick(forecasts, ["\u9884\u6D4B\u5468\u671F", "SKU", "\u9884\u6D4B\u9500\u91CF", "\u5386\u53F2\u53C2\u8003\u5747\u503C"]),
    orders: pick(orders, ["\u8BA2\u5355\u7F16\u53F7", "SKU", "\u6570\u91CF", "\u4EA4\u671F\u7C7B\u578B", "\u8BA2\u5355\u72B6\u6001"]),
    after_sales: pick(afterSales, ["\u552E\u540E\u7F16\u53F7", "SKU", "\u95EE\u9898\u7C7B\u578B", "\u5904\u7406\u72B6\u6001"]),
  };

  console.log(`  SKU: ${skuData.length}, inventory: ${inventory.length}, molds: ${molds.length}, production: ${production.length}, orders: ${orders.length}, after_sales: ${afterSales.length}`);
  return snapshot;
}

// --- 2. Call Coze API (streaming) ---

async function callAI(snapshot) {
  console.log("\nCalling Coze API ...");

  const prompt = `\u4EE5\u4E0B\u662F\u672C\u5468\u7684\u773C\u955C\u4F9B\u5E94\u94FE\u6570\u636E\u5FEB\u7167\uFF0C\u8BF7\u751F\u6210\u4E00\u4EFD\u7B80\u6D01\u7684\u5468\u5206\u6790\u62A5\u544A\u3002

## \u6570\u636E\u5FEB\u7167
${JSON.stringify(snapshot, null, 2)}

## \u5206\u6790\u8981\u6C42
\u8BF7\u6309\u4EE5\u4E0B\u683C\u5F0F\u8F93\u51FA\uFF08\u7EAF\u6587\u672C\uFF0C\u4E0D\u8981 markdown \u6807\u8BB0\uFF09\uFF1A

\u3010\u5E93\u5B58\u9884\u8B66\u3011
- \u5217\u51FA\u6240\u6709\u4F4E\u5E93\u5B58\u548C\u7F3A\u8D27\u7684 SKU\uFF0C\u8BF4\u660E\u5F53\u524D\u5E93\u5B58\u3001\u5B89\u5168\u5E93\u5B58\u3001\u7F3A\u53E3
- \u6807\u6CE8\u7D27\u6025\u7A0B\u5EA6\uFF08\u7D27\u6025/\u5173\u6CE8/\u6B63\u5E38\uFF09

\u3010\u6A21\u82AF\u9884\u8B66\u3011
- \u5217\u51FA\u9700\u8981\u5173\u6CE8\u7684\u6A21\u82AF\uFF0C\u5269\u4F59\u5BFF\u547D\u3001\u5BF9\u5E94 SKU
- \u5982\u6709\u6025\u9700\u66F4\u6362\u7684\u6A21\u82AF\uFF0C\u63D0\u9192\u91C7\u8D2D\u5468\u671F\uFF083-4\u5468\uFF09

\u3010\u6392\u4EA7\u5EFA\u8BAE\u3011
- \u57FA\u4E8E\u5E93\u5B58\u7F3A\u53E3\u548C\u9500\u552E\u9884\u6D4B\uFF0C\u7ED9\u51FA\u672C\u5468\u6392\u4EA7\u4F18\u5148\u7EA7\u5EFA\u8BAE
- \u6807\u6CE8\u54EA\u4E9B SKU \u5E94\u4F18\u5148\u6392\u4EA7\uFF0C\u5EFA\u8BAE\u4EA7\u91CF

\u3010\u8D8B\u52BF\u89C2\u5BDF\u3011
- \u57FA\u4E8E\u9884\u6D4B\u6570\u636E\u4E0E\u5E93\u5B58\u5BF9\u6BD4\uFF0C\u6307\u51FA\u6F5C\u5728\u98CE\u9669
- \u5982\u6709\u8BA2\u5355\u96C6\u4E2D\u8D8B\u52BF\uFF08\u5468\u672B\u9AD8\u5CF0\uFF09\uFF0C\u7ED9\u51FA\u5907\u8D27\u5EFA\u8BAE

\u3010\u552E\u540E\u5206\u6790\u3011
- \u6309\u95EE\u9898\u7C7B\u578B\u7EDF\u8BA1\u552E\u540E\u6570\u91CF\uFF0C\u8BC6\u522B\u9AD8\u9891\u95EE\u9898SKU

\u3010\u5173\u952E\u884C\u52A8\u9879\u3011\uFF08\u4E0D\u8D85\u8FC75\u6761\uFF09
- \u6700\u7D27\u6025\u7684\u884C\u52A8\u6392\u5728\u6700\u524D\u9762\uFF0C\u7528 1/2/3 \u7F16\u53F7

\u8BF7\u786E\u4FDD\u5206\u6790\u52A1\u5B9E\u3001\u53EF\u64CD\u4F5C\uFF0C\u76F4\u63A5\u7ED9\u7ED3\u8BBA\u548C\u5EFA\u8BAE\uFF0C\u4E0D\u8981\u8BF4\u7A7A\u8BDD\u3002`;

  const res = await fetch("https://api.coze.cn/v3/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${COZE_PAT}`,
    },
    body: JSON.stringify({
      bot_id: COZE_BOT_ID,
      user_id: "supply_chain_system",
      stream: true,
      auto_save_history: false,
      additional_messages: [
        { role: "user", content: prompt, content_type: "text" },
      ],
    }),
  });

  // Read SSE stream
  const text = await res.text();
  const lines = text.split("\n");

  let content = "";
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const dataStr = line.slice(5).trim();
    if (dataStr === "[DONE]") break;
    try {
      const evt = JSON.parse(dataStr);
      if (evt.role === "assistant" && evt.type === "answer" && evt.content) {
        content += evt.content;
      }
      if (evt.code && evt.code !== 0) {
        console.error("  Coze error:", evt.msg);
        return null;
      }
    } catch {
      // skip non-JSON lines
    }
  }

  if (content) {
    console.log(`  Done, length: ${content.length}`);
  } else {
    console.error("  No result received");
  }
  return content || null;
}

// --- 3. Parse & write to Feishu ---

function extractSection(text, title) {
  const regex = new RegExp(`\u3010${title}\u3011([\\s\\S]*?)(?=\u3010|$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

async function writeToFeishu(analysisText) {
  console.log("\nWriting to Feishu ...");

  const keyAlerts = extractSection(analysisText, "\u5E93\u5B58\u9884\u8B66")
    + "\n" + extractSection(analysisText, "\u6A21\u82AF\u9884\u8B66");
  const actions = extractSection(analysisText, "\u5173\u952E\u884C\u52A8\u9879");

  const fields = {
    "\u5206\u6790\u65E5\u671F": Date.now(),
    "\u5206\u6790\u7C7B\u578B": "\u5468\u62A5\u6458\u8981",
    "AI\u5206\u6790\u5185\u5BB9": analysisText,
    "\u5173\u952E\u9884\u8B66": keyAlerts.slice(0, 500),
    "\u5EFA\u8BAE\u884C\u52A8": actions.slice(0, 500),
  };

  const res = await fetch(
    `${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.ai_analysis}/records`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ fields }),
    }
  );
  const json = await res.json();

  if (json.code === 0) {
    console.log("  Written to AI analysis table");
  } else {
    console.error("  Write failed:", json.msg);
  }
}

// --- Main ---

async function main() {
  console.log("=== AI Supply Chain Analysis ===\n");

  if (!COZE_PAT) {
    console.error("Missing COZE_PAT in .env");
    process.exit(1);
  }

  await getToken();
  console.log("Feishu connected\n");

  const snapshot = await buildSnapshot();
  const analysis = await callAI(snapshot);
  if (!analysis) {
    console.error("AI analysis failed");
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log(analysis);
  console.log("=".repeat(60));

  await writeToFeishu(analysis);
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
