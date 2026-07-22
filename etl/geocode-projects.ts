/**
 * 建案 → 座標(NLSC TextQueryMap,同 geocode.ts 的資料源)
 * 預售屋實登地址是「工地位置」描述,不是乾淨門牌,常見三型:
 *   門牌型:中園路198號(可含 …號旁/對面/之鄰地 等尾綴)→ 直接查門牌
 *   路口型:春日路與青溪二路、春日路青溪二路路口 → 雙向查詢確切交叉路口
 *   路段型:中豐北路一段上/興北一路附近等 → 不產生假座標,標記 none
 * 成交地址無法精確定位時,再用同市/區/名 communities.street 作保守 fallback。
 * 結果寫回 projects.lat/lng,並以 proj|城市|區|地址 為鍵快取到 geocode_cache;
 * compute-stats 重建 projects 會清掉座標,重跑本script走快取即時回填。
 * 用法:tsx etl/geocode-projects.ts [--limit 50] [--concurrency 4]
 *      tsx etl/geocode-projects.ts --project 建案名 --refresh
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { createDb, projects, geocode_cache } from "../db/client";
import { parseSiteAddress, toHalf } from "./geocode-project-address";

const RATE_MS = 150;
const DEFAULT_CONCURRENCY = 4;
const NLSC = "https://api.nlsc.gov.tw/idc/TextQueryMap/";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Item = { content: string; key: string; lng: number; lat: number; remark: string };

async function query(text: string): Promise<Item[]> {
  const res = await fetch(NLSC + encodeURIComponent(toHalf(text)), {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://maps.nlsc.gov.tw/" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const items: Item[] = [];
  for (const m of xml.matchAll(/<ITEM>.*?<CONTENT>(.*?)<\/CONTENT>.*?<KEY>(.*?)<\/KEY>.*?<LOCATION>(.*?)<\/LOCATION>.*?<REMARK>(.*?)<\/REMARK>.*?<\/ITEM>/gs)) {
    const [lng, lat] = m[3].split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng))
      items.push({ content: m[1], key: m[2], lng, lat, remark: m[4] });
  }
  return items;
}

type LocatedSite = { lat: number; lng: number; precision: "door" | "cross" };
type CachedLocation = { loc: LocatedSite | null; fromCache: boolean };
type AddressCandidate = { raw: string; source: "deal" | "community" };

async function locate(city: string, district: string, raw: string): Promise<LocatedSite | null> {
  const p = parseSiteAddress(city, district, raw);
  if (!p) return null;
  // 只有路名不足以代表建案位置；寧可不顯示，也不再偽裝成精確座標。
  if (p.kind === "road") return null;
  const items = await query(p.q);
  const inDistrict = items.filter((it) => it.content.includes(district) || it.key.includes(district));

  if (p.kind === "door") {
    const doorPart = toHalf(p.q).slice(toHalf(`${city}${district}`).length);
    const hit = inDistrict.find((it) => it.remark.includes("門牌") && toHalf(it.content).endsWith(doorPart));
    return hit ? { lat: hit.lat, lng: hit.lng, precision: "door" } : null;
  }

  const findCross = (xs: Item[]) => xs.find((it) => it.key.includes("CROSSROAD") &&
    toHalf(`${it.key}|${it.content}`).includes(p.road) &&
    toHalf(`${it.key}|${it.content}`).includes(p.road2));
  let hit = findCross(inDistrict);
  if (!hit) {
    const secondary = await query(p.q2);
    hit = findCross(secondary.filter((it) => it.content.includes(district) || it.key.includes(district)));
  }
  return hit ? { lat: hit.lat, lng: hit.lng, precision: "cross" } : null;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : null;
  const projectName = args.includes("--project") ? args[args.indexOf("--project") + 1] : null;
  const refresh = args.includes("--refresh");
  const concurrency = args.includes("--concurrency")
    ? Math.max(1, +args[args.indexOf("--concurrency") + 1]) : DEFAULT_CONCURRENCY;

  const { db, pool } = createDb();

  // 代表地址:該建案預售交易中最常見的工地位置
  const base = db.select({
    id: projects.id, name: projects.name, city: projects.city, district: projects.district,
    address: sql<string | null>`(
      SELECT mode() WITHIN GROUP (ORDER BY d.address) FROM presale_deals d
      WHERE d.project_name = ${projects.name} AND d.city = ${projects.city} AND d.district = ${projects.district}
        AND d.address IS NOT NULL
    )`,
    communityStreets: sql<string[]>`ARRAY(
      SELECT DISTINCT c.street FROM communities c
      WHERE c.name = ${projects.name} AND c.city = ${projects.city} AND c.district = ${projects.district}
        AND c.street IS NOT NULL AND btrim(c.street) <> ''
      ORDER BY c.street
    )`,
  }).from(projects)
    .where(and(projectName ? eq(projects.name, projectName) : isNull(projects.lat), eq(projects.is_demo, false)));
  const rows = limit ? await base.limit(limit) : await base;
  console.log(`[geocode-projects] 待定位 ${rows.length} 個建案,${concurrency} 路平行`);

  async function locateCached(city: string, district: string, raw: string): Promise<CachedLocation> {
    const cacheKey = `proj|${city}|${district}|${raw}`;
    const [c] = await db.select().from(geocode_cache).where(eq(geocode_cache.addr_key, cacheKey));
    const cacheIsPrecise = c?.precision === "door" || c?.precision === "cross";
    if (!refresh && cacheIsPrecise && c.lat != null && c.lng != null) {
      return {
        loc: { lat: c.lat, lng: c.lng, precision: c.precision as LocatedSite["precision"] },
        fromCache: true,
      };
    }
    if (!refresh && c?.precision === "none") return { loc: null, fromCache: true };

    const loc = await locate(city, district, raw);
    await db.insert(geocode_cache).values({
      addr_key: cacheKey, lat: loc?.lat, lng: loc?.lng,
      precision: loc?.precision ?? "none",
    }).onConflictDoUpdate({
      target: geocode_cache.addr_key,
      set: { lat: loc?.lat ?? null, lng: loc?.lng ?? null, precision: loc?.precision ?? "none" },
    });
    await sleep(RATE_MS);
    return { loc, fromCache: false };
  }

  let next = 0, done = 0, hit = 0, cached = 0, fallback = 0, miss = 0, fail = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= rows.length) return;
      const { id, name, city, district, address, communityStreets } = rows[i];
      done++;
      const candidates: AddressCandidate[] = [];
      if (address?.trim()) candidates.push({ raw: address.trim(), source: "deal" });
      for (const street of communityStreets) {
        const raw = street.trim();
        if (raw && !candidates.some((candidate) => candidate.raw === raw))
          candidates.push({ raw, source: "community" });
      }
      if (!candidates.length) { miss++; continue; }
      try {
        let loc: LocatedSite | null = null;
        for (const candidate of candidates) {
          const result = await locateCached(city, district, candidate.raw);
          if (!result.loc) continue;
          loc = result.loc;
          if (result.fromCache) cached++;
          else hit++;
          if (candidate.source === "community") fallback++;
          break;
        }
        await db.update(projects)
          .set(loc
            ? { lat: +loc.lat.toFixed(6), lng: +loc.lng.toFixed(6) }
            : { lat: null, lng: null })
          .where(eq(projects.id, id));
        if (!loc) { miss++; continue; }
      } catch (e) {
        fail++;
        if (fail % 10 === 1) console.warn(`  [warn] ${name}: ${e}`);
        await sleep(3000);
      }
      if (done % 100 === 0)
        console.log(`  ${done}/${rows.length} hit=${hit} cache=${cached} fallback=${fallback} miss=${miss} fail=${fail}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`[geocode-projects] 完成:hit=${hit} cache=${cached} fallback=${fallback} miss=${miss} fail=${fail}(定位率 ${((hit + cached) / Math.max(1, done) * 100).toFixed(1)}%)`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
