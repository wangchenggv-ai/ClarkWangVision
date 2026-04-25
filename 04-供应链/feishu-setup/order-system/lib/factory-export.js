// lib/factory-export.js — 工厂导出（Excel + ZIP）

import XLSX from "xlsx";

// ─── 生成工厂 Excel 文件 ─────────────────────────────────────────────────────

export function buildFactoryExcel(records, orderNo, orderInfoMap = {}) {
  const isMap = orderInfoMap && !orderInfoMap.remark && !orderInfoMap.address;
  const getInfo = (recOrderNo, recCustomer, recPairIndex) => {
    if (!isMap) return orderInfoMap; // 旧格式：单个 info
    const fullKey = `${recOrderNo}|${recCustomer}|${recPairIndex || 1}`;
    const nameKey = `${recOrderNo}|${recCustomer}`;
    return orderInfoMap[fullKey] || orderInfoMap[nameKey] || orderInfoMap[recOrderNo] || Object.values(orderInfoMap)[0] || {};
  };
  const sorted = [...records].sort((a, b) => {
    const nameCmp = String(a.fields["顾客姓名"] || "").localeCompare(String(b.fields["顾客姓名"] || ""), "zh-CN");
    if (nameCmp !== 0) return nameCmp;
    const pa = a.fields["序号"] || 1, pb = b.fields["序号"] || 1;
    if (pa !== pb) return pa - pb;
    const ea = a.fields["眼别"] || "", eb = b.fields["眼别"] || "";
    if (ea.includes("右") && !eb.includes("右")) return -1;
    if (!ea.includes("右") && eb.includes("右")) return 1;
    return 0;
  });
  const rows = sorted.map(rec => {
    const f = rec.fields;
    const info = getInfo(f["订单编号"] || "", f["顾客姓名"] || "", f["序号"] || 1);
    return {
      "订单号": f["订单编号"] || "",
      "顾客": f["顾客姓名"] || "",
      "产品型号": f["产品型号"] || "",
      "数量": info.quantity || 1,
      "眼别": f["眼别"] || "",
      "球镜SPH": f["球镜SPH"] != null ? Number(f["球镜SPH"]).toFixed(2) : "",
      "柱镜CYL": f["柱镜CYL"] != null ? Number(f["柱镜CYL"]).toFixed(2) : "",
      "轴位AXIS": f["轴位AXIS"] != null ? Number(f["轴位AXIS"]).toFixed(0) : "",
      "镜片码": f["镜片码"] || "",
      "是否装配": f["是否装配"] || "",
      "联系人": info.contact || "",
      "联系电话": info.phone || "",
      "收货地址": info.address || "",
      "备注": info.remark || "",
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 6 },
    { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
    { wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 24 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, `订单${orderNo}`.slice(0, 31));
  return Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

// ─── 最小 ZIP 实现（Store 模式，不压缩）──────────────────────────────────────

export function buildZipBuffer(fileEntries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  const parts = [];

  for (const entry of fileEntries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    parts.push(local, data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length + data.length;
  }

  const centralDirOffset = offset;
  const centralDirBuf = Buffer.concat(centralHeaders);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(fileEntries.length, 8);
  eocd.writeUInt16LE(fileEntries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDirBuf, eocd]);
}

// ─── CRC32 ──────────────────────────────────────────────────────────────────

const _crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = _crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
