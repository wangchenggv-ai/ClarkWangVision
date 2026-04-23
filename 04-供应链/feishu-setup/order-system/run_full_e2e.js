/**
 * run_full_e2e.js — 全流程 E2E 测试
 * 10个订单（5代理商×2单）从下单到消费者签收
 *
 * 流程：下单 → 确认（生成镜片码）→ 合单发货 → 合单通行单 → 消费者签收 → 飞书通知
 *
 * Usage: node run_full_e2e.js
 */

import { execFileSync, spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync } from "fs";
import { createConnection } from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:3210";
const step = (n, msg) => console.log(`\n${"─".repeat(56)}\n步骤 ${n} — ${msg}\n${"─".repeat(56)}`);
const ok   = (msg) => console.log(`  ✅ ${msg}`);
const info = (msg) => console.log(`  ℹ  ${msg}`);
const err  = (msg) => console.error(`  ✗  ${msg}`);

// ─── 测试数据：5代理商 × 2订单 ───────────────────────────────────────────

const AGENTS = [
  { id: "AG-003", name: "北京明视眼镜", token: "AG-003-z3t0557ucthgfxep" },
  { id: "AG-004", name: "上海优视光学", token: "AG-004-5otjdnmwxt34i7ws" },
  { id: "AG-005", name: "广州明亮眼镜", token: "AG-005-4ypvi42cap18qm6y" },
  { id: "AG-006", name: "成都清晰视界", token: "AG-006-u4b05l624nz9t5qt" },
  { id: "AG-002", name: "测试代理商",   token: "AG-002-zxkmgoryb6nprmv6" },
];

const ORDERS = [
  // AG-003 北京明视
  { agentIdx: 0, customer: "张伟国", sku: "Ultra -1.25", address: "北京市朝阳区建国路88号",
    eyes: [{side:"右眼",sph:-1.25,cyl:-0.75,axis:180,pd:32,ph:22},{side:"左眼",sph:-1.50,cyl:-0.50,axis:170,pd:32,ph:22}] },
  { agentIdx: 0, customer: "李晓燕", sku: "Ultra -2.00", address: "北京市海淀区中关村大街1号",
    eyes: [{side:"右眼",sph:-2.00,cyl:0,axis:0,pd:31,ph:21},{side:"左眼",sph:-2.25,cyl:-0.25,axis:90,pd:31,ph:21}] },
  // AG-004 上海优视
  { agentIdx: 1, customer: "王芳芳", sku: "Ultra -0.75", address: "上海市浦东新区陆家嘴环路1000号",
    eyes: [{side:"右眼",sph:-0.75,cyl:0,axis:0,pd:30,ph:20},{side:"左眼",sph:-0.75,cyl:-0.25,axis:165,pd:30,ph:20}] },
  { agentIdx: 1, customer: "赵明亮", sku: "Ultra -3.00", address: "上海市静安区南京西路1788号",
    eyes: [{side:"右眼",sph:-3.00,cyl:-1.00,axis:15,pd:33,ph:23},{side:"左眼",sph:-2.75,cyl:-0.75,axis:175,pd:33,ph:23}] },
  // AG-005 广州明亮
  { agentIdx: 2, customer: "陈秀华", sku: "Ultra -1.50", address: "广州市天河区天河路385号",
    eyes: [{side:"右眼",sph:-1.50,cyl:-0.50,axis:5,pd:31,ph:21},{side:"左眼",sph:-1.75,cyl:-0.25,axis:10,pd:31,ph:21}] },
  { agentIdx: 2, customer: "刘建军", sku: "Ultra -1.00", address: "广州市越秀区中山路99号",
    eyes: [{side:"右眼",sph:-1.00,cyl:0,axis:0,pd:34,ph:24},{side:"左眼",sph:-1.25,cyl:-0.50,axis:80,pd:34,ph:24}] },
  // AG-006 成都清晰
  { agentIdx: 3, customer: "孙丽华", sku: "Ultra -2.50", address: "成都市锦江区春熙路138号",
    eyes: [{side:"右眼",sph:-2.50,cyl:-0.75,axis:180,pd:30,ph:20},{side:"左眼",sph:-2.25,cyl:-0.50,axis:175,pd:30,ph:20}] },
  { agentIdx: 3, customer: "周文杰", sku: "Ultra -1.75", address: "成都市武侯区天府大道500号",
    eyes: [{side:"右眼",sph:-1.75,cyl:-1.00,axis:90,pd:32,ph:22},{side:"左眼",sph:-2.00,cyl:-0.75,axis:85,pd:32,ph:22}] },
  // AG-002 测试代理商
  { agentIdx: 4, customer: "吴思远", sku: "Ultra -0.50", address: "深圳市南山区科技园B座101",
    eyes: [{side:"右眼",sph:-0.50,cyl:0,axis:0,pd:31,ph:21},{side:"左眼",sph:-0.50,cyl:-0.25,axis:120,pd:31,ph:21}] },
  { agentIdx: 4, customer: "郑雨婷", sku: "Ultra -1.25", address: "深圳市福田区华强北路99号",
    eyes: [{side:"右眼",sph:-1.25,cyl:-0.50,axis:45,pd:29,ph:19},{side:"左眼",sph:-1.50,cyl:-0.25,axis:50,pd:29,ph:19}] },
];

