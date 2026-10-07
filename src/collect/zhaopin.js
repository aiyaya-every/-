'use strict';

// 智联招聘（招聘平台来源）
// 使用 fe-api.zhaopin.com/c/i/sou 公开 JSON 接口，无需登录。
const { fetchWithTimeout } = require('../util');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const PAGE_SIZE = Number(process.env.ZHAOPIN_PAGE_SIZE || 60);
const TIMEOUT_MS = Number(process.env.COLLECT_TIMEOUT_MS || 20000);
const DELAY_MS = Number(process.env.REQUEST_INTERVAL_MS || 500);

// 默认关键词轮询，保证单次采集能稳定凑足 ≥10 条有效岗位。
const DEFAULT_KEYWORDS = (process.env.ZHAOPIN_KEYWORDS || 'Java,前端,产品经理')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(keyword) {
  const url =
    'https://fe-api.zhaopin.com/c/i/sou' +
    `?start=0&pageSize=${PAGE_SIZE}&cityId=&workExperience=-1&education=-1&companyType=-1` +
    `&employmentType=-1&jobWelfareTag=-1&kw=${encodeURIComponent(keyword)}&kt=3`;
  const res = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    TIMEOUT_MS
  );
  const rawText = await res.text();
  if (!res.ok) {
    const err = new Error(`智联招聘接口返回 HTTP ${res.status}`);
    err.code = 'HTTP_' + res.status;
    throw err;
  }
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    const err = new Error('智联招聘接口返回非 JSON 内容');
    err.code = 'PARSE_ERROR';
    throw err;
  }
  const results = (json && json.data && json.data.results) || [];
  return { results, rawText, httpStatus: res.status };
}

function toJob(r) {
  const city = r.city && (r.city.display || r.city.name);
  const requirements = [
    r.workingExp && (r.workingExp.name || r.workingExp.display),
    r.eduLevel && (r.eduLevel.name || r.eduLevel.display),
    r.jobType && (r.jobType.display || r.jobType.name),
    r.emplType && (r.emplType.display || r.emplType.name),
  ]
    .filter(Boolean)
    .join(' / ');
  return {
    identity: r.number != null ? String(r.number) : r.positionURL || null,
    title: r.jobName != null ? String(r.jobName) : null,
    company: (r.company && (r.company.name || r.company.display)) || '',
    city: city ? String(city) : null,
    requirements: requirements || null,
    deadline: null, // 平台未公开截止时间 -> 界面显示“未提供”
    status: 'open',
    detailUrl: r.positionURL || null,
  };
}

async function collect() {
  const all = new Map();
  const rawParts = [];
  let httpStatus = 200;

  for (const kw of DEFAULT_KEYWORDS) {
    const { results, rawText, httpStatus: hs } = await fetchPage(kw);
    httpStatus = hs;
    rawParts.push(rawText);
    for (const r of results) {
      const j = toJob(r);
      if (j.identity && j.title && !all.has(j.identity)) {
        all.set(j.identity, j);
      }
    }
    if (all.size >= 10) break;
    await sleep(DELAY_MS);
  }

  return { jobs: Array.from(all.values()), rawText: rawParts.join('\n'), httpStatus };
}

module.exports = { collect };
