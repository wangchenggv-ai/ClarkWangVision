/**
 * test.mjs — 统一测试入口
 *
 * 用法：
 *   node test.mjs              # 跑所有本地测试（需要 server 在 localhost:3210）
 *   node test.mjs --cloud      # 跑云端测试（需要 lab.gaushclear.com 可达）
 *   node test.mjs --all        # 本地 + 云端
 *   node test.mjs schema       # 只跑字段守卫
 *   node test.mjs stock        # 只跑库存并发
 *   node test.mjs e2e          # 只跑 E2E 全流程
 *   node test.mjs security     # 只跑安全/边界测试
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CWD = fileURLToPath(new URL(".", import.meta.url));

const args = process.argv.slice(2);
const runCloud = args.includes("--cloud") || args.includes("--all");
const runAll = !args.length || args.includes("--all");
const filters = args.filter(a => !a.startsWith("--"));

// ─── 测试定义 ────────────────────────────────────────────────────────

const LOCAL_TESTS = [
  { name: "字段守卫", file: "check_schema.js", tag: "schema", timeout: 30_000 },
  { name: "库存并发", file: "test_stock_concurrency.mjs", tag: "stock", timeout: 120_000 },
  { name: "Bug回归", file: "test_bug_fixes.js", tag: "regression", timeout: 120_000 },
  { name: "Day2回归", file: "test_day2_fixes.js", tag: "regression", timeout: 120_000 },
  { name: "E2E全流程", file: "e2e_full_sim.mjs", tag: "e2e", timeout: 120_000 },
  { name: "Bitable E2E", file: "test_e2e_bitable.js", tag: "e2e", timeout: 120_000 },
  { name: "安全边界", file: "test_challenge.mjs", tag: "security", timeout: 120_000 },
];

const CLOUD_TESTS = [
  { name: "云端回归", file: "test_cloud_regression.mjs", tag: "cloud", timeout: 180_000 },
  { name: "云端冒烟", file: "e2e_cloud_0422.mjs", tag: "cloud", timeout: 60_000 },
];

// ─── 工具函数 ────────────────────────────────────────────────────────

function runTest(t) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [t.file], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: CWD,
    });

    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d);
    child.stderr.on("data", d => stderr += d);

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ...t, ok: false, ms: Date.now() - start, output: "TIMEOUT" });
    }, t.timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      const ms = Date.now() - start;
      const output = (stdout + stderr).split("\n").slice(-8).join("\n");
      resolve({ ...t, ok: code === 0, ms, output });
    });
  });
}

async function checkServer() {
  try {
    const r = await fetch("http://localhost:3210/", { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════");
console.log("  订单系统测试套件");
console.log("═══════════════════════════════════════════════════════\n");

let tests = [];

if (runAll || runCloud) {
  tests.push(...LOCAL_TESTS);
  if (runCloud) tests.push(...CLOUD_TESTS);
} else {
  for (const f of filters) {
    tests.push(...LOCAL_TESTS.filter(t => t.tag === f || t.file.includes(f)));
    tests.push(...CLOUD_TESTS.filter(t => t.tag === f || t.file.includes(f)));
  }
}

if (tests.length === 0) {
  console.log("没有匹配的测试。可用标签: schema, stock, regression, e2e, security, cloud");
  process.exit(1);
}

// schema 不需要 server，其余需要
const needsServer = tests.some(t => t.tag !== "schema");
if (needsServer) {
  const up = await checkServer();
  if (!up) {
    console.log("❌ Server 未运行（localhost:3210）。请先启动: node server.js\n");
    process.exit(1);
  }
  console.log("✅ Server 运行中\n");
}

let passed = 0, failed = 0;
const results = [];

for (const t of tests) {
  process.stdout.write(`▸ ${t.name} ... `);
  const r = await runTest(t);
  if (r.ok) {
    console.log(`✅ (${(r.ms / 1000).toFixed(1)}s)`);
    passed++;
  } else {
    console.log(`❌ (${(r.ms / 1000).toFixed(1)}s)`);
    if (r.output !== "TIMEOUT") {
      console.log(`  ${r.output.split("\n").slice(-3).join("\n  ")}`);
    }
    failed++;
  }
  results.push(r);
}

console.log(`\n${"─".repeat(50)}`);
console.log(`结果: ${passed} 通过 / ${failed} 失败 / ${tests.length} 总计`);
if (failed > 0) {
  console.log("\n失败项:");
  results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.name} — ${r.file}`));
}
process.exit(failed > 0 ? 1 : 0);
