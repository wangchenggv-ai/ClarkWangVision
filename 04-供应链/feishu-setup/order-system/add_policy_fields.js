import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { init, feishuApi } from "./lib/feishu.js";
import { APP_TOKEN, TABLES } from "./shared/tables.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 加载 .env
function loadEnv() {
  const paths = [
    resolve(__dirname, "../shared/.env"),
    resolve(__dirname, "../.env"),
    resolve(__dirname, ".env"),
  ];
  const env = {};
  for (const p of paths) {
    try {
      const lines = readFileSync(p, "utf-8").split("\n");
      for (const line of lines) {
        const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
        if (m) env[m[1]] = m[2];
      }
      break;
    } catch {}
  }
  return env;
}

const ENV = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";

init({ base: BASE, appToken: APP_TOKEN, env: ENV });

const TABLE_ID = TABLES.summer_target;

async function addField(name, type, props = {}) {
  try {
    const body = { field_name: name, type, ...props };
    const res = await feishuApi("POST",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/fields`,
      body
    );
    if (res?.field) {
      console.log(`✓ 添加字段 "${name}" 成功 (id: ${res.field.field_id})`);
    } else {
      console.log(`? 添加字段 "${name}" 返回:`, JSON.stringify(res));
    }
  } catch (e) {
    if (e.message?.includes("FieldNameExist") || e.message?.includes("already exists")) {
      console.log(`- 字段 "${name}" 已存在，跳过`);
    } else {
      console.error(`✗ 添加字段 "${name}" 失败:`, e.message);
    }
  }
}

// 1 = 文本, 2 = 数字
await addField("policy_confirmed", 2);  // 数字类型，存储时间戳
await addField("policy_remark", 1);     // 文本类型，存储备注

console.log("\n完成！");
process.exit(0);
