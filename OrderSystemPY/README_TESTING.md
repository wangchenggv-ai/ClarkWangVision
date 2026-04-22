# 溯源系统对接测试指南 V2

**版本:** shuang_client V3 + daily_batch V4 + sanity_check V1 + mock_shuang V1
**日期:** 2026-04-19

---

## V2 相对 V1 的升级

| 新增 | 说明 |
|---|---|
| `sanity_check.py` | 每日首次跑 daily_batch 自动调用,只读探测 API 健康 |
| 分级规模保护 | 10/50/300 三级阈值,大批量自动交互确认 |
| `--yolo` 参数 | 300+ 超大批量需要显式解锁,防止 Excel 异常导致误写 |
| `--skip-sanity` | 跳过健康检查(应急用,不推荐) |
| `.gitignore` | 保护 .env、真实订单数据、审计日志不入库 |

---

## 一、一次性准备(10 分钟)

### 1.1 文件放置

| 文件 | 操作 |
|---|---|
| `shuang_client.py` | **完整替换** |
| `daily_batch.py` | **完整替换** |
| `sanity_check.py` | **新增**,放到 `scripts/` |
| `mock_shuang.py` | **新增**(如已有 V1 版本,可替换,逻辑一致) |
| `config_append.py` | 追加到现有 config.py 末尾,然后删除此文件 |
| `env_append.txt` | 追加到现有 .env 末尾,然后删除此文件 |
| `.gitignore` | **放到项目根目录**(不是 scripts/),覆盖现有的 |

### 1.2 安装依赖

```powershell
pip install flask
```

### 1.3 紧急:检查 .env 是否曾提交过 git

**今天必须做**:

```powershell
cd 项目根目录
git log --all --full-history -- .env
```

- 如果有输出 → 历史上提交过 → **立刻重置所有凭证**(飞书 APP_SECRET 等)
- 如果无输出 → 没提交过 → 安全,继续

再检查 inputs/ 目录下的真实 Excel 有没有进 git:

```powershell
git log --all --full-history -- "inputs/**"
```

**原因:** 真实 Excel 含代理商、顾客姓名、电话,一旦进 git 历史永远可查,是个人信息合规风险。

### 1.4 提交 .gitignore

```powershell
git add .gitignore
git commit -m "Add gitignore to protect credentials and real data"
```

### 1.5 确认 .env 里 SHUANG_ENV=mock

```
SHUANG_ENV=mock
```

**这行在 mock 就绝对不会触达生产溯源系统。**

---

## 二、核心测试流程(严格按顺序)

### Step 1:启动 Mock(终端 A)

```powershell
cd 项目根目录\scripts
python mock_shuang.py
```

保持终端 A 运行。

### Step 2:冒烟测试 sanity_check(终端 B)

这是 V2 新增的关键步骤。

```powershell
cd 项目根目录\scripts
python sanity_check.py
```

**期望输出**(大致):

```
============================================================
  溯源系统健康检查
  环境: 🟢 MOCK(本地模拟)
  API:  http://localhost:3001/api
  时间: 2026-04-19 15:00:00
============================================================

[1/3] 检查 API 可达性...
      目标: http://localhost:3001/api/securityOrderList
      ✅ API 可达,响应正常
      ✅ 历史订单总数: 0

[2/3] 抽查记录数据结构...
      ⚠️  没有历史记录(可能是全新系统或 mock 未写入)

[3/3] 抽查 ZIP 下载...
      ⚠️  抽查的记录都没有 barcode_url,跳过下载检查

============================================================
  ✅ 所有检查通过
============================================================
```

Mock 全新启动时没数据,这是正常的。后面跑过一次 daily_batch 再回来跑 sanity_check,就会看到完整的数据抽查和 ZIP 下载检查。

### Step 3:1 条端到端测试

在 `inputs/YYYYMMDD/` 放 1 个含 1 条订单的 Excel。

```powershell
# 先 dry-run
python daily_batch.py --dry-run

# 再正式跑
python daily_batch.py
```

