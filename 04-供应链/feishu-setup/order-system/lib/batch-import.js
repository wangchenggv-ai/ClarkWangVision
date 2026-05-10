import { createHash, randomBytes } from "crypto";

const AGENT_RE = /AG\d{3}/i;

export function extractAgentId(filename) {
  const match = filename.match(AGENT_RE);
  return match ? match[0].toUpperCase() : "";
}

export function genOrderNo() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = randomBytes(4).toString("hex").toUpperCase();
  return `ORD-${d}-${r}`;
}

export function genLensCode() {
  return randomBytes(8).toString("hex").toUpperCase();
}

export function contentHash(patients) {
  const h = createHash("md5");
  for (const p of patients) {
    h.update(p.customerName + "|" + p.sku + "|" + p.quantity + "|" + (p.pairIndex || 1));
    for (const e of p.eyes) {
      h.update("|" + e.side + e.sph + e.cyl + e.axis);
    }
  }
  return h.digest("hex").slice(0, 12);
}


export function buildOrderRecords(patients, agentInfo, orderNo) {
  const now = Date.now();
  const orderRecords = [];
  const lensRecords = [];

  for (const p of patients) {
    const lensCount = p.eyes.length;
    const orderFields = {
      "订单编号": orderNo,
      "产品型号": p.sku,
      "数量": (p.quantity || 1) * lensCount,
      "订单状态": "生产中",
      "下单日期": now,
      "顾客姓名": p.customerName.trim(),
      "序号": p.pairIndex || 1,
      "代理商名称": agentInfo.name,
      "代理商ID": agentInfo.id,
      "订单来源": "代理商门户",
      "是否装配": "否",
    };
    if (agentInfo.customerId) orderFields["客户ID"] = agentInfo.customerId;
    if (agentInfo.terminalCustomer) orderFields["终端客户"] = agentInfo.terminalCustomer;
    if (agentInfo.contact) orderFields["联系人"] = agentInfo.contact;
    if (agentInfo.phone) orderFields["联系电话"] = agentInfo.phone;
    if (agentInfo.address) orderFields["收货地址"] = agentInfo.address;
    if (p.remark) orderFields["备注"] = p.remark;

    orderRecords.push({ fields: orderFields });

    for (const eye of p.eyes) {
      const code = genLensCode();
      lensRecords.push({
        fields: {
          "镜片码（唯一）": code,
          "订单编号": orderNo,
          "眼别": eye.side,
          "球镜SPH": Number(eye.sph) || 0,
          "柱镜CYL": Number(eye.cyl) || 0,
          "轴位AXIS": Number(eye.axis) || 0,
          "是否装配": "否",
          "产品型号": p.sku,
          "顾客姓名": p.customerName.trim(),
          "序号": p.pairIndex || 1,
          "代理商名称": agentInfo.name,
          "代理商ID": agentInfo.id,
          "订单状态": "生产中",
        },
      });
    }
  }

  return { orderRecords, lensRecords };
}
