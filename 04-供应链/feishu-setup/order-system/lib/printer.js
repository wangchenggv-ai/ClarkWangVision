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
  const eyeLabel = isRight ? "R" : "L";
  const sph = f["球镜SPH"] ?? "";
  const cyl = f["柱镜CYL"] ?? "";
  const axis = f["轴位AXIS"] ?? "";
  const lensCode = f["镜片码"] || "";
  const agentName = f["代理商名称"] || "";
  const agentId = f["代理商ID"] || "";
  const verifyUrl = `${getServerBaseUrl()}/verify/${lensCode}`;

  const zpl = [
    "^XA",
    "^CI28",
    "^PW600",
    "^LL320",
    "",
    `^FO30,10^BY2^BCN,70,Y,N,N^FD${orderNo}^FS`,
    `^FO30,90^A0N,20,20^FD${orderNo}^FS`,
    `^FO30,120^A0N,24,24^FD${customerName}^FS`,
    `^FO280,120^A0N,18,18^FD${sku}^FS`,
    `^FO30,155^A0N,30,30^FD${eyeLabel} ${eye}^FS`,
    "^FO30,192^A0N,16,16^FDSPH^FS",
    "^FO130,192^A0N,16,16^FDCYL^FS",
    "^FO230,192^A0N,16,16^FDAXIS^FS",
    `^FO30,214^A0N,24,24^FD${fmt(sph)}^FS`,
    `^FO130,214^A0N,24,24^FD${fmt(cyl)}^FS`,
    `^FO230,214^A0N,24,24^FD${fmtAxis(axis)}^FS`,
    `^FO450,10^BQN,2,4^FDQA,${verifyUrl}^FS`,
    "^FO468,135^A0N,12,12^FDQR验真^FS",
    `^FO30,250^A0N,18,18^FD${lensCode}^FS`,
    "^FO30,238^GB530,1,1^FS",
    "^FO30,278^A0N,18,18^FDGAUSH | CLEAR^FS",
    `^FO250,278^A0N,14,14^FD${agentId} ${agentName}^FS`,
    "^XZ",
  ].join("\n");

  return zpl;
}

export function buildTestZpl() {
  return [
    "^XA", "^CI28", "^PW600", "^LL320",
    "^FO170,20^A0N,36,36^FDGAUSH TEST^FS",
    "^FO30,70^BY2^BCN,70,Y,N,N^FDTEST-PRINT^FS",
    "^FO30,155^A0N,22,22^FD测试标签 / Test Label^FS",
    "^FO30,185^A0N,18,18^FD" + new Date().toLocaleString("zh-CN") + "^FS",
    "^FO30,215^A0N,16,16^FD打印机: " + loadPrinterConfig().printer_model + "^FS",
    "^FO450,70^BQN,2,3^FDQA,https://gaushclear.com^FS",
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
