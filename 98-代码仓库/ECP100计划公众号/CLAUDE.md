# ECP100 视光师激励计划

## 项目概述
消费者到店取镜时，视光师用专属二维码帮消费者扫码验真+绑定订单。消费者获正品保障和随访服务，视光师累计业绩。

## 核心文件
- `ECP100_MVP方案.md` — 完整MVP方案V3.1
- `form-server/server.js` — Node.js表单服务器（端口3001），通过lark-cli写入飞书多维表格
- `qrcodes/` — 视光师专属二维码

## 技术栈
- **后端**: Node.js http模块（无第三方依赖），lark-cli写飞书
- **数据存储**: 飞书多维表格（CRM系统内）
  - ECP业绩明细表 `tblnC2oBxVyIX11j`
  - ECP视光师档案表 `tblFyEMF7P76o7Ur`
- **Base Token**: `RlfTb6gykaEb3gsR1lwcGnShnAA`
- **表单ID**: `vewfe8Nen0`

## 表单URL模板
```
http://localhost:3001/?optometrist={视光师姓名}&store={门店名}
```

## 开发约束
- 不用npm包，只用Node.js内置模块
- lark-cli需 `--as user` 身份执行
- 消费者-facing页面必须干净独立，不暴露飞书后台
