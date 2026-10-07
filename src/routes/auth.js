'use strict';

const express = require('express');
const { findUserByUsername } = require('../db');
const { verifyPassword } = require('../util');
const { signSession, requireUser, COOKIE_NAME, publicUser } = require('../auth');

const router = express.Router();

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '请填写用户名和密码' });
  }
  const u = findUserByUsername(String(username));
  if (!u || !verifyPassword(String(password), u.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = signSession({ uid: u.id });
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE_MS });
  res.json({ user: publicUser(u) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
