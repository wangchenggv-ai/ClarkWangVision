// 飞书订单 Agent 核心：事件处理 + 命令路由 + 卡片模板

import { sendCard, sendText, replyCard, downloadFile } from "./feishu.js";
import * as api from "./api.js";
import * as XLSX from "xlsx";

// 暂存 Excel 解析结果（key → records），避免 button value 过大
const _pendingImports = new Map();

// ─── 事件入口 ────────────────────────────────────────────────────────────────

export async function handleEvent(payload) {
  // 飞书 URL 验证握手
  if (payload.challenge) return { challenge: payload.challenge };

  const type = payload.header?.event_type;
  const event = payload.event || {};

  if (type === "im.message.receive_v1") {
    handleMessage(event).catch(e => console.error("handleMessage error:", e.message));
  } else if (type === "card.action.trigger") {
    handleCardAction(event).catch(e => console.error("handleCardAction error:", e.message));
  } else if (!type && payload.open_chat_id) {
    handleCardAction(payload).catch(e => console.error("handleCardAction error:", e.message));
  }

  return {};  // 飞书要求立即 200 响应
}

// ─── 消息处理 ────────────────────────────────────────────────────────────────

async function handleMessage(event) {
  const msg = event.message;
  const chatId = msg.chat_id;
  const messageId = msg.message_id;
  const msgType = msg.message_type;

  if (msgType === "text") {
    const raw = JSON.parse(msg.content).text || "";
    // 去掉 @机器人 mention
    const text = raw.replace(/@\S+\s*/g, "").trim();
    if (!text) return;
    await routeText(text, chatId, messageId);
  } else if (msgType === "file") {
    const content = JSON.parse(msg.content);
    const fileName = content.file_name || "";
    if (fileName.match(/\.(xlsx|xls)$/i)) {
      await handleExcel(messageId, content.file_key, chatId);
    } else {
      await sendText(chatId, "⚠️ 只支持 .xlsx / .xls 格式的订单文件");
    }
  }
}

// ─── 文本命令路由 ─────────────────────────────────────────────────────────────

async function routeText(text, chatId, messageId) {
  // /确认 ORD-xxx [ORD-xxx ...]
  const confirmM = text.match(/^[\/]?确认\s+(ORD[\w-]+(?:[\s,]+ORD[\w-]+)*)/i);
  if (confirmM) {
    const nos = confirmM[1].trim().split(/[\s,]+/).filter(s => s.startsWith("ORD"));
    return cmdConfirm(nos, chatId);
  }

  // /发货 ORD-xxx [快递单号] [快递公司]
  const shipM = text.match(/^[\/]?发货\s+(ORD[\w-]+)(?:\s+(\S+))?(?:\s+(\S+))?/i);
  if (shipM) return cmdShip(shipM[1], shipM[2], shipM[3], chatId);

  // /签收 ORD-xxx
  const deliverM = text.match(/^[\/]?签收\s+(ORD[\w-]+)/i);
  if (deliverM) return cmdDeliver(deliverM[1], chatId);

  // /退回 ORD-xxx
  const revertM = text.match(/^[\/]?退回\s+(ORD[\w-]+)/i);
  if (revertM) return cmdRevert(revertM[1], chatId);

  // 直接发订单号 → 查询
  const orderM = text.match(/^(ORD[\w-]+)/i);
  if (orderM) return cmdQuery(orderM[1], chatId);

  // /待处理 /生产中 /打标签 /已发货
  const statusM = text.match(/^[\/]?(待处理|生产中|打标签|已发货|已下单|已签收)/);
  if (statusM) return cmdList(statusM[1], chatId);

  // /今日
  if (/^[\/]?今日/.test(text)) return cmdList("待处理", chatId);

  // /看板 /仪表盘
  if (/^[\/]?(看板|仪表盘|dashboard)/i.test(text)) return cmdDashboard(chatId);

  // /帮助
  if (/^[\/]?帮助/.test(text) || text === "?" || text === "？") return cmdHelp(chatId);

  await sendText(chatId, `❓ 不认识「${text.slice(0, 20)}」，发 /帮助 查看可用命令`);
}

