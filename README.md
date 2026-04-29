# feishu-product-monitor

Amazon 产品监控 Skill for Claude Code — 自动抓取 Amazon 产品页面数据，写入飞书多维表格。

## 功能

从飞书多维表格读取 ASIN 列表，通过 CDP 浏览器访问 Amazon 产品页面，提取以下数据并写回飞书追踪表：

| 数据项 | 说明 |
|--------|------|
| 价格 | 当前售价 (USD) |
| 评分 | 星级评分 |
| 评论数 | 总评论数 |
| 库存状态 | 有货 / 缺货 / 预售 |
| 小类排名 | BSR 小类排名（取第一个子类目） |
| 类目名称 | 底层类目名称 |
| 优惠信息 | Coupon / Deal / Subscribe & Save / 无 |
| 首页差评 | 产品页首页 1-3 星评论全文 |
| 页面完整性 | 完整 / 不完整（检查图片>=6、标题、Bullet Points、A+页面） |

每次采集都会在追踪表新增一条记录，保留完整历史数据。

## 前置要求

- **Node.js 22+**（使用原生 fetch）
- **Chrome 浏览器**，开启远程调试
- **CDP Proxy**（端口 3456）— 可通过 web-access skill 或其他 CDP proxy 提供
- **lark-cli**：飞书 CLI 工具
  ```bash
  npm install -g @anthropic-ai/lark-cli
  lark-cli auth login
  ```

## 安装

### 方式一：Claude Code Skill（推荐）

```bash
git clone https://github.com/zhangxinxin2323-ui/feishu-product-monitor.git ~/.claude/skills/feishu-product-monitor
```

### 方式二：手动复制

将 `SKILL.md` 和 `scripts/` 目录复制到 `~/.claude/skills/feishu-product-monitor/`。

## 配置

### 1. 创建飞书多维表格

在飞书中创建一个多维表格（Bitable），包含两个数据表：

**ASIN 信息配置表**（配置要监控的产品）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| ID | 自动编号 | 自增 |
| 产品链接 | 文本 | Amazon 完整 URL，如 `https://www.amazon.com/dp/B0BCVCCN6Q` |
| ASIN | 文本 | 产品 ASIN 码 |
| 监控状态 | 单选 | `启用` / `暂停` |
| 产品名称 | 文本 | 产品名称备注 |
| 备注 | 文本 | 可选备注 |

**ASIN 数据追踪表**（采集结果自动写入）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| ASIN | 关联 | 关联到配置表 |
| 采集时间 | 日期时间 | 采集时间戳 |
| 价格 | 数字 | 售价 (USD) |
| 评分 | 数字 | 星级 |
| 评论数 | 数字 | 总评论数 |
| 库存状态 | 单选 | 有货 / 缺货 / 预售 |
| 小类排名 | 数字 | BSR 小类排名 |
| 类目名称 | 文本 | 底层类目名称 |
| 优惠信息 | 单选 | Coupon / Deal 等 |
| 首页差评 | 文本 | 1-3 星评论全文 |
| 页面完整性 | 单选 | 完整 / 不完整 |
| 状态 | 单选 | 成功 / 失败 |
| 错误信息 | 文本 | 失败原因 |

### 2. 配置环境变量

复制 `.env.example` 到 `scripts/.env`，填入你的飞书表格信息：

```bash
cp .env.example scripts/.env
```

编辑 `scripts/.env`：

```
FEISHU_BASE_TOKEN=你的Base_Token
FEISHU_CONFIG_TABLE=你的配置表table_id
FEISHU_TRACK_TABLE=你的追踪表table_id
```

获取方式：打开飞书多维表格，URL 格式为 `https://xxx.feishu.cn/base/<BASE_TOKEN>?table=<TABLE_ID>`。

## 使用方法

### 方式一：在 Claude Code 中触发（推荐）

安装 Skill 后，直接对 Claude 说：

- `跑一下监控`
- `采集产品数据`
- `ASIN 采集`
- `抓取产品数据`

Claude 会自动执行完整采集流程并汇报结果。

### 方式二：命令行直接运行

```bash
node ~/.claude/skills/feishu-product-monitor/scripts/run-monitor.mjs
```

输出示例：
```
=== Checking CDP proxy ===
CDP proxy OK
=== Reading config table ===
Found 3 active ASINs to scrape.

--- Scraping B0BCVCCN6Q (产品A) ---
  OK: $26.99 | 4.6★ | 198 reviews | #453 Bathroom Trays
--- Scraping B0DG89B516 (产品B) ---
  OK: $18.99 | 4.6★ | 195 reviews | #21 Cabinet Door Organizers

=== Done ===
Total: 3 | Success: 3 | Failed: 0
```

### 方式三：采集单个 ASIN（调试用）

```bash
node ~/.claude/skills/feishu-product-monitor/scripts/scrape-asin.mjs B0BCVCCN6Q
```

输出：
```json
{
  "price": 26.99,
  "rating": 4.6,
  "reviews": 198,
  "stock": "有货",
  "rank": 453,
  "cat": "Bathroom Trays, Holders, & Organizers",
  "promo": "无",
  "negText": "无",
  "comp": "完整"
}
```

### 方式四：定时采集

在 Claude Code 中使用 loop skill：

```
/loop 24h 执行产品监控采集
```

## 工作原理

```
飞书配置表 --> lark-cli 读取 ASIN 列表
                |
         CDP Proxy (localhost:3456)
                |
      Chrome 打开 Amazon 产品页
                |
      JS eval 提取页面数据
                |
      lark-cli 写入飞书追踪表
```

1. `run-monitor.mjs` 通过 lark-cli 读取配置表中监控状态=启用的记录
2. 对每个 ASIN，调用 `scrape-asin.mjs` 通过 CDP Proxy 打开 Amazon 页面
3. 页面加载后滚动到底部加载 BSR 和评论区域
4. 使用 JS eval 提取价格、评分、排名等 10 项数据
5. 通过 lark-cli 将结果写入追踪表（每次新增一条，保留历史）
6. 采集失败时记录错误信息，继续处理下一个 ASIN

## 文件结构

```
feishu-product-monitor/
├── SKILL.md              # Claude Code Skill 定义
├── README.md             # 本文件
├── .env.example          # 环境变量模板
├── .gitignore            # 忽略 .env 等敏感文件
└── scripts/
    ├── run-monitor.mjs   # 主流程：读取飞书 -> 批量采集 -> 写回飞书
    ├── scrape-asin.mjs   # 单 ASIN 采集：CDP 打开页面 -> 提取数据 -> 输出 JSON
    └── .env              # 你的飞书配置（不会上传到 git）
```

## 常见问题

**Q: CDP proxy 连不上？**
确保 Chrome 已开启远程调试，且 CDP proxy 在 localhost:3456 运行。

**Q: lark-cli 报错？**
运行 `lark-cli auth login` 重新登录飞书。

**Q: 某个 ASIN 采集失败？**
脚本会自动跳过失败的 ASIN 继续采集，失败原因会记录在飞书追踪表的"错误信息"字段。

**Q: 如何添加新的监控产品？**
在飞书配置表中新增一行，填入 ASIN 和产品链接，监控状态设为"启用"即可。

## License

MIT
