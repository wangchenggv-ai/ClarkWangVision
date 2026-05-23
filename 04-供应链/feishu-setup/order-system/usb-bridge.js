#!/usr/bin/env node
// usb-bridge.js — USB 打印机桥接服务（零依赖）
// 运行在连接斑马打印机的 Windows 电脑上，接收 HTTP 请求并转发到 USB 打印机
//
// 用法: node usb-bridge.js [--port 9101] [--printer "Zebra ZT410"]
// 测试: curl -X POST http://localhost:9101/print -d "^XA^FO50,50^A0N,50,50^FDTEST^FS^XZ"

import http from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";
import { execSync, exec } from "node:child_process";

const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf("--port") + 1]) || 9101;
const PRINTER_NAME = args[args.indexOf("--printer") + 1] || "Zebra ZT410";

// ─── 自动检测打印机端口 ─────────────────────────────────────────────────────

let detectedPort = null;

function detectPrinterPort() {
  if (detectedPort) return detectedPort;
  try {
    // 通过 PowerShell 查询打印机端口
    const ps = `Get-Printer -Name "${PRINTER_NAME}" | Select-Object -ExpandProperty PortName`;
    const port = execSync(`powershell -Command "${ps}"`, { encoding: "utf-8", timeout: 5000 }).trim();
    if (port) {
      detectedPort = port;
      console.log(`检测到打印机端口: ${port}`);
      return port;
    }
  } catch {}
  // 常见 USB 端口名
  detectedPort = "USB001";
  console.log(`未检测到端口，使用默认: ${detectedPort}`);
  return detectedPort;
}

// ─── 发送 ZPL 到 USB 打印机 ────────────────────────────────────────────────

function sendZplToUsb(zplString) {
  const tmpFile = `C:\\Windows\\Temp\\zpl_${Date.now()}.zpl`;

  return new Promise((resolve, reject) => {
    writeFileSync(tmpFile, zplString, "utf-8");
    const port = detectPrinterPort();

    // 方法1: 直接写入 USB 端口（最可靠，绕过驱动）
    try {
      execSync(`copy /B "${tmpFile}" "\\\\.\\${port}"`, { shell: "cmd.exe", timeout: 10000 });
      cleanup();
      resolve({ ok: true, method: "usb-port", port });
      return;
    } catch {}

    // 方法2: 通过打印机共享名发送
    try {
      execSync(`copy /B "${tmpFile}" "\\\\localhost\\${PRINTER_NAME}"`, { shell: "cmd.exe", timeout: 10000 });
      cleanup();
      resolve({ ok: true, method: "usb-share" });
      return;
    } catch {}

    // 方法3: PowerShell WritePrinter API
    const psScript = `
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter")]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW")]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFO di);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter")]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter")]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter")]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter")]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
    public static bool SendBytes(string printerName, byte[] bytes) {
        IntPtr hPrinter; DOCINFO di = new DOCINFO();
        di.pDocName = "ZPL Label"; di.pDataType = "RAW";
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
        StartDocPrinter(hPrinter, 1, ref di);
        StartPagePrinter(hPrinter);
        IntPtr pBytes = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, pBytes, bytes.Length);
        int written;
        WritePrinter(hPrinter, pBytes, bytes.Length, out written);
        Marshal.FreeHGlobal(pBytes);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        return written == bytes.Length;
    }
}
"@
      $bytes = [System.IO.File]::ReadAllBytes("${tmpFile}")
      [RawPrinter]::SendBytes("${PRINTER_NAME}", $bytes)
    `;

    try {
      const result = execSync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, {
        encoding: "utf-8", timeout: 15000
      });
      cleanup();
      if (result.trim() === "True") {
        resolve({ ok: true, method: "usb-spooler" });
      } else {
        reject(new Error("WritePrinter returned false"));
      }
    } catch (e) {
      cleanup();
      reject(new Error(`USB print failed: ${e.message}`));
    }

    function cleanup() { try { unlinkSync(tmpFile); } catch {} }
  });
}

// ─── HTTP 服务 ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, printer: PRINTER_NAME, port: PORT, detectedPort: detectedPort || "unknown" }));
    return;
  }

  if (req.method === "POST" && req.url === "/print") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      if (!body.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Empty ZPL" }));
        return;
      }
      try {
        const result = await sendZplToUsb(body);
        console.log(`✓ 打印成功 [${result.method}]`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error(`✗ 打印失败: ${e.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`\n=== USB 桥接服务 ===`);
  console.log(`地址: http://localhost:${PORT}`);
  console.log(`打印机: ${PRINTER_NAME}`);
  detectPrinterPort();
  console.log(`\n测试打印: node -e "fetch('http://localhost:${PORT}/print',{method:'POST',body:'^XA^FO50,50^A0N,50,50^FDTEST^FS^XZ'}).then(r=>r.json()).then(console.log)"`);
  console.log(`状态检查: curl http://localhost:${PORT}/status\n`);
});
