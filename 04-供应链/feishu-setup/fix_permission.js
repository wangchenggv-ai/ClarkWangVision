/**
 * 修复文档权限 — 将多维表格转移给用户 / 开放组织内访问
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    env[key.trim()] = rest.join("=").trim();
  }
  return env;
}

const env = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";

async function main() {
  // 1. 获取 token
  console.log("🔑 获取 token ...");
  const tokenRes = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const tokenData = await tokenRes.json();
  const token = tokenData.tenant_access_token;
  console.log("✅ token 获取成功");

  // 2. 设置文档为组织内所有人可编辑
  console.log("\n📋 设置文档权限: 组织内可编辑 ...");
  const permRes = await fetch(
    `${BASE}/drive/v1/permissions/${APP_TOKEN}/public?type=bitable`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        external_access_entity: "open",
        security_entity: "anyone_can_view",
        comment_entity: "anyone_can_view",
        share_entity: "anyone",
        manage_collaborator_entity: "collaborator_can_view",
        link_share_entity: "tenant_editable",
      }),
    }
  );
  const permData = await permRes.json();
  console.log("权限设置结果:", JSON.stringify(permData, null, 2));

  if (permData.code === 0) {
    console.log("\n✅ 权限已开放！组织内成员通过链接即可编辑");
    console.log(`\n📊 打开链接: https://gausheyetech.feishu.cn/base/${APP_TOKEN}`);
  } else {
    // 如果上面的方式不行，尝试通过转移到用户文件夹
    console.log("\n⚠️ 公开权限设置失败，尝试将文档转移到你的根文件夹 ...");

    // 获取用户的根文件夹
    const folderRes = await fetch(`${BASE}/drive/explorer/v2/root_folder/meta`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const folderData = await folderRes.json();
    console.log("根文件夹:", JSON.stringify(folderData, null, 2));
  }
}

main().catch(console.error);
