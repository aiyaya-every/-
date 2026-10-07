'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 隔离快照目录，避免污染仓库。
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jobtrack-'));

const db = require('../src/db');
const { runCollection } = require('../src/collect/engine');

function freshDb() {
  db.initDb(':memory:');
  return db;
}

function uid(username) {
  return db.findUserByUsername(username).id;
}

function mkJob(identity, title, city, requirements, extra = {}) {
  return {
    identity: String(identity),
    title,
    company: '腾讯',
    city,
    requirements,
    deadline: null,
    status: 'open',
    detailUrl: 'https://careers.tencent.com/job.html?postId=' + identity,
    ...extra,
  };
}

async function collect(sourceId, jobs) {
  return runCollection({ sourceId, isReplay: true, replayLabel: 'test', replayJobs: jobs });
}

function findJobByIdentity(identity) {
  const src = db.getSourceBySourceId('tencent');
  return db.findJob(src.id, String(identity));
}

test('JOB-02 重复采集相同内容：不重复建档、不产生变更', async () => {
  freshDb();
  const r1 = await collect('tencent', [mkJob(1, '后端工程师', '深圳', '熟悉 Go')]);
  assert.strictEqual(r1.new_count, 1);
  assert.strictEqual(r1.changed_count, 0);

  const r2 = await collect('tencent', [mkJob(1, '后端工程师', '深圳', '熟悉 Go')]);
  assert.strictEqual(r2.new_count, 0);
  assert.strictEqual(r2.changed_count, 0);
  assert.strictEqual(r2.unchanged_count, 1);
  assert.strictEqual(db.countJobs(), 1);
  assert.strictEqual(db.getJobChanges(findJobByIdentity(1).id).length, 0);
});

test('JOB-03 同名不同 identity：保持独立，不按名称合并', async () => {
  freshDb();
  await collect('tencent', [
    mkJob(1, '工程师', '深圳', 'A'),
    mkJob(2, '工程师', '深圳', 'B'),
  ]);
  assert.strictEqual(db.countJobs(), 2);
  assert.ok(findJobByIdentity(1));
  assert.ok(findJobByIdentity(2));
});

test('JOB-04 仅关注者收到动态；前后值与时间可追溯', async () => {
  freshDb();
  await collect('tencent', [mkJob(1, '后端工程师', '深圳', 'v1'), mkJob(2, '前端工程师', '北京', 'v1')]);
  const alice = uid('alice');
  const bob = uid('bob');
  const jobA = findJobByIdentity(1);
  db.followJob(alice, jobA.id); // alice 关注 A，不关注 B；bob 不关注任何

  await collect('tencent', [
    mkJob(1, '后端工程师', '深圳', 'v2', { deadline: '2026-12-31', status: 'closed', explicitClosedEvidence: '官网标注已关闭' }),
    mkJob(2, '前端工程师', '北京', 'v2'),
  ]);

  // A 发生 3 处变更（requirements/deadline/status），B 发生 1 处
  assert.strictEqual(db.getJobChanges(jobA.id).length, 3);
  assert.strictEqual(db.listFeed(alice).length, 3); // 只关注了 A
  assert.strictEqual(db.listFeed(bob).length, 0);   // bob 未关注

  const statusChange = db.getJobChanges(jobA.id).find((c) => c.field === 'status');
  assert.strictEqual(statusChange.before, 'open');
  assert.strictEqual(statusChange.after, 'closed');
  assert.strictEqual(statusChange.evidence, '官网标注已关闭');
  assert.ok(statusChange.changed_at);

  const feedStatus = db.listFeed(alice).find((e) => e.field === 'status');
  assert.strictEqual(feedStatus.before, 'open');
  assert.strictEqual(feedStatus.after, 'closed');
});

test('JOB-05 关注前变化不补发；关注后仅见后续变化', async () => {
  freshDb();
  await collect('tencent', [mkJob(1, '后端工程师', '深圳', 'v1')]);
  const alice = uid('alice');
  const jobA = findJobByIdentity(1);

  // 关注前发生一次变化（无关注者，无动态）
  await collect('tencent', [mkJob(1, '后端工程师', '深圳', 'v2')]);
  assert.strictEqual(db.listFeed(alice).length, 0);

  db.followJob(alice, jobA.id);
  await collect('tencent', [mkJob(1, '后端工程师', '深圳', 'v3')]);

  const feed = db.listFeed(alice);
  assert.strictEqual(feed.length, 1);
  assert.strictEqual(feed[0].before, 'v2');
  assert.strictEqual(feed[0].after, 'v3');
});

