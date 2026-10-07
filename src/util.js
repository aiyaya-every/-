'use strict';

const crypto = require('node:crypto');

/** ISO-8601 UTC timestamp. */
function now() {
  return new Date().toISOString();
}

/** SHA-256 hex of a Buffer or string (raw bytes of the UTF-8 string). */
function sha256Hex(input) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Normalize a detail URL into a stable identity, used only when a source does
 * not expose a stable job id. Keeps path + meaningful query, drops fragments
 * and common tracking params.
 */
function normalizeIdentity(url) {
  if (url == null) return null;
  const s = String(url).trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    u.hash = '';
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'kt', 'ref', 'from', 'source', 'spm', 'trace'];
    for (const k of drop) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return s;
  }
}

/** fetch() with an abort timeout. */
async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

/** scrypt password hash stored as "salt:hash" hex. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// ---- CSV helpers for evidence export ----
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(arr) {
  return arr.map(csvEscape).join(',');
}

module.exports = {
  now,
  sha256Hex,
  normalizeIdentity,
  fetchWithTimeout,
  hashPassword,
  verifyPassword,
  csvEscape,
  csvRow,
};
