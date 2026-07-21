/**
 * 門牌 → 座標(NLSC 國土測繪中心 TextQueryMap,免費、需帶 Referer)
 * 撈 sale_deals 中尚未在 geocode_cache 的 addr_key,逐筆查詢後寫入快取。
 * 可中斷續跑(只查缺的)。平行 worker,整體約 15~20 req/s(再高怕被封)。
 * 用法:
 *   tsx etl/geocode.ts                 # 全部缺的
 *   tsx etl/geocode.ts --city 臺北市    # 只跑單一城市(回填建議逐城序跑)
 *   tsx etl/geocode.ts --district 八德區
 *   tsx etl/geocode.ts --limit 200
 *   tsx etl/geocode.ts --concurrency 4 # 降速
 */
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { createDb, sale_deals, geocode_cache } from "../db/client";
import { cityPrefixRe } from "../src/lib/cities";

const RATE_MS = 150;        // 每個 worker 自己的間隔
const DEFAULT_CONCURRENCY = 6;
const NLSC = "https://api.nlsc.gov.tw/idc/TextQueryMap/";

// 全形數字/符號 → 半形(NLSC 查詢用半形,回傳 CONTENT 是全形)
const toHalf = (s: string) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
   .replace(/－/g, "-").replace(/之/g, "之");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lookup(addrKey: string, city: string, district: string): Promise<{ lat: number; lng: number } | null> {
  // parse 已保證 addr_key 帶「{城市}{區}」前綴;缺前綴的舊資料用交易的城市+區名補全
  const query = cityPrefixRe.test(addrKey) ? addrKey : `${city}${district}${addrKey}`;
  // 查詢用半形;比對時兩邊都轉半形、去掉里鄰資訊再比門牌尾段
  const streetPart = toHalf(addrKey.replace(cityPrefixRe, "").replace(/^[^區]+區/, ""));
  const res = await fetch(NLSC + encodeURIComponent(toHalf(query)), {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://maps.nlsc.gov.tw/" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  for (const m of xml.matchAll(/<ITEM>.*?<CONTENT>(.*?)<\/CONTENT>.*?<LOCATION>(.*?)<\/LOCATION>.*?<REMARK>(.*?)<\/REMARK>.*?<\/ITEM>/gs)) {
    const [, content, location, remark] = m;
    if (!remark.includes("門牌")) continue;
    if (!content.includes(district)) continue;           // 鎖定正確行政區
    if (!toHalf(content).endsWith(streetPart)) continue; // 精確比對,避免 631巷 對到 611巷
    const [lng, lat] = location.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const cityArg = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;
  const district = args.includes("--district") ? args[args.indexOf("--district") + 1] : null;
  const limit = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : null;
  const concurrency = args.includes("--concurrency")
    ? Math.max(1, +args[args.indexOf("--concurrency") + 1]) : DEFAULT_CONCURRENCY;

  const { db, pool } = createDb();

  const base = db.selectDistinctOn([sale_deals.addr_key], {
    addr_key: sale_deals.addr_key,
    city: sale_deals.city,
    district: sale_deals.district,
  }).from(sale_deals)
    .leftJoin(geocode_cache, eq(geocode_cache.addr_key, sale_deals.addr_key))
    .where(and(
      isNotNull(sale_deals.addr_key),
      isNull(geocode_cache.addr_key),
      cityArg ? eq(sale_deals.city, cityArg) : undefined,
      district ? eq(sale_deals.district, district) : undefined,
    ))
    .orderBy(sale_deals.addr_key);
  const rows = limit ? await base.limit(limit) : await base;
  console.log(`[geocode] 待查 ${rows.length} 筆${cityArg ? `(${cityArg})` : ""}${district ? `(${district})` : ""},${concurrency} 路平行`);

  const t0 = Date.now();
  let next = 0, done = 0, hit = 0, miss = 0, fail = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= rows.length) return;
      const { addr_key, city: c, district: d } = rows[i];
      if (!addr_key) { done++; continue; }
      try {
        const loc = await lookup(addr_key, c, d);
        if (loc) {
          await db.insert(geocode_cache)
            .values({ addr_key, lat: loc.lat, lng: loc.lng, precision: "door" })
            .onConflictDoNothing();
          hit++;
        } else {
          await db.insert(geocode_cache)
            .values({ addr_key, precision: "none" })
            .onConflictDoNothing();
          miss++;
        }
      } catch (e) {
        fail++; // 網路/限流錯誤不寫快取,下次續跑會重試
        if (fail % 10 === 1) console.warn(`  [warn] ${addr_key}: ${e}`);
        await sleep(3000);
      }
      done++;
      if (done % 500 === 0) {
        const rps = done / ((Date.now() - t0) / 1000);
        const etaMin = (rows.length - done) / rps / 60;
        console.log(`  ${done}/${rows.length} hit=${hit} miss=${miss} fail=${fail}(${rps.toFixed(1)}/s,約剩 ${etaMin.toFixed(0)} 分)`);
      }
      await sleep(RATE_MS);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const secs = (Date.now() - t0) / 1000;
  console.log(`[geocode] 完成:hit=${hit} miss=${miss} fail=${fail}(命中率 ${(hit / Math.max(1, hit + miss) * 100).toFixed(1)}%,${secs.toFixed(0)}s,${(done / secs).toFixed(1)}/s)`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
