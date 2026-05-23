#!/usr/bin/env node
// pull-print.js — Mac 本地守护进程，轮询云端打印队列 → 发送 ZPL 到斑马打印机 / 打开同行单
// 用法: nohup node pull-print.js &

import { Socket } from "node:net";
import { exec } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

// ─── 配置 ────────────────────────────────────────────────────────────────

const CONFIG_PATH = new URL("./pull-print-config.json", import.meta.url).pathname;

const defaults = {
  serverUrl: "https://lab.gaushclear.com",
  adminToken: "GaushOrderMock",
  pollMs: 2000,
  printerHost: "192.168.0.208",
  printerPort: 9100,
  timeoutMs: 5000,
  maxRetries: 3,
};

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const file = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      return { ...defaults, ...file };
    }
  } catch (e) { console.warn(`⚠ 配置文件解析失败，使用默认值: ${e.message}`); }
  return defaults;
}

const cfg = loadConfig();

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function ts() {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function log(level, msg) {
  const prefix = { info: "ℹ", ok: "✓", warn: "⚠", err: "✗" }[level] || "·";
  console.log(`[${ts()}] ${prefix} ${msg}`);
}

// ─── TCP 发送 ZPL ──────────────────────────────────────────────────────────

async function sendTcpZpl(zpl, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    sock.setTimeout(timeoutMs);
    sock.connect(port, host, () => {
      sock.write(Buffer.from(zpl, "utf-8"), () => {
        sock.end();
        resolve();
      });
    });
    sock.on("error", (err) => reject(new Error(`TCP 失败 (${host}:${port}): ${err.message}`)));
    sock.on("timeout", () => { sock.destroy(); reject(new Error(`TCP 超时 (${host}:${port})`)); });
  });
}

// ─── 打开 URL（跨平台）────────────────────────────────────────────────────

function openUrl(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : `open "${url}"`;
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => {
      if (err) reject(new Error(`打开失败: ${err.message}`));
      else resolve();
    });
  });
}

// ─── USB 桥接发送 ──────────────────────────────────────────────────────────

async function sendUsbBridge(zpl, bridgeUrl) {
  const res = await fetch(`${bridgeUrl}/print`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: zpl,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `USB bridge HTTP ${res.status}`);
  }
  return res.json();
}

// ─── 处理单个打印任务 ──────────────────────────────────────────────────────

async function processJob(job) {
  if (job.type === "zpl") {
    const conn = cfg.connection || "tcp";
    if (conn === "usb") {
      await sendUsbBridge(job.zpl, cfg.usbBridgeUrl || "http://localhost:9101");
      log("ok", `标签已打印(USB): ${job.orderNo} ${job.customerName} ${job.eye} [${job.lensCode}]`);
    } else {
      await sendTcpZpl(job.zpl, cfg.printerHost, cfg.printerPort, cfg.timeoutMs);
      log("ok", `标签已打印(TCP): ${job.orderNo} ${job.customerName} ${job.eye} [${job.lensCode}]`);
    }
  } else if (job.type === "slip") {
    await openUrl(job.slipUrl);
    log("ok", `同行单已打开: ${job.title}`);
  }
}

// ─── 标记任务完成 ──────────────────────────────────────────────────────────

async function markDone(id, error) {
  try {
    const body = error ? { error } : {};
    const url = `${cfg.serverUrl}/api/admin/print-queue/${id}/done?admin=${encodeURIComponent(cfg.adminToken)}`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    log("err", `回写失败 [${id}]: ${e.message}`);
  }
}

// ─── 主轮询循环 ────────────────────────────────────────────────────────────

let running = true;
let consecutiveErrors = 0;

async function poll() {
  if (!running) return;

  try {
    const url = `${cfg.serverUrl}/api/admin/print-queue/poll?admin=${encodeURIComponent(cfg.adminToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const { jobs } = await res.json();
    consecutiveErrors = 0;

    if (!jobs || jobs.length === 0) return;

    log("info", `收到 ${jobs.length} 个打印任务`);

    for (const job of jobs) {
      if (!running) break;
      let retries = 0;
      let lastErr = null;

      while (retries <= cfg.maxRetries) {
        try {
          await processJob(job);
          await markDone(job.id);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          retries++;
          if (retries <= cfg.maxRetries) {
            log("warn", `重试 ${retries}/${cfg.maxRetries}: ${e.message}`);
            await new Promise(r => setTimeout(r, 1000 * retries));
          }
        }
      }

      if (lastErr) {
        log("err", `任务失败 [${job.id}]: ${lastErr.message}`);
        await markDone(job.id, lastErr.message);
      }
    }
  } catch (e) {
    consecutiveErrors++;
    if (consecutiveErrors <= 3 || consecutiveErrors % 30 === 0) {
      log("err", `轮询失败 (连续${consecutiveErrors}次): ${e.message}`);
    }
  }
}

// ─── 优雅退出 ──────────────────────────────────────────────────────────────

function shutdown() {
  log("info", "正在退出...");
  running = false;
  // 等一轮轮询完成后再退出
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ─── 启动 ──────────────────────────────────────────────────────────────────

log("info", `pull-print 守护进程启动`);
log("info", `服务器: ${cfg.serverUrl}`);
log("info", `打印机: ${cfg.printerHost}:${cfg.printerPort}`);
log("info", `轮询间隔: ${cfg.pollMs}ms`);
log("info", `按 Ctrl+C 退出`);

// 自调度轮询（避免 setInterval 并发重叠）
async function pollLoop() {
  while (running) {
    await poll();
    await new Promise(r => setTimeout(r, cfg.pollMs));
  }
}
pollLoop();
