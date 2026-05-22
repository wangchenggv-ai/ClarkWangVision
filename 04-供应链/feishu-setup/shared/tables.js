/**
 * ══════════════════════════════════════════════════════════
 * SKU 三层数据模型（全局约定，所有模块统一遵守，不得绕过）
 * ══════════════════════════════════════════════════════════
 *
 * Layer 1 — ProductSKU（产品型号）
 *   存储：TABLES.sku（tblwQsvGAahoeoJV）
 *   标识：SKU编号字段（如 OK-A、OK-B），目前共 7 个
 *   用途：采购、模具台账、毛坯库存、定价
 *   写法：代码里变量名用 productSku / sku
 *
 * Layer 2 — StockSKU（备库度数单元）
 *   存储：TABLES.sku_location（tblTbLuC3VI0ISKH）
 *   标识：序列号 001-219，由 ProductSKU + SPH + CYL 唯一确定
 *   用途：仓库货位管理、配货单生成、度数级库存扣减
 *   写法：代码里变量名用 serialNo / skuSerial
 *
 * Layer 3 — LensItem（镜片个体）
 *   存储：TABLES.lens_detail（tblC7pve7ObFgIOl）
 *   标识：16位 HEX 镜片码（如 8355795E862C512E），一眼一码
 *   用途：消费者扫码验真、一眼一镜追踪、防伪
 *   写法：代码里变量名用 lensCode / hexCode
 *
 * 跨层引用规则：
 *   下单时    → 代理商填 ProductSKU + SPH + CYL（Layer1+2输入）
 *   库存扣减  → 通过 ProductSKU+SPH+CYL 定位 StockSKU，更新 stock_detail
 *   配货单    → 通过 ProductSKU+SPH+CYL 查 sku_location → 拿序列号+货位编号
 *   验真      → 用 LensItem 16位HEX 查 lens_detail
 * ══════════════════════════════════════════════════════════
 */

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
  sku_location: "tblTbLuC3VI0ISKH",

  // ── 导出记录 ──
  export_log: "tblBhxfut1XWWP0Q",

  // ── 批量订单 ──
  batch_order: "tbldOzNezl6xGDM2",

  // ── 分析 ──
  ai_analysis: "tbl8W9F9K2RbaL0k",

  // ── 财务结算 ──
  agent_pricing: "tbl7eFXyw8s2fkYN",
  agent_deposit_log: "tblObRYwlLa0Giua",
  return_exchange: "tbldW8XLtXPf0lZC",
  rebate_rule: "tblq2OW1BQ6JRNgu",
  rebate_record: "tblvtvJdtVLh6Ijy",

  // ── 业务看板 ──
  sales_manager: "tblXXXXXXXXXXXXX",  // 销售经理映射表（待创建）
  key_account: "tblYYYYYYYYYYYYY",    // 大客户标记表（待创建）
};
