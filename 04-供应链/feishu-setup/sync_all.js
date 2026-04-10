/**
 * sync_all.js — 每日同步入口
 *
 * 按序执行：
 *   1. sync_customers.js — CRM客户 → 供应链终端客户表
 *   2. sync_orders.js    — 旧订单表增量 → 供应链订单表（含90天清理）
 *
 * Usage:
 *   node sync_all.js           # 正常运行
 *   node sync_all.js --dry-run # 两个脚本都以 dry-run 模式运行
 */

import { execSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");
const flag = dryRun ? " --dry-run" : "";

function run(label, cmd) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`▶ ${label}`);
  console.log(`  ${cmd}`);
  console.log("─".repeat(50));
  try {
    execSync(cmd, { cwd: __dirname, stdio: "inherit" });
  } catch (e) {
    console.error(`\n❌ ${label} 失败 (exit ${e.status})，继续下一步`);
  }
}

console.log(`\n${"═".repeat(50)}`);
console.log(`  每日供应链同步  ${new Date().toLocaleString("zh-CN")}${dryRun ? "  [DRY-RUN]" : ""}`);
console.log(`${"═".repeat(50)}`);

run("1/2 客户同步（CRM → 供应链）", `node sync_customers.js${flag}`);
run("2/2 订单增量同步（旧表 → 供应链）", `node sync_orders.js${flag}`);

console.log(`\n${"═".repeat(50)}`);
console.log("  同步完成");
console.log(`${"═".repeat(50)}\n`);
