---
name: feishu-product-monitor
description: "Amazon产品监控：从飞书多维表格读取ASIN列表，通过CDP浏览器打开Amazon产品页面抓取数据（价格、评分、评论数、库存、小类排名、类目、优惠、差评、页面完整性），写回飞书追踪表。支持手动触发和每日自动采集。当用户提到'产品监控'、'ASIN采集'、'抓取产品数据'、'Amazon数据同步到飞书'、'产品数据追踪'、'跑一下监控'、'采集产品信息'时触发此技能。"
---

# Amazon 产品监控 → 飞书多维表格

从飞书多维表格读取待监控ASIN列表，通过浏览器CDP访问Amazon产品页面，提取关键指标，将结果写回飞书追踪表。每次采集都新增一条记录，保留完整历史。

## 权限配置（已在 settings.json 中配置，无需手动确认）

以下命令已加入全局 `permissions.allow`，执行时不会弹出确认：
- `curl -s http://localhost:3456:*` — CDP proxy 所有请求
- `curl -s -X POST "http://localhost:3456:*"` — CDP proxy POST 请求
- `lark-cli base:*` — 飞书多维表格所有操作
- `node "C:/Users/oo/.claude/skills/web-access:*"` — web-access 脚本

## 优惠信息判断原则

**只识别产品本身的优惠，忽略Amazon平台通用文案。** 以下内容不算优惠：
- "Get Fast, Free Shipping with Amazon Prime" — 平台通用
- "FREE Returns" — 平台通用
- "Get $50 off instantly: Pay $0.00 upon approval for Amazon Visa" — 信用卡促销，非产品优惠
- "Save X% with Subscribe & Save discount" 但无 S&S 专属UI组件 — 不算

必须通过**DOM元素检测**而非全文搜索来判断优惠类型。

## 飞书表格配置

```
Base Token: InWmbEcLJaln9Msoon8cDnZcnWe
配置表 (ASIN信息配置表): tblLn2TAEblG2aUG
追踪表 (ASIN数据追踪表): tblPIVltaQ6YJmjj
```

### 配置表字段

| 字段 | Field ID | 类型 | 说明 |
|------|----------|------|------|
| ID | fldj7PsWe3 | auto_number | 自增编号 |
| ASIN | fldKkP7i8L (索引字段,实际name="产品链接") | text | 产品ASIN码 |
| 产品链接 | fldKfnkF05 | text | Amazon完整产品URL（如 https://www.amazon.com/dp/B0xxx） |
| 监控状态 | fld2WLvYep | select | 启用/暂停 |
| 备注 | fldGjWfLZi | text | 备注 |
| 产品名称 | fldO2V1IjE | text | 产品名称 |

### 追踪表字段

| 字段 | Field ID | 类型 | 说明 |
|------|----------|------|------|
| ASIN | fldATO6Ne8 | link | 关联配置表 |
| 采集时间 | fld0jnCEFa | datetime | 毫秒时间戳 |
| 价格 | fldgMzVgi6 | number | 当前售价(USD) |
| 评分 | fld3LBzjwq | number | 星级评分 |
| 评论数 | fldIUzm3Hh | number | 总评论数 |
| 库存状态 | fldQNKVlU7 | select | 有货/缺货/预售 |
| 小类排名 | fldDGple2c | number | BSR小类排名(取第一个) |
| 状态 | fldz0Vwqs2 | select | 成功/失败 |
| 错误信息 | fld9IH21TU | text | 失败原因 |
| 优惠信息 | fld2u7n7Nx | select | 优惠类型 |
| 类目节点 | fldRhi0M2f | text | 底层类目节点ID |
| 类目名称 | fldoppaPC4 | text | 底层类目名称(如Wireless Earbuds) |
| 首页差评 | fldQhvVRlu | text | 首页1-3星评论全文,无则标记"无" |
| 页面完整性 | fldBajiKMX | select | 完整/不完整 |

## 执行流程

### 1. 读取待采集ASIN列表

用 lark-cli 从配置表读取监控状态=启用的记录：

```bash
lark-cli base +record-list --base-token "InWmbEcLJaln9Msoon8cDnZcnWe" --table-id "tblLn2TAEblG2aUG"
```

筛选 `监控状态 == "启用"` 的记录，提取每条记录的：
- record_id（用于关联追踪表）
- 产品链接 URL（直接用于打开页面，无需拼接）

### 2. 启动CDP浏览器并逐个采集

**必须加载 web-access skill 并遵循其指引。**

先运行前置检查：
```bash
node "C:/Users/oo/.claude/skills/web-access/scripts/check-deps.mjs"
```

