'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { now, hashPassword } = require('./util');

let db = null;
let dataDir = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  name TEXT NOT NULL,
  entry_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  identity TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  city TEXT,
  requirements TEXT,
  deadline TEXT,
  status TEXT,
  detail_url TEXT,
  is_replay INTEGER NOT NULL DEFAULT 0,
  last_collected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, identity)
);
CREATE TABLE IF NOT EXISTS job_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  field TEXT NOT NULL,
  before TEXT,
  after TEXT,
  evidence TEXT,
  changed_at TEXT NOT NULL,
  run_id INTEGER
);
CREATE TABLE IF NOT EXISTS follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  followed_at TEXT NOT NULL,
  unfollowed_at TEXT,
  UNIQUE(user_id, job_id)
);
CREATE TABLE IF NOT EXISTS feed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  change_id INTEGER NOT NULL REFERENCES job_changes(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  keyword TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  http_status INTEGER,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  raw_snapshot_path TEXT,
  raw_sha256 TEXT,
  is_replay INTEGER NOT NULL DEFAULT 0,
  replay_label TEXT
);
`;

const DEFAULT_USERS = [
  { username: 'maintainer', password: 'maintainer123', role: 'maintainer', display_name: '数据维护员' },
  { username: 'alice', password: 'alice123', role: 'user', display_name: 'Alice' },
  { username: 'bob', password: 'bob123', role: 'user', display_name: 'Bob' },
];

const DEFAULT_SOURCES = [
  { source_id: 'tencent', source_type: 'company_careers', name: '腾讯招聘', entry_url: 'https://careers.tencent.com/' },
  { source_id: 'zhaopin', source_type: 'recruitment_platform', name: '智联招聘', entry_url: 'https://www.zhaopin.com/' },
];

function initDb(dbPath, { seed = true } = {}) {
  if (dbPath !== ':memory:') {
    dataDir = path.dirname(dbPath);
    fs.mkdirSync(dataDir, { recursive: true });
  } else {
    dataDir = process.env.DATA_DIR || '.';
  }
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  if (seed) seedDb();
  return db;
}

function getDb() {
  if (!db) throw new Error('DB 尚未初始化');
  return db;
}

function getDataDir() {
  return dataDir;
}

function seedDb() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c === 0) {
    const ins = db.prepare(
      'INSERT INTO users (username, password_hash, role, display_name, created_at) VALUES (?,?,?,?,?)'
    );
    for (const u of DEFAULT_USERS) {
      ins.run(u.username, hashPassword(u.password), u.role, u.display_name, now());
    }
  }
  const s = db.prepare('SELECT COUNT(*) AS c FROM sources').get();
  if (s.c === 0) {
    const ins = db.prepare(
      'INSERT INTO sources (source_id, source_type, name, entry_url) VALUES (?,?,?,?)'
    );
    for (const src of DEFAULT_SOURCES) {
      ins.run(src.source_id, src.source_type, src.name, src.entry_url);
    }
  }
}

// ---------------- users ----------------
function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}
function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// ---------------- sources ----------------
function listSources() {
  return db.prepare('SELECT * FROM sources ORDER BY id').all();
}
function getSourceBySourceId(sourceId) {
  return db.prepare('SELECT * FROM sources WHERE source_id = ?').get(sourceId);
}
function getSourceById(id) {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
}

// ---------------- jobs ----------------
function findJob(sourceId, identity) {
  return db.prepare('SELECT * FROM jobs WHERE source_id = ? AND identity = ?').get(sourceId, identity);
}
function insertJob(sourceId, job, isReplay, collectedAt) {
  const t = now();
  const r = db
    .prepare(
      `INSERT INTO jobs
       (source_id, identity, title, company, city, requirements, deadline, status, detail_url, is_replay, last_collected_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      sourceId, job.identity, job.title, job.company ?? '', job.city ?? null,
      job.requirements ?? null, job.deadline ?? null, job.status ?? null,
      job.detailUrl ?? null, isReplay ? 1 : 0, collectedAt, t, t
    );
  return Number(r.lastInsertRowid);
}
function updateJob(id, job, isReplay, collectedAt) {
  db
    .prepare(
      `UPDATE jobs SET title=?, company=?, city=?, requirements=?, deadline=?, status=?, detail_url=?, is_replay=?, last_collected_at=?, updated_at=? WHERE id=?`
    )
    .run(
      job.title, job.company ?? '', job.city ?? null, job.requirements ?? null,
      job.deadline ?? null, job.status ?? null, job.detailUrl ?? null,
      isReplay ? 1 : 0, collectedAt, now(), id
    );
}
function touchJob(id, collectedAt) {
  db.prepare('UPDATE jobs SET last_collected_at=?, updated_at=? WHERE id=?').run(collectedAt, now(), id);
}

