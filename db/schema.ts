/**
 * 唯一的 schema 來源:改表 → npm run db:generate 產 migration → npm run db:migrate 套用。
 * 屬性名刻意用 snake_case,讓 select 回傳的 JSON 形狀與既有 API/前端一致。
 */
import {
  pgTable, serial, text, date, numeric, integer, boolean, timestamp, index, unique,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { mode: "number" });

// 原始交易資料(ETL 寫入)
export const presale_deals = pgTable("presale_deals", {
  id: serial("id").primaryKey(),
  district: text("district").notNull(),          // 鄉鎮市區(CSV 原生欄位,免 geocoding)
  project_name: text("project_name"),            // 建案名稱
  address: text("address"),                      // 區段化門牌
  deal_date: date("deal_date"),
  total_price: money("total_price"),             // 總價(萬)
  parking_price: money("parking_price").default(0), // 車位總價(萬)
  area_ping: money("area_ping"),                 // 建物移轉總面積(坪)
  parking_area_ping: money("parking_area_ping").default(0), // 車位移轉總面積(坪)
  unit_price: money("unit_price"),               // 扣車位單價(萬/坪,分母亦扣車位坪)
  raw_season: text("raw_season"),
}, (t) => [
  index("idx_presale_district").on(t.district),
  index("idx_presale_project").on(t.project_name),
]);

// 中古/成屋買賣(a 檔;僅含建物之交易,純土地/車位已濾除)
export const sale_deals = pgTable("sale_deals", {
  id: serial("id").primaryKey(),
  district: text("district").notNull(),
  address: text("address"),
  deal_date: date("deal_date"),
  total_price: money("total_price"),             // 總價(萬)
  parking_price: money("parking_price").default(0), // 車位總價(萬)
  area_ping: money("area_ping"),                 // 權狀總坪
  parking_area_ping: money("parking_area_ping").default(0), // 車位坪(買賣檔此欄品質可用)
  main_area_ping: money("main_area_ping"),       // 主建物坪
  unit_price: money("unit_price"),               // 扣車位(價+坪)單價 萬/坪
  unit_price_main: money("unit_price_main"),     // 實坪單價(主建物)萬/坪
  building_type: text("building_type"),
  build_year: integer("build_year"),             // 建築完成年(西元)
  addr_key: text("addr_key"),                    // 去樓層門牌(歸戶鍵,如「…建國路６３１巷８號」)
  raw_season: text("raw_season"),
}, (t) => [
  index("idx_sale_district").on(t.district),
  index("idx_sale_addr_key").on(t.addr_key),
]);

// 門牌 → 座標快取(NLSC 定位,一次性回填後增量)
export const geocode_cache = pgTable("geocode_cache", {
  addr_key: text("addr_key").primaryKey(),
  lat: money("lat"),
  lng: money("lng"),
  precision: text("precision"),                  // door=門牌精確 | none=查無
  queried_at: timestamp("queried_at", { withTimezone: true }).defaultNow(),
});

// 棟級彙總(compute-stats 由 sale_deals × geocode_cache 重建)
export const buildings = pgTable("buildings", {
  addr_key: text("addr_key").primaryKey(),
  district: text("district").notNull(),
  lat: money("lat"),
  lng: money("lng"),
  deal_count: integer("deal_count"),
  median_unit_price: money("median_unit_price"), // 扣車位 萬/坪
  median_total: money("median_total"),           // 中位總價(萬)
  building_type: text("building_type"),          // 眾數
  build_year: integer("build_year"),
  last_deal: date("last_deal"),
}, (t) => [
  index("idx_buildings_district").on(t.district),
]);

export const rent_deals = pgTable("rent_deals", {
  id: serial("id").primaryKey(),
  district: text("district").notNull(),
  address: text("address"),
  deal_date: date("deal_date"),
  monthly_rent: money("monthly_rent"),           // 月租(元)
  area_ping: money("area_ping"),
  rent_per_ping: money("rent_per_ping"),         // 元/坪/月
  build_year: integer("build_year"),             // 建築完成年(西元,可為 null)
  building_type: text("building_type"),          // 建物型態(住宅大樓/華廈/店面...)
  is_social: boolean("is_social").default(false),// 社會住宅包租代管件(租金受政策壓低)
  addr_key: text("addr_key"),                    // 去樓層門牌(實登2.0起租賃有完整門牌)
  raw_season: text("raw_season"),
}, (t) => [
  index("idx_rent_district").on(t.district),
  index("idx_rent_addr_key").on(t.addr_key),
]);