对每个ASIN：

1. 用 `/new` 打开产品页面
2. 等待页面加载完成
3. 用 `/eval` 提取数据（见下方提取逻辑）
4. 提取完成后 `/close` 关闭tab
5. 将数据写入飞书追踪表
6. 如果采集失败，记录错误信息，继续下一个ASIN

**节奏控制**：每个ASIN之间间隔2-3秒，避免触发Amazon反爬。

### 3. 页面数据提取

打开Amazon产品页面后，用 `/eval` 执行JS提取以下数据。注意：Amazon页面结构可能变化，应根据实际DOM调整选择器，不要死板套用。下方是常见模式参考：

#### 价格
```javascript
// 常见位置：.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .priceToPay
(() => {
  const el = document.querySelector('.priceToPay .a-offscreen, .a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .apexPriceToPay .a-offscreen');
  if (!el) return null;
  const text = el.textContent.trim();
  const match = text.match(/[\d,.]+/);
  return match ? parseFloat(match[0].replace(/,/g, '')) : null;
})()
```

#### 评分和评论数
```javascript
(() => {
  const ratingEl = document.querySelector('#acrPopover .a-icon-alt, [data-hook="rating-out-of-text"]');
  const reviewEl = document.querySelector('#acrCustomerReviewText, [data-hook="total-review-count"]');
  const rating = ratingEl ? parseFloat(ratingEl.textContent.match(/[\d.]+/)?.[0]) : null;
  const reviews = reviewEl ? parseInt(reviewEl.textContent.replace(/[^\d]/g, '')) : null;
  return JSON.stringify({ rating, reviews });
})()
```

#### 库存状态
```javascript
(() => {
  const avail = document.querySelector('#availability, #outOfStock');
  if (!avail) return '有货';
  const text = avail.textContent.toLowerCase().trim();
  if (text.includes('in stock') || text.includes('available')) return '有货';
  if (text.includes('out of stock') || text.includes('unavailable')) return '缺货';
  if (text.includes('pre-order')) return '预售';
  return '有货';
})()
```

#### 小类排名 + 类目名称 + 类目节点
需要滚动到 Product Information / Product Details 区域。BSR信息在 `#productDetails_detailBullets_sections1` 或 `#detailBulletsWrapper_feature_div` 中。

```javascript
(() => {
  // 找 Best Sellers Rank 区域
  const tables = document.querySelectorAll('table, .detail-bullet-list');
  let bsrText = '';
  document.querySelectorAll('th, .a-text-bold, span').forEach(el => {
    if (el.textContent.includes('Best Sellers Rank')) {
      bsrText = el.closest('tr, li, .a-section')?.textContent || '';
    }
  });

  // 提取第一个小类排名
  const rankMatch = bsrText.match(/#([\d,]+)\s+in\s+([^\(]+?)(?:\s*\(|$)/);
  const rank = rankMatch ? parseInt(rankMatch[1].replace(/,/g, '')) : null;
  const categoryName = rankMatch ? rankMatch[2].trim() : null;

  // 类目节点ID from link
  const catLink = bsrText.match(/node=([\d]+)/);
  const nodeId = catLink ? catLink[1] : null;

  return JSON.stringify({ rank, categoryName, nodeId });
})()
```

#### 优惠信息
关键原则：只识别**产品本身的优惠**，忽略Amazon平台通用文案（如Prime免运费、Amazon Visa信用卡、Free Returns等）。必须通过DOM元素而非全文搜索来判断。

```javascript
(() => {
  // Coupon — 只看产品优惠券的专属DOM元素
  if (document.querySelector('#couponTextpct498, #couponTextpctoff, .couponBadge, [id^="couponText"], .a-color-success[data-csa-c-coupon]')) return 'Coupon';

  // Lightning Deal / Deal of the Day — 只看deal专属badge
  if (document.querySelector('#dealBadge, .dealBadge, [data-deal-badge], #dealprice_feature_div')) return 'Lightning Deal';

  // Subscribe & Save — 只看S&S专属区域
  if (document.querySelector('#snsDetailPageVariation, .sns-base-price, #sns-base-price, #accordionRow_0 .sns-widget')) return 'Subscribe & Save';

  // Prime Exclusive — 只看价格区域的Prime Exclusive标记
  const priceArea = document.querySelector('#apex_desktop, #corePrice_feature_div, #ppd');
  if (priceArea && /Prime Exclusive/i.test(priceArea.textContent)) return 'Prime Exclusive';

  // Buy One Get One — 只看促销区域
  const promoArea = document.querySelector('#applicable_promotion_list_sec, .promoPriceBlockMessage');
  if (promoArea && /buy\s+\d+.*get\s+\d+/i.test(promoArea.textContent)) return 'Buy One Get One';

  // 其他明确促销
  if (document.querySelector('#applicable_promotion_list_sec .promoPriceBlockMessage')) return 'Promotion';

  return '无';
})()
```

