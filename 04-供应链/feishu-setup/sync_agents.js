/**
 * sync_agents.js — 同步 CRM 代理商表 → 供应链代理商表
 *
 * 数据源: CRM "01_代理商开发管理" (RlfTb6gykaEb3gsR1lwcGnShnAA / tblWmD23R4djdAlW)
 * 目标: 供应链代理商表 (B3xQbbqicaome1sKdZbcwdk8nWg / tblHsgGbJWkB31qu)
 *
 * 同步逻辑:
 *   - 已存在（按CRM_ID匹配）：更新代理商名称 + 地址，不覆盖Token/手机/状态/备注
 *   - 新代理商：生成AG-XXX ID + token，状态=启用
 *   - CRM已删除（有CRM_ID但CRM中找不到）：状态=停用（软删除）
 *   - 没有CRM_ID的代理商（测试等）：跳过不动
 *
 * Usage:
 *   node sync_agents.js            # 全量同步
 *   node sync_agents.js --dry-run  # 只打印，不写入
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const NEW_APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const AGENT_TABLE = "tblHsgGbJWkB31qu";

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

let TOKEN = "";
let CRM_TOKEN = "";

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
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return res.json();
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

function genToken(id) {
  const r = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${id}-${r}`;
}

// 从飞书字段值中提取纯文本
function val(v) {
  if (!v) return "";
  if (Array.isArray(v)) return v.map(i => i.text || i.name || String(i)).join("");
  if (typeof v === "object") return v.text || v.name || "";
  return String(v);
}

// CRM auto_number返回字符串如 "D001"，直接用
function getCrmId(rec) {
  const v = rec.fields["代理商编号"];
  if (v == null) return "";
  return String(v);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== CRM代理商同步 ${dryRun ? "[DRY-RUN]" : ""} ===\n`);

  const env = loadEnv();
  const CRM_APP_TOKEN = env.CRM_APP_TOKEN || "RlfTb6gykaEb3gsR1lwcGnShnAA";
  const CRM_AGENT_TABLE = env.CRM_AGENT_TABLE || "tblWmD23R4djdAlW";

  await getToken(env);
  await getCrmToken(env);
  console.log("✅ 飞书 tokens 获取成功（供应链 + CRM）\n");

  // 1. 读CRM代理商
  console.log("[1] 读取 CRM 代理商表...");
  const crmAgents = await listCrmRecords(CRM_APP_TOKEN, CRM_AGENT_TABLE);
  console.log(`    读到 ${crmAgents.length} 条CRM记录`);

  // 过滤已签约的
  const signedAgents = crmAgents.filter(r => {
    const signed = r.fields["是否签约"];
    return signed && (signed === "是" || signed === "已签约");
  });
  console.log(`    其中已签约: ${signedAgents.length} 条`);

  // 2. 读供应链现有代理商
  console.log("\n[2] 读取供应链代理商表...");
  const existingAgents = await listAllRecords(NEW_APP_TOKEN, AGENT_TABLE);
  console.log(`    已有 ${existingAgents.length} 条`);

  // 建CRM_ID→record映射（用于更新匹配）
  const byCrmId = new Map();
  for (const r of existingAgents) {
    const crmId = val(r.fields["CRM_ID"]);
    if (crmId) byCrmId.set(crmId, r);
  }

  // 3. 同步
  console.log("\n[3] 同步中...");
  let created = 0, updated = 0, skipped = 0;
  const crmIdSet = new Set();

  // 找到当前最大AG编号
  let maxNum = 0;
  for (const r of existingAgents) {
    const id = val(r.fields["代理商ID"]);
    const m = id.match(/^AG-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  }

  for (const rec of signedAgents) {
    const crmId = getCrmId(rec);
    if (!crmId) { skipped++; continue; }
    crmIdSet.add(crmId);

    const name = val(rec.fields["代理商名称"]);
    if (!name) { skipped++; continue; }

    const address = val(rec.fields["签约区域"]) || val(rec.fields["省份"]);

    const existing = byCrmId.get(crmId);
    if (existing) {
      // 已存在：更新名称+地址（不覆盖Token/手机/状态/备注）
      const oldName = val(existing.fields["代理商名称"]);
      const oldAddr = val(existing.fields["地址"]);
      if (oldName === name && oldAddr === address) { skipped++; continue; }

      if (dryRun) {
        console.log(`  [DRY] 更新 ${crmId}: ${oldName} → ${name}`);
      } else {
        const r = await apiPut(
          `/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${AGENT_TABLE}/records/${existing.record_id}`,
          { fields: { 代理商名称: name, 地址: address, CRM同步时间: Date.now() } }
        );
        if (r.code !== 0) { console.error(`  ❌ 更新失败 ${crmId}:`, r.msg); continue; }
        console.log(`  ✅ 更新 ${crmId}: ${oldName} → ${name}`);
      }
      updated++;
    } else {
      // 新代理商
      maxNum++;
      const newId = `AG-${String(maxNum).padStart(3, "0")}`;
      const token = genToken(newId);
      const fields = {
        代理商ID: newId,
        代理商名称: name,
        CRM_ID: crmId,
        下单Token: token,
        地址: address,
        状态: "启用",
        CRM同步时间: Date.now(),
        来源系统: "CRM同步",
      };

      if (dryRun) {
        console.log(`  [DRY] 新建 ${newId} ${crmId} ${name}`);
      } else {
        const r = await apiPost(
          `/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${AGENT_TABLE}/records`,
          { fields }
        );
        if (r.code !== 0) { console.error(`  ❌ 新建失败 ${name}:`, r.msg); continue; }
        console.log(`  ✅ 新建 ${newId} ${crmId} ${name}`);
      }
      created++;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // 4. 软删除：CRM中不存在但供应链中有CRM_ID且不在crmIdSet中的
  let deactivated = 0;
  for (const r of existingAgents) {
    const crmId = val(r.fields["CRM_ID"]);
    const status = val(r.fields["状态"]);
    if (!crmId || status === "停用") continue; // 没有CRM_ID的（测试代理商）或已停用的跳过
    if (!crmIdSet.has(crmId)) {
      const name = val(r.fields["代理商名称"]);
      if (dryRun) {
        console.log(`  [DRY] 停用 ${crmId} ${name}（CRM中已删除）`);
      } else {
        const resp = await apiPut(
          `/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${AGENT_TABLE}/records/${r.record_id}`,
          { fields: { 状态: "停用", CRM同步时间: Date.now() } }
        );
        if (resp.code !== 0) { console.error(`  ❌ 停用失败 ${crmId}:`, resp.msg); continue; }
        console.log(`  ⏹ 停用 ${crmId} ${name}（CRM中已删除）`);
      }
      deactivated++;
    }
  }

  console.log(`\n✅ 同步完成: 新建 ${created}，更新 ${updated}，跳过 ${skipped}，停用 ${deactivated}`);
}

main().catch(err => { console.error("💥", err.message); process.exit(1); });
