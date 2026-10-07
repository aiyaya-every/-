# 回放快照格式说明

回放快照是**离线验证变更追踪逻辑**用的本地 JSON 材料。它复用与真实采集相同的“归一化 → 按 identity 去重 → 比较 requirements/deadline/status → 记录变更 → 物化动态”管道，但明确标注 `is_replay`，**不替代两个来源的真实采集**，界面与证据均不会将其冒充为真实抓取。

## 快照结构

```json
{
  "sourceId": "tencent",          // 来源标识：tencent | zhaopin
  "label": "腾讯招聘 第2次采集（回放·字段变化）",   // 可选，仅作展示/记录
  "jobs": [ ... ]                  // 见 replay.schema.json 的 job 定义
}
```

`jobs[]` 单条字段（camelCase）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `identity` | ✅ | 来源内稳定 ID（腾讯 PostId / 智联 number）。同名不同 identity 保持独立 |
| `title` | ✅ | 岗位名称 |
| `company` | | 公司名称 |
| `city` | | 城市（城市搜索按值匹配） |
| `requirements` | | 岗位要求（关键词匹配标题或要求）；缺失为 `null` |
| `deadline` | | 截止时间；来源未公开为 `null` |
| `status` | | `open` \| `closed` \| `null`。`closed` 需附 `explicitClosedEvidence` |
| `detailUrl` | | 详情链接（identity 缺失时的兜底） |
| `explicitClosedEvidence` | | `status=closed` 的明确关闭依据 |

JSON Schema（2020-12）见 `replay.schema.json`。

## 语义约定（与真实采集完全一致）

- 首次出现某 identity → 建档，**不产生**动态。
- 再次出现且 requirements/deadline/status 均相同 → 无变化，不建档、不产生动态。
- 字段发生变化 → 写 `job_changes`（前后值 + 时间），并物化给“此刻仍在关注”的用户。
- 本次快照缺失某 identity / 超时 / 解析失败 → **不判关闭**，已有数据保留。
- `status=closed` 仅在提供 `explicitClosedEvidence` 时视为明确关闭信号。

## 用法

- 界面：采集管理 →「导入回放快照」，粘贴上述 JSON。
- API：`POST /api/collect/replay`，请求体 `{ "sourceId": "tencent", "jobs": [...] }`。
- 模拟来源失败：`POST /api/collect/replay`，请求体 `{ "sourceId": "zhaopin", "kind": "source_failure", "failureReason": "..." }`。
- CLI（自动化验证）：`node --test`（见 `test/change-tracking.test.js`）。

## 示例快照

本目录 `*.json` 为示例快照（含初始、字段变化、第二来源），其 SHA-256 见 `replay-manifest.example.json`。
