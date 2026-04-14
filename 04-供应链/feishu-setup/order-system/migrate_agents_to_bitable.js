/**
 * migrate_agents_to_bitable.js — 一次性迁移 agents.json → 供应链代理商表
 *
 * Usage:
 *   node migrate_agents_to_bitable.js            # 执行
 *   node migrate_agents_to_bitable.js --dry-run  # 只打印
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
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

async function getToken(env) {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== agents.json → 代理商表 迁移 ${dryRun ? "[DRY-RUN]" : ""} ===\n`);

  const agents = JSON.parse(readFileSync(resolve(__dirname, "agent-portal/agents.json"), "utf-8"));
  console.log(`读到 ${agents.length} 个代理商\n`);

  const env = loadEnv();
  await getToken(env);
  console.log("✅ Token 获取成功\n");

  let created = 0, failed = 0;

  for (const agent of agents) {
    const fields = {
      代理商ID: agent.id,
      代理商名称: agent.name,
      CRM_ID: agent.crm_id || "",
      下单Token: agent.token,
      手机号: agent.phone || "",
      地址: agent.address || "",
      状态: "启用",
      来源系统: "手动导入",
    };

    if (dryRun) {
      console.log(`  [DRY] ${agent.id} ${agent.name} token=${agent.token}`);
    } else {
      const r = await apiPost(
        `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_TABLE}/records`,
        { fields }
      );
      if (r.code !== 0) {
        console.error(`  ❌ ${agent.id} ${agent.name}: ${r.msg}`);
        failed++;
        continue;
      }
      console.log(`  ✅ ${agent.id} ${agent.name}`);
    }
    created++;
    // 避免并发写冲突
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n✅ 迁移完成: 导入 ${created} 个，失败 ${failed} 个`);
}

main().catch(err => { console.error("💥", err.message); process.exit(1); });
