'use strict';

const express = require('express');
const { listFeed } = require('../db');
const { requireUser } = require('../auth');

const router = express.Router();
router.use(requireUser);

router.get('/', (req, res) => {
  res.json({ events: listFeed(req.user.id) });
});

module.exports = router;
