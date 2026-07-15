/**
 * 由原始交易重算 district_stats 與 projects(覆蓋 demo 資料)
 * 投報率邏輯:
 *   區:median(租金元/坪/月, 屋齡<8年) × 12 ÷ (median(預售單價 萬/坪) × 10000)
 *   建案:推估月租 = 區租金中位 × 建案中位坪數 × 0.85(公設折減粗估)
 * 兩套口徑:混合(全部件)與 market(排除社會住宅包租代管件,租金受政策壓低約 5 成)
 * 租賃樣本僅計住宅類建物(排除店面/工廠/辦公等)。
 * 中古屋:住宅類、屋齡≤MAX_BUILDING_AGE(與租金池同一屋齡帶),扣車位價與車位坪;
 *   presale_premium = 預售中位單價 vs 中古新古屋中位單價之溢價 %。
 * 樣本 < MIN_SAMPLES 時 est_roi 存 null,前端顯示「資料不足」。
 * 彙總 SQL(percentile_cont/CTE)刻意保留原生寫法,經 drizzle sql template 參數化執行。
 */
import { eq, sql } from "drizzle-orm";
import { createDb, district_stats, projects, buildings } from "../db/client";

const MIN_SAMPLES = 5;
const MAX_BUILDING_AGE = 8;
const AREA_DISCOUNT = 0.85;
const RESIDENTIAL = "^(住宅大樓|華廈|透天厝|公寓|套房)";

async function main() {
  const { db, pool } = createDb();

  await db.execute(sql`
    WITH p AS (
      SELECT district,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_price) AS mup,
             count(*) AS pc
      FROM presale_deals GROUP BY district
    ),
    r AS (
      SELECT district,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY rent_per_ping) AS mrp,
             count(*) AS rc,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY rent_per_ping) FILTER (WHERE NOT is_social) AS mrp_mkt,
             count(*) FILTER (WHERE NOT is_social) AS rc_mkt
      FROM rent_deals
      WHERE (build_year IS NULL OR build_year >= extract(year FROM now()) - ${MAX_BUILDING_AGE})
        AND (building_type IS NULL OR building_type ~ ${RESIDENTIAL})
      GROUP BY district
    ),
    sa AS (
      SELECT district,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_price) AS mup_resale,
             count(*) AS sc
      FROM sale_deals
      WHERE building_type ~ ${RESIDENTIAL}
        AND build_year IS NOT NULL AND build_year >= extract(year FROM now()) - ${MAX_BUILDING_AGE}
        AND unit_price > 0
      GROUP BY district
    )
    INSERT INTO district_stats(district, median_unit_price, median_rent_ping, est_roi,
                               median_rent_ping_market, est_roi_market,
                               median_unit_price_resale, est_roi_resale, est_roi_resale_market,
                               resale_count, presale_premium,
                               presale_count, rent_samples, rent_samples_market, is_demo, updated_at)
    SELECT p.district, p.mup, r.mrp,
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
    FROM p LEFT JOIN r USING (district) LEFT JOIN sa USING (district)
    ON CONFLICT (district) DO UPDATE SET
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

  await db.delete(projects).where(eq(projects.is_demo, false));
  await db.execute(sql`
    INSERT INTO projects(name, district, median_total, median_area, unit_price,
                         est_rent, est_roi, est_rent_market, est_roi_market,
                         rent_samples, rent_samples_market, deal_count, is_demo)
    SELECT d.project_name, d.district,
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
           s.rent_samples, s.rent_samples_market, count(*), false
    FROM presale_deals d
    JOIN district_stats s ON s.district = d.district
    WHERE d.project_name IS NOT NULL AND d.project_name <> ''
    GROUP BY d.project_name, d.district, s.median_rent_ping, s.rent_samples,
             s.median_rent_ping_market, s.rent_samples_market
    HAVING count(*) >= 3
    ON CONFLICT (name, district) DO UPDATE SET
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
      is_demo      = false;
  `);
  // 棟級彙總:中古交易按門牌歸戶 + geocode 座標(只收已定位的)
  await db.delete(buildings);
  await db.execute(sql`
    INSERT INTO buildings(addr_key, district, lat, lng, deal_count,
                          median_unit_price, median_total, building_type, build_year, last_deal)
    SELECT s.addr_key, min(s.district), g.lat, g.lng, count(*),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.unit_price),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.total_price),
           mode() WITHIN GROUP (ORDER BY s.building_type),
           max(s.build_year), max(s.deal_date)
    FROM sale_deals s
    JOIN geocode_cache g ON g.addr_key = s.addr_key AND g.precision = 'door'
    WHERE s.unit_price > 0
    GROUP BY s.addr_key, g.lat, g.lng;
  `);

  // 有真資料後把 demo 清掉
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM district_stats WHERE is_demo = false`)).rows as { n: number }[];
  if (n > 0) {
    await db.delete(district_stats).where(eq(district_stats.is_demo, true));
    await db.delete(projects).where(eq(projects.is_demo, true));
  }
  console.log("stats updated");
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