#### 首页差评（1-3星评论）
```javascript
(() => {
  const reviews = [];
  document.querySelectorAll('[data-hook="review"]').forEach(r => {
    const starEl = r.querySelector('[data-hook="review-star-rating"] .a-icon-alt, .review-rating .a-icon-alt');
    if (!starEl) return;
    const stars = parseFloat(starEl.textContent.match(/[\d.]+/)?.[0] || '5');
    if (stars <= 3) {
      const body = r.querySelector('[data-hook="review-body"] span')?.textContent?.trim() || '';
      const title = r.querySelector('[data-hook="review-title"] span')?.textContent?.trim() || '';
      if (body) reviews.push(`[${stars}星] ${title}: ${body}`);
    }
  });
  return reviews.length > 0 ? reviews.join('\n---\n') : '无';
})()
```

#### 页面完整性
判断标准：图片≥6张、有标题、有五点描述(bullet points)、有A+页面。缺少任何一项即为"不完整"。

```javascript
(() => {
  const hasTitle = !!document.querySelector('#productTitle, #title');
  const images = document.querySelectorAll('#altImages .a-button-thumbnail img, .imgTagWrapper img, #imageBlock img');
  const hasEnoughImages = images.length >= 6;
  const bullets = document.querySelectorAll('#feature-bullets li:not(.aok-hidden), #feature-bullets .a-list-item');
  const hasBullets = bullets.length >= 3;
  const hasAPlus = !!document.querySelector('#aplus, #aplus_feature_div, .aplus-v2, #aplusBrandStory_feature_div');

  const isComplete = hasTitle && hasEnoughImages && hasBullets && hasAPlus;
  return JSON.stringify({
    complete: isComplete ? '完整' : '不完整',
    details: { hasTitle, imageCount: images.length, bulletCount: bullets.length, hasAPlus }
  });
})()
```

### 4. 写入飞书追踪表

每个ASIN采集完成后，立即写入一条追踪记录：

```bash
lark-cli base +record-create --base-token "InWmbEcLJaln9Msoon8cDnZcnWe" --table-id "tblPIVltaQ6YJmjj" --json '{
  "fields": {
    "ASIN": {"record_ids": ["RECORD_ID_FROM_CONFIG"]},
    "采集时间": TIMESTAMP_MS,
    "价格": 29.99,
    "评分": 4.5,
    "评论数": 1234,
    "库存状态": "有货",
    "小类排名": 156,
    "状态": "成功",
    "优惠信息": "Coupon",
    "类目节点": "123456789",
    "类目名称": "Wireless Earbuds",
    "首页差评": "差评内容...",
    "页面完整性": "完整"
  }
}'
```

**关联字段格式**：ASIN字段是link类型，值格式为 `{"record_ids": ["recXXX"]}`。

**采集失败时**：
```bash
lark-cli base +record-create --base-token "..." --table-id "..." --json '{
  "fields": {
    "ASIN": {"record_ids": ["RECORD_ID"]},
    "采集时间": TIMESTAMP_MS,
    "状态": "失败",
    "错误信息": "页面加载超时 / 元素未找到 / 等具体原因"
  }
}'
```

## 并行策略

当ASIN数量 > 3 时，可以分给子Agent并行处理。每个子Agent负责一批ASIN（建议每批3-5个），自行创建tab、采集、写入飞书、关闭tab。

子Agent prompt要点：
- 必须加载 web-access skill 并遵循指引
- 明确给出ASIN列表、配置表record_id映射、飞书token信息
- 描述目标（"采集这些ASIN的产品数据并写入飞书"），不限定具体步骤

## 采集完成后

汇总本次采集结果，向用户报告：
- 总计采集 N 个ASIN
- 成功 X 个，失败 Y 个
- 失败ASIN及原因列表
- 飞书表格链接：https://rwl9zeyyr5o.feishu.cn/base/InWmbEcLJaln9Msoon8cDnZcnWe

## 触发方式

**手动触发**（在 Claude Code 中直接说）：
- `跑一下监控`
- `采集产品数据`
- `ASIN采集`

**定时执行**（配合 loop skill）：
```
/loop 24h 执行产品监控采集
```
