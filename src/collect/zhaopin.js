'use strict';

// 智联招聘（招聘平台来源）
// 搜索页 www.zhaopin.com/sou 为服务端渲染（SSR），岗位数据内嵌在页面
// <script> 的 window.__INITIAL_STATE__ JSON 的 positionList 数组中。
// 通过 sou.zhaopin.com/?kw=<关键词> 跟随 301 重定向到 SSR 页并解析，无需登录。
const { fetchWithTimeout } = require('../util');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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

/** 从 SSR HTML 中抽出 window.__INITIAL_STATE__ = {...} 的 JSON。 */
function extractInitialState(html) {
  const marker = '__INITIAL_STATE__=';
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = i + marker.length;
  const end = html.indexOf('</script>', start);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

/** 把 positionList 里的一条岗位映射为采集引擎的 job。 */
function toJob(p) {
  const skills = Array.isArray(p.jobSkillTags)
    ? p.jobSkillTags.map((t) => t && t.name).filter(Boolean)
    : [];
  const requirements = [p.workingExp, p.education, p.workType, ...skills]
    .filter((v) => v != null && String(v).trim() !== '')
    .join(' / ');
  const detailUrl = p.positionURL || p.positionUrl || null;
  return {
    identity: p.number != null ? String(p.number) : detailUrl,
    title: p.name != null ? String(p.name) : null,
    company: p.companyName != null ? String(p.companyName) : '',
    city: p.workCity != null ? String(p.workCity) : null,
    requirements: requirements || null,
    deadline: null, // 平台未公开截止时间 -> 界面显示“未提供”
    status: 'open',
    detailUrl,
  };
}

async function fetchKeyword(kw) {
  const url = 'https://sou.zhaopin.com/?kw=' + encodeURIComponent(kw);
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    },
    TIMEOUT_MS
  );
  const rawText = await res.text();
  if (!res.ok) {
    const err = new Error(`智联招聘搜索页返回 HTTP ${res.status}`);
    err.code = 'HTTP_' + res.status;
    throw err;
  }
  const state = extractInitialState(rawText);
  const list = state && Array.isArray(state.positionList) ? state.positionList : [];
  return { list, rawText, httpStatus: res.status };
}

async function collect() {
  const all = new Map();
  const rawParts = [];
  let httpStatus = 200;

  for (const kw of DEFAULT_KEYWORDS) {
    const { list, rawText, httpStatus: hs } = await fetchKeyword(kw);
    httpStatus = hs;
    rawParts.push(rawText);
    for (const p of list) {
      const j = toJob(p);
      if (j.identity && j.title && !all.has(j.identity)) {
        all.set(j.identity, j);
      }
    }
    await sleep(DELAY_MS);
  }

  return { jobs: Array.from(all.values()), rawText: rawParts.join('\n'), httpStatus };
}

module.exports = { collect };
