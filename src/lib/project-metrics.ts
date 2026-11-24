import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { CITY_NAMES } from "@/lib/cities";
import { makeContains } from "@/lib/geo";
import {
  MAX_RENT_BUILDING_AGE, MIN_RENT_BUILDING_AGE, RENT_FALLBACK_RADIUS_M,
  RENT_LOOKBACK_YEARS, RENT_PRIMARY_RADIUS_M,
} from "@/lib/rent";
import {
  DEV_MIN_OWN_DEALS, PointGrid, YIELD_MIN_LEASES, cancelRate, deviation, grossYield, median, recentPriceUsable,
  type Peer, type ProjectMetrics,
} from "@/lib/metrics-core";

// 建案判讀指標:請求時由原始成交/租約即時算出,不落表(免 migration、資料一更新就跟著變)。
//  - 比行情:本案近一年中位單價 vs 同生活圈「其他」預售案近一年行情;圈內樣本不足退回行政區。
//    只比近一年,是因為拿多年前完銷案的價格跟現在比沒有意義。
//  - 租金回報:本社區實際租約優先;沒有就取附近屋齡 1–10 年住宅租約(1 公里,不足放寬到 2.5 公里)。
//  - 解約率:解約筆數 ÷ (成交+解約)。
// 全量算一次約數百毫秒,行程內快取 10 分鐘;對外回應另有 CDN 快取。

const RESIDENTIAL = "^(住宅大樓|華廈|透天厝|公寓|套房)";
const TTL_MS = 10 * 60 * 1000;

export const projectKey = (city: string, district: string, name: string) => `${city}|${district}|${name}`;

type Zone = { name: string; city: string; contains: (lng: number, lat: number) => boolean };
let zoneCache: Zone[] | null = null;
function loadZones(): Zone[] {
  if (zoneCache) return zoneCache;
  const geo = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "zones.geojson"), "utf-8"));
  zoneCache = (geo.features as any[])
    .filter((f) => CITY_NAMES.includes(f.properties.city) && f.properties.name)
    .map((f) => ({
      name: String(f.properties.name), city: String(f.properties.city),
      contains: makeContains(f.geometry),
    }));
  return zoneCache;
}

