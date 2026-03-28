/**
 * 飞书多维表格自动建表脚本 — 眼镜供应链智能系统
 *
 * 使用方式:
 *   1. 在飞书开放平台创建企业自建应用，获取 App ID 和 App Secret
 *   2. 应用权限中添加: bitable:app (多维表格)
 *   3. 复制 .env.example 为 .env，填入凭证
 *   4. node setup_tables.js
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 配置 ───────────────────────────────────────────────

// 从 .env 文件读取配置
function loadEnv() {
  try {
    const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      env[key.trim()] = rest.join("=").trim();
    }
    return env;
  } catch {
    console.error("❌ 找不到 .env 文件，请复制 .env.example 为 .env 并填入飞书凭证");
    process.exit(1);
  }
}

const env = loadEnv();
const APP_ID = env.FEISHU_APP_ID;
const APP_SECRET = env.FEISHU_APP_SECRET;

if (!APP_ID || !APP_SECRET) {
  console.error("❌ 请在 .env 中填写 FEISHU_APP_ID 和 FEISHU_APP_SECRET");
  process.exit(1);
}

const BASE = "https://open.feishu.cn/open-apis";

// ─── HTTP 工具 ──────────────────────────────────────────

async function request(method, path, body, token) {
  const url = `${BASE}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.error(`API 错误 [${path}]:`, JSON.stringify(json, null, 2));
    throw new Error(`API code=${json.code} msg=${json.msg}`);
  }
  return json.data;
}

// ─── 获取 tenant_access_token ───────────────────────────

async function getTenantToken() {
  console.log("🔑 获取 tenant_access_token ...");
  const data = await request("POST", "/auth/v3/tenant_access_token/internal", {
    app_id: APP_ID,
    app_secret: APP_SECRET,
  });
  // 这个接口返回格式不同，直接在顶层
  return data.tenant_access_token || data;
}

// 这个接口比较特殊，不走标准 code/data 格式
async function getTenantTokenRaw() {
  const url = `${BASE}/auth/v3/tenant_access_token/internal`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.error("获取 token 失败:", json);
    throw new Error("无法获取 tenant_access_token");
  }
  console.log("✅ token 获取成功");
  return json.tenant_access_token;
}

// ─── 创建多维表格 ───────────────────────────────────────

async function createBitable(token) {
  console.log("\n📊 创建多维表格「眼镜供应链智能系统」...");
  // 创建多维表格（在根目录）
  const data = await request("POST", "/bitable/v1/apps", {
    name: "眼镜供应链智能系统",
  }, token);
  const appToken = data.app.app_token;
  const url = data.app.url;
  console.log(`✅ 多维表格已创建: ${url}`);
  return { appToken, url };
}

// ─── 表结构定义 ─────────────────────────────────────────

// 飞书字段类型编号
const T = {
  TEXT: 1,        // 文本
  NUMBER: 2,      // 数字
  SELECT: 3,      // 单选
  DATE: 5,        // 日期
  LINK: 21,       // 关联
  FORMULA: 20,    // 公式
  AUTO_NUM: 15,   // 自动编号
  CREATED_TIME: 1001, // 创建时间
  MODIFIED_TIME: 1002, // 修改时间
};

// 注意：关联字段需要在所有表建好后再创建（需要 table_id）
// 公式字段也在后面单独添加

const TABLE_DEFS = [
  {
    key: "sku",
    name: "SKU主数据表",
    fields: [
      { field_name: "SKU编号", type: T.TEXT },
      { field_name: "SKU名称", type: T.TEXT },
      { field_name: "类型", type: T.SELECT, property: { options: [{ name: "备货品" }, { name: "定制品" }] } },
      { field_name: "安全库存", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "最大库存（3月量）", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "标准交期（天）", type: T.NUMBER, property: { formatter: "0" } },
    ],
  },
  {
    key: "finished_inventory",
    name: "成品库存表",
    fields: [
      { field_name: "SKU", type: T.TEXT },  // 先用文本，后面改关联
      { field_name: "当前库存", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "在产量", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "状态", type: T.TEXT },
      { field_name: "最近更新", type: T.MODIFIED_TIME },
    ],
  },
  {
    key: "blank_inventory",
    name: "毛坯片库存表",
    fields: [
      { field_name: "SKU", type: T.TEXT },
      { field_name: "当前毛坯库存", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "在产毛坯量", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "可转成品数", type: T.NUMBER, property: { formatter: "0" } },
    ],
  },
  {
    key: "mold",
    name: "模芯管理表",
    fields: [
      { field_name: "模芯编号", type: T.TEXT },
      { field_name: "SKU", type: T.TEXT },
      { field_name: "总寿命（次）", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "已使用次数", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "剩余次数", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "预警阈值", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "状态", type: T.TEXT },
    ],
  },
  {
    key: "production",
    name: "排产计划表",
    fields: [
      { field_name: "周次", type: T.TEXT },
      { field_name: "SKU", type: T.TEXT },
      { field_name: "建议产量", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "生产类型", type: T.SELECT, property: { options: [{ name: "备货生产" }, { name: "定制生产" }] } },
      { field_name: "触发原因", type: T.TEXT },
      { field_name: "状态", type: T.SELECT, property: { options: [{ name: "待确认" }, { name: "已确认" }, { name: "生产中" }, { name: "完成" }] } },
    ],
  },
  {
    key: "forecast",
    name: "销售预测表",
    fields: [
      { field_name: "预测周期", type: T.TEXT },
      { field_name: "SKU", type: T.TEXT },
      { field_name: "预测销量", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "历史参考均值", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "实际销量", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "预测准确率", type: T.TEXT },
    ],
  },
  {
    key: "ai_analysis",
    name: "AI分析记录表",
    fields: [
      { field_name: "分析日期", type: T.DATE, property: { date_formatter: "yyyy/MM/dd" } },
      { field_name: "分析类型", type: T.SELECT, property: { options: [{ name: "库存预警" }, { name: "排产建议" }, { name: "周报摘要" }] } },
      { field_name: "AI分析内容", type: T.TEXT },
      { field_name: "关键预警", type: T.TEXT },
      { field_name: "建议行动", type: T.TEXT },
    ],
  },
  {
    key: "order",
    name: "订单表",
    fields: [
      { field_name: "订单编号", type: T.TEXT },
      { field_name: "下单日期", type: T.DATE, property: { date_formatter: "yyyy/MM/dd" } },
      { field_name: "SKU", type: T.TEXT },
      { field_name: "数量", type: T.NUMBER, property: { formatter: "0" } },
      { field_name: "交期类型", type: T.SELECT, property: { options: [{ name: "有货3天" }, { name: "定制5天" }] } },
      { field_name: "承诺交货日", type: T.DATE, property: { date_formatter: "yyyy/MM/dd" } },
      { field_name: "订单状态", type: T.SELECT, property: { options: [{ name: "待处理" }, { name: "生产中" }, { name: "已发货" }, { name: "完成" }] } },
    ],
  },
];

// ─── 模拟数据 ───────────────────────────────────────────

const MOCK_DATA = {
  sku: [
    { "SKU编号": "SKU-001", "SKU名称": "1.56非球面透明镜片", "类型": "备货品", "安全库存": 30, "最大库存（3月量）": 200, "标准交期（天）": 3 },
    { "SKU编号": "SKU-002", "SKU名称": "1.60非球面透明镜片", "类型": "备货品", "安全库存": 25, "最大库存（3月量）": 180, "标准交期（天）": 3 },
    { "SKU编号": "SKU-003", "SKU名称": "1.67非球面透明镜片", "类型": "备货品", "安全库存": 20, "最大库存（3月量）": 150, "标准交期（天）": 3 },
    { "SKU编号": "SKU-004", "SKU名称": "1.74非球面透明镜片", "类型": "备货品", "安全库存": 15, "最大库存（3月量）": 100, "标准交期（天）": 3 },
    { "SKU编号": "SKU-005", "SKU名称": "1.56防蓝光镜片", "类型": "备货品", "安全库存": 20, "最大库存（3月量）": 150, "标准交期（天）": 3 },
    { "SKU编号": "SKU-006", "SKU名称": "1.60防蓝光镜片", "类型": "备货品", "安全库存": 18, "最大库存（3月量）": 130, "标准交期（天）": 3 },
    { "SKU编号": "SKU-007", "SKU名称": "1.67防蓝光镜片", "类型": "备货品", "安全库存": 12, "最大库存（3月量）": 90, "标准交期（天）": 3 },
    { "SKU编号": "SKU-008", "SKU名称": "1.56变色镜片（灰）", "类型": "备货品", "安全库存": 10, "最大库存（3月量）": 80, "标准交期（天）": 3 },
    { "SKU编号": "SKU-009", "SKU名称": "1.60变色镜片（茶）", "类型": "备货品", "安全库存": 8, "最大库存（3月量）": 60, "标准交期（天）": 3 },
    { "SKU编号": "SKU-010", "SKU名称": "1.56渐进多焦点镜片", "类型": "定制品", "安全库存": 0, "最大库存（3月量）": 0, "标准交期（天）": 5 },
    { "SKU编号": "SKU-011", "SKU名称": "1.60渐进多焦点镜片", "类型": "定制品", "安全库存": 0, "最大库存（3月量）": 0, "标准交期（天）": 5 },
    { "SKU编号": "SKU-012", "SKU名称": "1.67高度数定制镜片", "类型": "定制品", "安全库存": 0, "最大库存（3月量）": 0, "标准交期（天）": 5 },
  ],
  finished_inventory: [
    { "SKU": "SKU-001", "当前库存": 85, "在产量": 40, "状态": "✅有货" },
    { "SKU": "SKU-002", "当前库存": 60, "在产量": 30, "状态": "✅有货" },
    { "SKU": "SKU-003", "当前库存": 45, "在产量": 20, "状态": "✅有货" },
    { "SKU": "SKU-004", "当前库存": 12, "在产量": 0, "状态": "⚠️低库存" },
    { "SKU": "SKU-005", "当前库存": 50, "在产量": 25, "状态": "✅有货" },
    { "SKU": "SKU-006", "当前库存": 18, "在产量": 0, "状态": "⚠️低库存" },
    { "SKU": "SKU-007", "当前库存": 0, "在产量": 0, "状态": "❌缺货" },
    { "SKU": "SKU-008", "当前库存": 25, "在产量": 10, "状态": "✅有货" },
    { "SKU": "SKU-009", "当前库存": 3, "在产量": 0, "状态": "⚠️低库存" },
    { "SKU": "SKU-010", "当前库存": 0, "在产量": 0, "状态": "定制品" },
    { "SKU": "SKU-011", "当前库存": 0, "在产量": 0, "状态": "定制品" },
    { "SKU": "SKU-012", "当前库存": 0, "在产量": 0, "状态": "定制品" },
  ],
  blank_inventory: [
    { "SKU": "SKU-001", "当前毛坯库存": 120, "在产毛坯量": 60, "可转成品数": 120 },
    { "SKU": "SKU-002", "当前毛坯库存": 90, "在产毛坯量": 50, "可转成品数": 90 },
    { "SKU": "SKU-003", "当前毛坯库存": 60, "在产毛坯量": 40, "可转成品数": 60 },
    { "SKU": "SKU-004", "当前毛坯库存": 20, "在产毛坯量": 0, "可转成品数": 20 },
    { "SKU": "SKU-005", "当前毛坯库存": 80, "在产毛坯量": 30, "可转成品数": 80 },
    { "SKU": "SKU-006", "当前毛坯库存": 40, "在产毛坯量": 0, "可转成品数": 40 },
    { "SKU": "SKU-007", "当前毛坯库存": 0, "在产毛坯量": 30, "可转成品数": 0 },
    { "SKU": "SKU-008", "当前毛坯库存": 35, "在产毛坯量": 20, "可转成品数": 35 },
    { "SKU": "SKU-009", "当前毛坯库存": 10, "在产毛坯量": 0, "可转成品数": 10 },
  ],
  mold: [
    { "模芯编号": "MC-001", "SKU": "SKU-001", "总寿命（次）": 5000, "已使用次数": 2100, "剩余次数": 2900, "预警阈值": 500, "状态": "🟢正常" },
    { "模芯编号": "MC-002", "SKU": "SKU-002", "总寿命（次）": 5000, "已使用次数": 3800, "剩余次数": 1200, "预警阈值": 500, "状态": "🟢正常" },
    { "模芯编号": "MC-003", "SKU": "SKU-003", "总寿命（次）": 5000, "已使用次数": 4600, "剩余次数": 400, "预警阈值": 500, "状态": "🟡预警" },
    { "模芯编号": "MC-004", "SKU": "SKU-004", "总寿命（次）": 4000, "已使用次数": 3950, "剩余次数": 50, "预警阈值": 500, "状态": "🔴需更换" },
    { "模芯编号": "MC-005", "SKU": "SKU-005", "总寿命（次）": 5000, "已使用次数": 1500, "剩余次数": 3500, "预警阈值": 500, "状态": "🟢正常" },
    { "模芯编号": "MC-006", "SKU": "SKU-006", "总寿命（次）": 5000, "已使用次数": 2800, "剩余次数": 2200, "预警阈值": 500, "状态": "🟢正常" },
    { "模芯编号": "MC-007", "SKU": "SKU-008", "总寿命（次）": 4000, "已使用次数": 3200, "剩余次数": 800, "预警阈值": 500, "状态": "🟢正常" },
  ],
  forecast: [
    { "预测周期": "2026-W14", "SKU": "SKU-001", "预测销量": 50, "历史参考均值": 45, "实际销量": 0, "预测准确率": "" },
    { "预测周期": "2026-W14", "SKU": "SKU-002", "预测销量": 40, "历史参考均值": 38, "实际销量": 0, "预测准确率": "" },
    { "预测周期": "2026-W14", "SKU": "SKU-003", "预测销量": 30, "历史参考均值": 28, "实际销量": 0, "预测准确率": "" },
    { "预测周期": "2026-W14", "SKU": "SKU-004", "预测销量": 20, "历史参考均值": 18, "实际销量": 0, "预测准确率": "" },
    { "预测周期": "2026-W14", "SKU": "SKU-005", "预测销量": 25, "历史参考均值": 22, "实际销量": 0, "预测准确率": "" },
    { "预测周期": "2026-W14", "SKU": "SKU-006", "预测销量": 15, "历史参考均值": 14, "实际销量": 0, "预测准确率": "" },
    { "预测周期": "2026-W14", "SKU": "SKU-007", "预测销量": 10, "历史参考均值": 8, "实际销量": 0, "预测准确率": "" },
    { "预测周期": "2026-W14", "SKU": "SKU-008", "预测销量": 8, "历史参考均值": 7, "实际销量": 0, "预测准确率": "" },
    { "预测周期": "2026-W14", "SKU": "SKU-009", "预测销量": 6, "历史参考均值": 5, "实际销量": 0, "预测准确率": "" },
  ],
  order: [
    { "订单编号": "ORD-2026-0401", "下单日期": 1743120000000, "SKU": "SKU-001", "数量": 5, "交期类型": "有货3天", "承诺交货日": 1743379200000, "订单状态": "待处理" },
    { "订单编号": "ORD-2026-0402", "下单日期": 1743120000000, "SKU": "SKU-007", "数量": 3, "交期类型": "定制5天", "承诺交货日": 1743552000000, "订单状态": "待处理" },
    { "订单编号": "ORD-2026-0403", "下单日期": 1743120000000, "SKU": "SKU-004", "数量": 10, "交期类型": "有货3天", "承诺交货日": 1743379200000, "订单状态": "待处理" },
    { "订单编号": "ORD-2026-0404", "下单日期": 1743120000000, "SKU": "SKU-009", "数量": 5, "交期类型": "定制5天", "承诺交货日": 1743552000000, "订单状态": "待处理" },
    { "订单编号": "ORD-2026-0405", "下单日期": 1743120000000, "SKU": "SKU-010", "数量": 2, "交期类型": "定制5天", "承诺交货日": 1743552000000, "订单状态": "待处理" },
  ],
};

// ─── 建表主流程 ─────────────────────────────────────────

async function createTable(token, appToken, tableDef) {
  // 创建表（带第一个字段，飞书要求至少一个字段）
  const data = await request(
    "POST",
    `/bitable/v1/apps/${appToken}/tables`,
    {
      table: {
        name: tableDef.name,
        default_view_name: "默认视图",
        fields: tableDef.fields.map((f) => {
          const field = { field_name: f.field_name, type: f.type };
          if (f.property) field.property = f.property;
          return field;
        }),
      },
    },
    token
  );
  return data.table_id;
}

async function batchCreateRecords(token, appToken, tableId, records) {
  if (!records || records.length === 0) return;

  // 飞书批量写入上限 500 条，这里数据量小直接一次写
  const data = await request(
    "POST",
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
    {
      records: records.map((r) => ({ fields: r })),
    },
    token
  );
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 主函数 ─────────────────────────────────────────────

async function main() {
  console.log("🚀 眼镜供应链智能系统 — 飞书多维表格自动建表\n");

  // 1. 获取 token
  const token = await getTenantTokenRaw();

  // 2. 创建多维表格
  const { appToken, url } = await createBitable(token);

  // 3. 删除默认表（新建的多维表格会自带一张空表）
  // 先获取表列表
  const tableList = await request("GET", `/bitable/v1/apps/${appToken}/tables`, null, token);
  const defaultTableId = tableList.items?.[0]?.table_id;

  // 4. 逐张建表 + 写入数据
  const tableIds = {};

  for (const def of TABLE_DEFS) {
    console.log(`\n📋 创建表: ${def.name} ...`);
    const tableId = await createTable(token, appToken, def);
    tableIds[def.key] = tableId;
    console.log(`   ✅ ${def.name} (${tableId})`);

    // 写入模拟数据
    const mockData = MOCK_DATA[def.key];
    if (mockData && mockData.length > 0) {
      console.log(`   📝 写入 ${mockData.length} 条模拟数据 ...`);
      await batchCreateRecords(token, appToken, tableId, mockData);
      console.log(`   ✅ 数据写入完成`);
    }

    await sleep(200); // 避免触发限流
  }

  // 5. 删除默认空表
  if (defaultTableId) {
    try {
      await request("DELETE", `/bitable/v1/apps/${appToken}/tables/${defaultTableId}`, null, token);
      console.log("\n🗑️  已删除默认空表");
    } catch {
      // 忽略
    }
  }

  // 6. 输出结果
  console.log("\n" + "=".repeat(60));
  console.log("🎉 全部完成！");
  console.log("=".repeat(60));
  console.log(`\n📊 多维表格链接: ${url}`);
  console.log(`\n📋 表 ID 清单（配置自动化规则时需要）:`);
  for (const def of TABLE_DEFS) {
    console.log(`   ${def.name}: ${tableIds[def.key]}`);
  }
  console.log(`\n🔗 App Token: ${appToken}`);
  console.log("\n下一步: 在飞书中打开链接，配置自动化规则（Sprint 2）");
}

main().catch((err) => {
  console.error("\n💥 执行失败:", err.message);
  process.exit(1);
});
