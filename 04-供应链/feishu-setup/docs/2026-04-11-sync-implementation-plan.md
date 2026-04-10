# 三系统数据同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将旧订单表和CRM客户数据增量同步进供应链系统，打通三系统数据流，支撑Rule1-9正常运行。

**Architecture:** 旧订单表（唯一源头）→ 供应链订单表（滚动90天镜像）；CRM客户表 → 供应链终端客户表（镜像）。单向只读同步，幂等，重跑安全。

**Tech Stack:** Node.js ES modules, Feishu Bitable API (direct fetch), `.env` credentials, `field_mapping.json` 字段配置

---

## 已完成（勿重复）

- ✅ Migration 11：终端客户表 `tbltXNNhF65EBl17`
- ✅ Migration 12：订单表加 客户ID/来源订单号/同步时间
- ✅ `sync_orders.js` 框架（增量同步 + --dry-run）
- ✅ `field_mapping.json` 占位文件

---

## 文件结构

```
feishu-setup/
├── sync_orders.js          # 修改：加90天滚动清理
├── sync_customers.js       # 新建：CRM → 供应链客户同步
├── field_mapping.json      # 用户填写旧表信息（Task 3为用户操作）
├── .env                    # 加 CRM_APP_TOKEN + CRM_CUSTOMER_TABLE
├── .sync_cursor.json       # 自动生成，gitignore
└── docs/
    └── 2026-04-11-sync-implementation-plan.md
```

---

## Task 1：sync_customers.js（CRM → 供应链终端客户表）

**Files:**
- Create: `feishu-setup/sync_customers.js`
- Modify: `feishu-setup/.env`（加两个变量）

前置条件：需要 CRM 飞书多维表的 app_token 和客户表 table_id。  
可在 CRM 飞书多维表 URL 中找到：`/base/XXXXXXXX` 里的 `XXXXXXXX` 即 app_token；打开客户表后 URL 中 `tbl` 开头的段即 table_id。

- [ ] **Step 1：在 .env 末尾添加 CRM 配置**

打开 `feishu-setup/.env`，追加：

```
CRM_APP_TOKEN=待填（CRM多维表的app_token）
CRM_CUSTOMER_TABLE=待填（CRM客户表的table_id）
```

- [ ] **Step 2：创建 sync_customers.js**

```js
/**
 * sync_customers.js — 增量同步 CRM 客户表 → 供应链终端客户表
 *
 * CRM 客户表只读，不做任何写操作。
 * 用客户名称匹配，存在则跳过，不存在则新建（自动生成客户ID）。
 *
 * Usage:
 *   node sync_customers.js            # 全量同步（客户数量少，直接全量）
 *   node sync_customers.js --dry-run  # 只打印，不写入
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const NEW_APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const CUSTOMER_TABLE = "tbltXNNhF65EBl17";

function loadEnv() {
  const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split("=");
    env[k.trim()] = v.join("=").trim();
  }
  return env;
}

let TOKEN = "";
async function getToken(env) {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function listAllRecords(appToken, tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await apiGet(`/bitable/v1/apps/${appToken}/tables/${tableId}/records${qs}`);
    if (res.code !== 0) { console.error("  ❌ 读取失败:", res.msg); break; }
    if (res.data.items) records.push(...res.data.items);
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }
  return records;
}

function genCustomerId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CUS-${d}-${r}`;
}

