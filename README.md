# 桃園預售屋投報率地圖

實價登錄預售價 × 租賃行情 → 分區推估投報率。Next.js + MapLibre + PostgreSQL。

## 快速開始(附示範資料,不用先跑 ETL)

```bash
cp .env.example .env
pnpm install
just local-dev       # 起 PostgreSQL → 套 migration → 塞示範種子資料
pnpm dev             # http://localhost:3000
```

沒裝 [just](https://github.com/casey/just) 的話等價於 `pnpm db:up && pnpm db:migrate && pnpm db:seed`。
收環境:`just local-down`(資料保留);連 DB 資料一起刪:`just local-nuke`。

## Schema 管理(Drizzle)

`db/schema.ts` 是唯一的 schema 來源,ETL 與 API 共用同一份表定義與型別。

```bash
# 改表流程:編輯 db/schema.ts →
pnpm db:generate     # 產生 migration SQL(db/migrations/)
pnpm db:migrate      # 套用到 DATABASE_URL 指到的 DB
```

## 灌真實資料

```bash
pnpm etl:download            # 抓最新一期(或指定:tsx etl/download-lvr.ts 115S1 115S2)
pnpm etl:parse               # CSV → sale_deals / presale_deals / rent_deals
pnpm etl:geocode             # 門牌 → 座標(NLSC,平行查詢,首次全量約 20~30 分,之後增量幾分鐘)
pnpm etl:stats               # 重算 district_stats / projects / buildings,自動清除示範資料
```

實價登錄每月 1、11、21 日更新,`etl:all` 排進 cron 或 GitHub Actions 即可。

## 資料流

```
plvr.land.moi.gov.tw ──download──> etl/downloads/{season}/h_lvr_land_{a,b,c}.csv
        (a=中古買賣 b=預售 c=租賃)          │ parse
                                            v
              sale_deals / presale_deals / rent_deals(原始層)
                          │ geocode(NLSC 門牌定位,geocode_cache 快取)
                          │ compute-stats
                          v
              district_stats / projects / buildings(彙總層)
                                            │
        data/taoyuan-districts.geojson ──┐  │
                        (內政部區界/g0v)  v  v
                            /api/districts, /api/projects ──> MapLibre 前端
```

## 投報率定義

- **區級(預售)**:`median(租金 元/坪/月, 屋齡≤8年, 住宅類) × 12 ÷ (median(預售單價 萬/坪) × 10000)`
- **區級(中古)**:分母改用中古住宅(屋齡≤8年、扣車位價與車位坪)中位單價;租金池同一套
- **預售溢價**:`(預售中位單價 ÷ 中古中位單價 − 1) × 100%`
- **建案級**:推估月租 = 區租金中位 × 建案中位坪數 × **0.85**(權狀→可租面積的公設折減粗估)
- 租賃樣本只計住宅類建物(住宅大樓/華廈/透天/公寓/套房),排除店面、工廠、辦公
- **兩套口徑**(前端可切換):
  - **含社宅**:全部租賃件。桃園約 76% 租賃登錄是社會住宅包租代管件,租金受政策壓低約 5 成 → 投報率系統性低估
  - **排除社宅**:只用一般市場件,較貼近散戶實際租得到的行情;但樣本剩約 1/4,且偏向小坪數套房(每坪租金偏高)→ 部分區投報率可能高估,看數字時務必配合樣本數
- 租賃樣本 < 5 筆 → 投報率顯示「樣本不足」,不給假精確

已知限制(刻意保守):
- **預售**單價未拆車位坪(預售檔車位面積品質不穩),偏低估單價 → 投報率略高估;
  **中古**檔車位坪品質可用、已拆(另存 `unit_price_main` 主建物實坪單價)
- 因上述口徑差,`presale_premium` 系統性偏低(多區呈負值),僅供區間趨勢比較,
  不能解讀為「預售比中古便宜」
- 排除社宅後市場件樣本偏套房,每坪租金偏高 → 該口徑投報率偏樂觀
- 透天厝單價分母只有建物坪(土地價值含在總價裡)→ 棟級單價會遠高於大樓,不同型態間不可直接比較
- 預售交屋 vs 當期租金有 2~3 年時間差;中古屋投報率無此問題,較可信

## Roadmap

- [x] 中古屋棟級點位:實價登錄 2.0 完整門牌 → NLSC geocode → 歸戶 buildings → 前端 cluster 地圖
- [ ] 預售建案座標:預售檔地址模糊(「○○路110號附近」),需另接內政部「預售屋建案標示/備查」資料的建案座落地址再 geocode
- [ ] 重劃區層:桃園地政局重劃範圍圖 → PostGIS `ST_Contains` 歸戶,支援「A7重劃區」粒度
- [ ] 591 租金補充源(Playwright,低頻自用)
- [ ] 多縣市:download-lvr.ts 的 WANTED 加城市代碼即可