**关键观察:**

- [ ] 控制台首先出现 `[sanity] 当天首次运行,先跑健康检查...`
- [ ] sanity check 通过后才执行主流程
- [ ] 显示 `🟢 MOCK(本地模拟,绝对安全)`
- [ ] 1 条订单 ≤ 10,**无警告直接跑**(小批量无感)
- [ ] `outputs/YYYYMMDD/.sanity_checked` 标记文件生成
- [ ] `outputs/YYYYMMDD/sanity_check.txt` 报告生成
- [ ] `outputs/YYYYMMDD/audit_shuang.jsonl` 有 `add_success` 记录
- [ ] `outputs/YYYYMMDD/shuang_zips/` 有 1 个 ZIP

### Step 4:再跑一次,验证 sanity check 跳过

```powershell
python daily_batch.py --dry-run
```

**期望:** 控制台显示 `[sanity] 当天已检查过...跳过`。

### Step 5:回头再跑 sanity_check,验证数据抽查

```powershell
python sanity_check.py
```

**期望:** 这次不再是"没有历史记录",而是列出你刚写入的 1 条记录,并尝试下载其 ZIP。

### Step 6:15 条中批量测试(触发警告阈值)

清理:

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/reset" -Method Post
Remove-Item -Recurse -Force .\outputs\20260419\ -ErrorAction SilentlyContinue
```

放 15 条订单 Excel,跑:

```powershell
python daily_batch.py
```

**期望:**
- 出现 `⚠️  中批量写入: 15 条(自动继续)`
- 不需要人工确认,自动继续
- 全部 15 条写入成功

### Step 7:60 条大批量测试(触发交互确认 - mock 不触发)

在 mock 环境 60 条不触发交互,**只在 production 才触发**。mock 会打印 `大批量写入: 60 条(非生产环境,自动继续)`。

跑:

```powershell
python daily_batch.py
```

**期望:** 全部 60 条写入成功,无交互阻塞。

### Step 8:模拟 production 交互确认

**临时**(不改 .env)模拟 production 环境跑 60 条:

```powershell
# PowerShell
$env:SHUANG_ENV="production"
$env:CONFIRM_PRODUCTION="YES_I_AM_SURE"
$env:SHUANG_API_BASE_PRODUCTION="http://localhost:3001/api"  # 把"生产地址"临时指向 mock,只为测交互流程
python daily_batch.py
```

**期望:** 在写入前出现交互提示:

```
============================================================
🔴 即将写入 60 条订单到生产溯源系统
============================================================
目标: http://localhost:3001/api
环境: PRODUCTION
审计: outputs/20260419/audit_shuang.jsonl

按 Enter 继续,Ctrl+C 取消...
```

按 Enter 继续。**测试完成后立即关闭终端,清除环境变量**:

```powershell
Remove-Item Env:\SHUANG_ENV
Remove-Item Env:\CONFIRM_PRODUCTION
Remove-Item Env:\SHUANG_API_BASE_PRODUCTION
```

或者直接关闭这个 PowerShell 窗口,开新窗口继续后面测试(最稳)。

### Step 9:350 条超大批量测试(触发 --yolo 阻断)

放 350 条订单,跑:

```powershell
python daily_batch.py
```

**期望:** 脚本拒绝执行:

```
❌ 超大批量 350 条,超过默认上限 300。
  如果确定要跑,请加 --yolo 参数解锁。
  如果不应该是这么多,请检查 Excel 是否异常。
