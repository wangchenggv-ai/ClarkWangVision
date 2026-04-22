/**
 * shared/tables.js — 所有 Bitable 表 ID 的单一真相源
 *
 * 改表 ID 只改这一个文件，server.js / automations.js / sync 脚本统一引用。
 */

export const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";

export const TABLES = {
  // ── 订单系统 ──
  order: "tblk9Ch4gk2uQ1zG",
  lens_detail: "tblC7pve7ObFgIOl",
  customer: "tbltXNNhF65EBl17",
  agent: "tblHsgGbJWkB31qu",

  // ── 库存系统 ──
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  stock_detail: "tbl7U79QGG4JtQev",
  stock_plan: "tbluUfuETzwGdW1E",
  blank_inventory: "tblrFIGHFVhTB16p",
  mold: "tblfnVzOA2yFzbjs",
  production: "tblWu5QwGPK1zYMl",
  forecast: "tblK2YNUZ3RM3Zta",
  procurement: "tblZX1qW7RvcJieg",
  factory: "tblJ6RXFENJFQe9A",
  rule_config: "tbl78V8wgziRs0pt",

  // ── 寄售库存 ──
  agent_stock: "tblIEYUemBGIquVs",
  consignment_ledger: "tblP9VObYpOMh1gD",
  monthly_statement: "tblvEIQ7IBCJw2iY",

  // ── 分析 ──
  ai_analysis: "tbl8W9F9K2RbaL0k",
};
