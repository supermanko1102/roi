/**
 * 門牌 → 座標(NLSC 國土測繪中心 TextQueryMap,免費、需帶 Referer)
 * 撈 sale_deals 中尚未在 geocode_cache 的 addr_key,逐筆查詢後寫入快取。
 * 可中斷續跑(只查缺的)。禮貌速率 ~3 req/s。
 * 用法:
 *   tsx etl/geocode.ts                 # 全部缺的
 *   tsx etl/geocode.ts --district 八德區
 *   tsx etl/geocode.ts --limit 30
 */
import { Client } from "pg";

const RATE_MS = 300;
const NLSC = "https://api.nlsc.gov.tw/idc/TextQueryMap/";

// 全形數字/符號 → 半形(NLSC 查詢用半形,回傳 CONTENT 是全形)
const toHalf = (s: string) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
   .replace(/－/g, "-").replace(/之/g, "之");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lookup(addrKey: string, district: string): Promise<{ lat: number; lng: number } | null> {
  // 少數地址缺「桃園市○區」前綴 → 用交易的區名補全,避免誤中其他縣市同名路
  const query = addrKey.startsWith("桃園市") ? addrKey : `桃園市${district}${addrKey}`;
  // 查詢用半形;比對時兩邊都轉半形、去掉里鄰資訊再比門牌尾段
  const streetPart = toHalf(addrKey.replace(/^桃園市[^區]+區/, ""));
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
  const district = args.includes("--district") ? args[args.indexOf("--district") + 1] : null;
  const limit = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : null;

  const c = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://roi:roi@localhost:5432/taoyuan_roi" });
  await c.connect();

  const { rows } = await c.query(
    `SELECT DISTINCT ON (s.addr_key) s.addr_key, s.district FROM sale_deals s
     LEFT JOIN geocode_cache g ON g.addr_key = s.addr_key
     WHERE s.addr_key IS NOT NULL AND g.addr_key IS NULL
       ${district ? "AND s.district = $1" : ""}
     ORDER BY s.addr_key ${limit ? `LIMIT ${limit}` : ""}`,
    district ? [district] : []
  );
  console.log(`[geocode] 待查 ${rows.length} 筆${district ? `(${district})` : ""}`);

  let hit = 0, miss = 0, fail = 0;
  for (const [i, { addr_key, district: d }] of rows.entries()) {
    try {
      const loc = await lookup(addr_key, d);
      if (loc) {
        await c.query(
          `INSERT INTO geocode_cache(addr_key, lat, lng, precision) VALUES($1,$2,$3,'door')
           ON CONFLICT (addr_key) DO NOTHING`, [addr_key, loc.lat, loc.lng]);
        hit++;
      } else {
        await c.query(
          `INSERT INTO geocode_cache(addr_key, precision) VALUES($1,'none')
           ON CONFLICT (addr_key) DO NOTHING`, [addr_key]);
        miss++;
      }
    } catch (e) {
      fail++; // 網路/限流錯誤不寫快取,下次續跑會重試
      if (fail % 10 === 1) console.warn(`  [warn] ${addr_key}: ${e}`);
      await sleep(3000);
    }
    if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${rows.length} hit=${hit} miss=${miss} fail=${fail}`);
    await sleep(RATE_MS);
  }
  console.log(`[geocode] 完成:hit=${hit} miss=${miss} fail=${fail}(命中率 ${(hit / Math.max(1, hit + miss) * 100).toFixed(1)}%)`);
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
