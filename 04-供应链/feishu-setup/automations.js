/**
 * 自动化规则脚本 — 通过飞书 API 实现4条业务规则
 *
 * 用法:
 *   node automations.js rule1   # 处理新订单：查库存→写交期
 *   node automations.js rule2   # 库存预警检查
 *   node automations.js rule3   # 模芯寿命预警
 *   node automations.js rule4   # 销售预测→排产建议
 *   node automations.js all     # 依次执行全部规则
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 配置 ───────────────────────────────────────────────

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

// 表 ID
const TABLES = {
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  blank_inventory: "tbladv6bQTXlNOlM",
  mold: "tblkZ4ODg3v63prW",
  production: "tbltSntfaR9KCI7B",
  forecast: "tblFLAHOXLSgWS6Q",
  ai_analysis: "tbl8W9F9K2RbaL0k",
  order: "tblk9Ch4gk2uQ1zG",
};

let TOKEN = "";

// ─── HTTP 工具 ──────────────────────────────────────────

async function api(method, path, body) {
  const url = `${BASE}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.error(`  API 错误 [${method} ${path}]:`, json.msg);
    return null;
  }
  return json.data;
}

async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const json = await res.json();
  TOKEN = json.tenant_access_token;
}

// ─── 通用：读取全表记录 ────────────────────────────────

async function listRecords(tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const data = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    if (!data) break;
    if (data.items) records.push(...data.items);
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return records;
}

async function updateRecord(tableId, recordId, fields) {
  return api("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`, { fields });
}

async function createRecord(tableId, fields) {
  return api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`, { fields });
}

// ─── 通用：发飞书消息（通过 webhook 或直接写入 AI 分析表记录） ──

function logAlert(emoji, message) {
  console.log(`  ${emoji} ${message}`);
}

// ─── 规则1：订单 → 查库存 → 写交期 ────────────────────

async function rule1() {
  console.log("\n📦 规则1：处理订单 → 查库存 → 写交期");
  console.log("─".repeat(50));

  const orders = await listRecords(TABLES.order);
  const inventory = await listRecords(TABLES.finished_inventory);
  const skuData = await listRecords(TABLES.sku);

  // 建立 SKU 类型索引
  const skuMap = {};
  for (const r of skuData) {
    skuMap[r.fields["SKU编号"]] = r;
  }

  // 建立库存索引 SKU -> record
  const invMap = {};
  for (const r of inventory) {
    const sku = r.fields["SKU"];
    if (sku) invMap[sku] = r;
  }

  let processed = 0;
  for (const order of orders) {
    const f = order.fields;
    // 跳过已处理的订单（已有交期类型）
    if (f["交期类型"]) {
      console.log(`  ⏭️  ${f["订单编号"]} 已处理，跳过`);
      continue;
    }

    const sku = f["SKU"];
    const qty = Number(f["数量"]) || 0;
    const orderDate = f["下单日期"]; // 飞书日期是毫秒时间戳

    const inv = invMap[sku];
    const currentStock = Number(inv ? (inv.fields["当前库存"] || 0) : 0);

    // 查 SKU 类型（定制品始终走定制5天）
    const skuInfo = skuMap[sku];
    const isCustom = skuInfo && skuInfo.fields["类型"] === "定制品";

    let deliveryType, daysToAdd;
    if (!isCustom && currentStock >= qty) {
      deliveryType = "有货3天";
      daysToAdd = 3;
      // 扣减库存
      if (inv) {
        const newStock = currentStock - qty;
        await updateRecord(TABLES.finished_inventory, inv.record_id, { "当前库存": newStock });
        inv.fields["当前库存"] = newStock;
        console.log(`  📉 ${sku} 库存扣减: ${currentStock} → ${newStock}`);
      }
    } else {
      deliveryType = "定制5天";
      daysToAdd = 5;
    }

    // 计算承诺交货日
    let promiseDate = null;
    if (orderDate) {
      const ts = typeof orderDate === "number" ? orderDate : orderDate;
      promiseDate = ts + daysToAdd * 24 * 60 * 60 * 1000;
    }

    const update = {
      "交期类型": deliveryType,
      "订单状态": "待处理",
    };
    if (promiseDate) update["承诺交货日"] = promiseDate;

    await updateRecord(TABLES.order, order.record_id, update);
    console.log(`  ✅ ${f["订单编号"]} | ${sku} × ${qty} → ${deliveryType}（库存${currentStock}）`);
    processed++;
  }

  console.log(`\n  处理完成: ${processed} 条订单`);
}

// ─── 规则2：库存低于安全值 → 预警 ─────────────────────

async function rule2() {
  console.log("\n📊 规则2：库存预警检查");
  console.log("─".repeat(50));

  const inventory = await listRecords(TABLES.finished_inventory);
  const skuData = await listRecords(TABLES.sku);

  // SKU编号 -> 安全库存
  const safetyMap = {};
  for (const r of skuData) {
    const id = r.fields["SKU编号"];
    safetyMap[id] = {
      safety: r.fields["安全库存"] || 0,
      name: r.fields["SKU名称"],
      type: r.fields["类型"],
    };
  }

  let alerts = 0;
  for (const r of inventory) {
    const sku = r.fields["SKU"];
    const current = r.fields["当前库存"] || 0;
    const info = safetyMap[sku];
    if (!info) continue;

    // 定制品不检查库存
    if (info.type === "定制品") continue;

    let status;
    if (current <= 0) {
      status = "❌缺货";
      logAlert("🚨", `${sku}（${info.name}）已缺货！当前库存 0`);
      alerts++;
    } else if (current < info.safety) {
      status = "⚠️低库存";
      logAlert("⚠️", `${sku}（${info.name}）库存 ${current} 片，低于安全库存 ${info.safety} 片`);
      alerts++;
    } else {
      status = "✅有货";
      console.log(`  ✅ ${sku}（${info.name}）库存正常: ${current} / 安全线${info.safety}`);
    }

    // 更新状态字段
    await updateRecord(TABLES.finished_inventory, r.record_id, { "状态": status });
  }

  console.log(`\n  检查完成: ${alerts} 条预警`);
}

// ─── 规则3：模芯寿命预警 ──────────────────────────────

async function rule3() {
  console.log("\n🔧 规则3：模芯寿命预警");
  console.log("─".repeat(50));

  const molds = await listRecords(TABLES.mold);

  let alerts = 0;
  for (const r of molds) {
    const f = r.fields;
    const id = f["模芯编号"];
    const total = f["总寿命（次）"] || 0;
    const used = f["已使用次数"] || 0;
    const remaining = total - used;
    const threshold = f["预警阈值"] || 500;

    let status;
    if (remaining <= 50) {
      status = "🔴需更换";
      logAlert("🔴", `${id}（${f["SKU"]}）仅剩 ${remaining} 次，急需更换！采购周期3-4周`);
      alerts++;
    } else if (remaining < threshold) {
      status = "🟡预警";
      logAlert("🟡", `${id}（${f["SKU"]}）剩余 ${remaining} 次，低于预警阈值 ${threshold}`);
      alerts++;
    } else {
      status = "🟢正常";
      console.log(`  🟢 ${id}（${f["SKU"]}）剩余 ${remaining} 次，正常`);
    }

    // 更新剩余次数和状态
    await updateRecord(TABLES.mold, r.record_id, {
      "剩余次数": remaining,
      "状态": status,
    });
  }

  console.log(`\n  检查完成: ${alerts} 条预警`);
}

// ─── 规则4：销售预测 → 排产建议 ───────────────────────

async function rule4() {
  console.log("\n📋 规则4：销售预测 → 排产建议");
  console.log("─".repeat(50));

  const forecasts = await listRecords(TABLES.forecast);
  const inventory = await listRecords(TABLES.finished_inventory);
  const existingPlans = await listRecords(TABLES.production);

  // 库存索引
  const invMap = {};
  for (const r of inventory) {
    invMap[r.fields["SKU"]] = r.fields;
  }

  // 已有排产索引（避免重复生成）
  const planSet = new Set();
  for (const r of existingPlans) {
    planSet.add(`${r.fields["周次"]}_${r.fields["SKU"]}`);
  }

  let created = 0;
  for (const r of forecasts) {
    const f = r.fields;
    const week = f["预测周期"];
    const sku = f["SKU"];
    const forecastQty = f["预测销量"] || 0;

    // 跳过已有排产计划
    if (planSet.has(`${week}_${sku}`)) {
      console.log(`  ⏭️  ${week} ${sku} 已有排产计划，跳过`);
      continue;
    }

    const inv = invMap[sku] || {};
    const currentStock = inv["当前库存"] || 0;
    const inProduction = inv["在产量"] || 0;
    const gap = forecastQty - currentStock - inProduction;

    if (gap > 0) {
      await createRecord(TABLES.production, {
        "周次": week,
        "SKU": sku,
        "建议产量": gap,
        "生产类型": "备货生产",
        "触发原因": `预测${forecastQty} - 库存${currentStock} - 在产${inProduction} = 缺口${gap}`,
        "状态": "待确认",
      });
      logAlert("📌", `${week} ${sku}: 建议产量 ${gap}（预测${forecastQty} - 库存${currentStock} - 在产${inProduction}）`);
      created++;
    } else {
      console.log(`  ✅ ${week} ${sku}: 库存+在产 (${currentStock}+${inProduction}) ≥ 预测 (${forecastQty})，无需排产`);
    }
  }

  console.log(`\n  生成完成: ${created} 条排产建议`);
}

// ─── 主入口 ─────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2] || "all";

  console.log("🚀 眼镜供应链自动化规则引擎\n");
  await getToken();
  console.log("✅ 已连接飞书");

  const rules = {
    rule1,
    rule2,
    rule3,
    rule4,
  };

  if (cmd === "all") {
    for (const [name, fn] of Object.entries(rules)) {
      await fn();
    }
  } else if (rules[cmd]) {
    await rules[cmd]();
  } else {
    console.error(`未知命令: ${cmd}\n用法: node automations.js [rule1|rule2|rule3|rule4|all]`);
    process.exit(1);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ 自动化规则执行完毕");
  console.log("=".repeat(50));
}

main().catch((err) => {
  console.error("\n💥 执行失败:", err.message);
  process.exit(1);
});
