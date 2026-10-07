'use strict';

// 一次性采集 + 证据导出脚本。
// 用法：node scripts/collect.js [sourceId...]   （默认 tencent zhaopin）
// 需要可访问真实网络的机器运行；随后把采集结果落到 evidence/ 目录。
const fs = require('node:fs');
const path = require('node:path');
const { initDb, listRuns, listSources, searchJobs } = require('../src/db');
const { runCollection } = require('../src/collect/engine');
const { csvRow } = require('../src/util');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const EVIDENCE_DIR = path.join(ROOT, 'evidence');
const SNAPSHOT_DIR = path.join(EVIDENCE_DIR, 'snapshots');

function main() {
  const args = process.argv.slice(2).filter(Boolean);
  const sources = args.length ? args : ['tencent', 'zhaopin'];

  initDb(path.join(DATA_DIR, 'app.db'));
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  (async () => {
    for (const s of sources) {
      process.stdout.write(`正在采集 ${s} ... `);
      try {
        const run = await runCollection({ sourceId: s });
        console.log(`${run.status}  新增=${run.new_count} 更新=${run.changed_count} 无变化=${run.unchanged_count} 失败=${run.failed_count}`);
        if (run.status === 'failed') console.log(`  错误: ${run.error_code || ''} ${run.error_message || ''}`);
      } catch (e) {
        console.log('异常: ' + e.message);
      }
    }
    exportEvidence();
    console.log('\n证据已导出到 evidence/');
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

/** 把数据目录下的原始快照复制到 evidence/snapshots/，并返回 {filename -> sha}。 */
function syncSnapshots() {
  const srcDir = path.join(DATA_DIR, 'snapshots');
  const map = {};
  if (!fs.existsSync(srcDir)) return map;
  for (const f of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, f);
    const dst = path.join(SNAPSHOT_DIR, f);
    fs.copyFileSync(src, dst);
    map[f] = require('../src/util').sha256Hex(fs.readFileSync(dst));
  }
  return map;
}

function exportEvidence() {
  const shaByFile = syncSnapshots();
  const runs = listRuns(10000).filter((r) => !r.is_replay); // 真实采集的 run
  const sources = listSources();

  // collection-runs.csv（每次、每个来源一行）
  const runHeader = [
    'run_id', 'source_id', 'source_type', 'entry_url', 'started_at', 'finished_at',
    'status', 'http_status', 'fetched_count', 'valid_count', 'new_count', 'changed_count',
    'unchanged_count', 'failed_count', 'raw_snapshot_path', 'raw_sha256', 'error_code', 'error_message',
  ];
  const runRows = runs.map((r) => {
    const fname = r.raw_snapshot_path ? path.basename(r.raw_snapshot_path) : null;
    return csvRow([
      `run-${r.id}`, r.source_key, r.source_type, r.entry_url || '', r.started_at, r.finished_at || '',
      r.status, r.http_status != null ? r.http_status : '', r.fetched_count, r.valid_count,
      r.new_count, r.changed_count, r.unchanged_count, r.failed_count,
      fname ? `evidence/snapshots/${fname}` : '', fname ? (shaByFile[fname] || r.raw_sha256) : '',
      r.error_code || '', r.error_message || '',
    ]);
  });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'collection-runs.csv'), '﻿' + runHeader.join(',') + '\n' + runRows.join('\n') + '\n', 'utf8');

  // source-evidence.csv（每个来源一行）
  const srcHeader = [
    'source_id', 'source_type', 'source_name', 'entry_url', 'company_official_evidence_url',
    'collection_run_id', 'valid_unique_jobs', 'collected_at', 'sample_detail_urls',
    'snapshot_path', 'snapshot_sha256', 'collection_method', 'access_notes',
  ];
  const srcRows = sources.map((s) => {
    const latest = runs.filter((r) => r.source_id === s.id).sort((a, b) => b.id - a.id)[0];
    const jobs = searchJobs({ sourceId: s.source_id });
    const fname = latest && latest.raw_snapshot_path ? path.basename(latest.raw_snapshot_path) : null;
    return csvRow([
      s.source_id, s.source_type, s.name, s.entry_url,
      s.source_type === 'company_careers' ? companyEvidenceUrl(s.source_id) : '',
      latest ? `run-${latest.id}` : '', jobs.length,
      latest && latest.finished_at ? latest.finished_at : '',
      jobs.slice(0, 5).map((j) => j.detail_url).filter(Boolean).join(';'),
      fname ? `evidence/snapshots/${fname}` : '', fname ? (shaByFile[fname] || '') : '',
      collectionMethod(s.source_id), accessNotes(s.source_id),
    ]);
  });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'source-evidence.csv'), '﻿' + srcHeader.join(',') + '\n' + srcRows.join('\n') + '\n', 'utf8');
}

function companyEvidenceUrl(sourceId) {
  // 官方站需给出“公司官网指向招聘入口”的可核对依据。
  return sourceId === 'tencent' ? 'https://careers.tencent.com/' : '';
}
function collectionMethod(sourceId) {
  return sourceId === 'tencent'
    ? '公开接口 careers.tencent.com/tencentcareer/api/post/Query'
    : '搜索页 www.zhaopin.com/sou（SSR，内嵌 __INITIAL_STATE__.positionList）';
}
function accessNotes(sourceId) {
  return sourceId === 'tencent'
    ? '无需登录；GET 单页 pageSize=30；请求间隔约 1s'
    : '无需登录；请求 sou.zhaopin.com/?kw=… 跟随重定向解析 SSR 页面；按关键词轮询（Java/前端/产品经理）；按 number 去重';
}

main();
