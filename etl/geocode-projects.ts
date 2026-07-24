/**
 * 建案 → 座標(NLSC TextQueryMap,同 geocode.ts 的資料源)
 * 預售屋實登地址是「工地位置」描述,不是乾淨門牌,常見三型:
 *   門牌型:中園路198號(可含 …號旁/對面/之鄰地 等尾綴)→ 直接查門牌
 *   路口型:春日路與青溪二路、春日路青溪二路路口 → 雙向查詢確切交叉路口
 *   路段型:中豐北路一段上/興北一路附近等 → 不產生假座標,標記 none
 * 成交地址無法精確定位時,再用同市/區/名 communities.street 作保守 fallback。
 * 結果寫回 projects.lat/lng,並以 proj|城市|區|地址 為鍵快取到 geocode_cache;
 * compute-stats 會保留既有建案座標；新案或未定位案重跑本 script 時先走快取回填。
 * 用法:tsx etl/geocode-projects.ts [--limit 50] [--concurrency 4]
 *      tsx etl/geocode-projects.ts --project 建案名 --refresh
 *      tsx etl/geocode-projects.ts --cache-only  # 僅以既有精確快取回填,不查外部 API
 */
import path from "node:path";
import { and, eq, isNull, like, sql } from "drizzle-orm";
import { createDb, projects, geocode_cache } from "../db/client";
import { normalizeCnNums, parseSiteAddress, siteAddressCandidates, toHalf } from "./geocode-project-address";

const RATE_MS = 150;
const DEFAULT_CONCURRENCY = 4;
const NLSC = "https://api.nlsc.gov.tw/idc/TextQueryMap/";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Item = { content: string; key: string; lng: number; lat: number; remark: string };

