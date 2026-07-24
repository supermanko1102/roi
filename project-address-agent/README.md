# 預售建案地址修復 Agent

這是一個與主 Next.js 應用隔離的 Python / Google ADK 子專案。它找出已進入
`presale_deals`、但尚未生成可顯示座標的預售建案，整理官方證據，使用 NLSC
驗證候選地址。正常 ETL 會在既有兩層 geocoder 都失敗後，自動執行本系統。

LLM Agent 不具有 approve 或 publish 工具。無人值守 runner 只會發布由程式從
本地內政部證據抽出、通過 NLSC 與行政區驗證，而且所有有效候選只形成一個
座標群的案件；模糊案件保留在 queue，不會阻塞 ETL。

## 資料流程

```text
presale_deals / projects
  → audit 與失敗分類
  → Agent 檢查交易、備查、地號、契約證據
  → NLSC 門牌／路口／地號驗證
  → 行政區 Polygon 驗證
  → project_location_candidates
  → 唯一座標群判定
  → 自動 publish
  → projects + geocode_cache
```

## 安裝

需要 Python 3.11–3.13 與 `uv`。

```bash
cd project-address-agent
cp .env.example .env
uv sync
```

在 `.env` 設定：

```dotenv
DATABASE_URL=postgres://...
GOOGLE_API_KEY=...
GOOGLE_GENAI_USE_VERTEXAI=FALSE
ADDRESS_AGENT_MODEL=gemini-3-flash-preview
ROI_REPO_ROOT=..
ADDRESS_AGENT_ALLOW_PUBLISH=0
```

自動修復不需要 Gemini key；`GOOGLE_API_KEY` 只供互動式 ADK Agent 搜尋使用。

主資料庫須先套用新增的 Drizzle migration：

```bash
cd ..
pnpm db:migrate
```

## 先執行 audit

唯讀報告：

```bash
uv run project-address-agent audit
uv run project-address-agent audit --limit 50
```

將可處理案件同步到 `project_location_cases`：

```bash
uv run project-address-agent audit --write
uv run project-address-agent cases
```

主要分類：

- `below_threshold`：有效成交少於三筆，只報告，不交給 Agent 修復。
- `project_missing`：有效成交達標但沒有 `projects` row，應先查 ETL。
- `project_no_coord`：Agent 的主要處理目標。
- `name_mangled`：名稱有 `?` / `�`，需要保守查證。

若 MOI 歷史資料的 `district` 是空字串，但交易地址明確包含行政區，
Agent 可使用該官方地址中的行政區做 NLSC 驗證；發布時仍會更新原始
`(city, district, project_name)` 對應的 `projects` row。

## 無人值守修復

先 dry-run，不改正式座標：

```bash
uv run project-address-agent auto --limit 50
```

套用所有通過自動安全閘門的案件：

```bash
uv run project-address-agent auto --apply --limit 50
```

主專案的 `etl:all` 已在 `etl:geocode-projects` 與 `etl:geocode-lots` 後自動執行：

```bash
pnpm etl:repair-projects
```

自動發布必須同時滿足：

- 候選由程式從 `presale_deals`、`communities` 或 MOI buildcase 檔抽出。
- 只能是完整門牌、兩路口或地號。
- NLSC 回傳精確座標。
- 座標落在預期行政區 polygon。
- 同案所有可驗證候選只形成一個 25 公尺座標群。

任何一項不成立就只記錄狀態，等待下次 ETL，不需要人工介入。
每批嘗試過的案件會移到佇列尾端，因此固定批次上限不會讓後面的案件餓死。

## 啟動 Agent

互動式 CLI：

```bash
uv run adk run project_address_agent
```

ADK Web：

```bash
make playground
```

可直接對 Agent 說：

```text
先 audit 桃園市缺座標建案，挑成交筆數最高的一案，檢查本地官方證據；
只在 NLSC 與行政區驗證都通過時 stage，不能 publish。
```

## 選用的人工覆核

列出候選：

```bash
uv run project-address-agent candidates
```

核准或拒絕：

```bash
uv run project-address-agent review 12 --approve --reviewer alex --note "核對備查案號"
uv run project-address-agent review 12 --reject --reviewer alex --note "同名建案衝突"
```

若要處理自動安全閘門刻意略過的例外，人工發布仍必須臨時啟用環境旗標：

```bash
ADDRESS_AGENT_ALLOW_PUBLISH=1 uv run project-address-agent publish 12
```

發布器只接受：

- 已人工 `approved`
- NLSC 驗證產生的 `lat/lng`
- `door`、`cross` 或 `lot` precision

若後續 ETL 重建 `projects`，可重套已發布決策：

```bash
ADDRESS_AGENT_ALLOW_PUBLISH=1 uv run project-address-agent apply-published
```

## 單獨檢查

```bash
uv run project-address-agent evidence 桃園市 桃園區 建案名稱
uv run project-address-agent validate 桃園市 桃園區 建案名稱 \
  --kind door --candidate 中正路100號
```

## 測試與評估

```bash
make test
make lint
make eval
```

單元測試不需要 API key 或外部網路。`make eval` 會呼叫 Gemini，需要有效的
Google AI Studio 或 Vertex AI 認證。

完整行為與安全規格見 [DESIGN_SPEC.md](DESIGN_SPEC.md)。
