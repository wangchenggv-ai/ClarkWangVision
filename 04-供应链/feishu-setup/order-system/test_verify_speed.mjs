/**
 * 模拟 10 个患者验真：直接写入 Bitable（已下单→确认→发货→验真）
 * 用法: node test_verify_speed.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 加载环境变量
const envPath = resolve(__dirname, "../shared/.env");
const envText = readFileSync(envPath, "utf-8");
const ENV = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) ENV[m[1].trim()] = m[2].trim();
}

const APP_TOKEN = ENV.FEISHU_APP_TOKEN || "B3xQbbqicaome1sKdZbcwdk8nWg";
const FEISHU_APP_ID = ENV.FEISHU_APP_ID;
const FEISHU_APP_SECRET = ENV.FEISHU_APP_SECRET;

// 表 ID — 从 shared/tables.js 读取
const tablesPath = resolve(__dirname, "../shared/tables.js");
const tablesText = readFileSync(tablesPath, "utf-8");
const TABLES = {};
for (const m of tablesText.matchAll(/(\w+):\s*"(tbl\w+)"/g)) {
  TABLES[m[1]] = m[2];
}

const SURNAMES = ["张","李","王","刘","陈","杨","赵","黄","周","吴"];
const SKU = "Ultra双效";
const BASE_URL = "https://lab.gaushclear.com";
const ADMIN_TOKEN = "GaushOrderMock";
const AGENT_TOKEN = "AG-002-zxkmgoryb6nprmv6";

let _appToken = "";

async function getFeishuToken() {
  if (_appToken && Date.now() - _appToken._ts < 3600_000) return _appToken.token;
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  _appToken = { token: data.app_access_token, _ts: Date.now() };
  return _appToken.token;
}

async function feishuApi(method, path, body) {
  const token = await getFeishuToken();
  const opts = {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://open.feishu.cn/open-apis${path}`, opts);
  return res.json();
}

async function batchCreate(tableId, records) {
  const result = await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`, { records });
  return result.data?.records || result.data?.items || [];
}

async function batchUpdate(tableId, records) {
  const result = await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`, { records });
  return result.data?.records || result.data?.items || [];
}

async function listRecords(tableId, filter, pageSize = 500) {
  const items = [];
  let pageToken = "";
  while (true) {
    let qs = `?page_size=${pageSize}`;
    if (pageToken) qs += `&page_token=${pageToken}`;
    if (filter) qs += `&filter=${encodeURIComponent(filter)}`;
    const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    if (!data?.data) break;
    items.push(...(data.data.items || []));
    if (!data.data.has_more) break;
    pageToken = data.data.page_token;
  }
  return items;
}

function genLensCode() {
  return randomBytes(8).toString("hex").toUpperCase();
}

function genOrderNo() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  const rand = randomBytes(4).toString("hex").toUpperCase().slice(0,6);
  return `ORD-${date}-${rand}`;
}

async function main() {
  const orderNo = genOrderNo();
  console.log(`=== 创建测试订单: ${orderNo} ===\n`);

  // 1. 创建订单主表记录 + 镜片明细
  const orderRecords = [];
  const lensRecords = [];
  const lensCodes = [];

  for (let i = 0; i < 10; i++) {
    const name = `${SURNAMES[i]}验真测试${i+1}`;
    orderRecords.push({
      fields: {
        "订单编号": orderNo,
        "产品型号": SKU,
        "数量": 2,
        "订单状态": "已下单",
        "下单日期": Date.now(),
        "顾客姓名": name,
        "序号": i + 1,
        "代理商名称": "测试代理商",
        "代理商ID": "AG-002",
        "收货地址": "测试地址",
        "订单来源": "验真速度测试",
        "是否装配": "是",
      },
    });

    for (const side of ["右眼", "左眼"]) {
      const code = genLensCode();
      lensCodes.push(code);
      lensRecords.push({
        fields: {
          "订单编号": orderNo,
          "眼别": side,
          "球镜SPH": -(2 + i * 0.25),
          "柱镜CYL": -(0.5 + i * 0.25),
          "轴位AXIS": 90 + i,
          "是否装配": "是",
          "产品型号": SKU,
          "顾客姓名": name,
          "序号": i + 1,
          "代理商名称": "测试代理商",
          "订单状态": "已下单",
          "镜片码（唯一）": code,
        },
      });
    }
  }

  // 写入 Bitable
  console.log("写入订单主表...");
  const orderRes = await batchCreate(TABLES.order, orderRecords);
  console.log(`  写入 ${orderRes.length} 条`);

  console.log("写入镜片明细表...");
  const lensRes = await batchCreate(TABLES.lens_detail, lensRecords);
  console.log(`  写入 ${lensRes.length} 条，镜片码: ${lensCodes.length} 个`);

  // 等待 Bitable 索引
  await new Promise(r => setTimeout(r, 3000));

  // 2. 确认赋码（调 /api/admin/confirm）
  console.log("\n=== 确认赋码 ===");
  const confirmRes = await fetch(`${BASE_URL}/api/admin/confirm?admin=${ADMIN_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNos: [orderNo], stockStatus: "有库存" }),
  });
  const confirmData = await confirmRes.json();
  console.log("确认结果:", confirmData.results?.map(r => ({ ok: r.ok, status: r.targetStatus, codes: r.lensCodes?.length || 0 })));

  await new Promise(r => setTimeout(r, 2000));

  // 3. 验真速度测试（赋码后即可验真，不需要发货）
  console.log("\n=== 消费者扫码验真 ===");
  const times = [];
  for (const code of lensCodes) {
    const t0 = performance.now();
    const html = await fetch(`${BASE_URL}/verify/${code}`).then(r => r.text());
    const elapsed = performance.now() - t0;
    const found = html.includes("hero-ok");
    times.push({ code, elapsed: elapsed.toFixed(0), found });
  }

  console.log("\n=== 验真结果 ===");
  for (const t of times) {
    console.log(`${t.code}: ${t.found ? "✓" : "✗"} ${t.elapsed}ms`);
  }

  const avg = times.reduce((s, t) => s + Number(t.elapsed), 0) / times.length;
  const max = Math.max(...times.map(t => Number(t.elapsed)));
  console.log(`\n平均: ${avg.toFixed(0)}ms | 最慢: ${max.toFixed(0)}ms | 共 ${times.length} 条`);

  // 4. 清理：退回并删除测试数据
  console.log(`\n=== 清理测试数据: ${orderNo} ===`);

  // 退回订单
  const revertRes = await fetch(`${BASE_URL}/api/admin/revert?admin=${ADMIN_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNos: [orderNo] }),
  });
  const revertData = await revertRes.json();
  console.log("退回:", revertData.results?.map(r => ({ ok: r.ok })));

  await new Promise(r => setTimeout(r, 1000));

  // 删除 Bitable 记录
  const orderItems = await listRecords(TABLES.order, `CurrentValue.[订单编号]="${orderNo}"`);
  if (orderItems.length) {
    const ids = orderItems.map(r => ({ record_id: r.record_id }));
    await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records/batch_delete`, { records: ids });
    console.log(`删除订单: ${ids.length} 条`);
  }

  const lensItems = await listRecords(TABLES.lens_detail, `CurrentValue.[订单编号]="${orderNo}"`);
  if (lensItems.length) {
    const ids = lensItems.map(r => ({ record_id: r.record_id }));
    await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records/batch_delete`, { records: ids });
    console.log(`删除镜片: ${ids.length} 条`);
  }

  console.log("\n测试完成！");
}

main().catch(e => console.error(e));