async function compute(): Promise<Map<string, ProjectMetrics>> {
  const [recentRes, projRes, leaseRes, commRes] = await Promise.all([
    // 基準日取資料內最新成交日(實登有申報時差),避免「近一年」被今天的日期吃掉一段
    db.execute(sql`
      WITH ref AS (
        SELECT least(max(deal_date), current_date) AS d FROM presale_deals WHERE is_cancelled IS NOT TRUE
      )
      SELECT pd.city, pd.district, pd.project_name AS name,
             count(*) FILTER (WHERE pd.deal_date >= ref.d - interval '12 months' AND pd.unit_price > 0)::int AS recent_n,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY pd.unit_price)
               FILTER (WHERE pd.deal_date >= ref.d - interval '12 months' AND pd.unit_price > 0))::float AS recent_price,
             to_char(max(pd.deal_date), 'YYYY-MM-DD') AS last_deal
      FROM presale_deals pd CROSS JOIN ref
      WHERE pd.project_name IS NOT NULL AND pd.project_name <> '' AND pd.is_cancelled IS NOT TRUE
      GROUP BY pd.city, pd.district, pd.project_name
    `),
    db.execute(sql`
      SELECT pj.city, pj.district, pj.name, pj.lat::float AS lat, pj.lng::float AS lng,
             pj.unit_price::float AS unit_price,
             coalesce(pj.deal_count, 0)::int AS deal_count, coalesce(pj.cancel_count, 0)::int AS cancel_count
      FROM projects pj WHERE pj.is_demo IS NOT TRUE
    `),
    // 與 /api/rentals 同一套口徑:屋齡 1–10 年住宅、排除社宅、濾掉離譜值;DISTINCT 去掉重複申報
    db.execute(sql`
      SELECT gc.lat::float AS lat, gc.lng::float AS lng, lease.rent_per_ping::float AS rpp
      FROM (
        SELECT DISTINCT rd.addr_key, rd.deal_date, rd.monthly_rent, rd.area_ping, rd.floor_no, rd.rent_per_ping
        FROM rent_deals rd
        WHERE rd.addr_key IS NOT NULL AND rd.is_social IS NOT TRUE
          AND rd.build_year BETWEEN extract(year FROM now()) - ${MAX_RENT_BUILDING_AGE}
                                AND extract(year FROM now()) - ${MIN_RENT_BUILDING_AGE}
          AND rd.building_type ~ ${RESIDENTIAL}
          AND rd.monthly_rent BETWEEN 3000 AND 200000
          AND rd.area_ping BETWEEN 3 AND 200
          AND rd.rent_per_ping BETWEEN 150 AND 5000
          AND rd.deal_date >= now() - make_interval(years => ${RENT_LOOKBACK_YEARS})
      ) lease
      JOIN geocode_cache gc ON gc.addr_key = lease.addr_key AND gc.precision = 'door'
      WHERE gc.lat IS NOT NULL AND gc.lng IS NOT NULL
    `),
    db.execute(sql`
      SELECT cm.city, cm.district, cm.name,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY lease.rent_per_ping))::float AS rpp,
             count(*)::int AS n
      FROM communities cm
      JOIN building_community bc ON bc.case_no = cm.case_no
      JOIN (
        SELECT DISTINCT rd.addr_key, rd.deal_date, rd.monthly_rent, rd.area_ping, rd.floor_no, rd.rent_per_ping
        FROM rent_deals rd
        WHERE rd.is_social IS NOT TRUE AND rd.rent_per_ping BETWEEN 150 AND 5000
          AND rd.deal_date >= now() - make_interval(years => ${RENT_LOOKBACK_YEARS})
      ) lease ON lease.addr_key = bc.addr_key
      GROUP BY cm.city, cm.district, cm.name
      HAVING count(*) >= ${YIELD_MIN_LEASES}
    `),
  ]);

  type Recent = { city: string; district: string; name: string; recent_n: number; recent_price: number | null; last_deal: string | null };
  type Proj = { city: string; district: string; name: string; lat: number | null; lng: number | null; unit_price: number | null; deal_count: number; cancel_count: number };
  const recent = new Map<string, Recent>();
  for (const r of recentRes.rows as Recent[]) recent.set(projectKey(r.city, r.district, r.name), r);
  const commRent = new Map<string, { rpp: number; n: number }>();
  for (const r of commRes.rows as { city: string; district: string; name: string; rpp: number; n: number }[])
    commRent.set(projectKey(r.city, r.district, r.name), { rpp: r.rpp, n: r.n });
  const leases = new PointGrid(leaseRes.rows as { lat: number; lng: number; rpp: number }[]);
  const zones = loadZones();
  const projs = projRes.rows as Proj[];

  // 建案 → 生活圈(有座標才判得出);同圈/同區的 peers 只收近一年有成交的案
  const zoneOf = new Map<string, string>();
  const zonePeers = new Map<string, Peer[]>();
  const districtPeers = new Map<string, Peer[]>();
  for (const p of projs) {
    const key = projectKey(p.city, p.district, p.name);
    const r = recent.get(key);
    const zone = p.lat != null && p.lng != null
      ? zones.find((z) => z.city === p.city && z.contains(p.lng!, p.lat!)) : undefined;
    if (zone) zoneOf.set(key, zone.name);
    if (!r || r.recent_n < DEV_MIN_OWN_DEALS || !recentPriceUsable(r.recent_price, p.unit_price)) continue;
    const peer: Peer = { key, price: r.recent_price!, deals: r.recent_n };
    const dk = `${p.city}|${p.district}`;
    (districtPeers.get(dk) ?? districtPeers.set(dk, []).get(dk)!).push(peer);
    if (zone) {
      const zk = `${p.city}|${zone.name}`;
      (zonePeers.get(zk) ?? zonePeers.set(zk, []).get(zk)!).push(peer);
    }
  }

  const out = new Map<string, ProjectMetrics>();
  for (const p of projs) {
    const key = projectKey(p.city, p.district, p.name);
    const r = recent.get(key);
    const recentN = r?.recent_n ?? 0;
    const recentPrice = r && recentPriceUsable(r.recent_price, p.unit_price) ? r.recent_price : null;

    const zoneName = zoneOf.get(key);
    const viaZone = zoneName
      ? deviation(key, recentPrice, recentN, zonePeers.get(`${p.city}|${zoneName}`) ?? []) : null;
    const viaDistrict = viaZone
      ? null : deviation(key, recentPrice, recentN, districtPeers.get(`${p.city}|${p.district}`) ?? []);
    const dev = viaZone ?? viaDistrict;

    // 租金回報的分母:近一年有足夠成交就用近一年價,否則用全期中位(完銷案買進的價格)
    const basePrice = recentN >= DEV_MIN_OWN_DEALS && recentPrice != null ? recentPrice : p.unit_price;
    let yieldSrc: ProjectMetrics["yield_src"] = null, rent: number | null = null, n = 0, radius: number | null = null;
    const own = commRent.get(key);
    if (own) { yieldSrc = "community"; rent = own.rpp; n = own.n; }
    else if (p.lat != null && p.lng != null) {
      for (const rad of [RENT_PRIMARY_RADIUS_M, RENT_FALLBACK_RADIUS_M]) {
        const near = leases.within(p.lat, p.lng, rad);
        if (near.length >= YIELD_MIN_LEASES) {
          yieldSrc = "nearby"; rent = median(near.map((l) => l.rpp)); n = near.length; radius = rad;
          break;
        }
      }
    }
    const yieldPct = grossYield(rent, basePrice);

    out.set(key, {
      recent_n: recentN,
      recent_price: recentPrice == null ? null : +recentPrice.toFixed(1),
      last_deal: r?.last_deal ?? null,
      dev: dev?.dev ?? null,
      dev_scope: viaZone ? "zone" : viaDistrict ? "district" : null,
      dev_base: viaZone ? zoneName! : viaDistrict ? p.district : null,
      dev_price: dev?.price ?? null,
      dev_projects: dev?.projects ?? 0,
      dev_deals: dev?.deals ?? 0,
      yield_pct: yieldPct,
      yield_src: yieldPct == null ? null : yieldSrc,
      yield_rent: yieldPct == null || rent == null ? null : Math.round(rent),
      yield_n: yieldPct == null ? 0 : n,
      yield_radius_m: yieldPct == null ? null : radius,
      cancel_rate: cancelRate(p.deal_count, p.cancel_count),
    });
  }
  return out;
}

let cache: { at: number; value: Promise<Map<string, ProjectMetrics>> } | null = null;

/** 全部建案的判讀指標(key=城市|區|建案名)。失敗不快取,下次請求重算。 */
export function getProjectMetrics(): Promise<Map<string, ProjectMetrics>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = compute();
  cache = { at: Date.now(), value };
  value.catch(() => { if (cache?.value === value) cache = null; });
  return value;
}