// 預售建案備查(plvr「預售備查建案下載」;實登 2.0 之後才有,match-communities 重建)
export const communities = pgTable("communities", {
  case_no: text("case_no").primaryKey(),      // 備查編號
  name: text("name").notNull(),               // 建案名稱
  district: text("district").notNull(),
  households: integer("households"),          // 戶數
  street: text("street"),                     // 坐落街道(工地位置描述)
  permit_no: text("permit_no"),               // 建造執照字號
  first_reg: date("first_reg"),               // 第1次登記日期(≈完工/交屋)
  declare_date: date("declare_date"),         // 申報備查日期
}, (t) => [
  index("idx_communities_district").on(t.district),
]);

// 門牌 → 建案歸戶(中古交易地號 × 建案坐落地號交集;match-communities 重建)
export const building_community = pgTable("building_community", {
  addr_key: text("addr_key").primaryKey(),
  case_no: text("case_no").notNull(),
  matched_parcels: integer("matched_parcels").default(0), // 交集地號數(信心參考)
});

// 生活圈租金行情(compute-zone-rents 重建;供圈級投報與抽屜推估用)
export const zone_stats = pgTable("zone_stats", {
  zone: text("zone").primaryKey(),               // 生活圈名(對應 taoyuan-zones.geojson 的 name)
  median_rent_ping_market: money("median_rent_ping_market"), // 元/坪/月,排除社宅
  rent_samples_market: integer("rent_samples_market").default(0),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// 彙總層(compute-stats 重算;seed 先塞示範值)
export const district_stats = pgTable("district_stats", {
  district: text("district").primaryKey(),
  median_unit_price: money("median_unit_price"), // 預售中位單價 萬/坪
  median_rent_ping: money("median_rent_ping"),   // 租金中位 元/坪/月(混合:含社宅)
  est_roi: money("est_roi"),                     // 推估年投報 %(混合口徑)
  median_rent_ping_market: money("median_rent_ping_market"), // 租金中位(排除社宅)
  est_roi_market: money("est_roi_market"),       // 推估年投報 %(排除社宅)
  median_unit_price_resale: money("median_unit_price_resale"), // 中古住宅(屋齡≤8年)扣車位中位單價 萬/坪
  est_roi_resale: money("est_roi_resale"),       // 中古屋年投報 %(混合口徑)
  est_roi_resale_market: money("est_roi_resale_market"), // 中古屋年投報 %(排除社宅)
  resale_count: integer("resale_count").default(0), // 中古住宅(屋齡≤8年)樣本數
  presale_premium: money("presale_premium"),     // 預售 vs 中古新古屋溢價 %
  presale_count: integer("presale_count").default(0),
  rent_samples: integer("rent_samples").default(0),
  rent_samples_market: integer("rent_samples_market").default(0),
  is_demo: boolean("is_demo").default(false),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  district: text("district").notNull(),
  lat: money("lat"),
  lng: money("lng"),
  median_total: money("median_total"),           // 中位成交總價(萬)
  median_area: money("median_area"),             // 中位坪數
  unit_price: money("unit_price"),               // 扣車位單價 萬/坪
  est_rent: money("est_rent"),                   // 推估月租(元,混合口徑)
  est_roi: money("est_roi"),
  est_rent_market: money("est_rent_market"),     // 推估月租(排除社宅)
  est_roi_market: money("est_roi_market"),
  rent_samples: integer("rent_samples").default(0),
  rent_samples_market: integer("rent_samples_market").default(0),
  deal_count: integer("deal_count").default(0),
  is_demo: boolean("is_demo").default(false),
}, (t) => [
  unique("projects_name_district_key").on(t.name, t.district),
]);
