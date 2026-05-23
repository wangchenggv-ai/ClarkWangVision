/**
 * 设置星图年度目标 - 测试用
 * 为深圳视力康(AG-028)设置3000副年度目标
 */

import { TABLES, APP_TOKEN } from "./shared/tables.js";
import { init, feishuApi, getFeishuToken } from "./lib/feishu.js";
import { readFileSync } from "fs";

// 读取环境变量
const envPath = "C:/Users/wangc/Downloads/ClarkWangVision/04-供应链/feishu-setup/shared/.env";
const env = {};
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const [key, ...vals] = line.split("=");
    if (key && vals.length) env[key.trim()] = vals.join("=").trim();
  }
  console.log("✅ 读取.env文件成功");
} catch (e) {
  console.log("⚠️ 无法读取.env文件，使用默认配置");
}

const BASE = "https://open.feishu.cn/open-apis";
const AGENT_TABLE = TABLES.agent;
const TARGET_AGENT_ID = "AG-028";
const TARGET_VOLUME = 3000;

async function main() {
  console.log("=== 设置星图年度目标 ===\n");

  // 1. 初始化feishu模块
  init({ base: BASE, appToken: APP_TOKEN, env });
  console.log("✅ 飞书模块初始化成功");

  // 2. 获取token
  await getFeishuToken();
  console.log("✅ 飞书token获取成功\n");

  // 2. 检查agents表字段
  console.log("步骤1: 检查agents表字段...");
  const fieldsResp = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_TABLE}/fields`
  );
  const fields = fieldsResp?.items || [];
  const targetField = fields.find(f => f.field_name === "年度目标");

  if (targetField) {
    console.log(`✅ 「年度目标」字段已存在 (field_id: ${targetField.field_id})`);
  } else {
    console.log("⚠️ 「年度目标」字段不存在，正在创建...");
    const createResp = await feishuApi("POST",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_TABLE}/fields`,
      {
        field_name: "年度目标",
        type: 2, // Number type
      }
    );
    if (createResp?.field) {
      console.log(`✅ 创建成功 (field_id: ${createResp.field.field_id})`);
    } else {
      console.log("❌ 创建失败:", createResp);
      return;
    }
  }

  // 3. 查找深圳视力康
  console.log("\n步骤2: 查找深圳视力康...");
  const records = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_TABLE}/records?page_size=100`
  );
  const agents = records?.items || [];
  const targetAgent = agents.find(r => {
    const id = r.fields["代理商ID"] || r.fields["agent_id"] || "";
    return id === TARGET_AGENT_ID;
  });

  if (!targetAgent) {
    console.log(`❌ 未找到代理商 ${TARGET_AGENT_ID}`);
    return;
  }

  const agentName = targetAgent.fields["代理商名称"] || targetAgent.fields["name"] || "未知";
  console.log(`✅ 找到: ${agentName} (${TARGET_AGENT_ID})`);
  console.log(`   record_id: ${targetAgent.record_id}`);

  // 4. 更新年度目标
  console.log(`\n步骤3: 设置年度目标为 ${TARGET_VOLUME} 副...`);
  const updateResp = await feishuApi("PUT",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_TABLE}/records/${targetAgent.record_id}`,
    {
      fields: {
        "年度目标": TARGET_VOLUME,
      }
    }
  );

  if (updateResp?.record) {
    console.log(`✅ 更新成功！`);
    console.log(`   年度目标: ${TARGET_VOLUME} 副`);
  } else {
    console.log("❌ 更新失败:", updateResp);
    return;
  }

  // 5. 验证
  console.log("\n步骤4: 验证更新...");
  const verifyResp = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_TABLE}/records/${targetAgent.record_id}`
  );
  const updatedTarget = verifyResp?.fields?.["年度目标"];
  console.log(`   读取到的年度目标: ${updatedTarget} 副`);

  if (updatedTarget === TARGET_VOLUME) {
    console.log("\n=== 完成 ===");
    console.log(`深圳视力康年度目标已设置为 ${TARGET_VOLUME} 副`);
    console.log("\n下一步: 测试star-trail API");
    console.log(`  curl "http://localhost:3210/api/starmap/star-trail?agentId=${TARGET_AGENT_ID}"`);
  } else {
    console.log("\n⚠️ 验证失败，请手动检查Bitable");
  }
}

main().catch(console.error);
