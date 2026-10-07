'use strict';

const express = require('express');
const { listFilters, createFilter, updateFilter, deleteFilter, getFilterOwn } = require('../db');
const { requireUser } = require('../auth');

const router = express.Router();
router.use(requireUser);

router.get('/', (req, res) => {
  res.json({ filters: listFilters(req.user.id) });
});

router.post('/', (req, res) => {
  const { name, keyword, city } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: '筛选方案名称不能为空' });
  }
  const id = createFilter(req.user.id, String(name).trim(), keyword ?? '', city ?? '');
  res.status(201).json({ filter: getFilterOwn(req.user.id, id) });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, keyword, city } = req.body || {};
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: '筛选方案名称不能为空' });
  }
  const ok = updateFilter(req.user.id, id, {
    name: name !== undefined ? String(name).trim() : undefined,
    keyword: keyword !== undefined ? keyword : undefined,
    city: city !== undefined ? city : undefined,
  });
  if (!ok) return res.status(404).json({ error: '筛选方案不存在或无权操作' });
  res.json({ filter: getFilterOwn(req.user.id, id) });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const ok = deleteFilter(req.user.id, id);
  if (!ok) return res.status(404).json({ error: '筛选方案不存在或无权操作' });
  res.json({ ok: true });
});

module.exports = router;
