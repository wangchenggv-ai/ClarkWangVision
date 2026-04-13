/**
 * import_excel.js — 读取客户 Excel 订单，通过代理商门户 API 下单
 *
 * 用法：
 *   node import_excel.js <excel文件路径> --agent <代理商token>
 *
 * 示例：
 *   node import_excel.js /path/to/订单.xlsx --agent AG-003-z3t0557ucthgfxep
 *
 * Excel 格式要求：
 *   第2行：客户名称 | xxx  ...  联系人 | xxx  联系电话 | xxx
 *   第3行：收货地址 | xxx  ...  下单日期 | xxx
 *   第5行起：表头 + 数据行
 *   列：顾客姓名 | 产品型号 | 眼别 | 球镜 | 柱镜 | 轴位 | 瞳距 | 瞳高 | 数量 | 镜框型号
 *   同一顾客的左右眼只在第一行填姓名
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import XLSX from "xlsx";

const PORT = process.env.PORT || 3210;
const BASE_URL = `http://localhost:${PORT}`;

// ─── 解析参数 ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let excelPath = "";
let agentToken = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--agent" && args[i + 1]) { agentToken = args[i + 1]; i++; }
  else if (!args[i].startsWith("--")) { excelPath = args[i]; }
}

if (!excelPath || !agentToken) {
  console.log("用法: node import_excel.js <excel文件> --agent <代理商token>");
  console.log("示例: node import_excel.js 订单.xlsx --agent AG-003-xxx");
  process.exit(1);
}

// ─── 读取 Excel ────────────────────────────────────────────────────────

function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // 解析头部信息
  let customerCompany = "";  // 客户名称（公司）
  let contact = "";          // 联系人
  let phone = "";            // 联系电话
  let address = "";          // 收货地址
  let orderDate = "";        // 下单日期

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const val = String(row[i] || "").trim();
      if (val === "客户名称:" && row[i + 1]) customerCompany = String(row[i + 1]).trim();
      if (val === "联系人:" && row[i + 1]) contact = String(row[i + 1]).trim();
      if (val === "联系电话:" && row[i + 1]) phone = String(row[i + 1]).trim();
      if (val === "收货地址:" && row[i + 1]) address = String(row[i + 1]).trim();
      if (val === "下单日期:" && row[i + 1]) orderDate = String(row[i + 1]).trim();
    }
  }

  // 找表头行
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(c => String(c || "").includes("顾客姓名"))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error("找不到表头行（顾客姓名）");

  const headers = rows[headerIdx].map(c => String(c || "").trim());

  // 解析数据行（过滤空行和备注行）
  const dataRows = rows.slice(headerIdx + 1).filter(r => {
    const first = String(r[0] || "").trim();
    if (!first && !r.some(c => c != null && String(c).trim() !== "")) return false;
    if (first.startsWith("备注")) return false;
    return r.some(c => c != null && String(c).trim() !== "");
  });

  // 按顾客分组（同一顾客的左右眼只在第一行填姓名）
  const patients = [];
  let currentPatient = null;
  let lastCustomerName = "";

  for (const row of dataRows) {
    // 模糊匹配列名（处理 "瞳距（单眼）" vs "瞳距"）
    const findCol = (name) => {
      let idx = headers.indexOf(name);
      if (idx >= 0) return idx;
      idx = headers.findIndex(h => h.startsWith(name) || h.includes(name));
      return idx;
    };
    const get = (name) => {
      const idx = findCol(name);
      return idx >= 0 ? row[idx] : undefined;
    };

    const customerName = String(get("顾客姓名") || "").trim();
    const eye = String(get("眼别") || "").trim();
    const productModel = String(get("产品型号") || "").trim();
    const sph = get("球镜");
    const cyl = get("柱镜");
    const axis = get("轴位");
    const pd = get("瞳距");
    const ph = get("瞳高");
    const qty = get("数量（片）") || get("数量") || 1;
    const frame = String(get("镜框型号") || "").trim();

    // 填充顾客姓名（Excel 中同组只填第一行）
    const name = customerName || lastCustomerName;
    if (customerName) lastCustomerName = customerName;

    // 构建 SKU：产品型号 + 度数
    let sku = productModel;
    if (sph != null && sph !== "") {
      const sphStr = Number(sph) >= 0 ? `+${Number(sph)}` : String(sph);
      sku = `${productModel} ${sphStr}`;
    }

    const eyeObj = {
      side: eye,
      sph: sph != null ? Number(sph) : 0,
      cyl: cyl != null ? Number(cyl) : 0,
      axis: axis != null ? Number(axis) : 0,
      pd: pd != null ? Number(pd) : 0,
      ph: ph != null ? Number(ph) : 0,
      frame: frame || "",
    };

    // 如果当前顾客已有记录，合并到同一个 patient
    if (currentPatient && currentPatient.customerName === name) {
      currentPatient.eyes.push(eyeObj);
    } else {
      currentPatient = {
        customerName: name,
        sku: sku,
        quantity: Number(qty) || 1,
        eyes: [eyeObj],
        remark: "",
      };
      patients.push(currentPatient);
    }
  }

  return {
    address,
    company: customerCompany,
    contact,
    phone,
    orderDate,
    patients,
  };
}

// ─── 提交订单 ──────────────────────────────────────────────────────────

async function submitOrder(data) {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║    Excel 订单导入 → 代理商门户               ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  console.log(`客户公司: ${data.company}`);
  console.log(`联系人: ${data.contact}`);
  console.log(`电话: ${data.phone}`);
  console.log(`收货地址: ${data.address}`);
  console.log(`下单日期: ${data.orderDate}`);
  console.log(`患者数: ${data.patients.length}\n`);

  for (const p of data.patients) {
    console.log(`  ${p.customerName}: ${p.sku} × ${p.quantity}，${p.eyes.length} 眼`);
    for (const e of p.eyes) {
      console.log(`    ${e.side}: SPH ${e.sph} CYL ${e.cyl} AXIS ${e.axis} PD ${e.pd} PH ${e.ph} 镜框 ${e.frame}`);
    }
  }

  // 确认度数
  console.log("\n提交订单中...");

  const res = await fetch(`${BASE_URL}/api/submit?t=${agentToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: data.address,
      patients: data.patients,
    }),
  });

  const result = await res.json();

  if (result.error) {
    console.log(`\n❌ 提交失败: ${result.error}`);
    process.exit(1);
  }

  console.log(`\n✅ 下单成功！`);
  console.log(`  订单号: ${result.orderNo}`);
  console.log(`  患者数: ${result.summary?.totalPatients}`);
  console.log(`  镜片数: ${result.summary?.totalLenses}`);
  if (result.items) {
    for (const item of result.items) {
      console.log(`  - ${item.skuName} × ${item.quantity} (${item.deliveryType}, 交期 ${item.promiseDateFormatted})`);
    }
  }
}

// ─── 主流程 ────────────────────────────────────────────────────────────

const absPath = resolve(excelPath);
console.log(`读取文件: ${absPath}\n`);

try {
  const data = parseExcel(absPath);
  await submitOrder(data);
} catch (e) {
  console.error("❌ 错误:", e.message);
  process.exit(1);
}
