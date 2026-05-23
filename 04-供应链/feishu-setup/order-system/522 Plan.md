─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
     │ 订单管理界面三项修改计划                                                                                                                                                │
     │                                                                                                                                                                         │
     │ Context                                                                                                                                                                 │
     │                                                                                                                                                                         │
     │ 订单管理界面 (orders.html) 有三个待修问题：装配筛选有 bug、缺导出给打标签的功能、确认时选了有库存/高清应直达打标签状态。后端 confirm 端点已支持 stockStatus             │
     │ 参数走快速路径，但前端 quickConfirm/confirmOrders 没传递该参数。                                                                                                        │
     │                                                                                                                                                                         │
     │ ---                                                                                                                                                                     │
     │ 修改1：装配筛选修复                                                                                                                                                     │
     │                                                                                                                                                                         │
     │ 问题：Bitable字段值是"是"/"否"，但筛选下拉选项文案是"已装配"/"未装配"，与数据不匹配，造成困惑。                                                                         │
     │                                                                                                                                                                         │
     │ 修法：                                                                                                                                                                  │
     │ - orders.html 行556：下拉选项改为匹配数据值——标签"是否装配"，选项"是"/"否"                                                                                              │
     │ <select id="filterAssembly"><option value="">是否装配</option><option value="是">是</option><option value="否">否</option></select>                                     │
     │ - 后端筛选逻辑无需改动（已经用"是"/"否"精确匹配）                                                                                                                       │
     │                                                                                                                                                                         │
     │ 文件：orders.html (行556)                                                                                                                                               │
     │                                                                                                                                                                         │
     │ ---                                                                                                                                                                     │
     │ 修改2：增加"导出Excel给打标签"按钮                                                                                                                                      │
     │                                                                                                                                                                         │
     │ 现状：已有 exportExcelSelected() 调用 /api/admin/labels/export-excel，但按钮只在打标签/已发货状态显示（ctx-btn）。需要新增一个更易用的入口。                            │
     │                                                                                                                                                                         │
     │ 修法：                                                                                                                                                                  │
     │ - orders.html 行571：将现有 导出Excel 按钮的 ctx-btn 类移除（使其始终可见），改按钮文案为 导出Excel给打标签                                                             │
     │ - orders.html exportExcelSelected() 函数（行1391）：移除状态限制，允许已下单/待处理/生产中的订单也导出（这些订单可能已有镜片码）                                        │
     │ - 后端 /api/admin/labels/export-excel 无需改动，已有逻辑会过滤无镜片码的记录                                                                                            │
     │                                                                                                                                                                         │
     │ 文件：orders.html (行571, 1391附近)                                                                                                                                     │
     │                                                                                                                                                                         │
     │ ---                                                                                                                                                                     │
     │ 修改3：有库存/高清确认 → 打标签                                                                                                                                         │
     │                                                                                                                                                                         │
     │ 问题根因：quickConfirm() 和 confirmOrders() 不传 stockStatus/supplier 给后端，后端走自动检测 routeConfirm。但自动检测依赖 resolveStock                                  │
     │ 读库存表，可能不准确。用户在行内选了供应商=高清，表示自有工厂有货，应直接走快速路径。                                                                                   │
     │                                                                                                                                                                         │
     │ 修法：                                                                                                                                                                  │
     │                                                                                                                                                                         │
     │ 后端 server.js（行3318-3327）                                                                                                                                           │
     │                                                                                                                                                                         │
     │ 在 stockStatus 为空时，增加对 Bitable 记录中 供应商厂家 字段的检查：                                                                                                    │
     │ if (stockStatus) {                                                                                                                                                      │
     │   // 现有逻辑不变                                                                                                                                                       │
     │ } else {                                                                                                                                                                │
     │   // 检查记录中已有的供应商：高清 = 自有工厂 = 有库存                                                                                                                   │
     │   const existingSupplier = rawVal(records[0]?.fields["供应商厂家"] || "");                                                                                              │
     │   if (existingSupplier === "高清") {                                                                                                                                    │
     │     confirmTargetStatus = "打标签";                                                                                                                                     │
     │     confirmWfStep = "labeled";                                                                                                                                          │
     │     deliveryType = "有货1-2天";                                                                                                                                         │
     │   } else {                                                                                                                                                              │
     │     const route = routeConfirm(stockResults);                                                                                                                           │
     │     confirmTargetStatus = route.targetStatus;                                                                                                                           │
     │     confirmWfStep = route.wfStep;                                                                                                                                       │
     │     deliveryType = route.deliveryType;                                                                                                                                  │
     │   }                                                                                                                                                                     │
     │ }                                                                                                                                                                       │
     │ 同理，effectiveStock 也需调整：供应商=高清时应为"有库存"。                                                                                                              │
     │                                                                                                                                                                         │
     │ 前端 orders.html — quickConfirm()（行1166）                                                                                                                             │
     │                                                                                                                                                                         │
     │ - 从行内 inline-select 读取当前订单的 supplier 值                                                                                                                       │
     │ - 从展开详情面板读取 stockStatus 值（如已展开）                                                                                                                         │
     │ - 如果 supplier=高清 或 stockStatus=有库存，传 stockStatus: "有库存" 给 API                                                                                             │
     │ - 乐观更新目标状态改为"打标签"（而非固定"待处理"）                                                                                                                      │
     │ - 弹窗文案根据 stockStatus 调整："状态将变为'打标签'并生成镜片码"                                                                                                       │
     │                                                                                                                                                                         │
     │ 前端 orders.html — confirmOrders()（行1206）                                                                                                                            │
     │                                                                                                                                                                         │
     │ - 批量确认时，收集每个选中订单的 supplier（从 allOrders 数组读取）                                                                                                      │
     │ - 如果所有选中订单 supplier=高清，传 stockStatus: "有库存"                                                                                                              │
     │ - 如果部分高清，分别调用：高清的传 stockStatus: "有库存"，其余不传（走自动检测）                                                                                        │
     │ - 实际上最简方案：不按订单拆分，而是直接让后端读每个订单的 供应商厂家 字段判断（上面后端已加了检查）。前端只需在批量确认时，如果所有订单供应商都是高清，传 stockStatus: │
     │  "有库存" 优化路径；否则不传，让后端逐单判断。                                                                                                                          │
     │ - 弹窗文案改为动态：根据是否有高清订单显示不同提示                                                                                                                      │
     │                                                                                                                                                                         │
     │ 文件：server.js (行3318-3330), orders.html (行1166-1186, 1206-1242)                                                                                                     │
     │                                                                                                                                                                         │
     │ ---                                                                                                                                                                     │
     │ 实施顺序                                                                                                                                                                │
     │                                                                                                                                                                         │
     │ 1. 修改1 装配筛选 → 验证：筛选"是"和"否"结果正确                                                                                                                        │
     │ 2. 修改3 确认快速路径 → 验证：选高清/有库存后确认，状态直达打标签                                                                                                       │
     │ 3. 修改2 导出按钮 → 验证：选中订单点"导出Excel给打标签"可下载                                                                                                           │
     │                                                                                                                                                                         │
     │ 验证                                                                                                                                                                    │
     │                                                                                                                                                                         │
     │ - 测试环境 http://113.44.175.221:3211/orders.html?admin=GaushOrderTest                                                                                                  │
     │ - 装配筛选：选"否"/"是"各筛一次，确认结果与 Bitable 一致                                                                                                                │
     │ - 确认快速路径：①选供应商=高清 → 点确认 → 状态变打标签；②不选供应商 → 点确认 → 走自动检测                                                                               │
     │ - 导出：选打标签状态订单 → 点"导出Excel给打标签" → 下载成功            