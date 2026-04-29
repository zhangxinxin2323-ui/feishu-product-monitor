---
name: feishu-product-monitor
description: "Amazon产品监控：从飞书多维表格读取ASIN列表，通过CDP浏览器打开Amazon产品页面抓取数据（价格、评分、评论数、库存、小类排名、类目、优惠、差评、页面完整性），写回飞书追踪表。支持手动触发和每日自动采集。当用户提到'产品监控'、'ASIN采集'、'抓取产品数据'、'Amazon数据同步到飞书'、'产品数据追踪'、'跑一下监控'、'采集产品信息'时触发此技能。"
---

# Amazon 产品监控 → 飞书多维表格

从飞书多维表格读取待监控ASIN列表，通过浏览器CDP访问Amazon产品页面，提取关键指标，将结果写回飞书追踪表。每次采集都新增一条记录，保留完整历史。

## 配置

用户需要在 `scripts/.env` 中配置自己的飞书表格信息（参考 `.env.example`）：

```
FEISHU_BASE_TOKEN=your_base_token
FEISHU_CONFIG_TABLE=your_config_table_id
FEISHU_TRACK_TABLE=your_track_table_id
```

## 执行流程

### 一键运行

```bash
node scripts/run-monitor.mjs
```

脚本会自动：
1. 检查 CDP proxy 是否就绪
2. 从飞书配置表读取监控状态=启用的 ASIN
3. 逐个打开 Amazon 产品页面采集数据
4. 将结果写入飞书追踪表
5. 输出采集汇总

### 采集单个 ASIN（调试用）

```bash
node scripts/scrape-asin.mjs B0BCVCCN6Q
```

## 优惠信息判断原则

**只识别产品本身的优惠，忽略Amazon平台通用文案。** 以下内容不算优惠：
- "Get Fast, Free Shipping with Amazon Prime" — 平台通用
- "FREE Returns" — 平台通用
- "Get $50 off instantly: Pay $0.00 upon approval for Amazon Visa" — 信用卡促销

必须通过**DOM元素检测**而非全文搜索来判断优惠类型。

## 飞书表格结构

### 配置表字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ID | auto_number | 自增编号 |
| 产品链接 | text | Amazon完整产品URL |
| ASIN | text | 产品ASIN码 |
| 监控状态 | select | 启用/暂停 |
| 产品名称 | text | 产品名称 |
| 备注 | text | 备注 |

### 追踪表字段

| 字段 | 类型 | 说明 |
|------|------|------|
| ASIN | link | 关联配置表 |
| 采集时间 | datetime | 毫秒时间戳 |
| 价格 | number | 当前售价(USD) |
| 评分 | number | 星级评分 |
| 评论数 | number | 总评论数 |
| 库存状态 | select | 有货/缺货/预售 |
| 小类排名 | number | BSR小类排名 |
| 类目名称 | text | 底层类目名称 |
| 优惠信息 | select | 优惠类型 |
| 首页差评 | text | 首页1-3星评论全文 |
| 页面完整性 | select | 完整/不完整 |
| 状态 | select | 成功/失败 |
| 错误信息 | text | 失败原因 |

## 触发方式

**手动触发**（在 Claude Code 中直接说）：
- `跑一下监控`
- `采集产品数据`
- `ASIN采集`

**定时执行**（配合 loop skill）：
```
/loop 24h 执行产品监控采集
```
