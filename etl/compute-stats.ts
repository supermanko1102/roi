/**
 * 由原始交易重算 district_stats 與 projects(覆蓋 demo 資料)
 * 投報率邏輯:
 *   區:median(租金元/坪/月, 目前屋齡1–10年) × 12 ÷ (median(預售單價 萬/坪) × 10000)
 *   建案:推估月租 = 區租金中位 × 建案中位坪數 × 0.85(公設折減粗估)
 * 兩套口徑:混合(全部件)與 market(排除政策性社會住宅租約)
 * 租賃樣本僅計住宅類建物(排除店面/工廠/辦公等)。
 * 中古屋:住宅類、屋齡≤MAX_BUILDING_AGE(與租金池同一屋齡帶),扣車位價與車位坪;
 *   presale_premium = 預售中位單價 vs 中古新古屋中位單價之溢價 %。
 * 樣本 < MIN_SAMPLES 時 est_roi 存 null,前端顯示「資料不足」。
 * 彙總 SQL(percentile_cont/CTE)刻意保留原生寫法,經 drizzle sql template 參數化執行。
 */
import { eq, sql } from "drizzle-orm";
import {
  createDb, district_stats, district_band_stats, projects, buildings, room_stats,
} from "../db/client";
import { MIN_RENT_BUILDING_AGE, MAX_RENT_BUILDING_AGE } from "../src/lib/rent";
import { assertReplacementSafe } from "./replacement-safety";

const MIN_SAMPLES = 5;
const AREA_DISCOUNT = 0.85;
const RESIDENTIAL = "^(住宅大樓|華廈|透天厝|公寓|套房)";

