import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import * as feishuMod from "./lib/feishu.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 加载环境变量
function loadEnv() {
  const candidates = [
    resolve(__dirname, "../shared/.env"),
    resolve(__dirname, "../.env"),
    resolve(__dirname, ".env"),
  ];
  const env = {};
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [k, ...v] = t.split("=");
      const key = k.trim();
      if (!(key in env)) env[key] = v.join("=").trim();
    }
  }
  return env;
}

const ENV = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = ENV.FEISHU_APP_TOKEN || "";

// 初始化飞书模块
feishuMod.init({ base: BASE, appToken: APP_TOKEN, env: ENV });

const { feishuApi } = feishuMod;

/**
 * 创建导出记录表
 */

const TABLE_DEF = {
  name: "导出记录",
  fields: [
    { field_name: "导出类型", type: 3, property: { options: [
      { name: "factory", color: 0 },
      { name: "label", color: 1 },
      { name: "slip", color: 2 },
      { name: "statement", color: 3 },
    ]}},
    { field_name: "导出批次号", type: 1 },
    { field_name: "包含订单号", type: 1 },
    { field_name: "包含镜片码", type: 1 },
    { field_name: "导出时间", type: 5 },
    { field_name: "操作人", type: 1 },
    { field_name: "导出文件名", type: 1 },
    { field_name: "备注", type: 1 },
  ],
};

async function createExportLogTable() {
  console.log("创建导出记录表...");
  
  const data = await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: TABLE_DEF.name,
      default_view_name: "默认视图",
      fields: TABLE_DEF.fields,
    },
  });

  if (data && data.table_id) {
    console.log(`✅ 导出记录表创建成功！`);
    console.log(`   Table ID: ${data.table_id}`);
    console.log(`\n请将以下内容更新到 shared/tables.js 中：`);
    console.log(`   export_log: "${data.table_id}",`);
  } else {
    console.error("❌ 创建失败:", data);
  }
}

createExportLogTable().catch(console.error);
