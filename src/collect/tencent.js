'use strict';

// 腾讯招聘官方站（大厂官方招聘网站来源）
// 使用 careers.tencent.com 公开 JSON 接口，无需登录。
const { fetchWithTimeout } = require('../util');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const PAGE_SIZE = Number(process.env.TENCENT_PAGE_SIZE || 30);
const TIMEOUT_MS = Number(process.env.COLLECT_TIMEOUT_MS || 20000);

/**
 * 拉取一页岗位列表，返回规范化 job 数组。
 * 接口字段（防御式解析，字段缺失时降级为 null/空）：
 *   PostId -> identity, RecruitPostName -> title, LocationName -> city,
 *   Requirement/Responsibility -> requirements, PostURL -> detailUrl
 */
async function collect() {
  const timestamp = Date.now();
  const url =
    'https://careers.tencent.com/tencentcareer/api/post/Query' +
    `?timestamp=${timestamp}&countryId=&cityId=&bgIds=&productId=&categoryId=` +
    `&parentCategoryId=&attrId=&keyword=&pageIndex=1&pageSize=${PAGE_SIZE}&language=zh-cn&area=cn`;

  const res = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    TIMEOUT_MS
  );
  const rawText = await res.text();
  if (!res.ok) {
    const err = new Error(`腾讯招聘接口返回 HTTP ${res.status}`);
    err.code = 'HTTP_' + res.status;
    throw err;
  }

  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    const err = new Error('腾讯招聘接口返回非 JSON 内容');
    err.code = 'PARSE_ERROR';
    throw err;
  }

  const posts = (json && json.Data && json.Data.Posts) || [];
  const jobs = posts
    .map((p) => ({
      identity: p.PostId != null ? String(p.PostId) : null,
      title: p.RecruitPostName != null ? String(p.RecruitPostName) : null,
      company: p.BGName ? String(p.BGName) : '腾讯',
      city: p.LocationName != null ? String(p.LocationName) : null,
      requirements: [p.Requirement, p.Responsibility].filter(Boolean).join('\n') || null,
      deadline: null, // 官方列表未公开截止时间 -> 界面显示“未提供”
      status: 'open',
      detailUrl: p.PostURL || `https://careers.tencent.com/job.html?postId=${p.PostId}`,
    }))
    .filter((j) => j.identity && j.title);

  return { jobs, rawText, httpStatus: res.status };
}

module.exports = { collect };
