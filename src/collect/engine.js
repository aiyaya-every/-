'use strict';

// 采集引擎：拉取 → 归一化 → 按 (来源 + identity) 去重 → 比较 requirements/deadline/status
// → 记录变更(前后值) → 物化关注动态 → 记录采集执行(run) + 保存原始快照。
const fs = require('node:fs');
const path = require('node:path');
const dbmod = require('../db');
const { now, sha256Hex } = require('../util');
const replay = require('./replay');

const SCRAPERS = {
  tencent: require('./tencent'),
  zhaopin: require('./zhaopin'),
};

const TRACKED_FIELDS = ['requirements', 'deadline', 'status'];

function valueKey(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** 比较已跟踪字段，返回 [{field, before, after}]（before/after 为原始值或 null）。 */
function diffTrackedFields(existing, incoming) {
  const diffs = [];
  for (const field of TRACKED_FIELDS) {
    const before = existing[field];
    const after = incoming[field];
    if (valueKey(before) !== valueKey(after)) {
      diffs.push({ field, before: before ?? null, after: after ?? null });
    }
  }
  return diffs;
}

/** 保存原始快照字节，返回相对路径与 SHA-256。 */
function saveSnapshot(sourceId, runId, rawText, isReplay) {
  const dir = path.join(dbmod.getDataDir(), 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${sourceId}-${runId}-${isReplay ? 'replay' : 'raw'}.json`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, rawText, 'utf8');
  const sha = sha256Hex(fs.readFileSync(full));
  return { relPath: path.join('data', 'snapshots', filename), sha, full };
}

/**
 * 执行一次采集/回放。
 * options:
 *   sourceId    来源 key（'tencent' | 'zhaopin'）
 *   isReplay    是否回放（默认 false）
 *   replayLabel 回放标注
 *   replayJobs  回放时直接提供的 jobs（跳过在线抓取）
 *   replayKind  'source_failure' 时模拟来源失败（保留已有数据）
 *   failureReason
 */
async function runCollection(options = {}) {
  const { sourceId, isReplay = false, replayLabel = null, replayJobs = null, replayKind = null, failureReason = null } = options;

  const source = dbmod.getSourceBySourceId(sourceId);
  if (!source) {
    const e = new Error('未知来源: ' + sourceId);
    e.code = 'UNKNOWN_SOURCE';
    throw e;
  }

  const startedAt = now();
  const runId = dbmod.createRun(source.id, startedAt, isReplay, replayLabel);

  // 来源失败：不触碰任何已有岗位，仅记录一条失败 run。
  if (replayKind === 'source_failure') {
    dbmod.finalizeRun(runId, {
      status: 'failed',
      errorCode: 'SOURCE_FAILURE',
      errorMessage: failureReason || '来源超时或不可达',
      fetchedCount: 0,
    });
    return dbmod.getRunById(runId);
  }

  let rawText = '';
  let jobs = [];
  let httpStatus = null;

  try {
    if (isReplay) {
      const parsed = replay.parseSnapshot({ sourceId, jobs: replayJobs });
      jobs = parsed.jobs;
      rawText = JSON.stringify({ sourceId, jobs: replayJobs }, null, 2);
      httpStatus = 200;
    } else {
      const scraper = SCRAPERS[sourceId];
      if (!scraper) {
        const e = new Error('未实现采集器: ' + sourceId);
        e.code = 'NO_SCRAPER';
        throw e;
      }
      const res = await scraper.collect();
      rawText = res.rawText;
      jobs = res.jobs.map(replay.normalizeJob).filter(Boolean);
      httpStatus = res.httpStatus;
    }

    const { relPath, sha } = saveSnapshot(sourceId, runId, rawText, isReplay);

    // 批内按 identity 去重。
    const seen = new Set();
    const valid = [];
    let failedCount = 0;
    for (const j of jobs) {
      if (!j.identity || !j.title) {
        failedCount++;
        continue;
      }
      if (seen.has(j.identity)) continue;
      seen.add(j.identity);
      valid.push(j);
    }

    let newCount = 0;
    let changedCount = 0;
    let unchangedCount = 0;
    const collectedAt = now();

    for (const j of valid) {
      const existing = dbmod.findJob(source.id, j.identity);
      if (!existing) {
        dbmod.insertJob(source.id, j, isReplay, collectedAt);
        newCount++;
        continue;
      }

      const diffs = diffTrackedFields(existing, j);
      if (diffs.length === 0) {
        dbmod.touchJob(existing.id, collectedAt);
        unchangedCount++;
        continue;
      }

      dbmod.updateJob(existing.id, j, isReplay, collectedAt);
      for (const d of diffs) {
        const changeId = dbmod.insertChange(existing.id, d.field, d.before, d.after, j.evidence ?? null, collectedAt, runId);
        // 物化给“此刻仍在关注”的用户；取消关注后不再新增，已有关注者立即可见。
        for (const f of dbmod.currentFollowers(existing.id)) {
          dbmod.insertFeedEvent(f.user_id, existing.id, changeId);
        }
      }
      changedCount++;
    }

    const status =
      failedCount > 0 && valid.length > 0 ? 'partial' : failedCount > 0 ? 'failed' : 'success';
    dbmod.finalizeRun(runId, {
      status,
      httpStatus,
      fetchedCount: jobs.length,
      validCount: valid.length,
      newCount,
      changedCount,
      unchangedCount,
      failedCount,
      snapshotPath: relPath,
      sha,
    });
    return dbmod.getRunById(runId);
  } catch (e) {
    dbmod.finalizeRun(runId, {
      status: 'failed',
      httpStatus,
      fetchedCount: jobs.length,
      errorCode: e.code || 'COLLECT_ERROR',
      errorMessage: e.message || String(e),
    });
    return dbmod.getRunById(runId);
  }
}

module.exports = { runCollection, diffTrackedFields, TRACKED_FIELDS, SCRAPERS };
