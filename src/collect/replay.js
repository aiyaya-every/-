'use strict';

// 回放快照解析：把 replay-format.md / replay.schema.json 定义的快照
// { sourceId, jobs: [...] } 规整为采集引擎可消费的 job 数组。
// 回放仅用于离线验证变更逻辑，接口与界面均明确标注 is_replay，绝不冒充真实抓取。

/**
 * 规整单条 job。replay 格式约定字段（camelCase）：
 *   identity, title, company, city, requirements, deadline, status, detailUrl
 * 可附带 explicitClosedEvidence 作为 status=closed 的明确关闭依据。
 */
function normalizeJob(j) {
  if (!j || typeof j !== 'object') return null;
  return {
    identity: j.identity != null ? String(j.identity).trim() : null,
    title: j.title != null ? String(j.title).trim() : null,
    company: j.company != null ? String(j.company) : '',
    city: j.city != null ? String(j.city) : null,
    requirements: j.requirements != null ? String(j.requirements) : null,
    deadline: j.deadline != null ? String(j.deadline) : null,
    status: j.status != null ? String(j.status) : null,
    detailUrl: j.detailUrl != null ? String(j.detailUrl) : null,
    evidence: j.explicitClosedEvidence != null ? String(j.explicitClosedEvidence) : null,
  };
}

/**
 * 解析快照对象（{ sourceId, jobs: [] }），返回规范化 jobs。
 */
function parseSnapshot(obj) {
  const sourceId = obj && obj.sourceId ? String(obj.sourceId) : null;
  const jobs = Array.isArray(obj && obj.jobs) ? obj.jobs.map(normalizeJob).filter(Boolean) : [];
  return { sourceId, jobs };
}

module.exports = { normalizeJob, parseSnapshot };
