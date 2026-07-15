-- 原始交易資料(ETL 寫入)
CREATE TABLE IF NOT EXISTS presale_deals (
  id            serial PRIMARY KEY,
  district      text NOT NULL,            -- 鄉鎮市區(CSV 原生欄位,免 geocoding)
  project_name  text,                     -- 建案名稱
  address       text,                     -- 區段化門牌
  deal_date     date,
  total_price   numeric,                  -- 總價(萬)
  parking_price numeric DEFAULT 0,        -- 車位總價(萬)
  area_ping     numeric,                  -- 建物移轉總面積(坪)
  unit_price    numeric,                  -- 扣車位單價(萬/坪)
  raw_season    text
);
CREATE INDEX IF NOT EXISTS idx_presale_district ON presale_deals(district);
CREATE INDEX IF NOT EXISTS idx_presale_project  ON presale_deals(project_name);

-- 中古/成屋買賣(a 檔;僅含建物之交易,純土地/車位已濾除)
CREATE TABLE IF NOT EXISTS sale_deals (
  id            serial PRIMARY KEY,
  district      text NOT NULL,
  address       text,
  deal_date     date,
  total_price   numeric,                  -- 總價(萬)
  parking_price numeric DEFAULT 0,        -- 車位總價(萬)
  area_ping     numeric,                  -- 權狀總坪
  parking_area_ping numeric DEFAULT 0,    -- 車位坪(買賣檔此欄品質可用)
  main_area_ping numeric,                 -- 主建物坪
  unit_price    numeric,                  -- 扣車位(價+坪)單價 萬/坪
  unit_price_main numeric,                -- 實坪單價(主建物)萬/坪
  building_type text,
  build_year    int,                      -- 建築完成年(西元)
  addr_key      text,                     -- 去樓層門牌(歸戶鍵,如「…建國路６３１巷８號」)
  raw_season    text
);
CREATE INDEX IF NOT EXISTS idx_sale_district ON sale_deals(district);
CREATE INDEX IF NOT EXISTS idx_sale_addr_key ON sale_deals(addr_key);

-- 門牌 → 座標快取(NLSC 定位,一次性回填後增量)
CREATE TABLE IF NOT EXISTS geocode_cache (
  addr_key   text PRIMARY KEY,
  lat        numeric,
  lng        numeric,
  precision  text,                        -- door=門牌精確 | none=查無
  queried_at timestamptz DEFAULT now()
);

-- 棟級彙總(compute-stats 由 sale_deals × geocode_cache 重建)
CREATE TABLE IF NOT EXISTS buildings (
  addr_key          text PRIMARY KEY,
  district          text NOT NULL,
  lat               numeric,
  lng               numeric,
  deal_count        int,
  median_unit_price numeric,              -- 扣車位 萬/坪
  median_total      numeric,              -- 中位總價(萬)
  building_type     text,                 -- 眾數
  build_year        int,
  last_deal         date
);
CREATE INDEX IF NOT EXISTS idx_buildings_district ON buildings(district);

CREATE TABLE IF NOT EXISTS rent_deals (
  id           serial PRIMARY KEY,
  district     text NOT NULL,
  address      text,
  deal_date    date,
  monthly_rent numeric,                   -- 月租(元)
  area_ping    numeric,
  rent_per_ping numeric,                  -- 元/坪/月
  build_year   int,                       -- 建築完成年(西元,可為 null)
  building_type text,                     -- 建物型態(住宅大樓/華廈/店面...)
  is_social    boolean DEFAULT false,     -- 社會住宅包租代管件(租金受政策壓低)
  raw_season   text
);
CREATE INDEX IF NOT EXISTS idx_rent_district ON rent_deals(district);

-- 彙總層(compute-stats 重算;seed 先塞示範值)
CREATE TABLE IF NOT EXISTS district_stats (
  district          text PRIMARY KEY,
  median_unit_price numeric,              -- 預售中位單價 萬/坪
  median_rent_ping  numeric,              -- 租金中位 元/坪/月(混合:含社宅)
  est_roi           numeric,              -- 推估年投報 %(混合口徑)
  median_rent_ping_market numeric,        -- 租金中位(排除社宅)
  est_roi_market    numeric,              -- 推估年投報 %(排除社宅)
  median_unit_price_resale numeric,       -- 中古住宅(屋齡≤8年)扣車位中位單價 萬/坪
  est_roi_resale    numeric,              -- 中古屋年投報 %(混合口徑)
  est_roi_resale_market numeric,          -- 中古屋年投報 %(排除社宅)
  resale_count      int DEFAULT 0,        -- 中古住宅(屋齡≤8年)樣本數
  presale_premium   numeric,              -- 預售 vs 中古新古屋溢價 %
  presale_count     int DEFAULT 0,
  rent_samples      int DEFAULT 0,
  rent_samples_market int DEFAULT 0,
  is_demo           boolean DEFAULT false,
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  district      text NOT NULL,
  lat           numeric,
  lng           numeric,
  median_total  numeric,                  -- 中位成交總價(萬)
  median_area   numeric,                  -- 中位坪數
  unit_price    numeric,                  -- 扣車位單價 萬/坪
  est_rent      numeric,                  -- 推估月租(元,混合口徑)
  est_roi       numeric,
  est_rent_market numeric,                -- 推估月租(排除社宅)
  est_roi_market  numeric,
  rent_samples  int DEFAULT 0,
  rent_samples_market int DEFAULT 0,
  deal_count    int DEFAULT 0,
  is_demo       boolean DEFAULT false,
  UNIQUE(name, district)
);