function searchJobs({ keyword, city, sourceType, sourceId } = {}) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(j.title LIKE ? OR j.requirements LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw);
  }
  if (city) {
    where.push('j.city LIKE ?');
    params.push(`%${city}%`);
  }
  if (sourceType) {
    where.push('s.source_type = ?');
    params.push(sourceType);
  }
  if (sourceId) {
    where.push('s.source_id = ?');
    params.push(sourceId);
  }
  const sql =
    `SELECT j.id, j.identity, j.title, j.company, j.city, j.requirements, j.deadline, j.status,
            j.detail_url, j.is_replay, j.last_collected_at, j.created_at,
            s.name AS source_name, s.source_type, s.source_id AS source_key
     FROM jobs j JOIN sources s ON s.id = j.source_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY j.id DESC LIMIT 500`;
  return db.prepare(sql).all(...params);
}

function getJobById(id) {
  return db
    .prepare(
      `SELECT j.*, s.name AS source_name, s.source_type, s.source_id AS source_key
       FROM jobs j JOIN sources s ON s.id = j.source_id WHERE j.id = ?`
    )
    .get(id);
}

function countJobs() {
  return db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c;
}

function distinctCities() {
  return db
    .prepare("SELECT DISTINCT city FROM jobs WHERE city IS NOT NULL AND city != '' ORDER BY city")
    .all()
    .map((r) => r.city);
}

// ---------------- changes ----------------
function insertChange(jobId, field, before, after, evidence, changedAt, runId) {
  const r = db
    .prepare(
      'INSERT INTO job_changes (job_id, field, before, after, evidence, changed_at, run_id) VALUES (?,?,?,?,?,?,?)'
    )
    .run(jobId, field, before ?? null, after ?? null, evidence ?? null, changedAt, runId ?? null);
  return Number(r.lastInsertRowid);
}
function getJobChanges(jobId) {
  return db
    .prepare('SELECT * FROM job_changes WHERE job_id = ? ORDER BY changed_at DESC, id DESC')
    .all(jobId);
}

// ---------------- follows ----------------
function followJob(userId, jobId) {
  const existing = db.prepare('SELECT * FROM follows WHERE user_id=? AND job_id=?').get(userId, jobId);
  if (existing) {
    db.prepare('UPDATE follows SET followed_at=?, unfollowed_at=NULL WHERE id=?').run(now(), existing.id);
  } else {
    db.prepare('INSERT INTO follows (user_id, job_id, followed_at) VALUES (?,?,?)').run(userId, jobId, now());
  }
}
function unfollowJob(userId, jobId) {
  db.prepare('UPDATE follows SET unfollowed_at=? WHERE user_id=? AND job_id=? AND unfollowed_at IS NULL')
    .run(now(), userId, jobId);
}
function isFollowing(userId, jobId) {
  return !!db
    .prepare('SELECT 1 AS x FROM follows WHERE user_id=? AND job_id=? AND unfollowed_at IS NULL')
    .get(userId, jobId);
}
function listFollowedJobIds(userId) {
  return db
    .prepare('SELECT job_id FROM follows WHERE user_id=? AND unfollowed_at IS NULL')
    .all(userId)
    .map((r) => r.job_id);
}
function listFollows(userId) {
  return db
    .prepare(
      `SELECT f.job_id, f.followed_at, j.title, j.company, j.city, j.status, j.detail_url, j.identity, j.is_replay,
              s.name AS source_name
       FROM follows f
       JOIN jobs j ON j.id = f.job_id
       JOIN sources s ON s.id = j.source_id
       WHERE f.user_id=? AND f.unfollowed_at IS NULL
       ORDER BY f.followed_at DESC, f.id DESC`
    )
    .all(userId);
}
function currentFollowers(jobId) {
  return db.prepare('SELECT user_id FROM follows WHERE job_id=? AND unfollowed_at IS NULL').all(jobId);
}

// ---------------- feed ----------------
function insertFeedEvent(userId, jobId, changeId) {
  db.prepare('INSERT INTO feed_events (user_id, job_id, change_id, created_at) VALUES (?,?,?,?)')
    .run(userId, jobId, changeId, now());
}
function listFeed(userId) {
  return db
    .prepare(
      `SELECT e.id, e.created_at, e.job_id, j.title AS job_title, j.company, j.city, j.detail_url,
              c.field, c.before, c.after, s.name AS source_name
       FROM feed_events e
       JOIN job_changes c ON c.id = e.change_id
       JOIN jobs j ON j.id = e.job_id
       JOIN sources s ON s.id = j.source_id
       WHERE e.user_id=?
       ORDER BY e.created_at DESC, e.id DESC LIMIT 500`
    )
    .all(userId);
}

