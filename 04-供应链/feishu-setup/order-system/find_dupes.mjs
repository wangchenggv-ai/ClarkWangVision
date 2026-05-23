// find_dupes.mjs — 查询生产 Bitable 订单主表，找出重复订单号
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const candidates = [resolve(__dirname, "../shared/.env"), resolve(__dirname, "../.env")];
  const env = {};
  for (const envPath of candidates) {
    try {
      for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const [k, ...v] = t.split("=");
        const key = k.trim();
        if (!(key in env)) env[key] = v.join("=").trim();
      }
    } catch {}
  }
  return env;
}

const ENV = loadEnv();
const APP_ID = ENV.FEISHU_APP_ID || "cli_a94dfd3512f9dbd9";
const APP_SECRET = ENV.FEISHU_APP_SECRET;
const APP_TOKEN = ENV.FEISHU_APP_TOKEN || "B3xQbbqicaome1sKdZbcwdk8nWg";
const ORDER_TABLE = "tblk9Ch4gk2uQ1zG";
const BASE = "https://open.feishu.cn/open-apis";

let _token = null, _ts = 0;
async function getToken() {
  if (_token && Date.now() - _ts < 5000000) return _token;
  const r = await fetch(BASE + "/auth/v3/tenant_access_token/internal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const j = await r.json();
  _token = j.tenant_access_token;
  _ts = Date.now();
  return _token;
}

async function api(method, path, body) {
  const token = await getToken();
  const opts = { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const j = await res.json();
  if (j.code !== 0) { console.error("  API err:", j.code, j.msg); return null; }
  return j.data;
}

async function main() {
  console.log("拉取生产 Bitable 订单表所有记录...");
  const allRecords = [];
  let pageToken = "";
  let pages = 0;
  while (pages < 100) {
    const body = { page_size: 500, field_names: ["订单编号", "订单状态", "下单日期", "代理商名称", "顾客姓名", "产品型号"] };
    if (pageToken) body.page_token = pageToken;
    const data = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records/search`, body);
    if (!data) break;
    if (data.items) allRecords.push(...data.items);
    pages++;
    process.stderr.write(`\r  已拉取 ${allRecords.length} 条 (第 ${pages} 页)...`);
    if (!data.has_more) break;
    pageToken = data.page_token;
  }

  console.log(`\n总记录数: ${allRecords.length}`);

  // 按 orderNo 分组
  const groups = new Map();
  for (const r of allRecords) {
    const on = (r.fields["订单编号"] || "").trim();
    if (!on) continue;
    if (!groups.has(on)) groups.set(on, []);
    groups.get(on).push(r);
  }

  // 找出 count >= 2 的
  const dupes = [];
  for (const [on, recs] of groups) {
    if (recs.length >= 2) {
      const first = recs[0].fields;
      dupes.push({
        orderNo: on,
        count: recs.length,
        agentName: first["代理商名称"] || "",
        status: first["订单状态"] || "",
        customer: first["顾客姓名"] || "",
        sku: first["产品型号"] || "",
      });
    }
  }

  dupes.sort((a, b) => b.count - a.count);

  console.log(`\n唯一订单号: ${groups.size}`);
  console.log(`重复订单数（count>=2）: ${dupes.length}`);
  console.log(`最大重复次数: ${dupes[0]?.count || 0}\n`);

  if (dupes.length === 0) {
    console.log("✅ 未发现重复订单");
    return;
  }

  // 输出前 30 个
  console.log("═══ 重复最严重的订单（前30） ═══");
  console.log("OrderNo                                  Count  Agent                   Status    Customer        SKU");
  console.log("─".repeat(120));
  for (const d of dupes.slice(0, 30)) {
    console.log(
      d.orderNo.padEnd(42),
      String(d.count).padStart(5),
      " ",
      (d.agentName || "").padEnd(22).slice(0, 22),
      " ",
      (d.status || "").padEnd(10),
      " ",
      (d.customer || "").padEnd(14).slice(0, 14),
      " ",
      d.sku || ""
    );
  }

  if (dupes.length > 30) {
    console.log(`\n... 还有 ${dupes.length - 30} 个重复订单（见完整列表）`);
  }

  // 按重复次数分布统计
  const dist = new Map();
  for (const d of dupes) {
    const bucket = d.count >= 50 ? "50+" : d.count >= 30 ? "30-49" : d.count >= 20 ? "20-29" : d.count >= 10 ? "10-19" : d.count >= 5 ? "5-9" : "2-4";
    dist.set(bucket, (dist.get(bucket) || 0) + 1);
  }
  console.log("\n═══ 重复次数分布 ═══");
  const order = ["2-4", "5-9", "10-19", "20-29", "30-49", "50+"];
  for (const b of order) {
    if (dist.has(b)) console.log(`  ${b} 次: ${dist.get(b)} 个订单`);
  }

  // 按代理商分布
  const agentDist = new Map();
  for (const d of dupes) {
    const a = d.agentName || "(未知)";
    agentDist.set(a, (agentDist.get(a) || 0) + d.count);
  }
  console.log("\n═══ 按代理商（重复记录数） ═══");
  const sortedAgents = [...agentDist.entries()].sort((a, b) => b[1] - a[1]);
  for (const [a, c] of sortedAgents.slice(0, 15)) {
    console.log(`  ${a.padEnd(24)} ${c} 条`);
  }

  // 完整列表输出到 JSON 文件
  const fs = await import("fs");
  const outPath = resolve(__dirname, "dupes_result.json");
  fs.writeFileSync(outPath, JSON.stringify({ totalRecords: allRecords.length, uniqueOrders: groups.size, duplicateOrders: dupes.length, dupes }, null, 2));
  console.log(`\n完整结果已写入: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
