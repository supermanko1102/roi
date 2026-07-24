/**
 * 備查建案 → 座標(缺座標建案的第二層補救;第一層是 geocode-projects)
 * 來源:etl/downloads/buildcase/{a|f|h}_lvr_buildcase.csv(預售屋備查申報)
 *   1. 坐落街道為門牌/路口型 → 沿用 geocode-projects 的 NLSC TextQueryMap 定位
 *   2. 坐落基地地號 → ListLandSection 查段代碼 + CadasMapPosition 取地籍代表點
 * 只處理 projects.lat IS NULL 的建案;結果寫回 lat/lng,
 * 地號結果以 lot|城市|區|坐落基地 為鍵快取到 geocode_cache(precision='lot')。
 * 備查檔不存在時整步跳過(CI 環境尚未抓備查)。
 * 用法:tsx etl/geocode-landlots.ts [--limit 50]
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { createDb, projects, geocode_cache } from "../db/client";
import { locate } from "./geocode-projects";
import { col, readCsv } from "./lvr-fields";

const RATE_MS = 150;
const DL = path.join(import.meta.dirname, "downloads/buildcase");
const CITY_FILES: Array<[string, string, string]> = [
  ["臺北市", "A", "a_lvr_buildcase.csv"],
  ["新北市", "F", "f_lvr_buildcase.csv"],
  ["桃園市", "H", "h_lvr_buildcase.csv"],
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nlscGet(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Referer: "https://maps.nlsc.gov.tw/" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 2) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
}

/** 「三民段28地號等」「斯馨段50、56地號」「中路二段29-1地號」→ 段名 + 第一個地號 */
export function parseLandLot(raw: string): { sect: string; no8: string } | null {
  const m = raw.match(/([^\s,，、;；()（）]{1,12}?段(?:[^\s,，、;；()（）]{1,8}?小段)?)\s*([\d、,，.\-之及\s]+?)地號/);
  if (!m) return null;
  const first = m[2].split(/[、,，及\s]/).find((s) => /\d/.test(s));
  if (!first) return null;
  const [mother, child = "0"] = first.split(/[-之.]/);
  if (!/^\d{1,4}$/.test(mother) || !/^\d{1,4}$/.test(child)) return null;
  return { sect: m[1], no8: mother.padStart(4, "0") + child.padStart(4, "0") };
}

type SectionIndex = Map<string, { office: string; sectcode: string }>;

/** 該區的 段名→(事務所, 段代碼);同名段取第一筆 */
async function loadSections(cityCode: string, towncode: string): Promise<SectionIndex> {
  const xml = await nlscGet(`https://api.nlsc.gov.tw/other/ListLandSection/${cityCode}/${towncode}`);
  const idx: SectionIndex = new Map();
  for (const m of xml.matchAll(/<office>(\w+)<\/office>\s*<officestr>[^<]*<\/officestr>\s*<sectcode>(\d+)<\/sectcode>\s*<sectstr>([^<]+)<\/sectstr>/g))
    if (!idx.has(m[3])) idx.set(m[3], { office: m[1], sectcode: m[2] });
  return idx;
}

