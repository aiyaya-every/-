# 岗位搜索与变更追踪

面向求职者的岗位搜索与变更追踪应用：用户可按关键词 + 城市查找岗位、保存常用筛选方案、关注岗位，并在“关注动态”中回看关注期间发生的岗位变化（岗位要求 / 截止时间 / 招聘状态的前后值与时间）。数据从**两个真实来源**采集：一个招聘平台 + 一家大厂官方招聘网站。

- 真实前端 + 后端 + 数据库（Node.js + Express + SQLite）
- Docker 部署（`docker compose up --build`）
- 真实采集 ≥1 招聘平台 + ≥1 大厂官方招聘网站，各 ≥10 条
- 变更追踪（requirements/deadline/status 前后值 + 时间）、关注动态、按用户隔离、数据卷持久化

---

## 1. 技术栈与架构

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | Node.js (≥22.5) + Express | REST JSON API |
| 数据库 | SQLite（Node 内置 `node:sqlite`） | 单文件 `data/app.db`，零原生依赖，挂载卷持久化 |
| 前端 | 原生 HTML/CSS/JS 单页 | 由后端静态托管，无构建步骤 |
| 采集 | 公开 HTTP 接口 + Node 全局 `fetch` | 腾讯招聘、智联招聘均走公开 JSON 接口 |
| 认证 | 预置账号 + HMAC 签名 HttpOnly 会话 cookie | 后端逐接口校验归属，非隐藏按钮 |

单一 Node 服务：`server.js` 启动时自动初始化数据库（建表 + 空库预置账号与来源），Express 提供 `/api/*` 与静态前端。核心表：`users`、`sources`、`jobs`、`job_changes`、`follows`、`feed_events`、`saved_filters`、`collection_runs`。

**变更语义（严格对照题目）**：以“来源 + 稳定岗位 ID（identity）”识别岗位，同名/异源岗位保持独立；首次抓取仅建档不产生动态；重复抓取相同内容不重复建档、不产生动态；某次列表缺失 / 超时 / 解析失败**一律不判关闭**，仅当来源明确给出关闭信号（回放里 `status=closed` + `explicitClosedEvidence`）才记录关闭；关注前变化不补发、取消关注后不再新增、重新关注不补发历史（动态在变更发生时物化给当时仍在关注者）。

## 2. 快速开始

### 方式 A：Docker（验收方式）

```bash
cp .env.example .env        # Windows: copy .env.example .env
docker compose up --build
```

- 首次初始化自动完成：建表、预置账号与来源（无需额外命令）。
- 访问 http://localhost:3000 ，用下方测试账号登录。
- 数据库与快照保存在命名卷 `app-data`（宿主机持久化）。

> 验收环境无需自行安装 Node.js / Python / 数据库；`docker compose up --build` 即构建并启动。

### 方式 B：本地运行（无需 Docker）

```bash
npm install
npm start
```

要求 Node.js ≥ 22.5（本项目使用内置 `node:sqlite`）。数据落在 `./data/`（已 gitignore）。

## 3. 预置测试账号

| 账号 | 密码 | 角色 | 用途 |
|---|---|---|---|
| `maintainer` | `maintainer123` | 数据维护 | 采集管理：触发真实采集 / 导入回放快照 |
| `alice` | `alice123` | 普通用户 | 搜索、保存方案、关注、查看动态 |
| `bob` | `bob123` | 普通用户 | 验证用户间数据隔离 |

（无需注册 / 验证码 / 找回密码；密码使用 `scrypt` 哈希存储。）

## 4. 从首次采集到查看关注动态（操作步骤）

1. 用 `maintainer` 登录 → 进入「采集管理」→ 点击「采集全部来源」（或逐个「采集该来源」）。首次打开应用且未采集时，搜索页会引导先采集。
2. 用 `alice` 登录 → 「岗位搜索」→ 输入关键词 / 城市 → 「搜索」；可「保存为筛选方案」供下次复用。
3. 在结果中点击「关注」某岗位；进入「我的关注」可查看 / 取消关注。
4. 由维护账号再次刷新来源（真实站点变化较慢时，用「导入回放快照」模拟变更，详见 §6）。
5. `alice` 进入「关注动态」，看到关注期间发生的变化（字段、修改前后值、时间），并可点进岗位详情查看完整变更历史。

