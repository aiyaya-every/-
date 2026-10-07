'use strict';

const path = require('node:path');
const express = require('express');
const { initDb } = require('./src/db');
const { cookieParser } = require('./src/auth');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

initDb(path.join(DATA_DIR, 'app.db'));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/jobs', require('./src/routes/jobs'));
app.use('/api/filters', require('./src/routes/filters'));
app.use('/api/follows', require('./src/routes/follows'));
app.use('/api/feed', require('./src/routes/feed'));
app.use('/api', require('./src/routes/collect'));

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// central error handler
app.use((err, req, res, next) => {
  console.error('[error]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: (err && err.message) || '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`岗位搜索与变更追踪 已启动: http://localhost:${PORT}`);
  console.log(`数据目录: ${DATA_DIR}`);
});
