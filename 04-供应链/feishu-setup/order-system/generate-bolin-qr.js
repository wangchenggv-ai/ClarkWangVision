// 一次性脚本：铂林眼科 D8 预生成 225 个 QR 码
// SPH: 0 ~ -6.00（25档）× CYL: 0 ~ -2.00（9档）= 225 组合
// 用法：node generate-bolin-qr.js
// 输出：bolin-codes.json + bolin-qr/ 文件夹（225张PNG）+ bolin-manifest.xlsx

import { randomBytes } from "crypto";
import QRCode from "qrcode";
import XLSX from "xlsx";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "https://lab.gaushclear.com/bolin";
const OUT_DIR = resolve(__dirname, "bolin-qr");

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR);

function tag(val) {
  if (val === 0) return "000";
  const abs = Math.round(Math.abs(val) * 100);
  return `-${String(abs).padStart(3, "0")}`;
}

function fmtRx(val) {
  return val === 0 ? "0.00" : val.toFixed(2);
}

const codes = {};  // code → { sph, cyl }
const rows = [];
let count = 0;

for (let si = 0; si <= 24; si++) {
  const sph = Math.round(-(si * 0.25) * 100) / 100;
  for (let ci = 0; ci <= 8; ci++) {
    const cyl = Math.round(-(ci * 0.25) * 100) / 100;

    // 生成唯一 16 位 HEX 镜片码
    let code;
    do { code = randomBytes(8).toString("hex").toUpperCase(); } while (codes[code]);
    codes[code] = { sph, cyl };

    const url = `${BASE_URL}/${code}`;
    const filename = `D8_S${tag(sph)}_C${tag(cyl)}.png`;

    await QRCode.toFile(resolve(OUT_DIR, filename), url, {
      type: "png",
      width: 400,
      margin: 2,
      errorCorrectionLevel: "M",
    });

    rows.push({
      序号: ++count,
      镜片码: code,
      文件名: filename,
      "球镜 SPH": fmtRx(sph),
      "柱镜 CYL": fmtRx(cyl),
      验真网址: url,
    });

    if (count % 25 === 0) console.log(`已生成 ${count}/225...`);
  }
}

// 保存镜片码映射（服务端查询用）
writeFileSync(resolve(__dirname, "bolin-codes.json"), JSON.stringify(codes, null, 2));

// 生成清单 Excel
const ws = XLSX.utils.json_to_sheet(rows);
ws["!cols"] = [{ wch: 6 }, { wch: 20 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 60 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "铂林D8");
XLSX.writeFile(wb, resolve(__dirname, "bolin-manifest.xlsx"));

console.log(`\n✓ 已生成 ${count} 个 QR 码 → bolin-qr/`);
console.log("✓ 镜片码映射 → bolin-codes.json");
console.log("✓ 清单文件   → bolin-manifest.xlsx");