## 5. 功能说明（对应功能要求）

1. **岗位浏览与搜索**：展示岗位名称、公司、城市、岗位要求、截止时间、招聘状态、来源名称、原始链接、最近抓取时间。来源未公开的截止时间 / 状态显示“未提供”，不推测补全。关键词匹配岗位名称 **或** 岗位要求；城市按选定值匹配；两者同时填写时同时满足（AND），留空不限。
2. **条件收藏**：将当前关键词 + 城市保存为有名称的筛选方案，支持修改、删除、再次使用；使用方案时按当前数据重新计算（不后台推送）。
3. **关注岗位**：关注 / 取消关注、查看关注列表；不同用户的方案、关注、动态相互隔离。
4. **真实采集与变更比较**：后端从所选来源获取真实岗位，按“来源 + 稳定 ID”识别；对岗位要求、截止时间、招聘状态保存修改前后内容与时间；首次建档、重复抓取相同内容不产生重复岗位或虚假变更。
5. **关注动态**：统一入口展示关注期间的变化，可跳转岗位与变更详情；关注前不补发、取消关注后不新增（已有动态保留）；仅来源明确关闭才记录关闭。

采集入口展示各来源执行状态、新增 / 更新数量与失败原因，设有超时、重试与请求间隔；单个来源失败不清空已有数据、不影响另一来源；采集入口仅数据维护账号可用（后端校验，非隐藏按钮）。

## 6. 采集来源与采集方法

| 来源 | 类型 | 入口 | 采集方式 | 身份字段 |
|---|---|---|---|---|
| 腾讯招聘 | `company_careers`（大厂官方招聘网站） | https://careers.tencent.com/ | 公开接口 `POST /tencentcareer/api/post/Query`（pageSize=30，无需登录） | `PostId` |
| 智联招聘 | `recruitment_platform`（招聘平台） | https://www.zhaopin.com/ | 公开接口 `fe-api.zhaopin.com/c/i/sou`（按关键词 Java/前端/产品经理 各取 pageSize=60，无需登录，请求间隔 0.5s） | `number`（详情链接兜底） |

- 真实采集（需可访问真实网络的机器）：`node scripts/collect.js [sourceId...]`，或应用内「采集管理」→「采集该来源 / 全部」。原始响应保存为快照并计算 SHA-256，执行记录写入 `collection_runs` 表；`scripts/collect.js` 会同时导出 `evidence/collection-runs.csv`、`evidence/source-evidence.csv` 并复制原始快照到 `evidence/snapshots/`。
- 两类来源各至少 10 个有效岗位、合计至少 20 个。官方招聘网站来源已给出“公司官网指向招聘入口”的可核对依据（见 `evidence/source-evidence.csv`）。

## 7. 回放快照（离线验证变更逻辑）

真实站点在考核期间未必变化。可基于真实抓取结果制作**明确标注的本地回放快照**，用于验证字段变化 / 明确关闭 / 重复刷新 / 来源失败；回放**不能替代**两个来源的真实采集，界面与证据均明确标为“回放”。

- 界面：采集管理 →「导入回放快照」，粘贴形如 `{ "sourceId":"tencent", "jobs":[...] }` 的快照（`jobs` 字段同 `replay-format.md`）。
- API：`POST /api/collect/replay`（`{ sourceId, jobs, label }`）；模拟来源失败用 `{ sourceId, kind:"source_failure", failureReason }`。
- 材料格式：`evidence/replay/replay.schema.json`（JSON Schema 2020-12）与 `evidence/replay/replay-manifest.example.json` 示例清单，`steps[].changes / expected / sha256` 仅作复核材料，应用仍自行比较快照执行变更规则。

