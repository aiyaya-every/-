'use strict';

const express = require('express');
const {
  searchJobs,
  getJobById,
  getJobChanges,
  isFollowing,
  followJob,
  unfollowJob,
  distinctCities,
} = require('../db');
const { requireUser } = require('../auth');

const router = express.Router();
router.use(requireUser);

router.get('/', (req, res) => {
  const { keyword, city, sourceType, sourceId } = req.query;
  const jobs = searchJobs({ keyword, city, sourceType, sourceId });
  const followed = new Set(
    require('../db').listFollowedJobIds(req.user.id)
  );
  res.json({ jobs: jobs.map((j) => ({ ...j, followed: followed.has(j.id) })) });
});

router.get('/cities', (req, res) => {
  res.json({ cities: distinctCities() });
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '非法岗位 ID' });
  const job = getJobById(id);
  if (!job) return res.status(404).json({ error: '岗位不存在' });
  const changes = getJobChanges(id);
  res.json({ job: { ...job, followed: isFollowing(req.user.id, id) }, changes });
});

router.post('/:id/follow', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !getJobById(id)) return res.status(404).json({ error: '岗位不存在' });
  followJob(req.user.id, id);
  res.json({ ok: true, followed: true });
});

router.delete('/:id/follow', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '非法岗位 ID' });
  unfollowJob(req.user.id, id);
  res.json({ ok: true, followed: false });
});

module.exports = router;
