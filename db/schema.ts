/**
 * 唯一的 schema 來源:改表 → npm run db:generate 產 migration → npm run db:migrate 套用。
 * 屬性名刻意用 snake_case,讓 select 回傳的 JSON 形狀與既有 API/前端一致。
 */
import {
  pgTable, serial, text, date, numeric, integer, boolean, timestamp, index, unique, primaryKey,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { mode: "number" });

// 原始交易資料(ETL 寫入)
export const presale_deals = pgTable("presale_deals", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),                  // 城市(資料原生寫法,如「臺北市」;見 lib/cities)
  district: text("district").notNull(),          // 鄉鎮市區(CSV 原生欄位,免 geocoding)
  project_name: text("project_name"),            // 建案名稱
  address: text("address"),                      // 區段化門牌
  deal_date: date("deal_date"),
  total_price: money("total_price"),             // 總價(萬)
  parking_price: money("parking_price").default(0), // 車位總價(萬)
  area_ping: money("area_ping"),                 // 建物移轉總面積(坪)
  parking_area_ping: money("parking_area_ping").default(0), // 車位移轉總面積(坪)
  unit_price: money("unit_price"),               // 扣車位單價(萬/坪,分母亦扣車位坪)
  rooms: integer("rooms"),                       // 建物現況格局-房
  halls: integer("halls"),                       // 建物現況格局-廳
  baths: integer("baths"),                       // 建物現況格局-衛
  floor_no: integer("floor_no"),                 // 移轉層次(取首層;「全」/地下層為 null)
  total_floors: integer("total_floors"),         // 總樓層數
  is_cancelled: boolean("is_cancelled").default(false), // 解約情形有註記(價格統計應排除)
  cancel_date: date("cancel_date"),              // 解約日期(解約情形欄開頭的民國日期)
  unit_id: text("unit_id"),                      // 棟及號(如「B棟6-9F號」;distinct 計戶數/去化用)
  raw_season: text("raw_season"),
}, (t) => [
  index("idx_presale_district").on(t.city, t.district),
  index("idx_presale_project").on(t.project_name),
]);

// 中古/成屋買賣(a 檔;僅含建物之交易,純土地/車位已濾除)
export const sale_deals = pgTable("sale_deals", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),
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
  rooms: integer("rooms"),                       // 建物現況格局-房
  halls: integer("halls"),                       // 建物現況格局-廳
  baths: integer("baths"),                       // 建物現況格局-衛
  floor_no: integer("floor_no"),                 // 移轉層次(取首層;「全」/地下層為 null)
  total_floors: integer("total_floors"),         // 總樓層數
  raw_season: text("raw_season"),
}, (t) => [
  index("idx_sale_district").on(t.city, t.district),
  index("idx_sale_addr_key").on(t.addr_key),
]);

// 門牌 → 座標快取(NLSC 定位,一次性回填後增量)
export const geocode_cache = pgTable("geocode_cache", {
  addr_key: text("addr_key").primaryKey(),
  lat: money("lat"),
  lng: money("lng"),
  precision: text("precision"),                  // door=門牌 | cross=確切路口 | none=查無/僅路名
  queried_at: timestamp("queried_at", { withTimezone: true }).defaultNow(),
});

// 棟級彙總(compute-stats 由 sale_deals × geocode_cache 重建)
export const buildings = pgTable("buildings", {
  addr_key: text("addr_key").primaryKey(),
  city: text("city").notNull(),
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
  index("idx_buildings_district").on(t.city, t.district),
]);

export const rent_deals = pgTable("rent_deals", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),
  district: text("district").notNull(),
  address: text("address"),
  deal_date: date("deal_date"),
  monthly_rent: money("monthly_rent"),           // 月租(元)
  housing_rent: money("housing_rent"),           // 扣已申報車位租金後的房屋月租
  parking_rent: money("parking_rent").default(0),
  area_ping: money("area_ping"),
  parking_area_ping: money("parking_area_ping").default(0),
  rent_per_ping: money("rent_per_ping"),         // 元/坪/月
  build_year: integer("build_year"),             // 建築完成年(西元,可為 null)
  building_type: text("building_type"),          // 建物型態(住宅大樓/華廈/店面...)
  rental_type: text("rental_type"),              // 整棟(戶)出租/分層出租/分租套房等
  rooms: integer("rooms"),
  halls: integer("halls"),
  baths: integer("baths"),
  floor_no: integer("floor_no"),
  total_floors: integer("total_floors"),
  service_type: text("service_type"),            // 一般/社會住宅包租轉租/社會住宅代管
  is_social: boolean("is_social").default(false),// 社會住宅包租代管件；與市場相似案例分開統計
  addr_key: text("addr_key"),                    // 去樓層門牌(實登2.0起租賃有完整門牌)
  raw_season: text("raw_season"),
}, (t) => [
  index("idx_rent_district").on(t.city, t.district),
  index("idx_rent_addr_key").on(t.addr_key),
]);

// 預售建案備查(plvr「預售備查建案下載」;實登 2.0 之後才有,match-communities 重建)
export const communities = pgTable("communities", {
  case_no: text("case_no").primaryKey(),      // 備查編號
  name: text("name").notNull(),               // 建案名稱
  city: text("city").notNull(),
  district: text("district").notNull(),
  households: integer("households"),          // 戶數
  street: text("street"),                     // 坐落街道(工地位置描述)
  permit_no: text("permit_no"),               // 建造執照字號
  first_reg: date("first_reg"),               // 第1次登記日期(≈完工/交屋)
  declare_date: date("declare_date"),         // 申報備查日期
  use_issue_date: date("use_issue_date"),     // 使照發照日(建照號碼 join use_permits;優先於 first_reg 判屋齡)
}, (t) => [
  index("idx_communities_district").on(t.city, t.district),
]);