// 从飞书字段值中提取纯文本（兼容数组/对象/字符串）
function val(v) {
  if (!v) return "";
  if (Array.isArray(v)) return v.map(i => i.text || i.name || String(i)).join("");
  if (typeof v === "object") return v.text || v.name || "";
  return String(v);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== CRM客户同步 ${dryRun ? "[DRY-RUN]" : ""} ===\n`);

  const env = loadEnv();
  if (!env.CRM_APP_TOKEN || env.CRM_APP_TOKEN === "待填") {
    console.log("⚠️  .env 中 CRM_APP_TOKEN 尚未填写，退出");
    process.exit(1);
  }

  await getToken(env);
  console.log("✅ 飞书 token 获取成功\n");

  // 读 CRM 客户表
  console.log("[1] 读取 CRM 客户表...");
  const crmCustomers = await listAllRecords(env.CRM_APP_TOKEN, env.CRM_CUSTOMER_TABLE);
  console.log(`    读到 ${crmCustomers.length} 条`);

  if (crmCustomers.length === 0) {
    console.log("\n✅ CRM 客户表为空，无需同步");
    return;
  }

  // 读供应链现有客户（建名称索引）
  console.log("\n[2] 读取供应链现有客户...");
  const existingCustomers = await listAllRecords(NEW_APP_TOKEN, CUSTOMER_TABLE);
  const existingNames = new Set(existingCustomers.map(r => val(r.fields["客户名称"])));
  console.log(`    已有 ${existingNames.size} 个客户`);

  // 同步
  console.log("\n[3] 同步中...");
  let created = 0, skipped = 0;

  for (const rec of crmCustomers) {
    const name = val(rec.fields["客户名称"]) || val(rec.fields["名称"]) || val(rec.fields["customer_name"]);
    if (!name) { skipped++; continue; }
    if (existingNames.has(name)) { skipped++; continue; }

    const newId = genCustomerId();
    const fields = {
      客户ID: newId,
      客户名称: name,
      来源系统: "CRM手动",
    };

    // 可选字段（如果 CRM 有这些字段）
    const type = val(rec.fields["客户类型"]);
    const city = val(rec.fields["所在城市"]) || val(rec.fields["城市"]);
    if (type) fields["客户类型"] = type;
    if (city) fields["所在城市"] = city;

    if (dryRun) {
      console.log(`  [DRY] 新建客户: ${name} → ${newId}`);
    } else {
      const r = await apiPost(
        `/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${CUSTOMER_TABLE}/records`,
        { fields }
      );
      if (r.code !== 0) { console.error(`  ❌ 写入失败 ${name}:`, r.msg); continue; }
      console.log(`  ✅ 新建客户: ${name} → ${newId}`);
    }
    created++;
    existingNames.add(name);
  }

  console.log(`\n✅ 同步完成: 新建 ${created} 个，跳过已有 ${skipped} 个`);
}

main().catch(err => { console.error("💥", err.message); process.exit(1); });
```

- [ ] **Step 3：dry-run 验证（填入 CRM_APP_TOKEN 后）**

```bash
cd feishu-setup
node sync_customers.js --dry-run
```

预期输出：
```
=== CRM客户同步 [DRY-RUN] ===
✅ 飞书 token 获取成功
[1] 读取 CRM 客户表...
    读到 N 条
[2] 读取供应链现有客户...
    已有 0 个客户
[3] 同步中...
  [DRY] 新建客户: xxx → CUS-20260411-XXXX
...
✅ 同步完成: 新建 N 个，跳过已有 0 个
```

- [ ] **Step 4：真实写入**

```bash
node sync_customers.js
```

预期：供应链终端客户表出现来自 CRM 的客户记录。

---

## Task 2：sync_orders.js 加90天滚动清理

**Files:**
- Modify: `feishu-setup/sync_orders.js`

在 `main()` 函数末尾的 `saveCursor(syncTime)` 之前，加入滚动清理逻辑。

- [ ] **Step 1：在 sync_orders.js 中添加 cleanupOldOrders 函数**

在 `getExistingOrderNos` 函数之后（约第72行），插入：

```js
async function cleanupOldOrders(dryRun) {
  const cutoff = new Date(Date.now() - 90 * 86400000).getTime();
  const toDelete = [];
  let pageToken = "";

  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await apiGet(`/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${NEW_ORDER_TABLE}/records${qs}`);
    if (res.code !== 0) break;
    for (const r of res.data.items || []) {
      const ts = r.fields["下单日期"];
      if (ts && typeof ts === "number" && ts < cutoff) toDelete.push(r.record_id);
    }
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }

  if (toDelete.length === 0) { console.log("  清理：无过期记录"); return; }
  console.log(`  清理：${toDelete.length} 条超过90天的记录 ${dryRun ? "[DRY-跳过]" : ""}`);
  if (dryRun) return;

  // 批量删除（每次最多500条）
  for (let i = 0; i < toDelete.length; i += 500) {
    const batch = toDelete.slice(i, i + 500);
    await fetch(`${BASE}/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${NEW_ORDER_TABLE}/records/batch_delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ records: batch }),
    });
  }
}
```

- [ ] **Step 2：在 main() 的 saveCursor 调用前，加入清理调用**

找到 `if (!dryRun) saveCursor(syncTime);`，改为：

```js
  if (!dryRun) {
    console.log("\n[4] 清理90天前的旧记录...");
    await cleanupOldOrders(false);
    saveCursor(syncTime);
  } else {
    console.log("\n[4] 清理90天前的旧记录...");
    await cleanupOldOrders(true);
  }
```

- [ ] **Step 3：验证 dry-run 不报错**

```bash
node sync_orders.js --dry-run
```

预期末尾出现：
```
[4] 清理90天前的旧记录...
  清理：无过期记录
✅ 无新记录，同步完成
```

---

## Task 3：填写 field_mapping.json（用户操作）

**这一步需要用户提供旧订单表信息，代码无法自动完成。**

- [ ] **Step 1：获取旧订单表 app_token**

打开旧订单多维表，URL 格式为：  
`https://gausheyetech.feishu.cn/base/XXXXXXXXX`  
其中 `XXXXXXXXX` 即 `OLD_APP_TOKEN`。

