/**
 * 建案 → 座標(NLSC TextQueryMap,同 geocode.ts 的資料源)
 * 預售屋實登地址是「工地位置」描述,不是乾淨門牌,常見三型:
 *   門牌型:中園路198號(可含 …號旁/對面/之鄰地 等尾綴)→ 直接查門牌
 *   路口型:春日路與青溪二路交叉口 → 查路名,取含另一條路的「交叉路口」點
 *   路段型:中豐北路一段上/興北一路附近等 → 查路名,取該區交叉路口點的平均當路段中心
 * 結果寫回 projects.lat/lng,並以 proj|區|地址 為鍵快取到 geocode_cache;
 * compute-stats 重建 projects 會清掉座標,重跑本script走快取即時回填。
 * 用法:tsx etl/geocode-projects.ts [--limit 50] [--concurrency 4]
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { createDb, projects, geocode_cache } from "../db/client";

const RATE_MS = 150;
const DEFAULT_CONCURRENCY = 4;
const NLSC = "https://api.nlsc.gov.tw/idc/TextQueryMap/";

const toHalf = (s: string) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
   .replace(/－/g, "-");

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

const ROAD = "(?:[^,，、]{1,12}?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)";

/** 把工地位置描述拆成可查詢的策略;回傳 null = 無法解析 */
function parseSiteAddress(district: string, raw: string) {
  let a = toHalf(raw.trim())
    .replace(/^桃園市/, "").replace(new RegExp(`^${district}`), "")
    .replace(/桃園區福林段.*$/, "")            // 「…273號桃園區福林段395地號」之類的地號尾巴
    .replace(/(之鄰地|附近等|附近|一帶|旁邊|旁|對面|斜對面|交界處|交界|上)$/, "");
  // 範圍門牌 1~30號 → 取中間號
  a = a.replace(/(\d+)[~〜-](\d+)號/, (_, x, y) => `${Math.round((+x + +y) / 2)}號`);

  const door = a.match(new RegExp(`^(${ROAD}(?:\\d+巷)?(?:\\d+弄)?)(\\d+)號`));
  if (door) return { kind: "door" as const, road: door[1], q: `桃園市${district}${door[1]}${door[2]}號` };

  const cross = a.match(new RegExp(`^(${ROAD})[與和、及](${ROAD})`));
  if (cross) return { kind: "cross" as const, road: cross[1], road2: cross[2], q: `桃園市${district}${cross[1]}` };

  const road = a.match(new RegExp(`^(${ROAD})`));
  if (road) return { kind: "road" as const, road: road[1], q: `桃園市${district}${road[1]}` };
  return null;
}

async function locate(district: string, raw: string): Promise<{ lat: number; lng: number } | null> {
  const p = parseSiteAddress(district, raw);
  if (!p) return null;
  const items = await query(p.q);
  const inDistrict = items.filter((it) => it.content.includes(district) || it.key.includes(district));

  if (p.kind === "door") {
    const hit = inDistrict.find((it) => it.remark.includes("門牌") && toHalf(it.content).includes(p.road));
    if (hit) return hit;
    // 查無該門牌 → 降級成路段中心
  }
  if (p.kind === "cross") {
    const hit = inDistrict.find((it) => it.key.includes("CROSSROAD") &&
      (it.key.includes(p.road2!) || it.content.includes(p.road2!)));
    if (hit) return hit;
  }
  // 路段中心:該區這條路所有交叉路口點的平均
  const pts = inDistrict.filter((it) => it.key.includes("CROSSROAD"));
  if (!pts.length) return null;
  return {
    lat: pts.reduce((s, it) => s + it.lat, 0) / pts.length,
    lng: pts.reduce((s, it) => s + it.lng, 0) / pts.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : null;
  const concurrency = args.includes("--concurrency")
    ? Math.max(1, +args[args.indexOf("--concurrency") + 1]) : DEFAULT_CONCURRENCY;

  const { db, pool } = createDb();

  // 代表地址:該建案預售交易中最常見的工地位置
  const base = db.select({
    id: projects.id, name: projects.name, district: projects.district,
    address: sql<string | null>`(
      SELECT mode() WITHIN GROUP (ORDER BY d.address) FROM presale_deals d
      WHERE d.project_name = ${projects.name} AND d.district = ${projects.district}
        AND d.address IS NOT NULL
    )`,
  }).from(projects)
    .where(and(isNull(projects.lat), eq(projects.is_demo, false)));
  const rows = limit ? await base.limit(limit) : await base;
  console.log(`[geocode-projects] 待定位 ${rows.length} 個建案,${concurrency} 路平行`);

  let next = 0, done = 0, hit = 0, cached = 0, miss = 0, fail = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= rows.length) return;
      const { id, district, address } = rows[i];
      done++;
      if (!address) { miss++; continue; }
      const cacheKey = `proj|${district}|${address}`;
      try {
        const [c] = await db.select().from(geocode_cache).where(eq(geocode_cache.addr_key, cacheKey));
        let loc = c?.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null;
        if (c && !loc) { miss++; continue; } // 快取記錄過「查無」
        if (loc) cached++;
        else {
          loc = await locate(district, address);
          await db.insert(geocode_cache).values({
            addr_key: cacheKey, lat: loc?.lat, lng: loc?.lng,
            precision: loc ? "site" : "none",
          }).onConflictDoNothing();
          await sleep(RATE_MS);
          if (!loc) { miss++; continue; }
          hit++;
        }
        await db.update(projects)
          .set({ lat: +loc.lat.toFixed(6), lng: +loc.lng.toFixed(6) })
          .where(eq(projects.id, id));
      } catch (e) {
        fail++;
        if (fail % 10 === 1) console.warn(`  [warn] ${address}: ${e}`);
        await sleep(3000);
      }
      if (done % 100 === 0) console.log(`  ${done}/${rows.length} hit=${hit} cache=${cached} miss=${miss} fail=${fail}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`[geocode-projects] 完成:hit=${hit} cache=${cached} miss=${miss} fail=${fail}(定位率 ${((hit + cached) / Math.max(1, done) * 100).toFixed(1)}%)`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
