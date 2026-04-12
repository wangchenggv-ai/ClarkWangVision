/**
 * gen_tokens.js — 批量生成代理商token，写入 agents.json
 *
 * Usage:
 *   node gen_tokens.js                          # 查看当前列表
 *   node gen_tokens.js add "黑龙江方圆科技"      # 添加一个代理商
 *   node gen_tokens.js add-batch agents.txt     # 从文件批量添加（每行一个名称）
 *   node gen_tokens.js list                     # 打印所有链接
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, "agents.json");

// 本地服务地址（部署后替换为实际域名）
const BASE_URL = process.env.PORTAL_URL || "http://localhost:3000";

function load() {
  if (!existsSync(FILE)) return [];
  return JSON.parse(readFileSync(FILE, "utf-8"));
}

function save(agents) {
  writeFileSync(FILE, JSON.stringify(agents, null, 2));
}

function genToken(id) {
  const r = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${id}-${r}`;
}

function genId(agents) {
  const n = agents.length + 1;
  return `AG-${String(n).padStart(3, "0")}`;
}

const [,, cmd, arg] = process.argv;

const agents = load();

if (!cmd || cmd === "list") {
  if (agents.length === 0) {
    console.log("暂无代理商，使用 node gen_tokens.js add <名称> 添加");
  } else {
    console.log(`\n共 ${agents.length} 家代理商：\n`);
    console.log("ID       | 名称                     | 下单链接");
    console.log("---------|--------------------------|---------------------");
    for (const a of agents) {
      const link = `${BASE_URL}/order?t=${a.token}`;
      console.log(`${a.id.padEnd(8)} | ${a.name.padEnd(24)} | ${link}`);
    }
    console.log("");
  }

} else if (cmd === "add" && arg) {
  const name = arg.trim();
  if (agents.find(a => a.name === name)) {
    console.log(`⚠️  已存在: ${name}`);
    process.exit(0);
  }
  const id = genId(agents);
  const token = genToken(id);
  agents.push({ id, name, token, phone: "", address: "" });
  save(agents);
  console.log(`✅ 已添加: ${name}`);
  console.log(`   ID:    ${id}`);
  console.log(`   下单:  ${BASE_URL}/order?t=${token}`);
  console.log(`   查询:  ${BASE_URL}/track?t=${token}`);

} else if (cmd === "add-batch" && arg) {
  const lines = readFileSync(resolve(process.cwd(), arg), "utf-8")
    .split("\n").map(l => l.trim()).filter(Boolean);
  let added = 0;
  for (const name of lines) {
    if (agents.find(a => a.name === name)) { console.log(`⏭️  跳过已有: ${name}`); continue; }
    const id = genId(agents);
    const token = genToken(id);
    agents.push({ id, name, token, phone: "", address: "" });
    console.log(`✅ ${id} ${name}`);
    added++;
  }
  save(agents);
  console.log(`\n共新增 ${added} 家代理商`);

} else {
  console.log("Usage:");
  console.log("  node gen_tokens.js list");
  console.log('  node gen_tokens.js add "代理商名称"');
  console.log("  node gen_tokens.js add-batch agents.txt");
}
