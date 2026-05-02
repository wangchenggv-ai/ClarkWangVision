/**
 * shared/tables.js — 所有 Bitable 表 ID 的单一真相源
 *
 * 改表 ID 只改这一个文件，server.js / automations.js / sync 脚本统一引用。
 * 通过 NODE_ENV=test 切换到测试 Bitable。
 */

const isTest = process.env.NODE_ENV === "test";

export const APP_TOKEN = isTest
  ? "CtXObqwAHaCXYssBBfkcXmrlnUe"
  : "B3xQbbqicaome1sKdZbcwdk8nWg";

const prod = {
  order: "tblk9Ch4gk2uQ1zG",
  lens_detail: "tblC7pve7ObFgIOl",
  customer: "tbltXNNhF65EBl17",
  agent: "tblHsgGbJWkB31qu",
  product_model: "tblU25NQ3RuaJJfc",
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  stock_detail: "tbl7U79QGG4JtQev",
  stock_plan: "tbluUfuETzwGdW1E",
  blank_inventory: "tblrFIGHFVhTB16p",
  mold: "tblfnVzOA2yFzbjs",
  production: "tblWu5QwGPK1zYMl",
  forecast: "tblK2YNUZ3RM3Zta",
  factory: "tblJ6RXFENJFQe9A",
  rule_config: "tbl78V8wgziRs0pt",
  agent_stock: "tblIEYUemBGIquVs",
  consignment_ledger: "tblP9VObYpOMh1gD",
  monthly_statement: "tblvEIQ7IBCJw2iY",
  stock_movement: "tblCoNeAbrz6tM9C",
  ai_analysis: "tbl8W9F9K2RbaL0k",
};

const test = {
  order: "tblmlRxaq0bNYgaf",
  lens_detail: "tblNPrsAB5uET9Hm",
  customer: "tblWdwAxdGYpH5tI",
  agent: "tbl07GBA5a7GTOmY",
  product_model: "tbl7JGbz9zqw9aTD",
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  stock_detail: "tblMjDw8PJUL3kbN",
  stock_plan: "tblCnEnh32FDK4rP",
  blank_inventory: "tblvhanytCYdVqkW",
  mold: "tblN2fEQ9PPzmjAN",
  production: "tblWu5QwGPK1zYMl",
  forecast: "tblYjeK4HezBYUMV",
  factory: "tblJ6RXFENJFQe9A",
  rule_config: "tbl7vHIgEJgbnJey",
  agent_stock: "tblVrcGru9g6FrBp",
  consignment_ledger: "tblY6DIzgl96xmO1",
  monthly_statement: "tblHHsR4rok7Bc6J",
  stock_movement: "tblUWjnRgjdjCwr6",
  ai_analysis: "tbl8W9F9K2RbaL0k",
};

export const TABLES = isTest ? test : prod;
