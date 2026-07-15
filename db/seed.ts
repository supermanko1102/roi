/**
 * 示範種子資料:讓專案不跑 ETL 也能起來。跑過 etl:all 後會被真資料覆蓋。
 * 可重複執行(ON CONFLICT DO NOTHING)。
 */
import { sql, eq } from "drizzle-orm";
import { createDb, district_stats, projects } from "./client";

const DISTRICTS: (typeof district_stats.$inferInsert)[] = [
  { district: "桃園區", median_unit_price: 43.3, median_rent_ping: 740, est_roi: 2.05, presale_count: 128, rent_samples: 96, is_demo: true },
  { district: "龜山區", median_unit_price: 44.2, median_rent_ping: 865, est_roi: 2.35, presale_count: 87,  rent_samples: 74, is_demo: true },
  { district: "中壢區", median_unit_price: 38.4, median_rent_ping: 672, est_roi: 2.10, presale_count: 143, rent_samples: 88, is_demo: true },
  { district: "八德區", median_unit_price: 36.1, median_rent_ping: 737, est_roi: 2.45, presale_count: 65,  rent_samples: 52, is_demo: true },
  { district: "蘆竹區", median_unit_price: 35.2, median_rent_ping: 645, est_roi: 2.20, presale_count: 58,  rent_samples: 41, is_demo: true },
  { district: "大園區", median_unit_price: 32.8, median_rent_ping: 588, est_roi: 2.15, presale_count: 46,  rent_samples: 29, is_demo: true },
  { district: "平鎮區", median_unit_price: 30.5, median_rent_ping: 635, est_roi: 2.50, presale_count: 39,  rent_samples: 33, is_demo: true },
  { district: "楊梅區", median_unit_price: 25.4, median_rent_ping: 540, est_roi: 2.55, presale_count: 31,  rent_samples: 24, is_demo: true },
  { district: "龍潭區", median_unit_price: 24.8, median_rent_ping: 537, est_roi: 2.60, presale_count: 27,  rent_samples: 18, is_demo: true },
  { district: "大溪區", median_unit_price: 23.5, median_rent_ping: 470, est_roi: 2.40, presale_count: 14,  rent_samples: 11, is_demo: true },
  { district: "觀音區", median_unit_price: 21.2, median_rent_ping: 468, est_roi: 2.65, presale_count: 12,  rent_samples: 8,  is_demo: true },
  { district: "新屋區", median_unit_price: 19.6, median_rent_ping: 441, est_roi: 2.70, presale_count: 7,   rent_samples: 6,  is_demo: true },
];

const PROJECTS: (typeof projects.$inferInsert)[] = [
  { name: "擎天藝文", district: "桃園區", lat: 24.9990, lng: 121.3000, median_total: 2150, median_area: 31, unit_price: 63.2, est_rent: 33000, est_roi: 1.84, rent_samples: 10, deal_count: 22, is_demo: true },
  { name: "樾中央",   district: "桃園區", lat: 24.9812, lng: 121.3055, median_total: 1720, median_area: 29, unit_price: 53.6, est_rent: 29000, est_roi: 2.02, rent_samples: 11, deal_count: 31, is_demo: true },
  { name: "悅河灣",   district: "桃園區", lat: 25.0062, lng: 121.3208, median_total: 1650, median_area: 28, unit_price: 53.2, est_rent: 28000, est_roi: 2.04, rent_samples: 9,  deal_count: 18, is_demo: true },
  { name: "城心站前", district: "桃園區", lat: 24.9895, lng: 121.3125, median_total: 1450, median_area: 25, unit_price: 52.0, est_rent: 27500, est_roi: 2.28, rent_samples: 15, deal_count: 26, is_demo: true },
  { name: "峰匯青埔", district: "中壢區", lat: 25.0128, lng: 121.2148, median_total: 1980, median_area: 33, unit_price: 54.5, est_rent: 32000, est_roi: 1.94, rent_samples: 14, deal_count: 40, is_demo: true },
  { name: "鉑麗海華", district: "中壢區", lat: 24.9645, lng: 121.2168, median_total: 1560, median_area: 27, unit_price: 52.0, est_rent: 27000, est_roi: 2.08, rent_samples: 12, deal_count: 15, is_demo: true },
  { name: "灣岸A19",  district: "大園區", lat: 25.0335, lng: 121.2260, median_total: 1690, median_area: 30, unit_price: 50.7, est_rent: 28500, est_roi: 2.02, rent_samples: 7,  deal_count: 12, is_demo: true },
  { name: "山王A7",   district: "龜山區", lat: 25.0216, lng: 121.3654, median_total: 1280, median_area: 26, unit_price: 43.8, est_rent: 26500, est_roi: 2.48, rent_samples: 17, deal_count: 55, is_demo: true },
  { name: "鉑悅A7",   district: "龜山區", lat: 25.0180, lng: 121.3700, median_total: 1350, median_area: 28, unit_price: 43.0, est_rent: 27000, est_roi: 2.40, rent_samples: 17, deal_count: 38, is_demo: true },
  { name: "大砌八德", district: "八德區", lat: 24.9460, lng: 121.2965, median_total: 1180, median_area: 27, unit_price: 38.9, est_rent: 24500, est_roi: 2.49, rent_samples: 13, deal_count: 20, is_demo: true },
  { name: "觀止大湳", district: "八德區", lat: 24.9585, lng: 121.3120, median_total: 1250, median_area: 26, unit_price: 42.9, est_rent: 25000, est_roi: 2.40, rent_samples: 3,  deal_count: 9,  is_demo: true },
  { name: "平鎮心",   district: "平鎮區", lat: 24.9450, lng: 121.2180, median_total: 990,  median_area: 25, unit_price: 34.8, est_rent: 21000, est_roi: 2.55, rent_samples: 8,  deal_count: 14, is_demo: true },
  { name: "埔心之丘", district: "楊梅區", lat: 24.9210, lng: 121.1660, median_total: 880,  median_area: 24, unit_price: 32.1, est_rent: 18500, est_roi: 2.52, rent_samples: 6,  deal_count: 10, is_demo: true },
];

async function main() {
  const { db, pool } = createDb();

  await db.insert(district_stats).values(DISTRICTS).onConflictDoNothing();
  await db.insert(projects).values(PROJECTS).onConflictDoNothing();

  // 示範用「排除社宅」口徑:以混合值粗放大(真資料由 compute-stats 重算)
  await db.update(district_stats).set({
    median_rent_ping_market: sql`round(median_rent_ping * 1.9)`,
    est_roi_market: sql`round((est_roi * 1.9)::numeric, 2)`,
    rent_samples_market: sql`ceil(rent_samples * 0.4)`,
  }).where(eq(district_stats.is_demo, true));
  await db.update(projects).set({
    est_rent_market: sql`round(est_rent * 1.9)`,
    est_roi_market: sql`round((est_roi * 1.9)::numeric, 2)`,
    rent_samples_market: sql`ceil(rent_samples * 0.4)`,
  }).where(eq(projects.is_demo, true));

  console.log("demo seed done");
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