// ─── 等待服务器就绪 ───────────────────────────────────────────────────────

function checkPort(port, host = "127.0.0.1", timeoutMs = 1000) {
  return new Promise((resolve) => {
    const s = createConnection({ port, host });
    s.setTimeout(timeoutMs);
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error",   () => { s.destroy(); resolve(false); });
    s.on("timeout", () => { s.destroy(); resolve(false); });
  });
}

async function waitForServer(maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await checkPort(3210)) return true;
    await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

// ─── API 调用 ─────────────────────────────────────────────────────────────

async function post(path, body, token) {
  const url = token ? `${BASE}${path}${path.includes("?") ? "&" : "?"}t=${token}` : `${BASE}${path}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function submitOrder(agent, order) {
  return post("/api/submit", {
    agentId: agent.id,
    address: order.address,
    patients: [{
      customerName: order.customer,
      sku: order.sku,
      quantity: 1,
      eyes: order.eyes.map(e => ({
        side: e.side, sph: e.sph, cyl: e.cyl, axis: e.axis,
        pd: e.pd, ph: e.ph, frame: "标准镜框",
      })),
    }],
  }, agent.token);
}

async function confirmOrder(orderNo, token) {
  return post(`/api/order/${orderNo}/confirm?t=${token}`, {}, null);
}

// ─── 运行子命令 ───────────────────────────────────────────────────────────

function runCmd(args) {
  execFileSync(process.execPath, ["logistics.js", ...args], {
    cwd: __dirname, stdio: "inherit",
  });
}

// ─── 主流程 ───────────────────────────────────────────────────────────────

(async () => {
  const startTime = Date.now();
  const orderNos = [];

  // ── 步骤 0：启动服务器 ────────────────────────────────────────────────
  step(0, "检查 / 启动代理商门户服务器（端口 3210）");

  let serverProc = null;
  const alive = await waitForServer(2000);
  if (alive) {
    ok("服务器已在运行");
  } else {
    info("启动 agent-portal/server.js...");
    serverProc = spawn(process.execPath, ["agent-portal/server.js"], {
      cwd: __dirname, stdio: ["ignore", "pipe", "pipe"], detached: false,
    });
    serverProc.stdout.on("data", d => {
      const s = d.toString().trim();
      if (s) info(`[server] ${s}`);
    });
    const ready = await waitForServer(10000);
    if (!ready) { err("服务器启动失败"); process.exit(1); }
    ok("服务器已就绪");
  }

  // ── 步骤 1：提交 10 个订单 ────────────────────────────────────────────
  step(1, "提交 10 个订单（5代理商 × 2单）");

  for (const order of ORDERS) {
    const agent = AGENTS[order.agentIdx];
    const res = await submitOrder(agent, order);
    if (res.success) {
      ok(`${res.orderNo}  ${agent.name}  ${order.customer}  ${order.sku}`);
      orderNos.push({ orderNo: res.orderNo, agent });
    } else {
      err(`提交失败: ${order.customer} — ${JSON.stringify(res)}`);
    }
  }
  console.log(`\n  共提交 ${orderNos.length} 个订单`);

  // ── 步骤 2：确认订单（生成镜片码）────────────────────────────────────
  step(2, "工厂确认 → 生成镜片码");

  for (const { orderNo, agent } of orderNos) {
    const res = await confirmOrder(orderNo, agent.token);
    if (res.success) {
      const codes = res.lensCodes || [];
      ok(`${orderNo}  镜片码: ${codes.join(" | ")}`);
    } else {
      err(`确认失败: ${orderNo} — ${JSON.stringify(res)}`);
    }
  }

  // ── 步骤 3：合单发货 ──────────────────────────────────────────────────
  step(3, "合单发货（ship-batch）— 按代理商合并快递");

  runCmd(["ship-batch"]);

  // ── 步骤 4：生成合单随货同行单 ────────────────────────────────────────
  step(4, "生成合单随货同行单（slip-batch）");

  runCmd(["slip-batch"]);

  // ── 步骤 5：模拟消费者签收 ────────────────────────────────────────────
  step(5, "模拟消费者签收（deliver）→ 飞书通知");

  for (const { orderNo } of orderNos) {
    runCmd(["deliver", "--order", orderNo]);
  }

  // ── 步骤 6：查看最终状态 ──────────────────────────────────────────────
  step(6, "物流状态汇总");
  runCmd(["status"]);

  // ── 完成 ─────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(56)}`);
  console.log(`  全流程 E2E 完成  |  耗时 ${elapsed}s`);
  console.log(`  ${orderNos.length} 个订单  |  ${orderNos.length * 2} 片镜片  |  5 个包裹`);
  console.log(`  随货同行单: docs/slip-batch-*.html`);
  console.log(`  飞书私信: 发货通知 × 5 + 签收通知 × ${orderNos.length}`);
  console.log(`${"═".repeat(56)}\n`);

  if (serverProc) {
    info("关闭测试服务器...");
    serverProc.kill();
  }
})().catch(e => { console.error("✗ 错误:", e.message); process.exit(1); });