- [ ] **Step 2：获取旧订单表 table_id**

在旧订单多维表中，打开订单表，URL 中 `tbl` 开头的字符串即 `OLD_TABLE_ID`。

- [ ] **Step 3：查看旧订单表字段名**

在旧订单表中，找到以下字段的**精确名称**（注意中英文、空格）：

| 语义 | 旧表中的字段名（需查看） |
|------|------------------------|
| 订单编号 | ？ |
| 客户名称 | ？ |
| 产品型号/SKU | ？ |
| 数量 | ？ |
| 下单日期 | ？ |
| 订单状态 | ？ |

- [ ] **Step 4：填写 field_mapping.json**

```json
{
  "_comment": "填写旧订单表的连接信息和字段映射，旧表只读",
  "OLD_APP_TOKEN": "此处填入旧表app_token",
  "OLD_TABLE_ID": "此处填入旧表table_id",
  "fields": {
    "旧_订单号":   "此处填入旧表订单编号字段名",
    "旧_客户名":   "此处填入旧表客户名称字段名",
    "旧_SKU":      "此处填入旧表产品型号字段名",
    "旧_数量":     "此处填入旧表数量字段名",
    "旧_下单日期": "此处填入旧表下单日期字段名",
    "旧_状态":     "此处填入旧表订单状态字段名"
  }
}
```

---

## Task 4：端到端测试（依赖 Task 3 完成）

**Files:**
- 无新文件，使用已有脚本验证

- [ ] **Step 1：dry-run 验证读取旧表**

```bash
node sync_orders.js --days 3 --dry-run
```

预期：
```
[1] 读取旧订单表...
    读到 N 条（N > 0）
[3] 同步中...
  [DRY] 订单 XXXX: SKU=Ultra 数量=2 客户=CUS-...
```

若 N=0 或报错，检查 field_mapping.json 的 token 和字段名。

- [ ] **Step 2：真实同步最近3天订单**

```bash
node sync_orders.js --days 3
```

预期：
```
✅ 同步完成: 写入 N 条，跳过重复 0 条
```

打开飞书供应链订单表，确认出现新记录且字段正确（SKU、数量、客户ID、来源订单号）。

- [ ] **Step 3：运行 Rule1 验证自动化**

```bash
node automations.js rule1 -q
```

预期：Rule1 处理刚同步进来的订单，输出交期判断结果，无报错。

- [ ] **Step 4：运行全规则**

```bash
node automations.js all -q
```

预期：9条规则全部运行，输出约46行，无 ERROR。

- [ ] **Step 5：运行完整测试套件**

```bash
node full_test.js
```

预期：32/32 assertions pass。

---

## Task 5：配置每日定时同步

**每天固定时间自动运行 sync_customers.js + sync_orders.js**

- [ ] **Step 1：创建 sync_all.js 入口脚本**

```js
// sync_all.js — 每日同步入口，按序执行客户同步 + 订单增量同步
import { execSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { cwd: __dirname, stdio: "inherit" });
}

console.log(`=== 每日同步 ${new Date().toISOString()} ===`);
run("node sync_customers.js");
run("node sync_orders.js");
console.log("\n=== 同步完成 ===");
```

- [ ] **Step 2：验证手动运行正常**

```bash
node sync_all.js
```

预期：客户同步 + 订单增量同步依次运行，无报错。

- [ ] **Step 3：配置 Windows 任务计划（每天08:00）**

在 Windows 命令提示符（管理员）运行：

```cmd
schtasks /create /tn "供应链每日同步" /tr "node C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\sync_all.js" /sc DAILY /st 08:00 /ru SYSTEM
```

验证创建成功：
```cmd
schtasks /query /tn "供应链每日同步"
```

预期输出包含：`状态: 就绪`

- [ ] **Step 4：手动触发一次验证定时任务可运行**

```cmd
schtasks /run /tn "供应链每日同步"
```

等待10秒后检查供应链订单表，确认有新的同步时间戳。

---

## 验收标准

| 验收项 | 命令 | 预期 |
|--------|------|------|
| 客户同步 | `node sync_customers.js` | CRM客户出现在供应链终端客户表 |
| 订单增量同步 | `node sync_orders.js --days 7` | 最近7天订单进入供应链订单表 |
| 去重 | 重跑上面命令 | 跳过重复 N 条，写入 0 条 |
| 规则运行 | `node automations.js all -q` | 9条规则无报错 |
| 全量测试 | `node full_test.js` | 32/32 pass |
| 定时任务 | 次日08:00后检查 | 有当天同步记录 |
