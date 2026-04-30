// lib/printer.js — 打印机配置 + ZPL 标签生成 + TCP/USB 通信

import { readFileSync, writeFileSync } from "node:fs";
import { Socket } from "node:net";

let PRINTER_CONFIG_PATH, getServerBaseUrl, fmt, fmtAxis;
let _printerConfig = null;
let _printerConfigTime = 0;
const PRINTER_CONFIG_TTL = 30_000;

export function init({ configPath, serverBaseUrl, fmtFn, fmtAxisFn }) {
  PRINTER_CONFIG_PATH = configPath;
  getServerBaseUrl = serverBaseUrl;
  fmt = fmtFn;
  fmtAxis = fmtAxisFn;
}

export function loadPrinterConfig() {
  const now = Date.now();
  if (_printerConfig && now - _printerConfigTime < PRINTER_CONFIG_TTL) return _printerConfig;
  try {
    _printerConfig = JSON.parse(readFileSync(PRINTER_CONFIG_PATH, "utf-8"));
  } catch {
    _printerConfig = {
      default_connection: "tcp",
      tcp: { enabled: true, host: "192.168.0.208", port: 9100, timeout_ms: 5000 },
      usb: { enabled: false, bridge_url: "http://localhost:9101" },
      printer_model: "ZT410", dpi: 203,
      label_width_mm: 75, label_height_mm: 40,
      auto_print_on_ship: false, copies: 1,
    };
  }
  _printerConfigTime = now;
  return _printerConfig;
}

