import { createHash, randomBytes } from "crypto";
import XLSX from "xlsx";

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

export function parseExcelFile(name, base64Data) {
  const buffer = Buffer.from(base64Data, "base64");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const allRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  if (allRows.length < 2) return { patients: [], warnings: ["空文件或无数据行"], file: name };

  let headerIdx = -1;
  for (let i = 0; i < allRows.length; i++) {
    if (allRows[i].some(c => { const s = String(c || ""); return s.includes("顾客姓名") || s.includes("客户姓名") || s === "姓名" || s.includes("眼别"); })) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const headers = allRows[headerIdx].map(c => String(c || "").trim());
  const findCol = (...names) => {
    for (const name of names) {
      let idx = headers.indexOf(name);
      if (idx >= 0) return idx;
      idx = headers.findIndex(h => h.startsWith(name) || h.includes(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const dataRows = allRows.slice(headerIdx + 1);
  const warnings = [];
  const patients = [];
  let lastCustomerName = "";
  let orderContact = "", orderPhone = "", orderAddress = "";

  for (const row of dataRows) {
    if (!row.some(c => c != null && String(c).trim() !== "")) continue;
    const get = (...names) => { const idx = findCol(...names); return idx >= 0 ? row[idx] : undefined; };

    const customerName = String(get("顾客姓名", "姓名", "客户姓名", "配镜人") || "").trim();
    const eye = String(get("眼别", "眼", "左右眼") || "").trim();
    const _sph = get("球镜", "SPH", "球镜SPH", "近视", "度数");
    const _cyl = get("柱镜", "CYL", "柱镜CYL", "散光");
    const _axis = get("轴位", "AXIS", "轴位AXIS", "轴");
    if (eye && (_sph == null || String(_sph).trim() === "") && (_cyl == null || String(_cyl).trim() === "") && (_axis == null || String(_axis).trim() === "")) continue;

    const productModel = String(get("产品型号", "型号", "产品", "SKU") || "").trim();
    const sph = get("球镜", "SPH", "球镜SPH", "近视", "度数");
    const cyl = get("柱镜", "CYL", "柱镜CYL", "散光");
    const axis = get("轴位", "AXIS", "轴位AXIS", "轴");
    const qty = get("数量（副）", "数量", "副数", "片数") || 1;
    const remark = String(get("备注", "说明", "特殊要求") || "").trim();
    const contact = String(get("联系人", "收货人") || "").trim();
    const phone = String(get("联系电话", "电话", "手机") || "").trim();
    const address = String(get("收货地址", "地址", "送货地址") || "").trim();

    const name = customerName || lastCustomerName;
    if (customerName) lastCustomerName = customerName;
    if (customerName && /^(备注|合计|客户名称|下单日期|收货地址|联系人|电话)/.test(customerName)) continue;

    if (!name) {
      if (remark && lastCustomerName) {
        const prev = patients.find(p => p.customerName === lastCustomerName);
        if (prev && !prev.remark.includes(remark)) prev.remark = prev.remark ? prev.remark + "；" + remark : remark;
      }
      continue;
    }

    if (!orderContact && contact) orderContact = contact;
    if (!orderPhone && phone) orderPhone = phone;
    if (!orderAddress && address) orderAddress = address;

    let patient = null;
    if (productModel) {
      for (let i = patients.length - 1; i >= 0; i--) {
        const p = patients[i];
        if (p.customerName !== name || p.sku !== productModel) continue;
        if (!eye) { patient = p; break; }
        const existingSides = p.eyes.map(e => e.side);
        if (!existingSides.includes(eye)) { patient = p; break; }
        break;
      }
    }
    if (!patient && !productModel) {
      for (let i = patients.length - 1; i >= 0; i--) {
        if (patients[i].customerName === name) { patient = patients[i]; break; }
      }
    }
    if (!patient) {
      const pairIndex = patients.filter(p => p.customerName === name).length + 1;
      patient = { customerName: name, sku: productModel, quantity: Number(qty) || 1, eyes: [], assembly: false, remark: "", pairIndex };
      patients.push(patient);
    }
    if (productModel) patient.sku = productModel;
    if (remark && !patient.remark.includes(remark)) {
      patient.remark = patient.remark ? patient.remark + "；" + remark : remark;
    }

    if (eye) {
      const toRx = (v) => {
        if (v == null || v === "") return "0";
        const s = String(v).trim().toUpperCase();
        if (s === "PL" || s === "PLANO" || s.includes("平光")) return "0";
        const n = Number(v);
        return isNaN(n) ? "0" : String(Math.round(n * 4) / 4);
      };
      const toAxis = (v) => {
        if (v == null || v === "") return "0";
        const n = Number(v);
        return isNaN(n) ? "0" : String(Math.min(180, Math.max(0, Math.round(n))));
      };
      patient.eyes.push({
        side: eye.includes("右") ? "右眼" : eye.includes("左") ? "左眼" : eye,
        sph: toRx(sph),
        cyl: toRx(cyl),
        axis: toAxis(axis),
      });
    }
  }

  for (const p of patients) {
    p.eyes.sort((a, b) => (a.side === "右眼" ? 0 : 1) - (b.side === "右眼" ? 0 : 1));
  }

  return { patients, warnings, contact: orderContact, phone: orderPhone, address: orderAddress, file: name };
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
