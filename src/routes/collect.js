'use strict';

const express = require('express');
const { listSources, listRuns, getLastRunForSource, getSourceBySourceId } = require('../db');
const { requireUser, requireMaintainer } = require('../auth');
const { runCollection } = require('../collect/engine');

const router = express.Router();
router.use(requireUser, requireMaintainer);

router.get('/sources', (req, res) => {
  const sources = listSources().map((s) => ({ ...s, lastRun: getLastRunForSource(s.id) || null }));
  res.json({ sources });
});

router.get('/collect/runs', (req, res) => {
  res.json({ runs: listRuns(100) });
});

router.post('/collect', async (req, res, next) => {
  try {
    const { sourceId, all } = req.body || {};
    if (all) {
      const sources = listSources();
      const results = [];
      for (const s of sources) {
        results.push(await runCollection({ sourceId: s.source_id }));
      }
      return res.json({ results });
    }
    if (!sourceId) return res.status(400).json({ error: '缺少 sourceId 或 all' });
    if (!getSourceBySourceId(sourceId)) return res.status(400).json({ error: '未知来源: ' + sourceId });
    const run = await runCollection({ sourceId });
    res.json({ run });
  } catch (e) {
    next(e);
  }
});

router.post('/collect/replay', async (req, res, next) => {
  try {
    const { sourceId, jobs, label, kind, failureReason } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: '缺少 sourceId' });
    if (!getSourceBySourceId(sourceId)) return res.status(400).json({ error: '未知来源: ' + sourceId });

    if (kind === 'source_failure') {
      const run = await runCollection({
        sourceId,
        isReplay: true,
        replayLabel: label || '回放：来源失败',
        replayKind: 'source_failure',
        failureReason,
      });
      return res.json({ run });
    }

    if (!Array.isArray(jobs)) return res.status(400).json({ error: '回放快照需要 jobs 数组' });
    const run = await runCollection({
      sourceId,
      isReplay: true,
      replayLabel: label || '回放快照',
      replayJobs: jobs,
    });
    res.json({ run });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
