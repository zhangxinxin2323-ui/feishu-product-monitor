#!/usr/bin/env node
// Usage: node run-monitor.mjs
// Reads ASINs from Feishu config table, scrapes each, writes results to tracking table.

import { execSync, execFileSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Configuration: read from env vars or .env file ---
// Users must set these before running:
//   FEISHU_BASE_TOKEN  - Feishu Bitable App token
//   FEISHU_CONFIG_TABLE - Table ID for ASIN config
//   FEISHU_TRACK_TABLE  - Table ID for tracking results
// Can be set via environment variables or a .env file in the scripts directory.

// Load .env file if exists
const envFile = join(__dirname, '.env');
try {
  const envContent = (await import('fs')).readFileSync(envFile, 'utf-8');
  envContent.split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}

const BASE_TOKEN = process.env.FEISHU_BASE_TOKEN;
const CONFIG_TABLE = process.env.FEISHU_CONFIG_TABLE;
const TRACK_TABLE = process.env.FEISHU_TRACK_TABLE;

if (!BASE_TOKEN || !CONFIG_TABLE || !TRACK_TABLE) {
  console.error(`Missing configuration. Please set environment variables or create scripts/.env file:

  FEISHU_BASE_TOKEN=your_base_token
  FEISHU_CONFIG_TABLE=your_config_table_id
  FEISHU_TRACK_TABLE=your_track_table_id

Get these from your Feishu Bitable URL: https://xxx.feishu.cn/base/<BASE_TOKEN>
`);
  process.exit(1);
}

const SCRAPE_SCRIPT = join(__dirname, "scrape-asin.mjs");
const DELAY_MS = 3000;

// 0. Pre-flight: ensure CDP proxy is ready
console.log("=== Checking CDP proxy ===");
try {
  const res = await fetch("http://localhost:3456/json/version");
  if (!res.ok) throw new Error("CDP proxy not responding");
  console.log("CDP proxy OK");
} catch (e) {
  console.error("CDP proxy not available at localhost:3456.");
  console.error("Please ensure Chrome remote debugging is enabled and web-access skill is installed.");
  process.exit(1);
}

function lark(cmd) {
  const out = execSync(`lark-cli base ${cmd}`, { encoding: 'utf-8', timeout: 30000 });
  return JSON.parse(out);
}

function larkWriteRecord(json) {
  // Write JSON to temp file in current directory (lark-cli requires relative path)
  const tmpFile = `_feishu_tmp_${Date.now()}.json`;
  writeFileSync(tmpFile, JSON.stringify(json));
  try {
    const out = execSync(`lark-cli base +record-upsert --base-token "${BASE_TOKEN}" --table-id "${TRACK_TABLE}" --json @${tmpFile}`, { encoding: 'utf-8', timeout: 30000 });
    return JSON.parse(out);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// 1. Read config table
console.log("=== Reading config table ===");
const config = lark(`+record-list --base-token "${BASE_TOKEN}" --table-id "${CONFIG_TABLE}"`);
const fields = config.data.fields;
const linkIdx = fields.indexOf("产品链接");
const statusIdx = fields.indexOf("监控状态");
const asinIdx = fields.indexOf("ASIN");
const nameIdx = fields.indexOf("产品名称");

const tasks = [];
for (let i = 0; i < config.data.data.length; i++) {
  const row = config.data.data[i];
  const recId = config.data.record_id_list[i];
  const status = Array.isArray(row[statusIdx]) ? row[statusIdx][0] : row[statusIdx];
  if (status !== "启用") continue;

  // Extract ASIN - prefer the dedicated ASIN field, fallback to extracting from link
  let asin = row[asinIdx] || "";
  if (!asin) {
    const link = row[linkIdx] || "";
    const m = link.match(/B0[A-Z0-9]{8}/);
    if (m) asin = m[0];
  }
  // Also extract ASIN from the end of link field (after markdown wrapper) as the "real" ASIN
  const linkRaw = row[linkIdx] || "";
  const linkAsin = linkRaw.match(/\)?(B0[A-Z0-9]{8})$/)?.[1];
  if (linkAsin) asin = linkAsin;
  if (!asin) continue;

  tasks.push({ asin, recId, name: row[nameIdx] || asin });
}

console.log(`Found ${tasks.length} active ASINs to scrape.\n`);

// 2. Scrape each ASIN
let success = 0, failed = 0;
const results = [];

for (const task of tasks) {
  console.log(`--- Scraping ${task.asin} (${task.name}) ---`);
  try {
    const raw = execSync(`node "${SCRAPE_SCRIPT}" ${task.asin}`, { encoding: 'utf-8', timeout: 120000 }).trim();
    const data = JSON.parse(raw);

    if (data.error) {
      console.log(`  FAIL: ${data.error}`);
      // Write failure record
      const ts = Date.now();
      larkWriteRecord({
        "ASIN": [{"id": task.recId}],
        "采集时间": ts,
        "状态": "失败",
        "错误信息": data.error
      });
      failed++;
      results.push({ asin: task.asin, status: "失败", error: data.error });
    } else {
      console.log(`  OK: $${data.price} | ${data.rating}★ | ${data.reviews} reviews | #${data.rank} ${data.cat}`);
      const ts = Date.now();
      larkWriteRecord({
        "ASIN": [{"id": task.recId}],
        "采集时间": ts,
        "价格": data.price,
        "评分": data.rating,
        "评论数": data.reviews,
        "库存状态": data.stock,
        "小类排名": data.rank,
        "状态": "成功",
        "优惠信息": data.promo,
        "类目名称": data.cat,
        "首页差评": data.negText,
        "页面完整性": data.comp
      });
      success++;
      results.push({ asin: task.asin, status: "成功", price: data.price, rank: data.rank, cat: data.cat });
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    failed++;
    results.push({ asin: task.asin, status: "失败", error: e.message.substring(0, 100) });
  }

  // Delay between ASINs
  if (tasks.indexOf(task) < tasks.length - 1) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

// 3. Summary
console.log(`\n=== Done ===`);
console.log(`Total: ${tasks.length} | Success: ${success} | Failed: ${failed}`);
console.log(`Feishu: https://rwl9zeyyr5o.feishu.cn/base/${BASE_TOKEN}`);
console.log(JSON.stringify(results, null, 2));
