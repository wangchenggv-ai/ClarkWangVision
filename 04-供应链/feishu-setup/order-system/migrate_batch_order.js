import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = join(__dirname, "..", "shared", ".env");
  const env = {};
  try {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {}
  return env;
}

const ENV = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";

const feishuMod = await import("./lib/feishu.js");
feishuMod.init({ base: BASE, appToken: APP_TOKEN, env: ENV });

const fields = [
  { field_name: "顾客姓名", type: 1 },
  { field_name: "产品型号", type: 1 },
  { field_name: "眼别", type: 1 },
  { field_name: "球镜SPH", type: 2 },
  { field_name: "柱镜CYL", type: 2 },
  { field_name: "轴位AXIS", type: 2 },
  { field_name: "镜片码（唯一）", type: 1 },
  { field_name: "验真网址", type: 15 },
  { field_name: "订单状态", type: 1 },
  { field_name: "创建时间", type: 5 },
];

const res = await feishuMod.feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
  table: { name: "批量订单", fields },
});

console.log("Created table:", JSON.stringify(res, null, 2));