// 實體社區：一個社區可對應多個預售備查案(case_no)與多個門牌。
export const physical_communities = pgTable("physical_communities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  district: text("district").notNull(),
  permit_no: text("permit_no"),
  build_year: integer("build_year"),
  lat: money("lat"),
  lng: money("lng"),
}, (t) => [
  index("idx_physical_communities_district").on(t.city, t.district),
]);

export const community_cases = pgTable("community_cases", {
  case_no: text("case_no").primaryKey(),
  community_id: integer("community_id").notNull(),
}, (t) => [
  index("idx_community_cases_community").on(t.community_id),
]);

// 門牌 → 建案歸戶(中古交易地號 × 建案坐落地號交集;match-communities 重建)
export const building_community = pgTable("building_community", {
  addr_key: text("addr_key").primaryKey(),
  case_no: text("case_no").notNull(),
  community_id: integer("community_id"),
  matched_parcels: integer("matched_parcels").default(0), // 交集地號數(信心參考)
  match_method: text("match_method").default("parcel"),
  confidence: integer("confidence").default(100),
}, (t) => [
  index("idx_building_community_entity").on(t.community_id),
]);

// 租金補貼有效租約公布之區域基準；它是大樣本校驗值，不取代 1–10 年單筆比較租約。
export const rent_benchmarks = pgTable("rent_benchmarks", {
  id: serial("id").primaryKey(),
  period: date("period").notNull(),
  city: text("city").notNull(),
  district: text("district").notNull(),
  rental_type: text("rental_type").notNull(),
  age_group: text("age_group").notNull(),
  samples: integer("samples").notNull(),
  q25: money("q25").notNull(),
  median: money("median").notNull(),
  q75: money("q75").notNull(),
  source_url: text("source_url").notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  unique("rent_benchmarks_grain_key").on(
    t.period, t.city, t.district, t.rental_type, t.age_group,
  ),
  index("idx_rent_benchmarks_district").on(t.city, t.district),
]);

// 生活圈租金行情(compute-zone-rents 重建;供圈級投報與抽屜推估用)
export const zone_stats = pgTable("zone_stats", {
  city: text("city").notNull(),
  zone: text("zone").notNull(),                  // 生活圈名(對應 zones geojson 的 name)
  median_rent_ping_market: money("median_rent_ping_market"), // 元/坪/月,排除社宅
  rent_samples_market: integer("rent_samples_market").default(0),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.city, t.zone] }),
]);

// 彙總層(compute-stats 重算;seed 先塞示範值)
export const district_stats = pgTable("district_stats", {
  city: text("city").notNull(),
  district: text("district").notNull(),
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
}, (t) => [
  primaryKey({ columns: [t.city, t.district] }),
]);

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  city: text("city").notNull(),
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
  cancel_count: integer("cancel_count").default(0), // 曾解約筆數(不計入價格統計)
  is_demo: boolean("is_demo").default(false),
}, (t) => [
  unique("projects_name_district_key").on(t.city, t.name, t.district),
]);

// 使用執照(雙北開放資料;etl/import-use-permits.ts 逐市重建)
// 屋齡判定順序:使照發照日 > 備查第1次登記(桃園無使照資料,維持備查推算)
export const use_permits = pgTable("use_permits", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),
  license_no: text("license_no").notNull(),      // 使照號碼(原文)
  permit_no_norm: text("permit_no_norm"),        // 正規化建照號碼(與 communities.permit_no join 用)
  issue_date: date("issue_date"),                // 發照日期
  complete_date: date("complete_date"),          // 完工日期(台北摘要才有)
  address: text("address"),
  source: text("source"),
}, (t) => [
  unique("use_permits_city_license_key").on(t.city, t.license_no),
  index("idx_use_permits_permit").on(t.city, t.permit_no_norm),
]);

// 預售定型化契約備查的建材設備表(etl/fetch-contract-materials.ts 增量抓取)
// 來源:lvr 預售屋建案查詢 → 契約 PDF(mlvr 直鏈)→ pdftotext 抽附件「建材設備表」
export const contract_materials = pgTable("contract_materials", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),
  district: text("district").notNull(),
  project_name: text("project_name").notNull(),
  mlvr_case_no: text("mlvr_case_no"),            // 下載路徑案號(如 G2H011312020003-01)
  pdf_url: text("pdf_url"),                      // 房屋契約 PDF 官方直鏈
  version_note: text("version_note"),            // 版次說明(檔名)
  declare_date: text("declare_date"),            // 申報/變更備查日期(民國字串)
  materials_text: text("materials_text"),        // 建材設備表全文
  sections: text("sections"),                    // JSON:[{title, body}] 依 ※/分類標題切分
  status: text("status").notNull(),              // ok | no_materials | no_case | fetch_failed
  fetched_at: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  unique("contract_materials_project_key").on(t.city, t.district, t.project_name),
]);

// 房數帶彙總(compute-stats 重建):格局篩選時覆寫點位的價格/總價/筆數
// kind=resale 的 key 是 addr_key(含城市前綴);kind=presale 的 key 是 `${city}|${district}|${name}`
export const room_stats = pgTable("room_stats", {
  kind: text("kind").notNull(),                  // resale | presale
  key: text("key").notNull(),
  room_band: text("room_band").notNull(),        // 1(含0房套房) | 2 | 3 | 4p
  deal_count: integer("deal_count").default(0),
  median_unit_price: money("median_unit_price"), // 扣車位 萬/坪
  median_total: money("median_total"),           // 中位總價(萬)
}, (t) => [
  unique("room_stats_pk").on(t.kind, t.key, t.room_band),
  index("idx_room_stats_band").on(t.room_band),
]);