// ─── 卡片回调处理（按钮点击）────────────────────────────────────────────────

async function handleCardAction(event) {
  const action = event.action || {};
  const targetChat = event.context?.open_chat_id || event.open_chat_id;
  if (!targetChat) return;

  let value = action.value;
  // 飞书会对 button value 双重 JSON 编码，parse 两次
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return; } }
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return; } }
  if (!value || typeof value !== "object") return;

  if (value.action === "confirm_import" && value.key) {
    const records = _pendingImports.get(value.key);
    if (!records) return sendText(targetChat, "❌ 预览已过期，请重新上传 Excel");
    _pendingImports.delete(value.key);
    await doImport(records, targetChat);
  } else if (value.action === "confirm_order" && value.orderNos) {
    await cmdConfirm(value.orderNos, targetChat);
  }
}

// ─── 命令实现 ─────────────────────────────────────────────────────────────────

async function cmdQuery(orderNo, chatId) {
  await sendText(chatId, `🔍 查询中 ${orderNo}...`);
  const res = await api.getOrder(orderNo);
  const rows = res.orders || [];
  if (!rows.length) return sendText(chatId, `❌ 找不到订单 ${orderNo}`);

  const r = rows[0];
  const status = r.status || "-";
  const sku = r.sku || "-";
  const store = r.storeName || r.customerName || "-";
  const bin = r.binCode || "-";
  const tracking = r.trackingNo || "-";

  await sendCard(chatId, {
    header: { title: { tag: "plain_text", content: `📋 ${orderNo}` }, template: statusColor(status) },
    elements: [
      mdField("状态", status),
      mdField("客户", store),
      mdField("产品", sku),
      mdField("仓位", bin),
      mdField("快递单号", tracking),
      mdField("处方行数", `${rows.length} 条`),
      {
        tag: "action",
        actions: [{
          tag: "button", type: "default",
          text: { tag: "plain_text", content: "确认此订单" },
          value: JSON.stringify({ action: "confirm_order", orderNos: [orderNo] }),
        }],
      },
    ],
  });
}

async function cmdList(status, chatId) {
  await sendText(chatId, `🔍 查询「${status}」订单...`);
  const res = await api.listOrders(status, 15);
  const rows = res.orders || [];

  // 按订单号去重
  const seen = new Set();
  const orders = [];
  for (const r of rows) {
    const no = r.orderNo;
    if (no && !seen.has(no)) { seen.add(no); orders.push(r); }
  }

  if (!orders.length) return sendText(chatId, `📭 没有「${status}」的订单`);

  const lines = orders.slice(0, 12).map(r => {
    const label = r.customerName || r.agentName || "-";
    return `• **${r.orderNo}** ${label} ${r.sku || ""}`;
  });
  const extra = orders.length > 12 ? `\n_...共 ${orders.length} 张，只显示前12_` : "";

  const elements = [{ tag: "markdown", content: lines.join("\n") + extra }];
  if (status === "已下单" || status === "待处理") {
    elements.push({
      tag: "action",
      actions: [{
        tag: "button", type: "primary",
        text: { tag: "plain_text", content: `全部确认（${orders.length}张）` },
        value: JSON.stringify({ action: "confirm_order", orderNos: orders.map(r => r.orderNo) }),
        confirm: { title: { tag: "plain_text", content: "确认操作" }, text: { tag: "plain_text", content: `将确认 ${orders.length} 张订单并生成镜片码` } },
      }],
    });
  }
  await sendCard(chatId, {
    header: { title: { tag: "plain_text", content: `${status} (${orders.length})` }, template: "blue" },
    elements,
  });
}

