# 房市探探

北北桃預售屋成交行情地圖：地圖、棟別圖與列表瀏覽預售實價登錄，以及屋齡 1–10 年的租賃行情。Next.js + MapLibre + PostgreSQL。

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
pnpm etl:communities         # 地號交集 → 實體社區、建案與門牌歸戶
pnpm etl:rent-benchmarks     # 匯入官方租金補貼有效租約分位數
```

實價登錄每月 1、11、21 日更新,`etl:all` 排進 cron 或 GitHub Actions 即可。

## 資料流

```
plvr.land.moi.gov.tw ──download──> etl/downloads/{season}/h_lvr_land_{a,b,c}.csv
        (a=中古買賣 b=預售 c=租賃)          │ parse
                                            v
              sale_deals / presale_deals / rent_deals(原始層)
                          │ geocode(NLSC 門牌定位,geocode_cache 快取)
                          │ compute-stats / match-communities
                          v
              district_stats / projects / buildings / physical_communities
                                            │
      300億元租金補貼有效租約統計 ──> rent_benchmarks ──┤
        data/taoyuan-districts.geojson ──┐  │
                        (內政部區界/g0v)  v  v
                    /api/districts, /api/points, /api/rentals ──> MapLibre 前端
```

## 產品顯示口徑

- **預售屋模式**:顯示建案名稱、行政區、成交單價中位數、成交總價中位數、成交坪數中位數與逐筆成交紀錄
- **租屋模式**:顯示同門牌租約中位數、租賃坪數、每坪月租、屋齡、登錄筆數與最近租約日期
- 租屋樣本限定屋齡 1–10 年住宅，排除店面、工廠、辦公、社宅標記與異常值
- 預售屋與租屋是兩個並列主模式，不把租屋當成預售篩選或疊加圖層
- 前端不判斷貴／便宜、不推估建案未來租金，也不提供投報率或信心分數；使用者直接查看登錄數字與來源
- 資料庫仍保留社宅標記、區域租金基準與彙總欄位，供資料維護與後續研究，不在前端替使用者下結論

已知限制(刻意保守):
- **預售**單價未拆車位坪(預售檔車位面積品質不穩)，閱讀單價時需留意各案申報差異
- 預售檔與租賃檔的車位申報品質不一，畫面只呈現資料中可辨識的車位金額
- 非社宅租賃實登不是完整刊登市場，仍可能有申報選擇偏差
- 透天厝單價分母只有建物坪(土地價值含在總價裡)→ 棟級單價會遠高於大樓,不同型態間不可直接比較

## Roadmap

- [x] 屋齡 1–10 年租賃實登棟級圖層:住宅用途、門牌定位、同棟租約中位數,排除社宅與異常值
- [x] 中古屋棟級點位:實價登錄 2.0 完整門牌 → NLSC geocode → 歸戶 buildings → 前端 cluster 地圖
- [x] 預售屋／租屋並列主模式，共用地圖、搜尋與列表操作
- [x] 建案詳情精簡為基本資料與逐筆成交，不顯示自動分析或投報試算
- [x] 實體社區歸戶:行政區＋標準化建案名合併分期，地號交集串接門牌與租約
- [x] 官方區域基準:300 億租金補貼有效租約統計，與市場相似案例並列不混算
- [ ] 預售建案座標:預售檔地址模糊(「○○路110號附近」),需另接內政部「預售屋建案標示/備查」資料的建案座落地址再 geocode
- [ ] 重劃區層:桃園地政局重劃範圍圖 → PostGIS `ST_Contains` 歸戶,支援「A7重劃區」粒度
- [ ] 591 租金補充源(Playwright,低頻自用)
- [ ] 多縣市:download-lvr.ts 的 WANTED 加城市代碼即可