async function lotPosition(office: string, sectcode: string, no8: string): Promise<{ lat: number; lng: number } | null> {
  const xml = await nlscGet(`https://api.nlsc.gov.tw/dmaps/CadasMapPosition/${office}/${sectcode}/${no8}`);
  const x = +(xml.match(/<repX>([\d.]+)<\/repX>/)?.[1] ?? NaN);
  const y = +(xml.match(/<repY>([\d.]+)<\/repY>/)?.[1] ?? NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { lng: x, lat: y } : null;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : null;
  if (!fs.existsSync(DL)) { console.log("[geocode-lots] 無備查檔目錄,跳過"); return; }

  const { db, pool } = createDb();
  const missing = await db.select({
    id: projects.id, name: projects.name, city: projects.city, district: projects.district,
  }).from(projects).where(and(isNull(projects.lat), eq(projects.is_demo, false)));
  const byKey = new Map(missing.map((p) => [`${p.city}|${p.district}|${p.name}`, p]));

  // 備查列 →(street, landlot)
  type Case = { city: string; cityCode: string; district: string; street: string; land: string };
  const cases = new Map<string, Case>();
  for (const [city, cityCode, file] of CITY_FILES) {
    const f = path.join(DL, file);
    if (!fs.existsSync(f)) continue;
    const [h, ...rows] = readCsv(f);
    const iDist = col(h, "鄉鎮市區"), iName = col(h, "建案名稱"),
      iStreet = col(h, "坐落街道"), iLand = col(h, "坐落基地");
    for (const r of rows) {
      let key = `${city}|${r[iDist]}|${r[iName]}`;
      // 備查名可能仍是政府 Big5 亂碼(?讀伊頓),而 projects 已被 fix-names 歸併成
      // 乾淨名(悦讀伊頓);用 ? 當單字元萬用比對,唯一命中才視為同案
      if (!byKey.has(key) && (r[iName] ?? "").includes("?")) {
        const re = new RegExp(`^${r[iName].replace(/[.*+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, ".")}$`);
        const hits = missing.filter((p) => p.city === city && p.district === r[iDist] && re.test(p.name));
        if (hits.length === 1) key = `${city}|${r[iDist]}|${hits[0].name}`;
      }
      if (byKey.has(key) && !cases.has(key))
        cases.set(key, { city, cityCode, district: r[iDist], street: r[iStreet] ?? "", land: r[iLand] ?? "" });
    }
  }
  const todo = [...cases.entries()].slice(0, limit ?? Infinity);
  console.log(`[geocode-lots] 缺座標 ${missing.length} 案,備查可補 ${cases.size} 案${limit ? `,本次處理 ${todo.length}` : ""}`);

  const lotCache = new Map((await db.select().from(geocode_cache)).filter((r) => r.addr_key.startsWith("lot|"))
    .map((r) => [r.addr_key, r]));
  const townCodes = new Map<string, Map<string, string>>(); // cityCode → 區名→towncode
  const sections = new Map<string, SectionIndex>(); // cityCode|towncode → 段索引

  let street = 0, lot = 0, miss = 0, fail = 0;
  for (const [key, c] of todo) {
    const proj = byKey.get(key)!;
    try {
      // 1) 坐落街道(門牌/路口型才會回座標)
      if (c.street.trim()) {
        const loc = await locate(c.city, c.district, c.street.trim());
        await sleep(RATE_MS);
        if (loc) {
          await db.update(projects).set({ lat: +loc.lat.toFixed(6), lng: +loc.lng.toFixed(6) })
            .where(eq(projects.id, proj.id));
          street++;
          continue;
        }
      }
      // 2) 地號 → 地籍代表點
      const parsed = parseLandLot(c.land);
      if (!parsed) { miss++; continue; }
      const cacheKey = `lot|${c.city}|${c.district}|${c.land.trim()}`;
      let pos: { lat: number; lng: number } | null = null;
      const cached = lotCache.get(cacheKey);
      if (cached?.lat != null && cached.lng != null) pos = { lat: +cached.lat, lng: +cached.lng };
      else {
        if (!townCodes.has(c.cityCode)) {
          const xml = await nlscGet(`https://api.nlsc.gov.tw/other/ListTown/${c.cityCode}`);
          townCodes.set(c.cityCode, new Map([...xml.matchAll(/<towncode>(\w+)<\/towncode>\s*<townname>([^<]+)<\/townname>/g)]
            .map((m) => [m[2], m[1]])));
        }
        const towncode = townCodes.get(c.cityCode)!.get(c.district);
        if (!towncode) { miss++; continue; }
        const sectKey = `${c.cityCode}|${towncode}`;
        if (!sections.has(sectKey)) sections.set(sectKey, await loadSections(c.cityCode, towncode));
        const sect = sections.get(sectKey)!.get(parsed.sect);
        if (!sect) { miss++; continue; }
        pos = await lotPosition(sect.office, sect.sectcode, parsed.no8);
        await sleep(RATE_MS);
        await db.insert(geocode_cache).values({
          addr_key: cacheKey, lat: pos?.lat, lng: pos?.lng, precision: pos ? "lot" : "none",
        }).onConflictDoUpdate({
          target: geocode_cache.addr_key,
          set: { lat: pos?.lat ?? null, lng: pos?.lng ?? null, precision: pos ? "lot" : "none" },
        });
      }
      if (!pos) { miss++; continue; }
      await db.update(projects).set({ lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6) })
        .where(eq(projects.id, proj.id));
      lot++;
    } catch (e) {
      fail++;
      if (fail % 10 === 1) console.warn(`  [warn] ${proj.name}: ${e}`);
      await sleep(1000);
    }
  }
  console.log(`[geocode-lots] 完成:街道 ${street}、地號 ${lot}、無法定位 ${miss}、失敗 ${fail}`);

  // 第三層:人工查證地址對照表(內政部兩來源皆無位置資訊的案,如東騰青一)
  // 放地址不放座標:每次重跑都經 NLSC 驗證,來源記在 source 欄
  const ovFile = path.join(import.meta.dirname, "coord-overrides.json");
  if (fs.existsSync(ovFile)) {
    const overrides: Array<{ city: string; district: string; name: string; address: string }> =
      JSON.parse(fs.readFileSync(ovFile, "utf8"));
    let applied = 0;
    for (const ov of overrides) {
      const proj = byKey.get(`${ov.city}|${ov.district}|${ov.name}`);
      if (!proj) continue;
      const loc = await locate(ov.city, ov.district, ov.address);
      await sleep(RATE_MS);
      if (loc) {
        await db.update(projects).set({ lat: +loc.lat.toFixed(6), lng: +loc.lng.toFixed(6) })
          .where(eq(projects.id, proj.id));
        applied++;
      } else console.warn(`  [warn] override 定位失敗:${ov.name} ${ov.address}`);
    }
    if (overrides.length) console.log(`[geocode-lots] override 補定位 ${applied}/${overrides.length}`);
  }
  await pool.end();
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1]))
  main().catch((e) => { console.error(e); process.exit(1); });