test('JOB-06 取消关注后不再新增动态；已有动态保留', async () => {
  freshDb();
  await collect('tencent', [mkJob(1, '后端工程师', '深圳', 'v1')]);
  const alice = uid('alice');
  const jobA = findJobByIdentity(1);
  db.followJob(alice, jobA.id);

  await collect('tencent', [mkJob(1, '后端工程师', '深圳', 'v2')]);
  assert.strictEqual(db.listFeed(alice).length, 1);

  db.unfollowJob(alice, jobA.id);
  await collect('tencent', [mkJob(1, '后端工程师', '深圳', 'v3')]);

  const feed = db.listFeed(alice);
  assert.strictEqual(feed.length, 1);       // 不再新增
  assert.strictEqual(feed[0].before, 'v1'); // 已有动态保留
  assert.strictEqual(feed[0].after, 'v2');
});

test('JOB-07 列表缺失/来源失败：数据保留、不误关闭', async () => {
  freshDb();
  await collect('tencent', [mkJob(1, 'A', '深圳', 'v1'), mkJob(2, 'B', '北京', 'v1')]);
  const before = db.countJobs();

  // 列表缺失：job1 不在本次快照中
  const r = await collect('tencent', [mkJob(2, 'B', '北京', 'v1')]);
  assert.strictEqual(r.changed_count, 0);
  assert.strictEqual(db.countJobs(), before);
  const job1 = findJobByIdentity(1);
  assert.ok(job1);
  assert.strictEqual(job1.status, 'open'); // 未误判关闭

  // 来源失败：另一个来源记录失败，不影响已有数据
  const failRun = await runCollection({ sourceId: 'zhaopin', isReplay: true, replayKind: 'source_failure', failureReason: '模拟超时' });
  assert.strictEqual(failRun.status, 'failed');
  assert.strictEqual(failRun.error_code, 'SOURCE_FAILURE');
  assert.strictEqual(db.countJobs(), before);
});

test('JOB-08 用户数据隔离：B 无法读取/修改 A 的方案与动态', async () => {
  freshDb();
  await collect('tencent', [mkJob(1, 'A', '深圳', 'v1')]);
  const alice = uid('alice');
  const bob = uid('bob');
  const jobA = findJobByIdentity(1);
  db.followJob(alice, jobA.id);
  await collect('tencent', [mkJob(1, 'A', '深圳', 'v2')]);

  // alice 有动态、bob 无
  assert.ok(db.listFeed(alice).length > 0);
  assert.strictEqual(db.listFeed(bob).length, 0);

  // 筛选方案隔离
  const fid = db.createFilter(alice, '后端-深圳', '后端', '深圳');
  assert.strictEqual(db.listFilters(alice).length, 1);
  assert.strictEqual(db.listFilters(bob).length, 0);
  assert.strictEqual(db.getFilterOwn(bob, fid), undefined);   // bob 读取不到
  assert.strictEqual(db.updateFilter(bob, fid, { name: 'hack' }), false); // bob 改不了
  assert.strictEqual(db.deleteFilter(bob, fid), false);
});

test('JOB-09 筛选方案：保存/复用/修改/删除 + 搜索 AND 语义', async () => {
  freshDb();
  await collect('tencent', [
    mkJob(10, '后端工程师', '深圳', '熟悉 Go 与分布式'),
    mkJob(11, '前端工程师', '北京', '熟悉 React'),
    mkJob(12, '产品经理', '深圳', '数据产品'),
  ]);
  const alice = uid('alice');

  // 关键词匹配标题或要求；城市匹配；两者 AND
  assert.strictEqual(db.searchJobs({ keyword: '后端' }).length, 1);
  assert.strictEqual(db.searchJobs({ keyword: 'Go' }).length, 1);       // 匹配要求
  assert.strictEqual(db.searchJobs({ city: '深圳' }).length, 2);
  assert.strictEqual(db.searchJobs({ keyword: '工程师', city: '深圳' }).length, 1); // AND

  const fid = db.createFilter(alice, '深圳工程师', '工程师', '深圳');
  const f = db.getFilterOwn(alice, fid);
  assert.strictEqual(f.keyword, '工程师');
  assert.ok(db.updateFilter(alice, fid, { keyword: '产品' }));
  assert.strictEqual(db.getFilterOwn(alice, fid).keyword, '产品');
  assert.ok(db.deleteFilter(alice, fid));
  assert.strictEqual(db.listFilters(alice).length, 0);
});