export function savePrinterConfig(config) {
  writeFileSync(PRINTER_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  _printerConfig = config;
  _printerConfigTime = Date.now();
}

export function buildZpl(rec) {
  const f = rec.fields || rec;
  const orderNo = f["订单编号"] || "";
  const customerName = f["顾客姓名"] || "";
  const sku = f["产品型号"] || "";
  const eye = f["眼别"] || "";
  const isRight = eye.includes("右");
  const eyeLabel = isRight ? "R 右眼" : "L 左眼";
  const sph = f["球镜SPH"] ?? "";
  const cyl = f["柱镜CYL"] ?? "";
  const axis = f["轴位AXIS"] ?? "";
  const lensCode = f["镜片码（唯一）"] || "";
  const agentName = f["代理商名称"] || "";
  const agentId = f["代理商ID"] || "";
  const verifyUrl = `${getServerBaseUrl()}/verify/${lensCode}`;

  // ZT410 600dpi: 75mm ≈ 1776 dots, 40mm ≈ 945 dots
  // 1mm ≈ 23.6 dots
  const M = 23.6;
  const zpl = [
    "^XA",
    "^CI28",
    "^PW1776",
    "^LL945",
    "^LH236,236",
    "^MNN",
    // 1. 姓名 (5,3,35,7) 12pt
    `^FO${Math.round(5*M)},${Math.round(3*M)}^A0N,${Math.round(4.2*M)},${Math.round(4.2*M)}^FD${customerName}^FS`,
    // 2. 眼别 (38,4,10,6) 12pt
    `^FO${Math.round(38*M)},${Math.round(4*M)}^A0N,${Math.round(4.2*M)},${Math.round(4.2*M)}^FD${eyeLabel}^FS`,
    // 3. 表格外框 (15,10,55,15)
    `^FO${Math.round(15*M)},${Math.round(10*M)}^GB${Math.round(55*M)},${Math.round(15*M)},2^FS`,
    // 4. 表格竖线 (33,10,0,15) (50,10,0,15)
    `^FO${Math.round(33*M)},${Math.round(10*M)}^GB2,${Math.round(15*M)},2^FS`,
    `^FO${Math.round(50*M)},${Math.round(10*M)}^GB2,${Math.round(15*M)},2^FS`,
    // 5. 表格横线 (15,17,55,0)
    `^FO${Math.round(15*M)},${Math.round(17*M)}^GB${Math.round(55*M)},2,2^FS`,
    // 6-8. 表头 球镜(18,11) 柱镜(37,11) 轴位(55,11) 11pt
    `^FO${Math.round(18*M)},${Math.round(11*M)}^A0N,${Math.round(3.9*M)},${Math.round(3.9*M)}^FD球镜^FS`,
    `^FO${Math.round(37*M)},${Math.round(11*M)}^A0N,${Math.round(3.9*M)},${Math.round(3.9*M)}^FD柱镜^FS`,
    `^FO${Math.round(55*M)},${Math.round(11*M)}^A0N,${Math.round(3.9*M)},${Math.round(3.9*M)}^FD轴位^FS`,
    // 9-11. 数值 (19,19) (38,19) (56,19) 14pt
    `^FO${Math.round(19*M)},${Math.round(19*M)}^A0N,${Math.round(4.9*M)},${Math.round(4.9*M)}^FD${fmt(sph)}^FS`,
    `^FO${Math.round(38*M)},${Math.round(19*M)}^A0N,${Math.round(4.9*M)},${Math.round(4.9*M)}^FD${fmt(cyl)}^FS`,
    `^FO${Math.round(56*M)},${Math.round(19*M)}^A0N,${Math.round(4.9*M)},${Math.round(4.9*M)}^FD${fmtAxis(axis)}^FS`,
    // 12. 品名 (5,28,40,6) 12pt
    `^FO${Math.round(5*M)},${Math.round(28*M)}^A0N,${Math.round(4.2*M)},${Math.round(4.2*M)}^FD高视星® ${sku}^FS`,
    // 13. 生产日期 (5,35,38,6) 12pt
    `^FO${Math.round(5*M)},${Math.round(35*M)}^A0N,${Math.round(4.2*M)},${Math.round(4.2*M)}^FD${new Date().toISOString().slice(0,10)}^FS`,
    // 14. 二维码 (52,26,18,18)
    `^FO${Math.round(52*M)},${Math.round(26*M)}^BQN,2,6^FDQA,${verifyUrl}^FS`,
    "^XZ",
  ].join("\n");

  return zpl;
}

export function buildTestZpl() {
  return [
    "^XA", "^CI28", "^PW1776", "^LL945",
    "^FO500,50^A0N,80,80^FDGAUSH TEST^FS",
    "^FO90,180^BY4^BCN,180,Y,N,N^FDTEST-PRINT^FS",
    "^FO90,420^A0N,55,55^FD测试标签 / Test Label^FS",
    "^FO90,500^A0N,45,45^FD" + new Date().toLocaleString("zh-CN") + "^FS",
    "^FO90,560^A0N,40,40^FD打印机: " + loadPrinterConfig().printer_model + "^FS",
    "^FO1330,180^BQN,2,5^FDQA,https://gaushclear.com^FS",
    "^XZ",
  ].join("\n");
}

export async function sendTcpZpl(zplString, host, port = 9100, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    sock.setTimeout(timeoutMs);
    sock.connect(port, host, () => {
      sock.write(Buffer.from(zplString, "utf-8"), () => {
        sock.end();
        resolve({ ok: true, method: "tcp", host, port });
      });
    });
    sock.on("error", (err) => reject(new Error(`TCP 打印失败 (${host}:${port}): ${err.message}`)));
    sock.on("timeout", () => { sock.destroy(); reject(new Error(`TCP 连接超时 (${host}:${port})`)); });
  });
}

export async function sendUsbZpl(zplString, bridgeUrl) {
  const res = await fetch(`${bridgeUrl}/print`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: zplString,
  });
  if (!res.ok) throw new Error(`USB 桥接失败: ${res.status}`);
  return res.json();
}

export async function sendZplToPrinter(zplString) {
  const config = loadPrinterConfig();
  const conn = config.default_connection || "tcp";
  if (conn === "tcp" && config.tcp?.enabled) {
    return sendTcpZpl(zplString, config.tcp.host, config.tcp.port, config.tcp.timeout_ms);
  }
  if (conn === "usb" && config.usb?.enabled) {
    return sendUsbZpl(zplString, config.usb.bridge_url);
  }
  throw new Error(`打印机未配置或未启用 (connection=${conn})`);
}