async function cmdConfirm(orderNos, chatId) {
  await sendText(chatId, `⏳ 确认 ${orderNos.length} 张订单，生成镜片码中...`);
  const res = await api.confirmOrders(orderNos);
  if (res.error) return sendText(chatId, `❌ 确认失败：${res.error}`);
  // API 返回 { results: [{orderNo, ok, async, targetStatus}] }
  const results = res.results || [];
  const succeeded = results.filter(r => r.ok).map(r => `• ${r.orderNo} → ${r.targetStatus || "处理中"}`);
  const failed = results.filter(r => !r.ok).map(r => `• ${r.orderNo} ❌ ${r.error || ""}`);

  await sendCard(chatId, {
    header: { title: { tag: "plain_text", content: succeeded.length ? `✅ 确认完成` : `❌ 确认失败` }, template: succeeded.length ? "green" : "red" },
    elements: [
      { tag: "markdown", content: [
        succeeded.length ? `成功 **${succeeded.length}** 张：\n${succeeded.join("\n")}` : "",
        failed.length ? `失败 **${failed.length}** 张：\n${failed.join("\n")}` : "",
      ].filter(Boolean).join("\n\n") },
      { tag: "note", elements: [{ tag: "plain_text", content: "异步处理中（约3秒），镜片码将写入 Bitable" }] },
    ],
  });
}

async function cmdShip(orderNo, trackingNo, courier, chatId) {
  await sendText(chatId, `📦 发货处理中 ${orderNo}...`);
  const res = await api.shipOrder(orderNo, courier, trackingNo);
  if (res.error || res.code) {
    return sendText(chatId, `❌ 发货失败：${res.error || res.msg || JSON.stringify(res)}`);
  }
  await sendCard(chatId, {
    header: { title: { tag: "plain_text", content: "🚚 已发货" }, template: "blue" },
    elements: [
      mdField("订单号", orderNo),
      mdField("快递单号", trackingNo || "（自动生成）"),
      mdField("快递公司", courier || "（自动选择）"),
      { tag: "note", elements: [{ tag: "plain_text", content: "代理商群已收到发货通知" }] },
    ],
  });
}

async function cmdDeliver(orderNo, chatId) {
  const res = await api.deliverOrder(orderNo);
  if (res.error || res.code) {
    return sendText(chatId, `❌ 签收失败：${res.error || res.msg}`);
  }
  await sendCard(chatId, {
    header: { title: { tag: "plain_text", content: "✅ 已签收" }, template: "green" },
    elements: [mdField("订单号", orderNo), { tag: "note", elements: [{ tag: "plain_text", content: "订单已进入终态，不可再操作" }] }],
  });
}

async function cmdRevert(orderNo, chatId) {
  const res = await api.revertOrder(orderNo);
  if (res.error || res.code) {
    return sendText(chatId, `❌ 退回失败：${res.error || res.msg}`);
  }
  await sendText(chatId, `↩️ ${orderNo} 已退回上一步`);
}

async function cmdDashboard(chatId) {
  const res = await api.getDashboard();
  const d = res.data || res;
  await sendCard(chatId, {
    header: { title: { tag: "plain_text", content: "📊 系统看板" }, template: "purple" },
    elements: [{
      tag: "markdown",
      content: [
        `**待处理：** ${d.pending || 0}`,
        `**生产中：** ${d.producing || 0}`,
        `**打标签：** ${d.labeled || 0}`,
        `**已发货：** ${d.shipped || 0}`,
        `**本周交付：** ${d.deliveredThisWeek || 0}`,
      ].join("　　"),
    }],
  });
}

async function cmdHelp(chatId) {
  await sendCard(chatId, {
    header: { title: { tag: "plain_text", content: "🤖 订单助理 — 可用命令" }, template: "turquoise" },
    elements: [{
      tag: "markdown",
      content: [
        "**📎 上传Excel**　→　发起接单，预览后确认写入系统",
        "",
        "**查询**　　　`ORD-20260519-XXXXXX`",
        "**确认**　　　`/确认 ORD-xxx [ORD-xxx ...]`",
        "**发货**　　　`/发货 ORD-xxx [快递单号] [快递公司]`",
        "**签收**　　　`/签收 ORD-xxx`",
        "**退回**　　　`/退回 ORD-xxx`",
        "",
        "**列表**　　　`/待处理` `/生产中` `/打标签` `/已发货`",
        "**看板**　　　`/看板`",
        "**帮助**　　　`/帮助`",
      ].join("\n"),
    }],
  });
}

// ─── Excel 接单 ───────────────────────────────────────────────────────────────