async function main() {
  const allowEmpty = process.argv.includes("--allow-empty");
  const { db, pool } = createDb();

  // 有真中古交易時先清掉 seed 的 demo 件,避免混入區級/棟級統計;
  // 只有 demo 資料時保留,讓 buildings 不被洗成空表
  const [{ n: realSales }] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM sale_deals WHERE raw_season IS DISTINCT FROM 'demo'
  `)).rows as { n: number }[];
  const [{ n: realPresales }] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM presale_deals WHERE is_cancelled IS NOT TRUE
  `)).rows as { n: number }[];
  if (realSales === 0 && realPresales === 0) {
    console.log("[stats] 無真實交易，保留既有 demo／彙總資料");
    await pool.end();
    return;
  }
  const [publishCounts] = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM projects WHERE is_demo IS NOT TRUE) AS previous_projects,
      (SELECT count(*)::int FROM (
        SELECT project_name, city, district FROM presale_deals
        WHERE project_name IS NOT NULL AND project_name <> '' AND is_cancelled IS NOT TRUE
        GROUP BY project_name, city, district HAVING count(*) >= 3
      ) p) AS next_projects,
      (SELECT count(*)::int FROM buildings) AS previous_buildings,
      (SELECT count(DISTINCT s.addr_key)::int FROM sale_deals s
       JOIN geocode_cache g ON g.addr_key = s.addr_key AND g.precision = 'door'
       WHERE s.unit_price > 0) AS next_buildings
  `)).rows as {
    previous_projects: number; next_projects: number;
    previous_buildings: number; next_buildings: number;
  }[];
  assertReplacementSafe("[stats] projects", publishCounts.previous_projects, publishCounts.next_projects, allowEmpty);
  if (realSales > 0)
    assertReplacementSafe("[stats] buildings", publishCounts.previous_buildings, publishCounts.next_buildings, allowEmpty);

  await db.transaction(async (tx) => {
  if (realSales > 0) await tx.execute(sql`DELETE FROM sale_deals WHERE raw_season = 'demo'`);

  await tx.execute(sql`
    WITH p AS (
      SELECT city, district,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_price) AS mup,
             count(*) AS pc
      FROM presale_deals WHERE is_cancelled IS NOT TRUE GROUP BY city, district
    ),
    r AS (
      SELECT city, district,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY rent_per_ping) AS mrp,
             count(*) AS rc,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY rent_per_ping) FILTER (WHERE NOT is_social) AS mrp_mkt,
             count(*) FILTER (WHERE NOT is_social) AS rc_mkt
      FROM rent_deals
      WHERE build_year BETWEEN extract(year FROM now()) - ${MAX_RENT_BUILDING_AGE}
                            AND extract(year FROM now()) - ${MIN_RENT_BUILDING_AGE}
        AND (building_type IS NULL OR building_type ~ ${RESIDENTIAL})
      GROUP BY city, district
    ),
    sa AS (
      SELECT city, district,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_price) AS mup_resale,
             count(*) AS sc
      FROM sale_deals
      WHERE building_type ~ ${RESIDENTIAL}
        AND build_year BETWEEN extract(year FROM now()) - ${MAX_RENT_BUILDING_AGE}
                            AND extract(year FROM now()) - ${MIN_RENT_BUILDING_AGE}
        AND unit_price > 0
      GROUP BY city, district
    )
    INSERT INTO district_stats(city, district, median_unit_price, median_rent_ping, est_roi,
                               median_rent_ping_market, est_roi_market,
                               median_unit_price_resale, est_roi_resale, est_roi_resale_market,
                               resale_count, presale_premium,
                               presale_count, rent_samples, rent_samples_market, is_demo, updated_at)
    SELECT p.city, p.district, p.mup, r.mrp,
           CASE WHEN r.rc >= ${MIN_SAMPLES} AND p.mup > 0
                THEN round((r.mrp * 12 / (p.mup * 10000) * 100)::numeric, 2) END,
           r.mrp_mkt,
           CASE WHEN r.rc_mkt >= ${MIN_SAMPLES} AND p.mup > 0
                THEN round((r.mrp_mkt * 12 / (p.mup * 10000) * 100)::numeric, 2) END,
           sa.mup_resale,
           CASE WHEN r.rc >= ${MIN_SAMPLES} AND sa.sc >= ${MIN_SAMPLES} AND sa.mup_resale > 0
                THEN round((r.mrp * 12 / (sa.mup_resale * 10000) * 100)::numeric, 2) END,
           CASE WHEN r.rc_mkt >= ${MIN_SAMPLES} AND sa.sc >= ${MIN_SAMPLES} AND sa.mup_resale > 0
                THEN round((r.mrp_mkt * 12 / (sa.mup_resale * 10000) * 100)::numeric, 2) END,
           coalesce(sa.sc, 0),
           CASE WHEN sa.sc >= ${MIN_SAMPLES} AND sa.mup_resale > 0
                THEN round(((p.mup / sa.mup_resale - 1) * 100)::numeric, 2) END,
           p.pc, coalesce(r.rc, 0), coalesce(r.rc_mkt, 0), false, now()
    FROM p LEFT JOIN r USING (city, district) LEFT JOIN sa USING (city, district)
    ON CONFLICT (city, district) DO UPDATE SET
      median_unit_price = EXCLUDED.median_unit_price,
      median_rent_ping  = EXCLUDED.median_rent_ping,
      est_roi           = EXCLUDED.est_roi,
      median_rent_ping_market = EXCLUDED.median_rent_ping_market,
      est_roi_market    = EXCLUDED.est_roi_market,
      median_unit_price_resale = EXCLUDED.median_unit_price_resale,
      est_roi_resale    = EXCLUDED.est_roi_resale,
      est_roi_resale_market = EXCLUDED.est_roi_resale_market,
      resale_count      = EXCLUDED.resale_count,
      presale_premium   = EXCLUDED.presale_premium,
      presale_count     = EXCLUDED.presale_count,
      rent_samples      = EXCLUDED.rent_samples,
      rent_samples_market = EXCLUDED.rent_samples_market,
      is_demo           = false,
      updated_at        = now();
  `);

  // 解約件不計入價格/筆數統計,另計 cancel_count 供前端標記
  await tx.execute(sql`
    WITH cx AS (
      SELECT project_name, city, district, count(*) AS n
      FROM presale_deals WHERE is_cancelled GROUP BY project_name, city, district
    )
    INSERT INTO projects(name, city, district, median_total, median_area, unit_price,
                         est_rent, est_roi, est_rent_market, est_roi_market,
                         rent_samples, rent_samples_market, deal_count, cancel_count, is_demo)
    SELECT d.project_name, d.city, d.district,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY d.total_price),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY d.area_ping),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY d.unit_price),
           round(s.median_rent_ping * percentile_cont(0.5) WITHIN GROUP (ORDER BY d.area_ping) * ${AREA_DISCOUNT}),
           CASE WHEN s.rent_samples >= ${MIN_SAMPLES}
                THEN round((s.median_rent_ping * percentile_cont(0.5) WITHIN GROUP (ORDER BY d.area_ping) * ${AREA_DISCOUNT} * 12
                     / (percentile_cont(0.5) WITHIN GROUP (ORDER BY d.total_price) * 10000) * 100)::numeric, 2) END,
           round(s.median_rent_ping_market * percentile_cont(0.5) WITHIN GROUP (ORDER BY d.area_ping) * ${AREA_DISCOUNT}),
           CASE WHEN s.rent_samples_market >= ${MIN_SAMPLES}
                THEN round((s.median_rent_ping_market * percentile_cont(0.5) WITHIN GROUP (ORDER BY d.area_ping) * ${AREA_DISCOUNT} * 12
                     / (percentile_cont(0.5) WITHIN GROUP (ORDER BY d.total_price) * 10000) * 100)::numeric, 2) END,
           s.rent_samples, s.rent_samples_market, count(*), coalesce(max(cx.n), 0), false
    FROM presale_deals d
    JOIN district_stats s ON s.city = d.city AND s.district = d.district
    LEFT JOIN cx ON cx.project_name = d.project_name AND cx.city = d.city AND cx.district = d.district
    WHERE d.project_name IS NOT NULL AND d.project_name <> '' AND d.is_cancelled IS NOT TRUE
    GROUP BY d.project_name, d.city, d.district, s.median_rent_ping, s.rent_samples,
             s.median_rent_ping_market, s.rent_samples_market
    HAVING count(*) >= 3
    ON CONFLICT (city, name, district) DO UPDATE SET
      median_total = EXCLUDED.median_total,
      median_area  = EXCLUDED.median_area,
      unit_price   = EXCLUDED.unit_price,
      est_rent     = EXCLUDED.est_rent,
      est_roi      = EXCLUDED.est_roi,
      est_rent_market = EXCLUDED.est_rent_market,
      est_roi_market  = EXCLUDED.est_roi_market,
      rent_samples = EXCLUDED.rent_samples,
      rent_samples_market = EXCLUDED.rent_samples_market,
      deal_count   = EXCLUDED.deal_count,
      cancel_count = EXCLUDED.cancel_count,
      is_demo      = false;
  `);
  // 保留仍存在建案的定位結果；只移除已不符合彙總門檻的舊案。
  // 新案維持 lat/lng=null，後續 geocode-projects 再以 cache 或精確地址定位。
  await tx.execute(sql`
    DELETE FROM projects p
    WHERE p.is_demo = false
      AND NOT EXISTS (
        SELECT 1 FROM presale_deals d
        WHERE d.project_name = p.name AND d.city = p.city AND d.district = p.district
          AND d.project_name IS NOT NULL AND d.project_name <> ''
          AND d.is_cancelled IS NOT TRUE
        GROUP BY d.project_name, d.city, d.district
        HAVING count(*) >= 3
      );
  `);
  // 棟級彙總:中古交易按門牌歸戶 + geocode 座標(只收已定位的)。
  // 僅在有真資料時重建,否則保留 seed 直插的 demo 棟級點位
  if (realSales > 0) {
    await tx.delete(buildings);
    await tx.execute(sql`
      INSERT INTO buildings(addr_key, city, district, lat, lng, deal_count,
                            median_unit_price, median_total, building_type, build_year, last_deal)
      SELECT s.addr_key, min(s.city), min(s.district), g.lat, g.lng, count(*),
             percentile_cont(0.5) WITHIN GROUP (ORDER BY s.unit_price),
             percentile_cont(0.5) WITHIN GROUP (ORDER BY s.total_price),
             mode() WITHIN GROUP (ORDER BY s.building_type),
             max(s.build_year), max(s.deal_date)
      FROM sale_deals s
      JOIN geocode_cache g ON g.addr_key = s.addr_key AND g.precision = 'door'
      WHERE s.unit_price > 0
      GROUP BY s.addr_key, g.lat, g.lng;
    `);
  }

  // 房數帶彙總:格局篩選時前端用它覆寫點位的價格/總價/筆數
  // resale=棟級(僅已定位門牌,與 buildings 同口徑);presale=建案級(排除解約件)
  await tx.delete(room_stats);
  await tx.execute(sql`
    INSERT INTO room_stats(kind, key, room_band, deal_count, median_unit_price, median_total)
    SELECT 'resale', s.addr_key,
           CASE WHEN s.rooms <= 1 THEN '1' WHEN s.rooms = 2 THEN '2'
                WHEN s.rooms = 3 THEN '3' ELSE '4p' END AS band,
           count(*),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.unit_price),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.total_price)
    FROM sale_deals s
    JOIN geocode_cache g ON g.addr_key = s.addr_key AND g.precision = 'door'
    WHERE s.unit_price > 0 AND s.rooms IS NOT NULL AND s.raw_season IS DISTINCT FROM 'demo'
    GROUP BY s.addr_key, band;
  `);
  await tx.execute(sql`
    INSERT INTO room_stats(kind, key, room_band, deal_count, median_unit_price, median_total)
    SELECT 'presale', d.city || '|' || d.district || '|' || d.project_name,
           CASE WHEN d.rooms <= 1 THEN '1' WHEN d.rooms = 2 THEN '2'
                WHEN d.rooms = 3 THEN '3' ELSE '4p' END AS band,
           count(*),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY d.unit_price),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY d.total_price)
    FROM presale_deals d
    WHERE d.project_name IS NOT NULL AND d.project_name <> ''
      AND d.is_cancelled IS NOT TRUE AND d.rooms IS NOT NULL AND d.unit_price > 0
    GROUP BY d.city || '|' || d.district || '|' || d.project_name, band;
  `);

  // 行政區 × 屋齡帶預算，供 /api/districts 直接讀取。
  await tx.delete(district_band_stats);
  await tx.execute(sql`
    WITH deals AS (
      SELECT city, district, unit_price,
             CASE WHEN build_year IS NULL THEN 'unknown'
                  WHEN extract(year FROM now()) - build_year < 5  THEN '0_5'
                  WHEN extract(year FROM now()) - build_year < 10 THEN '5_10'
                  WHEN extract(year FROM now()) - build_year < 20 THEN '10_20'
                  ELSE '20p' END AS band
      FROM sale_deals
      WHERE building_type ~ ${RESIDENTIAL} AND unit_price > 0
        AND raw_season IS DISTINCT FROM 'demo'
      UNION ALL
      SELECT city, district, unit_price, 'presale' FROM presale_deals
      WHERE unit_price > 0 AND is_cancelled IS NOT TRUE
    )
    INSERT INTO district_band_stats(city, district, band, median_unit_price, samples, updated_at)
    SELECT city, district, coalesce(band, 'all'),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_price), count(*)::int, now()
    FROM deals
    GROUP BY GROUPING SETS ((city, district, band), (city, district));
  `);

  // 有真資料後把 demo 清掉
  const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM district_stats WHERE is_demo = false`)).rows as { n: number }[];
  if (n > 0) {
    await tx.delete(district_stats).where(eq(district_stats.is_demo, true));
    await tx.delete(projects).where(eq(projects.is_demo, true));
  }
  });
  console.log("stats updated");
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
