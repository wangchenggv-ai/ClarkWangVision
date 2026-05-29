/**
 * shared/tables.js — 所有 Bitable 表 ID 的单一真相源
 *
 * 改表 ID 只改这一个文件，server.js / automations.js / sync 脚本统一引用。
 * NODE_ENV=test 时自动切换到测试 Bitable 表 ID。
 */

export const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";

const isTest = process.env.NODE_ENV === "test";

const PROD = {
  // ── 订单系统 ──
  order: "tblk9Ch4gk2uQ1zG",
  lens_detail: "tblC7pve7ObFgIOl",
  customer: "tbltXNNhF65EBl17",
  agent: "tblHsgGbJWkB31qu",
  store_master: "",

  // ── 产品 ──
  product_model: "tblU25NQ3RuaJJfc",

  // ── 库存系统 ──
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  stock_detail: "tbl7U79QGG4JtQev",
  stock_plan: "tbluUfuETzwGdW1E",
  blank_inventory: "tblrFIGHFVhTB16p",
  mold: "tblfnVzOA2yFzbjs",
  production: "tblWu5QwGPK1zYMl",
  forecast: "tblK2YNUZ3RM3Zta",
  procurement: "tblOfnWZAMxvjZCQ",
  factory: "tblJ6RXFENJFQe9A",
  rule_config: "tbl78V8wgziRs0pt",

  // ── 寄售库存 ──
  agent_stock: "tblIEYUemBGIquVs",
  consignment_ledger: "tblP9VObYpOMh1gD",
  monthly_statement: "tblvEIQ7IBCJw2iY",
  stock_movement: "tblCoNeAbrz6tM9C",

  // ── 仓位映射 ──
  bin_map: "tblTbiUtWHpjKfUm",

  // ── 导出记录 ──
  export_log: "tblBhxfut1XWWP0Q",

  // ── 分析 ──
  ai_analysis: "tbl8W9F9K2RbaL0k",
};

const TEST = {
  // ── 订单系统 ──
  order: "tblmlRxaq0bNYgaf",
  lens_detail: "tblNPrsAB5uET9Hm",
  customer: "tblWdwAxdGYpH5tI",
  agent: "tbl07GBA5a7GTOmY",
  store_master: "tblcR9JV8IhzNrjI",

  // ── 产品 ──
  product_model: "tbl7JGbz9zqw9aTD",

  // ── 库存系统 ──
  sku: "",
  finished_inventory: "tblMjDw8PJUL3kbN",
  stock_detail: "tblMjDw8PJUL3kbN",
  stock_plan: "tblCnEnh32FDK4rP",
  blank_inventory: "tblvhanytCYdVqkW",
  mold: "tblN2fEQ9PPzmjAN",
  production: "tblCnEnh32FDK4rP",
  forecast: "tblYjeK4HezBYUMV",
  procurement: "tblFEMqLAZNJ0eHr",
  factory: "",
  rule_config: "tbl7vHIgEJgbnJey",

  // ── 寄售库存 ──
  agent_stock: "tblVrcGru9g6FrBp",
  consignment_ledger: "tblY6DIzgl96xmO1",
  monthly_statement: "tblHHsR4rok7Bc6J",
  stock_movement: "tblUWjnRgjdjCwr6",

  // ── 仓位映射 ──
  bin_map: "",

  // ── 导出记录 ──
  export_log: "",

  // ── 分析 ──
  ai_analysis: "",
};

export const TABLES = isTest ? TEST : PROD;
