'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const COOKIE_NAME = 'sid';
let SECRET = null;

function getSecret() {
  if (SECRET) return SECRET;
  if (process.env.SESSION_SECRET) {
    SECRET = process.env.SESSION_SECRET;
    return SECRET;
  }
  // Fall back to a persisted random secret so sessions survive restarts
  // while the data volume is kept.
  const { getDataDir } = require('./db');
  const dir = getDataDir();
  const file = path.join(dir, '.session-secret');
  try {
    SECRET = fs.readFileSync(file, 'utf8').trim();
  } catch {
    SECRET = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, SECRET, { mode: 0o600 });
  }
  return SECRET;
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expect = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Minimal cookie parser middleware (no extra dependency). */
function cookieParser(req, res, next) {
  req.cookies = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) req.cookies[k] = v;
    }
  }
  next();
}

/** Requires a valid session; sets req.user. */
function requireUser(req, res, next) {
  const { findUserById } = require('./db');
  const payload = verifySession(req.cookies && req.cookies[COOKIE_NAME]);
  if (!payload || !payload.uid) return res.status(401).json({ error: '未登录或会话已过期' });
  const u = findUserById(payload.uid);
  if (!u) return res.status(401).json({ error: '用户不存在' });
  req.user = u;
  next();
}

/** Requires a maintainer-role user. */
function requireMaintainer(req, res, next) {
  if (!req.user || req.user.role !== 'maintainer') {
    return res.status(403).json({ error: '无权限：仅数据维护账号可执行采集操作' });
  }
  next();
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, displayName: u.display_name };
}

module.exports = {
  COOKIE_NAME,
  signSession,
  verifySession,
  cookieParser,
  requireUser,
  requireMaintainer,
  publicUser,
};