async function query(text: string): Promise<Item[]> {
  // NLSC 的 keep-alive 連線會劣化成每請求數秒的殭屍 socket,拖垮所有 worker;
  // 短逾時 abort 會強制關閉壞連線,重試自然走新連線,等於自我修復
  const t0 = Date.now();
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(NLSC + encodeURIComponent(toHalf(text)), {
        headers: { "User-Agent": "Mozilla/5.0", Referer: "https://maps.nlsc.gov.tw/" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  const xml = await res.text();
  if (process.env.GEO_DEBUG) console.log(`    [t] query ${Date.now() - t0}ms ${text.slice(0, 20)}`);
  const items: Item[] = [];
  for (const m of xml.matchAll(/<ITEM>.*?<CONTENT>(.*?)<\/CONTENT>.*?<KEY>(.*?)<\/KEY>.*?<LOCATION>(.*?)<\/LOCATION>.*?<REMARK>(.*?)<\/REMARK>.*?<\/ITEM>/gs)) {
    const [lng, lat] = m[3].split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng))
      items.push({ content: m[1], key: m[2], lng, lat, remark: m[4] });
  }
  return items;
}

export type LocatedSite = { lat: number; lng: number; precision: "door" | "cross" };
type CachedLocation = { loc: LocatedSite | null; fromCache: boolean };

export async function locate(city: string, district: string, raw: string): Promise<LocatedSite | null> {
  const p = parseSiteAddress(city, district, raw);
  if (!p) return null;
  // 只有路名不足以代表建案位置；寧可不顯示，也不再偽裝成精確座標。
  if (p.kind === "road") return null;
  const items = await query(p.q);
  const inDistrict = items.filter((it) => it.content.includes(district) || it.key.includes(district));

  // NLSC 街名用中文數字(新富十一街)、實登用阿拉伯數字(新富11街),比對前兩側都正規化
  const norm = (s: string) => normalizeCnNums(toHalf(s));

  if (p.kind === "door") {
    const doorPart = norm(toHalf(p.q).slice(toHalf(`${city}${district}`).length));
    const hit = inDistrict.find((it) => it.remark.includes("門牌") && norm(it.content).endsWith(doorPart));
    return hit ? { lat: hit.lat, lng: hit.lng, precision: "door" } : null;
  }

  const findCross = (xs: Item[]) => xs.find((it) => it.key.includes("CROSSROAD") &&
    norm(`${it.key}|${it.content}`).includes(norm(p.road)) &&
    norm(`${it.key}|${it.content}`).includes(norm(p.road2)));
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
  const cacheOnly = args.includes("--cache-only");
  const concurrency = args.includes("--concurrency")
    ? Math.max(1, +args[args.indexOf("--concurrency") + 1]) : DEFAULT_CONCURRENCY;

  const { db, pool } = createDb();

  // 代表地址:該建案預售交易中最常見的工地位置
  const base = db.select({
    id: projects.id, name: projects.name, city: projects.city, district: projects.district,
    // 子查詢的關聯欄位必須寫死 "projects".*:drizzle 的 ${projects.name} 會生成
    // 不帶表名的 "name",在內層表也有同名欄位時變成 c.name = c.name 恆真,
    // 曾讓每個建案掛上全區 2500 條街道候選(錯座標 + 慢到跑不完)
    address: sql<string | null>`(
      SELECT mode() WITHIN GROUP (ORDER BY d.address) FROM presale_deals d
      WHERE d.project_name = "projects"."name" AND d.city = "projects"."city" AND d.district = "projects"."district"
        AND d.address IS NOT NULL
    )`,
    communityStreets: sql<string[]>`ARRAY(
      SELECT DISTINCT c.street FROM communities c
      WHERE c.name = "projects"."name" AND c.city = "projects"."city" AND c.district = "projects"."district"
        AND c.street IS NOT NULL AND btrim(c.street) <> ''
      ORDER BY c.street
    )`,
  }).from(projects)
    .where(and(projectName ? eq(projects.name, projectName) : isNull(projects.lat), eq(projects.is_demo, false)));
  const rows = limit ? await base.limit(limit) : await base;
  const cachedRows = await db.select().from(geocode_cache)
    .where(like(geocode_cache.addr_key, "proj|%"));
  const cache = new Map(cachedRows.map((row) => [row.addr_key, row]));
  const prepared = rows.map((row) => ({
    ...row,
    candidates: siteAddressCandidates(row.address, row.communityStreets),
  }));
  const cacheRank = (row: typeof prepared[number]) => {
    const entries = row.candidates.map((candidate) =>
      cache.get(`proj|${row.city}|${row.district}|${candidate.raw}`));
    if (entries.some((entry) =>
      (entry?.precision === "door" || entry?.precision === "cross") && entry.lat != null && entry.lng != null)) return 0;
    if (entries.length > 0 && entries.every((entry) => entry?.precision === "none")) return 1;
    return 2;
  };
  prepared.sort((a, b) => cacheRank(a) - cacheRank(b));
  console.log(`[geocode-projects] 待定位 ${prepared.length} 個建案,${concurrency} 路平行,cache=${cache.size}${cacheOnly ? ",cache-only" : ""}`);

  async function locateCached(city: string, district: string, raw: string): Promise<CachedLocation> {
    const cacheKey = `proj|${city}|${district}|${raw}`;
    const c = cache.get(cacheKey);
    const cacheIsPrecise = c?.precision === "door" || c?.precision === "cross";
    if (!refresh && cacheIsPrecise && c.lat != null && c.lng != null) {
      return {
        loc: { lat: c.lat, lng: c.lng, precision: c.precision as LocatedSite["precision"] },
        fromCache: true,
      };
    }
    if (!refresh && c?.precision === "none") return { loc: null, fromCache: true };
    if (cacheOnly) return { loc: null, fromCache: false };

    const loc = await locate(city, district, raw);
    await db.insert(geocode_cache).values({
      addr_key: cacheKey, lat: loc?.lat, lng: loc?.lng,
      precision: loc?.precision ?? "none",
    }).onConflictDoUpdate({
      target: geocode_cache.addr_key,
      set: { lat: loc?.lat ?? null, lng: loc?.lng ?? null, precision: loc?.precision ?? "none" },
    });
    cache.set(cacheKey, {
      addr_key: cacheKey, lat: loc?.lat ?? null, lng: loc?.lng ?? null,
      precision: loc?.precision ?? "none", queried_at: new Date(),
    });
    await sleep(RATE_MS);
    return { loc, fromCache: false };
  }

  let next = 0, done = 0, hit = 0, cached = 0, fallback = 0, miss = 0, fail = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= prepared.length) return;
      const { id, name, city, district, candidates } = prepared[i];
      done++;
      if (!candidates.length) { miss++; continue; }
      const tp = Date.now();
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
        if (process.env.GEO_DEBUG) console.log(`  [t] project ${name} ${Date.now() - tp}ms cands=${candidates.length}`);
        if (!loc) { miss++; continue; }
      } catch (e) {
        fail++;
        if (fail % 10 === 1) console.warn(`  [warn] ${name}: ${e}`);
        await sleep(1000);
      }
      if (done % 100 === 0)
        console.log(`  ${done}/${rows.length} hit=${hit} cache=${cached} fallback=${fallback} miss=${miss} fail=${fail}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`[geocode-projects] 完成:hit=${hit} cache=${cached} fallback=${fallback} miss=${miss} fail=${fail}(定位率 ${((hit + cached) / Math.max(1, done) * 100).toFixed(1)}%)`);
  await pool.end();
}
// locate 供 geocode-landlots 重用;僅直接執行時才跑主流程
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1]))
  main().catch((e) => { console.error(e); process.exit(1); });