const COLUMN_ALIASES = {
  "顾客姓名": ["顾客姓名","姓名","患者姓名","客户姓名","配镜人","name"],
  "眼别":     ["眼别","眼","左右眼","OD/OS","eye"],
  "球镜SPH":  ["球镜SPH","球镜","SPH","S","sph","近视","度数"],
  "柱镜CYL":  ["柱镜CYL","柱镜","CYL","C","cyl","散光"],
  "轴位AXIS": ["轴位AXIS","轴位","AXIS","A","axis","轴"],
  "产品型号": ["产品型号","型号","SKU","sku","产品","品名"],
  "终端门店": ["终端门店","门店","终端客户","终端","store"],
  "收货地址": ["收货地址","地址","送货地址","address"],
  "联系人":   ["联系人","收件人","contact"],
  "联系电话": ["联系电话","电话","手机","联系方式","phone"],
};

function parseExcel(buf) {
  const wb = XLSX.read(new Uint8Array(buf));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (allRows.length < 2) return { records: [], warnings: ["Excel 内容为空"] };

  // 找表头行（前10行中找含"顾客姓名"/"眼别"的行）
  let headerIdx = 0;
  for (let i = 0; i < Math.min(allRows.length, 10); i++) {
    if (allRows[i].some(c => {
      const s = String(c || "");
      return s.includes("顾客姓名") || s.includes("客户姓名") || s === "姓名" || s.includes("眼别");
    })) { headerIdx = i; break; }
  }

  const headers = allRows[headerIdx].map(c => String(c || "").trim());

  // 列名精确匹配 → 列索引
  const canonIndex = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      if (aliases.some(a => a.toLowerCase() === h)) {
        if (!(canonical in canonIndex)) canonIndex[canonical] = i;
      }
    }
  }
  // 部分匹配兜底
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (canonical in canonIndex) continue;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      if (aliases.some(a => h.includes(a.toLowerCase()))) {
        canonIndex[canonical] = i; break;
      }
    }
  }

  const getCell = (row, canonical) => {
    const idx = canonIndex[canonical];
    if (idx === undefined) return "";
    const v = row[idx];
    return (v !== "" && v !== null && v !== undefined) ? String(v).trim() : "";
  };

  const records = [], warnings = [];
  let lastCustomerName = "";

  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i];
    if (row.every(c => c === "" || c === null || c === undefined)) continue;

    const rawName = getCell(row, "顾客姓名");
    const customerName = rawName || lastCustomerName;
    if (rawName) lastCustomerName = rawName;

    if (!customerName) { warnings.push(`第${i+1}行：无顾客姓名`); continue; }
    if (/^(备注|合计|客户名称|下单日期|收货地址|联系人|电话)/.test(customerName)) continue;

    const eye = getCell(row, "眼别");
    if (!eye) { warnings.push(`第${i+1}行（${customerName}）：无眼别`); continue; }

    records.push({
      customer:  customerName,
      eye,
      sph:     getCell(row, "球镜SPH"),
      cyl:     getCell(row, "柱镜CYL"),
      axis:    getCell(row, "轴位AXIS"),
      sku:     getCell(row, "产品型号"),
      store:   getCell(row, "终端门店"),
      addr:    getCell(row, "收货地址"),
      contact: getCell(row, "联系人"),
      phone:   getCell(row, "联系电话"),
    });
  }

  return { records, warnings };
}

