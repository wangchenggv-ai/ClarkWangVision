/**
 * sync_customers.js — 同步 CRM 客户表 → 供应链终端客户表
 *
 * 数据源: CRM "02_终端开发和管理" (RlfTb6gykaEb3gsR1lwcGnShnAA / tblQidjfbGA8DDkJ)
 * 目标: 供应链终端客户表 (B3xQbbqicaome1sKdZbcwdk8nWg / tbltXNNhF65EBl17)
 *
 * CRM 表只读，不做任何写操作。
 * 用客户名称匹配，存在则跳过，不存在则新建（自动生成客户ID）。
 *
 * Usage:
 *   node sync_customers.js            # 全量同步
 *   node sync_customers.js --dry-run  # 只打印，不写入
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const NEW_APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const CUSTOMER_TABLE = "tbltXNNhF65EBl17";

function loadEnv() {
  const content = readFileSync(resolve(__dirname, "../shared/.env"), "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split("=");
    env[k.trim()] = v.join("=").trim();
  }
  return env;
}

let TOKEN = "";        // 供应链App token（用于写入）
let CRM_TOKEN = "";    // CRM App token（用于读取CRM）

async function getToken(env) {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function getCrmToken(env) {
  const appId = env.CRM_APP_ID || env.FEISHU_APP_ID;
  const appSecret = env.CRM_APP_SECRET || env.FEISHU_APP_SECRET;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  CRM_TOKEN = (await res.json()).tenant_access_token;
}

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.json();
}

async function crmApiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${CRM_TOKEN}` },
  });
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { console.error("  ⚠️ apiPost non-JSON response:", text.slice(0, 200)); return { code: -1, msg: "rate limited" }; }
}

async function apiPatch(path, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch {
      if (attempt < 2) { console.log(`  ⏳ 限流重试 (${attempt + 1}/3)...`); await new Promise(r => setTimeout(r, 2000)); continue; }
      console.error("  ⚠️ apiPatch failed after retries:", text.slice(0, 200));
      return { code: -1, msg: "rate limited" };
    }
  }
}

async function listAllRecords(appToken, tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await apiGet(`/bitable/v1/apps/${appToken}/tables/${tableId}/records${qs}`);
    if (res.code !== 0) { console.error("  ❌ 读取失败:", res.msg); break; }
    if (res.data.items) records.push(...res.data.items);
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }
  return records;
}

async function listCrmRecords(appToken, tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await crmApiGet(`/bitable/v1/apps/${appToken}/tables/${tableId}/records${qs}`);
    if (res.code !== 0) { console.error("  ❌ 读取CRM失败:", res.msg); break; }
    if (res.data.items) records.push(...res.data.items);
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }
  return records;
}

function genCustomerId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CUS-${d}-${r}`;
}

// 从飞书字段值中提取纯文本（兼容数组/对象/字符串）
function val(v) {
  if (!v) return "";
  if (Array.isArray(v)) return v.map(i => i.text || i.name || String(i)).join("");
  if (typeof v === "object") return v.text || v.name || "";
  return String(v);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== CRM客户同步 ${dryRun ? "[DRY-RUN]" : ""} ===\n`);

  const env = loadEnv();
  const CRM_APP_TOKEN = env.CRM_APP_TOKEN || "RlfTb6gykaEb3gsR1lwcGnShnAA";
  const CRM_CUSTOMER_TABLE = env.CRM_CUSTOMER_TABLE || "tblQidjfbGA8DDkJ";

  await getToken(env);
  await getCrmToken(env);
  console.log("✅ 飞书 tokens 获取成功（供应链 + CRM）\n");

  // 读 CRM 客户表（用CRM token）
  console.log("[1] 读取 CRM 客户表...");
  const crmCustomers = await listCrmRecords(CRM_APP_TOKEN, CRM_CUSTOMER_TABLE);
  console.log(`    读到 ${crmCustomers.length} 条`);

  if (crmCustomers.length === 0) {
    console.log("\n✅ CRM 客户表为空，无需同步");
    return;
  }

  // 读供应链现有客户（建名称索引）
  console.log("\n[2] 读取供应链现有客户...");
  const existingCustomers = await listAllRecords(NEW_APP_TOKEN, CUSTOMER_TABLE);
  const existingNames = new Set(existingCustomers.map(r => val(r.fields["客户名称"])));
  console.log(`    已有 ${existingNames.size} 个客户`);

  // 建立现有客户的名称→record_id索引（用于增量更新）
  const existingByName = {};
  for (const r of existingCustomers) {
    const n = val(r.fields["客户名称"]);
    if (n) existingByName[n] = r;
  }

  // 同步
  console.log("\n[3] 同步中...");
  let created = 0, updated = 0, skipped = 0;

  for (const rec of crmCustomers) {
    const name = val(rec.fields["客户名称"]);
    if (!name) { skipped++; continue; }

    // 从CRM提取联系信息
    const contact = val(rec.fields["联系人"]);
    const phone = val(rec.fields["电话"]);
    const address = val(rec.fields["地址"]);
    const province = val(rec.fields["省份"]);
    const city = val(rec.fields["城市"]);
    const cityField = [province, city].filter(Boolean).join(" ");

    const existing = existingByName[name];
    if (existing) {
      // 已有客户：检查是否需要更新联系信息
      const curContact = val(existing.fields["联系人"]);
      const curPhone = val(existing.fields["联系电话"]);
      const curAddress = val(existing.fields["收货地址"]);
      const curCity = val(existing.fields["所在城市"]);

      const needUpdate = (
        (contact && contact !== curContact) ||
        (phone && phone !== curPhone) ||
        (address && address !== curAddress) ||
        (cityField && cityField !== curCity)
      );

      if (needUpdate) {
        const updateFields = {};
        if (contact && contact !== curContact) updateFields["联系人"] = contact;
        if (phone && phone !== curPhone) updateFields["联系电话"] = phone;
        if (address && address !== curAddress) updateFields["收货地址"] = address;
        if (cityField && cityField !== curCity) updateFields["所在城市"] = cityField;

        if (dryRun) {
          console.log(`  [DRY] 更新客户: ${name} → ${JSON.stringify(updateFields)}`);
        } else {
          const r = await apiPatch(
            `/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${CUSTOMER_TABLE}/records/${existing.record_id}`,
            { fields: updateFields }
          );
          if (r.code !== 0) { console.error(`  ❌ 更新失败 ${name}:`, r.msg); continue; }
          console.log(`  🔄 更新客户: ${name}`);
        }
        updated++;
        await new Promise(r => setTimeout(r, 100)); // 限流保护
      } else {
        skipped++;
      }
      continue;
    }

    // 新客户
    const newId = genCustomerId();
    const fields = {
      客户ID: newId,
      客户名称: name,
      来源系统: "CRM同步",
    };

    // 客户性质 → 客户类型映射
    const nature = val(rec.fields["客户性质"]);
    if (nature) {
      if (nature.includes("医院")) fields["客户类型"] = "眼科医院";
      else if (nature.includes("门诊") || nature.includes("门店")) fields["客户类型"] = "眼镜门店";
      else fields["客户类型"] = "其他";
    }

    if (contact) fields["联系人"] = contact;
    if (phone) fields["联系电话"] = phone;
    if (address) fields["收货地址"] = address;
    if (cityField) fields["所在城市"] = cityField;

    if (dryRun) {
      console.log(`  [DRY] 新建客户: ${name} → ${newId}`);
    } else {
      const r = await apiPost(
        `/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${CUSTOMER_TABLE}/records`,
        { fields }
      );
      if (r.code !== 0) { console.error(`  ❌ 写入失败 ${name}:`, r.msg); continue; }
      console.log(`  ✅ 新建客户: ${name} → ${newId}`);
    }
    created++;
    existingNames.add(name);
  }

  console.log(`\n✅ 同步完成: 新建 ${created} 个，更新 ${updated} 个，跳过 ${skipped} 个`);
}

main().catch(err => { console.error("💥", err.message); process.exit(1); });
