import { randomBytes } from "crypto";

export function genOrderNo() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = randomBytes(4).toString("hex").toUpperCase();
  return `ORD-${d}-${r}`;
}

export function buildMergeOrderRecords(patients, agentInfo, orderNo) {
  const now = Date.now();
  const records = [];

  for (const p of patients) {
    const lensCount = p.eyes.length;
    const fields = {
      "订单编号": orderNo,
      "产品型号": p.sku,
      "数量": (p.quantity || 1) * lensCount,
      "订单状态": "已下单",
      "下单日期": now,
      "顾客姓名": p.customerName.trim(),
      "序号": p.pairIndex || 1,
      "代理商名称": agentInfo.name,
      "代理商ID": agentInfo.id,
      "订单来源": "助理导入",
      "是否装配": "否",
    };
    if (agentInfo.customerId) fields["客户ID"] = agentInfo.customerId;
    if (agentInfo.terminalCustomer) fields["终端客户"] = agentInfo.terminalCustomer;
    if (agentInfo.contact) fields["联系人"] = agentInfo.contact;
    if (agentInfo.phone) fields["联系电话"] = agentInfo.phone;
    if (agentInfo.address) fields["收货地址"] = agentInfo.address;
    if (p.remark) fields["备注"] = p.remark;

    records.push({ fields });
  }

  return records;
}

export function buildMergeLensRecords(patients, agentInfo, orderNo) {
  const records = [];

  for (const p of patients) {
    for (const eye of p.eyes) {
      records.push({
        fields: {
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
          "订单状态": "已下单",
        },
      });
    }
  }

  return records;
}