async function handleExcel(messageId, fileKey, chatId) {
  await sendText(chatId, "📊 解析Excel中...");
  let buf;
  try {
    buf = await downloadFile(messageId, fileKey);
  } catch (e) {
    return sendText(chatId, `❌ 文件下载失败：${e.message}`);
  }

  let records, warnings;
  try {
    ({ records, warnings } = parseExcel(buf));
  } catch (e) {
    return sendText(chatId, `❌ Excel解析失败：${e.message}`);
  }

  if (!records.length) {
    const hint = warnings.length ? warnings.slice(0, 5).join("\n") : "空文件或格式不对";
    return sendText(chatId, `❌ 没有可用行\n${hint}`);
  }

  const errors = warnings;

  if (!records.length) {
    return sendText(chatId, `❌ 没有可用行\n${errors.slice(0, 5).join("\n")}`);
  }

  // 按门店分组预览
  const stores = {};
  for (const rec of records) {
    const k = rec.store || rec.customer || "未知门店";
    if (!stores[k]) stores[k] = [];
    stores[k].push(rec);
  }

  const previewLines = Object.entries(stores).map(([store, recs]) => {
    const names = [...new Set(recs.map(r => r.customer))].join("、");
    return `• **${store}** — ${names}（${recs.length}条）`;
  });
  const warnLine = errors.length ? `\n⚠️ ${errors.length} 行跳过（列名不匹配）` : "";

  // 暂存解析结果，button 只传 key
  const importKey = `imp_${Date.now()}`;
  _pendingImports.set(importKey, records);
  setTimeout(() => _pendingImports.delete(importKey), 10 * 60 * 1000); // 10分钟过期

  await sendCard(chatId, {
    header: { title: { tag: "plain_text", content: `📋 接单预览 — ${records.length} 条处方` }, template: "orange" },
    elements: [
      { tag: "markdown", content: previewLines.join("\n") + warnLine },
      {
        tag: "action",
        actions: [
          {
            tag: "button", type: "primary",
            text: { tag: "plain_text", content: `✅ 确认下单（${records.length}条）` },
            value: JSON.stringify({ action: "confirm_import", key: importKey }),
            confirm: { title: { tag: "plain_text", content: "确认写入" }, text: { tag: "plain_text", content: `将创建 ${records.length} 条处方记录，状态：已下单` } },
          },
          {
            tag: "button", type: "danger",
            text: { tag: "plain_text", content: "❌ 取消" },
            value: JSON.stringify({ action: "cancel" }),
          },
        ],
      },
    ],
  });
}

async function doImport(records, chatId) {
  await sendText(chatId, `⏳ 写入 ${records.length} 条处方到系统...`);

  // flat records → orders[{agentName, patients[{customerName, eyes[]}]}]
  const storeMap = {};
  for (const r of records) {
    const storeKey = r.store || "未知门店";
    if (!storeMap[storeKey]) {
      storeMap[storeKey] = {
        agentId: "", agentName: storeKey,
        contact: r.contact || "", phone: r.phone || "", address: r.addr || "",
        patientsMap: {},
      };
    }
    const s = storeMap[storeKey];
    if (!s.patientsMap[r.customer]) {
      s.patientsMap[r.customer] = { customerName: r.customer, sku: r.sku || "", quantity: 1, pairIndex: 1, eyes: [] };
    }
    s.patientsMap[r.customer].eyes.push({ side: r.eye, sph: r.sph, cyl: r.cyl, axis: r.axis });
  }

  const orders = Object.values(storeMap).map(s => ({
    agentId: s.agentId, agentName: s.agentName,
    contact: s.contact, phone: s.phone, address: s.address,
    patients: Object.values(s.patientsMap),
  }));

  const res = await api.mergeBatch(orders);
  if (res.error || !res.success) {
    return sendText(chatId, `❌ 写入失败：${res.error || res.msg || JSON.stringify(res)}`);
  }

  const orderCount = res.orderCount || orders.reduce((n, o) => n + o.patients.length, 0);
  await sendCard(chatId, {
    header: { title: { tag: "plain_text", content: "✅ 下单成功" }, template: "green" },
    elements: [
      { tag: "markdown", content: `已创建 **${orderCount}** 张订单，共 **${res.lensCount || records.length}** 条处方` },
      { tag: "note", elements: [{ tag: "plain_text", content: "状态：已下单。发 /已下单 查看，或 /确认 ORD-xxx 生成镜片码" }] },
    ],
  });
}


// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function rawVal(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(i => i.text || i.name || i.display_name || i).join(", ");
  if (typeof v === "object") return v.text || v.name || v.display_name || "";
  return String(v);
}

function statusColor(status) {
  const map = { "已下单": "blue", "待处理": "orange", "生产中": "yellow",
    "打标签": "purple", "已发货": "blue", "已签收": "green" };
  return map[status] || "grey";
}

function mdField(label, value) {
  return { tag: "markdown", content: `**${label}：** ${value}` };
}
