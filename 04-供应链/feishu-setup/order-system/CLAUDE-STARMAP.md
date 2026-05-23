# 星图项目宪法 (STARMAP-CLAUDE.md)

> 星图(Starmap) — 代理商赋能系统，集成在订单系统中

---

## 一、项目定位

**不是CRM，是赋能系统。**

代理商管自己，顺便让总部看见。核心使命：让暑期100天(7/1-10/8)的销售执行**透明化、自管理化、可复盘化**。

**Slogan**: 每一颗星，都被看见
**发布锚点**: 2026年6月11-12日 · 第二届代理商大会

---

## 二、模块清单

| 模块 | 中文名 | API | 数据源 | 优先级 |
|------|--------|-----|--------|--------|
| Star Trail | 星轨(年度进度) | `/api/starmap/star-trail?t=xxx` | orders表聚合 | P0 |
| Star Tier | 星级(返利档位) | `/api/starmap/star-tier?t=xxx` | orders表累计 | P0 |
| ECP Board | 星耀榜(ECP榜单) | `/api/starmap/ecp-board?t=xxx` | ECP100 Bitable | P1 |
| ~~Summer~~ | ~~暑期星阵~~ | — | 待确认表ID | 跳过 |
| ~~Warning~~ | ~~库存预警~~ | — | — | 跳过 |

---

## 三、三层视角

| 层级 | 用户 | 名字 | 认证 |
|------|------|------|------|
| L1 | 代理商 | 我的星图 | `?t={token}` |
| L2 | 销售经理 | 区域星图 | 待实现 |
| L3 | CEO+管理层 | 全国星图 | `?admin={ADMIN_TOKEN}` |

**数据可见性规则：**
- 代理商：只看自己，看不到其他代理商
- 销售：看辖区4-5家详情
- CEO：看全部20家

---

## 四、技术架构

**集成在订单系统中，不是独立项目。**

| 组件 | 选型 | 说明 |
|------|------|------|
| 后端 | Node.js http模块 | 复用server.js路由模式 |
| 存储 | 飞书 Bitable | 复用feishu.js封装 |
| 前端 | 原生HTML+JS | 零构建，复用common.css |
| 部署 | 华为云ECS Docker | 同order-app容器 |
| ECP数据 | 跨Bitable访问 | 同一飞书App，不同APP_TOKEN |

**关键文件：**
- `server.js` — starmap路由（~200行，追加在summer-plan路由之后）
- `lib/starmap-aggregator.js` — 数据聚合模块（新建）
- `public/starmap.html` — 前端单页面（新建）
- `shared/tables.js` — 表ID（复用，不新增）

---

## 五、数据规则

### 5.1 星轨计算逻辑

```javascript
progressPercent = (currentVolume / yearlyTarget * 100).toFixed(1)
remainingVolume = max(0, yearlyTarget - currentVolume)
remainingMonths = 12 - now.getMonth()  // 5月→8个月
monthlyPaceNeeded = Math.ceil(remainingVolume / remainingMonths)
```

**统计口径：** 当年累计副数 = 只算已发货订单（状态"已发货"）

**Status枚举：**
- `normal` — 进度%在期望±10%内（蓝色）
- `behind` — 进度% < 期望-10%（橙色）
- `ahead` — 进度% > 期望+10%（绿色）
- `exceeded` — 已超额完成（金色）
- `no_target` — 未设定目标（灰色）

### 5.2 ECP跨Bitable访问

ECP100数据在独立Bitable `RlfTb6gykaEb3gsR1lwcGnShnAA`，用同一飞书App的tenant_access_token访问。

```javascript
const ECP_APP_TOKEN = "RlfTb6gykaEb3gsR1lwcGnShnAA";
const ECP_PERF_TABLE = "tblnC2oBxVyIX11j";    // 业绩明细
const ECP_OPT_TABLE = "tblFyEMF7P76o7Ur";      // 视光师档案
```

---

## 六、前端架构

**单页面 `public/starmap.html`，底部3 Tab导航。**

| Tab | 标签 | API | 内容 |
|-----|------|-----|------|
| 1 | 星轨 | `/api/starmap/star-trail` | 进度条+关键数字 |
| 2 | 星级 | `/api/starmap/star-tier` | 档位徽章+差距 |
| 3 | 星耀 | `/api/starmap/ecp-board` | ECP排名+进度 |

**设计规范：**
- 移动端优先（80%+流量来自手机）
- 深色星空主题
- 大字号关键数字（2.5rem+）
- 进度条颜色按status变化
- Tab切换懒加载API
- 底部导航固定56px

---

## 七、开发铁律

1. **严格复用** — 不新建独立服务，不引入新依赖
2. **代理商数据隔离** — 代理商只能看自己的数据
3. **不确定加TODO** — 业务规则不确定的地方用 `// TODO[Clark]:` 标注
4. **不扩展功能** — 按SPEC执行，不自行添加功能
5. **移动端先测** — 所有页面先在375px验证
6. **T+1可接受** — 不要求实时数据

---

## 八、5周冲刺路线图

| 周 | 日期 | 目标 |
|----|------|------|
| W1 | 5/12-5/18 | 架构搭建 + 星轨模块 |
| W2 | 5/19-5/25 | 星级 + 星耀榜模块 |
| W3 | 5/26-6/1 | 销售/CEO视角 |
| W4 | 6/2-6/8 | 种子代理商内测 |
| W5 | 6/9-6/15 | 发布会冲刺 |

---

## 九、永远不做的5件事

1. ❌ 不做客户CRM
2. ❌ 不做产品目录/电商
3. ❌ 不做临床数据（归CDSA）
4. ❌ 不做内部OA/HR
5. ❌ 不做对外营销/官网

---

## 十、相关项目

| 项目 | 关系 | 说明 |
|------|------|------|
| 订单系统 | 数据源 | 星轨/星级的订单数据 |
| ECP100 | 数据源 | 星耀榜的视光师数据 |
| CRM | 数据源 | 代理商主数据 |

---

**最后更新**: 2026-05-13
**维护者**: Clark
