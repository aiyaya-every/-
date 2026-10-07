# 原始采集快照目录

真实采集时，本目录由 `node scripts/collect.js` 或应用内「采集管理」自动生成：每个来源每次采集的原始响应（原始 JSON 文本）会以
`<sourceId>-<runId>-raw.json` 命名复制到此处，并在 `../collection-runs.csv` 与 `../source-evidence.csv` 中记录其 SHA-256。

快照内容与来源原始响应一致，仅用于取证复核与回放依据；回放时在应用内明确标注 `is_replay`，不冒充真实抓取。

本目录当前为空是因为开发/验证环境无外网，真实采集需在可联网机器上运行一次（见 `README.md` §6）。
