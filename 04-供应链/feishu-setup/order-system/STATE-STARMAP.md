# 星图项目状态 (STATE-STARMAP.md)

> 更新：2026-05-13

---

## 当前开发状态

| 模块 | 状态 | 说明 |
|------|------|------|
| SPEC-001 星轨 | ✅ 本地测试通过 | 年度进度，深圳视力康作为MVP验证agent |
| SPEC-002 星级 | ✅ 本地测试通过 | 返利档位，阈值已定（4000/6000/10000副） |
| SPEC-004 星耀榜 | ✅ 本地测试通过 | ECP100跨Bitable |
| SPEC-003 暑期星阵 | 跳过 | summer_target表ID待确认 |
| 库存预警 | 跳过 | — |

---

## 已有系统概览

### 订单系统 (order-system)
- 生产地址：`https://lab.gaushclear.com`（华为云ECS Docker）
- 测试地址：`http://113.44.175.221:3211`
- 本地地址：`http://localhost:3210`
- Bitable：`B3xQbbqicaome1sKdZbcwdk8nWg`
- 代理商表：`tblHsgGbJWkB31qu`
- 订单表：`tblk9Ch4gk2uQ1zG`
- 技术栈：Node.js http模块 + 飞书Bitable，零构建

### ECP100项目
- Bitable：`RlfTb6gykaEb3gsR1lwcGnShnAA`
- 业绩明细表：`tblnC2oBxVyIX11j`
- 视光师档案表：`tblFyEMF7P76o7Ur`
- 表单服务器：端口3001

---

## 待办事项

- [x] `server.js` loadAgents() 读取 `yearly_target` ✅
- [x] 创建 `lib/starmap-aggregator.js` ✅
- [x] 添加 starmap 路由到 `server.js` ✅
- [x] 创建 `public/starmap.html` ✅
- [x] agents表新建「年度目标」数字字段 ✅ (field_id: fldokYKQTW)
- [x] 深圳视力康设置3000副年度目标 ✅
- [x] 本地测试三个API ✅
- [ ] 部署到测试环境验证
- [ ] 添加真实订单数据测试

---

## 测试结果 (2026-05-13)

### API测试
| API | 状态 | 响应 |
|-----|------|------|
| `/api/starmap/star-trail?t=AG-028-b9bd93d8ec941280` | ✅ | 年度进度正常 |
| `/api/starmap/star-tier?t=AG-028-b9bd93d8ec941280` | ✅ | 返利档位正常 |
| `/api/starmap/ecp-board?t=AG-028-b9bd93d8ec941280` | ✅ | ECP榜单正常 |
| `/api/agent?t=AG-028-b9bd93d8ec941280` | ✅ | 代理商信息正常 |

### 深圳视力康测试数据
- 代理商ID：AG-028
- 下单Token：AG-028-b9bd93d8ec941280
- 年度目标：3000 副
- 当前累计：0 副（需订单数据）
- 月均需达成：375 副/月
- 状态：behind（落后）

### 前端页面
- 地址：`http://localhost:3210/starmap.html?t=AG-028-b9bd93d8ec941280`
- 状态：代码正常，需浏览器测试

---

## 关键数字

- 代理商数量：20家
- 销售经理：4人（尹建华/余晓玲/徐征颖/高珊）
- MVP验证agent：深圳视力康 (AG-028)
- 目标发布日：2026-06-11

---

## 部署信息（复用订单系统）

```bash
# SSH
ssh -i "04-供应链/feishu-setup/order-system/密钥/key-gaush-lab.pem" root@113.44.175.221

# 部署starmap相关文件
scp -i "$KEY" public/starmap.html lib/starmap-aggregator.js server.js root@113.44.175.221:/tmp/
ssh -i "$KEY" root@113.44.175.221 \
  "docker cp /tmp/starmap.html order-app:/app/public/starmap.html && \
   docker cp /tmp/starmap-aggregator.js order-app:/app/lib/starmap-aggregator.js && \
   docker cp /tmp/server.js order-app:/app/server.js && \
   docker restart order-app"
```

---

*本文件由 AI 自动生成，每次会话结束时更新*
