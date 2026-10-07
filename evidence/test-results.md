# 关键场景验证结果

本文记录对“岗位搜索与变更追踪”核心逻辑的验证步骤与**实际结果**。验证环境无外网、无 Docker，故变更追踪逻辑采用**回放快照**离线全量验证（回放与真实采集走同一条 diff/物化管道，见 `src/collect/engine.js`）；真实采集与 Docker 验收在可联网/装有 Docker 的环境执行，步骤见 `README.md`。

- 运行环境：Node v24.16，Windows 11
- 自动化：`npm test`（`node:test`，使用 `:memory:` SQLite + 回放夹具）
- 端到端：`node server.js` 后经 HTTP 接口走通完整流程

---

## 一、自动化用例（8 个，全部通过）

`npm test` 实际输出：

```
✔ JOB-02 重复采集相同内容：不重复建档、不产生变更
✔ JOB-03 同名不同 identity：保持独立，不按名称合并
✔ JOB-04 仅关注者收到动态；前后值与时间可追溯
✔ JOB-05 关注前变化不补发；关注后仅见后续变化
✔ JOB-06 取消关注后不再新增动态；已有动态保留
✔ JOB-07 列表缺失/来源失败：数据保留、不误关闭
✔ JOB-08 用户数据隔离：B 无法读取/修改 A 的方案与动态
✔ JOB-09 筛选方案：保存/复用/修改/删除 + 搜索 AND 语义
ℹ pass 8  fail 0
```

用例断言要点（对应 `test/change-tracking.test.js`）：

| 用例 | 验证点 | 关键断言（实际通过） |
|---|---|---|
| JOB-02 | 去重 / 防虚假变更 | 二次采集 `new_count=0, changed_count=0, unchanged_count=1`，岗位数仍为 1，变更记录为 0 |
| JOB-03 | 同名独立 | identity=1 与 identity=2 同名「工程师」→ 岗位数为 2，二者均存在 |
| JOB-04 | 关注者动态 + 前后值 | A 三处变更（requirements/deadline/status）→ alice 动态 3 条、bob 0 条；status 变更 before=open / after=closed / evidence 留存 |
| JOB-05 | 关注前不补发 | 关注前变更 → 动态 0；关注后变更 → 动态 1，before=v2 / after=v3 |
| JOB-06 | 取消关注后不新增、旧动态保留 | 取消后变更 → 动态仍 1 条，before=v1 / after=v2 |
| JOB-07 | 缺失/失败不误关闭 | 缺失 job1 → 仍存在且 status=open；zhaopin 来源失败 → status=failed、error_code=SOURCE_FAILURE，岗位数不变 |
| JOB-08 | 用户隔离 | bob 读不到/改不了/删不了 alice 的方案（`getFilterOwn` undefined、`update/delete` 返回 false）；bob 动态 0 |
| JOB-09 | 方案 CRUD + AND 搜索 | keyword 匹配标题或要求；keyword+city 为 AND；方案保存/复用/修改/删除均生效 |

---

## 二、端到端关键场景（HTTP 流程）

以下按“首次采集 → 查看关注动态”的操作步骤走通（回放快照，实际观测结果）。

### 场景 A：首次采集 → 搜索 → 关注 → 变更 → 动态

1. `maintainer` 登录，`POST /api/collect/replay` 导入腾讯初始快照（2 个岗位）→ 返回 **新增 2、更新 0、无变化 0**。
2. `alice` 登录，`GET /api/jobs?keyword=后端` → 命中 1 条（关键词匹配标题）。
3. `alice` 关注该岗位（`POST /api/jobs/:id/follow`）→ 关注成功。
4. `maintainer` 再次导入“要求变更”的快照 → 返回 **新增 0、更新 1（1 处变更）**。
5. `alice` `GET /api/feed` → **动态 1 条**，`field=requirements`，`before` 为旧要求、`after` 为新要求，`created_at` 有值。
6. `maintainer` 重复导入同一快照 → **更新 0、无变化 1**；`alice` 再查动态 → **仍 1 条**（未重复）。

**结论**：建档、搜索、关注、变更物化、防重复全部符合预期。

### 场景 B：列表缺失 / 来源失败不误判关闭，且不影响另一来源

1. 在已有岗位后，导入“缺少数个岗位”的快照 → 被缺失岗位**仍在**、`status` 仍为 `open`，`changed_count=0`。
2. 对 `zhaopin` 来源执行 `replayKind=source_failure`（模拟超时）→ run `status=failed`、`error_code=SOURCE_FAILURE`；腾讯来源已有岗位数量**不变**、状态不变。

**结论**：某来源失败/缺失不会清空已有数据，也不会把岗位误判为关闭。

### 场景 C：关注动态边界（关注前不补发、取消关注后不新增、旧动态保留）

1. 关注前发生一次变更 → 该用户动态 **0**。
2. 关注后发生变更 → 动态 **1**（before/after 为该次前后值）。
3. 取消关注后再变更 → 动态**仍 1**（不新增，且保留原 before/after）。

**结论**：动态严格限定在“关注期间”，取消关注后既有动态保留、不再新增。

### 场景 D：用户数据隔离

1. `alice` 保存方案、关注岗位、产生动态；`bob` 登录后：
   - 方案列表 **0**（读不到 alice 的方案）；直接以其 id 读写/删除 → **404/失败**。
   - 动态列表 **0**（读不到 alice 的关注动态）。

**结论**：方案、关注、动态均按 `user_id` 隔离（后端校验，非隐藏按钮）。

### 场景 E：持久化（进程重启后数据仍在）

1. 完成上述操作后停止 `node server.js`，重新 `npm start`。
2. 重新登录 → 已采集岗位、关注、方案、动态**均可读取**；快照目录与 `data/app.db` 完好。

**结论**：SQLite 单文件 + 数据目录持久化满足“数据卷重建后仍可读”。

---

## 三、待联网/待 Docker 验证（真实采集 + 容器）

本环境无外网与 Docker，以下项在交付机器执行（步骤见 `README.md`）：

- 真实采集：`node scripts/collect.js` 或应用内「采集管理」从腾讯、智联各抓 ≥10 条，自动生成 `evidence/collection-runs.csv`、`evidence/source-evidence.csv` 与 `evidence/snapshots/`。
- 容器验收：`docker compose up --build` → 初始化自动完成 → 走通核心流程 → `docker compose down && docker compose up -d --build`（保留卷）→ 数据仍可读。
