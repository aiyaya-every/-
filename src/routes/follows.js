'use strict';

const express = require('express');
const { listFollows } = require('../db');
const { requireUser } = require('../auth');

const router = express.Router();
router.use(requireUser);

router.get('/', (req, res) => {
  res.json({ follows: listFollows(req.user.id) });
});

module.exports = router;