// ---------------- saved filters ----------------
function listFilters(userId) {
  return db.prepare('SELECT * FROM saved_filters WHERE user_id=? ORDER BY updated_at DESC, id DESC').all(userId);
}
function getFilterOwn(userId, id) {
  return db.prepare('SELECT * FROM saved_filters WHERE id=? AND user_id=?').get(id, userId);
}
function createFilter(userId, name, keyword, city) {
  const t = now();
  const r = db
    .prepare('INSERT INTO saved_filters (user_id, name, keyword, city, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(userId, name, keyword ?? '', city ?? '', t, t);
  return Number(r.lastInsertRowid);
}
function updateFilter(userId, id, { name, keyword, city }) {
  const cur = getFilterOwn(userId, id);
  if (!cur) return false;
  db.prepare('UPDATE saved_filters SET name=?, keyword=?, city=?, updated_at=? WHERE id=?')
    .run(name ?? cur.name, keyword ?? cur.keyword, city ?? cur.city, now(), id);
  return true;
}
function deleteFilter(userId, id) {
  const r = db.prepare('DELETE FROM saved_filters WHERE id=? AND user_id=?').run(id, userId);
  return r.changes > 0;
}

// ---------------- collection runs ----------------
function createRun(sourceId, startedAt, isReplay, replayLabel) {
  const r = db
    .prepare('INSERT INTO collection_runs (source_id, started_at, status, is_replay, replay_label) VALUES (?,?,?,?,?)')
    .run(sourceId, startedAt, 'running', isReplay ? 1 : 0, replayLabel ?? null);
  return Number(r.lastInsertRowid);
}
function finalizeRun(runId, f) {
  db
    .prepare(
      `UPDATE collection_runs SET finished_at=?, status=?, http_status=?, fetched_count=?, valid_count=?,
       new_count=?, changed_count=?, unchanged_count=?, failed_count=?, error_code=?, error_message=?,
       raw_snapshot_path=?, raw_sha256=? WHERE id=?`
    )
    .run(
      now(), f.status, f.httpStatus ?? null, f.fetchedCount ?? 0, f.validCount ?? 0,
      f.newCount ?? 0, f.changedCount ?? 0, f.unchangedCount ?? 0, f.failedCount ?? 0,
      f.errorCode ?? null, f.errorMessage ?? null, f.snapshotPath ?? null, f.sha ?? null, runId
    );
}
function getRunById(id) {
  return db
    .prepare(
      `SELECT r.*, s.name AS source_name, s.source_id AS source_key, s.source_type
       FROM collection_runs r JOIN sources s ON s.id = r.source_id WHERE r.id = ?`
    )
    .get(id);
}
function listRuns(limit = 100) {
  return db
    .prepare(
      `SELECT r.*, s.name AS source_name, s.source_id AS source_key, s.source_type
       FROM collection_runs r JOIN sources s ON s.id = r.source_id
       ORDER BY r.started_at DESC, r.id DESC LIMIT ?`
    )
    .all(limit);
}
function getLastRunForSource(sourceId) {
  return db
    .prepare(
      `SELECT r.*, s.name AS source_name FROM collection_runs r JOIN sources s ON s.id = r.source_id
       WHERE r.source_id = ? ORDER BY r.started_at DESC, r.id DESC LIMIT 1`
    )
    .get(sourceId);
}

module.exports = {
  initDb,
  getDb,
  getDataDir,
  // users
  findUserByUsername,
  findUserById,
  // sources
  listSources,
  getSourceBySourceId,
  getSourceById,
  // jobs
  findJob,
  insertJob,
  updateJob,
  touchJob,
  searchJobs,
  getJobById,
  countJobs,
  distinctCities,
  // changes
  insertChange,
  getJobChanges,
  // follows
  followJob,
  unfollowJob,
  isFollowing,
  listFollowedJobIds,
  listFollows,
  currentFollowers,
  // feed
  insertFeedEvent,
  listFeed,
  // filters
  listFilters,
  getFilterOwn,
  createFilter,
  updateFilter,
  deleteFilter,
  // runs
  createRun,
  finalizeRun,
  getRunById,
  listRuns,
  getLastRunForSource,
};
