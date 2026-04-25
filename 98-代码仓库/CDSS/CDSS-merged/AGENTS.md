# AGENTS.md — 高视星 CDSS 项目

## 项目路径
`C:\Users\wangc\Downloads\ClarkWangVision\98-代码仓库\CDSS\CDSS-merged`

## 启动命令

### 前端
```powershell
cd "C:\Users\wangc\Downloads\ClarkWangVision\98-代码仓库\CDSS\CDSS-merged\frontend"
npm run dev
```
访问：http://localhost:5173/workbench

### 后端
```powershell
cd "C:\Users\wangc\Downloads\ClarkWangVision\98-代码仓库\CDSS\CDSS-merged\backend"
uvicorn app.main:app --reload --port 8000
```

### 种子数据
```powershell
cd "C:\Users\wangc\Downloads\ClarkWangVision\98-代码仓库\CDSS\CDSS-merged\backend"
python -m app.seed.seed_admin
```

## 默认登录
- 用户名：admin
- 密码：admin123
- 前端支持后端不可用时的Demo模式（同样用admin/admin123）

## 项目结构
- `backend/` — FastAPI后端（复刻自5000cases+m支架）
- `frontend/` — React + Ant Design前端
- `frontend/src/pages/Workbench/` — 接诊工作台（核心）
- `frontend/src/components/ConsultFlow/` — 患者教育、方案对比、临床报告组件
- `backend/app/routers/cdss.py` — CDSS分析API

## 关键文件
- `frontend/src/App.jsx` — 路由配置
- `frontend/src/contexts/AuthContext.jsx` — 认证+Demo模式
- `backend/app/config.py` — 数据库配置