## 8. 关键场景验证结果

覆盖核心流程与异常/边界的验证步骤与**实际结果**见 [`evidence/test-results.md`](evidence/test-results.md)（含 8 个自动化用例 + 一次端到端手工流程，全部为离线回放验证）。摘要：

- 重复刷新不重复建档、不产生虚假变更（JOB-02）
- 同名不同 identity 岗位保持独立（JOB-03）
- 仅关注者收到动态，前后值与时间可追溯（JOB-04）
- 关注前变化不补发 / 取消关注后不新增 / 已有动态保留（JOB-05/06）
- 列表缺失与来源失败不误判关闭，另一来源不受影响（JOB-07）
- 用户数据隔离，越权读写被拒（JOB-08）
- 筛选方案保存 / 修改 / 删除 / 复用 + 搜索 AND 语义（JOB-09）

## 9. 数据持久化与权限

- **持久化**：SQLite 数据库与快照均位于 `data/`，Docker 下挂载命名卷 `app-data`。`docker compose down && docker compose up -d --build`（保留卷）后，已保存的岗位、关注、方案、动态仍可读取。
- **权限**：所有数据接口经 `requireUser` 校验会话；方案 / 关注 / 动态查询均按 `user_id` 过滤，越权访问返回 404（不泄露存在性）或 403；采集接口经 `requireMaintainer` 校验角色。

## 10. 架构取舍与已知限制

**关键取舍**
- **SQLite 而非独立数据库服务**：零原生依赖、无需额外服务即可 `docker compose up --build`，且能在无 Docker 的本地环境完整验证；SQLite 是真实 SQL 数据库，满足“真实数据库”与持久化要求。如验收要求独立 DB 服务，可将 `src/db.js` 的查询层替换为 PostgreSQL（表结构一致）。
- **原生 JS 前端而非框架**：无构建步骤，镜像更小、启动更快、离线可运行；满足“真实前端”要求。允许并已使用成熟组件（Express），README 说明来源与自研范围。
- **公开接口而非浏览器自动化**：腾讯/智联均提供无需登录的公开 JSON 接口，规避验证码/登录绕过，遵守访问规则，并设置请求间隔与超时。

**已知限制**
- 真实采集需要可访问真实网络的运行环境（本机或 Docker 验收环境）。开发验证环境无外网，故真实抓取的在线验证与 `evidence/collection-runs.csv`、`source-evidence.csv`、原始快照需在联网时由 `node scripts/collect.js` 或应用内采集入口生成；变更追踪逻辑已用回放快照离线全量验证。
- 范围边界内不做：定时采集、跨来源岗位合并、邮件/手机推送、智能推荐、投递管理、按截止时间自动关闭（均为题目明确“不要求”）。
- 若目标站点接口结构变化，采集器解析失败会记为 `failed`/`partial` 并在采集记录与界面显示错误，不写入虚构数据；解析器为防御式（字段缺失降级为“未提供”）。

## 11. 目录结构

```
server.js                入口（初始化 DB + 路由 + 静态托管）
src/db.js                schema / seed / 数据访问层
src/auth.js              会话签名、cookie、鉴权中间件
src/collect/engine.js    采集引擎（去重 / diff / 变更 / 物化动态 / run 记录）
src/collect/{tencent,zhaopin,replay}.js
src/routes/*.js          auth / jobs / filters / follows / feed / collect
public/                  前端（index.html / app.js / styles.css）
scripts/collect.js       一次性真实采集 + 证据导出
test/                    node:test 自动化用例
evidence/                验收资料（采集记录、来源证据、回放、场景结果）
Dockerfile / docker-compose.yml / .env.example
```

## 12. 环境变量

见 [`.env.example`](.env.example)：`PORT`、`SESSION_SECRET`（留空自动生成并持久化）、`COLLECT_TIMEOUT_MS`、`REQUEST_INTERVAL_MS`、`ZHAOPIN_KEYWORDS`。密钥仅经服务端环境变量注入，不写入仓库或前端。