```

解锁后再跑:

```powershell
python daily_batch.py --yolo
```

期望:出现 `🚨 超大批量写入: 350 条(--yolo 已解锁)`,正常写入。

### Step 10:200 条压测(正常使用的目标量级)

清理后放 200 条,跑:

```powershell
python daily_batch.py
```

**验收目标:**
- [ ] 总耗时 < 2 分钟
- [ ] 成功率 > 98%
- [ ] ZIP 匹配率 100%
- [ ] `audit_shuang.jsonl` 200 条 `add_success` + 1 条 `batch_complete`

---

## 三、切换到生产的正确姿势(5.1 才做!!!)

**现在不要做这一步。** 仅供 5.1 参考。

### 3.1 前置条件全部满足

- [ ] 本地 Mock 测试所有 10 个 Step 通过
- [ ] 溯源系统当日备份已完成(MySQL + uploads)
- [ ] admin.gaushclear.com 弱密码已改
- [ ] 2-3 个代理商灰度跑通(真实小批量)

### 3.2 正式跑生产

**PowerShell**:

```powershell
# 1. 临时设环境变量(不写入 .env)
$env:SHUANG_ENV="production"
$env:CONFIRM_PRODUCTION="YES_I_AM_SURE"

# 2. 先 sanity_check(只读,可直接跑)
python sanity_check.py

# 3. 主流程
python daily_batch.py

# 4. 跑完立刻清除环境变量
Remove-Item Env:\SHUANG_ENV
Remove-Item Env:\CONFIRM_PRODUCTION
```

**bash**:

```bash
SHUANG_ENV=production python sanity_check.py
SHUANG_ENV=production CONFIRM_PRODUCTION=YES_I_AM_SURE python daily_batch.py
```

---

## 四、应急操作

### 4.1 Mock 数据累积太多,想清空

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/reset" -Method Post
```

### 4.2 当天想重新跑 sanity check

```powershell
Remove-Item .\outputs\20260419\.sanity_checked
```

下次跑 daily_batch 会重新触发 sanity check。

### 4.3 sanity check 失败但必须立刻处理订单(仅限应急)

```powershell
python daily_batch.py --skip-sanity
```

**此时必须手动验证过溯源系统可达,否则可能把一堆失败写入搞混数据。**

---

## 五、保护机制总览(一张图看懂)

```
用户命令
    │
    ▼
daily_batch.py 启动
    │
    ├─ [护栏 0] 互斥参数校验 (--shuang-only vs --feishu-only)
    │
    ├─ [护栏 1] 当日首次自动跑 sanity_check
    │            │
    │            └─ 失败 → 退出码 4,禁止继续
    │
    ├─ 环境 banner(mock/staging/production 高亮提示)
    │
    ▼
ShuangClient 初始化
    │
    ├─ [护栏 2] production 环境 + 无 CONFIRM_PRODUCTION → 拒绝启动
    │
    ▼
batch_add_orders(orders)
    │
    ├─ [护栏 3] 分级规模保护
    │            ≤10:  无感
    │            ≤50:  警告
    │            ≤300 + production: 交互 Enter 确认
    │            >300 + 无 --yolo:  硬阻断
    │
    ├─ [护栏 4] 每条写入前后审计日志(JSONL)
    │
    ├─ [护栏 5] 失败率超过 MAX_FAIL_RATE → 立即中止
    │
    ▼
写入完成
    │
    ├─ get_zips_for_orders 按 (dealer, remark) 精确匹配
    │    未匹配的打印警告,不盲目下载错误 ZIP
    │
    ▼
报告生成 + 退出
```

**5 道护栏,每道都可独立阻断。** 这就是"100% 不影响生产"的工程实现。

---

## 六、常见退出码

| 退出码 | 含义 | 应对 |
|---|---|---|
| 0 | 成功 | 检查报告 |
| 1 | 找不到输入 Excel | 检查 inputs/ 目录 |
| 2 | ProductionGuardError(生产环境未二次确认) | 加 CONFIRM_PRODUCTION=YES_I_AM_SURE |
| 3 | BatchAbortError(失败率超阈值) | 检查 audit_shuang.jsonl |
| 4 | sanity_check 失败 | 先查 API 可达性 |
| 5 | LargeBatchError(超大批量未解锁) | 检查 Excel 异常,或加 --yolo |
| 130 | 用户 Ctrl+C | —— |

---

人是主驾,AI 是副驾@Clark
