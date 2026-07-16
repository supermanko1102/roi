/**
 * 解析實價登錄 CSV → PostgreSQL
 * 處理:民國日期、BOM、第二列英文表頭、m²→坪、車位價拆分
 * 用法:tsx etl/parse-lvr.ts   (吃 etl/downloads/ 下所有期別)
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import { createDb, sale_deals, presale_deals, rent_deals } from "../db/client";

const PING = 3.305785; // m² per 坪
const DL = path.join(import.meta.dirname, "downloads");
const BATCH = 500;

const rocDate = (s?: string): string | null => {
  if (!s || s.length < 6) return null;
  const p = s.padStart(7, "0");
  const y = +p.slice(0, 3) + 1911, m = p.slice(3, 5), d = p.slice(5, 7);
  return m === "00" || d === "00" ? null : `${y}-${m}-${d}`;
};
const num = (s?: string) => {
  const n = parseFloat((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
// 欄名在不同期別會微調,用關鍵字找
const col = (headers: string[], ...keys: string[]) =>
  headers.findIndex(h => keys.every(k => h.includes(k)));

function readCsv(file: string): string[][] {
  let text = fs.readFileSync(file, "utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = parse(text, { relax_column_count: true, skip_empty_lines: true });
  return rows.filter((_, i) => i !== 1); // 第 2 列是英文表頭
}

async function insertBatched<T>(insert: (chunk: T[]) => Promise<unknown>, rows: T[]) {
  for (let i = 0; i < rows.length; i += BATCH) await insert(rows.slice(i, i + BATCH));
}

async function main() {
  const { db, pool } = createDb();

  for (const season of fs.readdirSync(DL)) {
    const dir = path.join(DL, season);

    // ---- 中古/成屋買賣 (a) ----
    const aFile = path.join(dir, "h_lvr_land_a.csv");
    if (fs.existsSync(aFile)) {
      const [h, ...rows] = readCsv(aFile);
      const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置");
      const iTarget = col(h, "交易標的"), iDate = col(h, "交易年月日");
      const iArea = col(h, "建物移轉總面積"), iMain = col(h, "主建物面積");
      const iTotal = col(h, "總價元"), iPark = col(h, "車位總價");
      const iParkArea = col(h, "車位移轉總面積");
      const iType = col(h, "建物型態"), iBuilt = col(h, "建築完成年月");
      const out: (typeof sale_deals.$inferInsert)[] = [];
      for (const r of rows) {
        if (!(r[iTarget] ?? "").includes("建物")) continue; // 濾掉純土地/車位
        const total = num(r[iTotal]), park = num(r[iPark]) ?? 0;
        const areaPing = num(r[iArea]) ? num(r[iArea])! / PING : null;
        if (!total || !areaPing || areaPing <= 0) continue;
        const parkAreaPing = (num(r[iParkArea]) ?? 0) / PING;
        const mainAreaPing = num(r[iMain]) ? num(r[iMain])! / PING : null;
        const netArea = areaPing - parkAreaPing;
        const unit = netArea > 0 ? (total - park) / 10000 / netArea : null;
        const unitMain = mainAreaPing && mainAreaPing > 0 ? (total - park) / 10000 / mainAreaPing : null;
        const builtRoc = (r[iBuilt] ?? "").slice(0, 3);
        const buildYear = /^\d{2,3}$/.test(builtRoc) ? +builtRoc + 1911 : null;
        const addr = r[iAddr] ?? "";
        const addrKey = addr.includes("號") ? addr.replace(/號.*$/, "號") : null;
        out.push({
          district: r[iDist], address: addr, deal_date: rocDate(r[iDate]),
          total_price: total / 10000, parking_price: park / 10000,
          area_ping: areaPing, parking_area_ping: parkAreaPing, main_area_ping: mainAreaPing,
          unit_price: unit, unit_price_main: unitMain,
          building_type: iType >= 0 ? r[iType] || null : null,
          build_year: buildYear, addr_key: addrKey, raw_season: season,
        });
      }
      await db.delete(sale_deals).where(eq(sale_deals.raw_season, season));
      await insertBatched((c) => db.insert(sale_deals).values(c), out);
      console.log(`[${season}] 買賣 ${out.length} 筆`);
    }

    // ---- 預售屋 (b) ----
    const bFile = path.join(dir, "h_lvr_land_b.csv");
    if (fs.existsSync(bFile)) {
      const [h, ...rows] = readCsv(bFile);
      const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置");
      const iDate = col(h, "交易年月日"), iArea = col(h, "建物移轉總面積");
      const iTotal = col(h, "總價元"), iPark = col(h, "車位總價");
      const iProj = col(h, "建案名稱");
      const out: (typeof presale_deals.$inferInsert)[] = [];
      for (const r of rows) {
        const total = num(r[iTotal]), park = num(r[iPark]) ?? 0;
        const areaPing = num(r[iArea]) ? num(r[iArea])! / PING : null;
        if (!total || !areaPing || areaPing <= 0) continue;
        const unit = (total - park) / 10000 / areaPing; // 萬/坪(粗估:未扣車位坪)
        out.push({
          district: r[iDist], project_name: iProj >= 0 ? r[iProj] : null,
          address: r[iAddr], deal_date: rocDate(r[iDate]),
          total_price: total / 10000, parking_price: park / 10000,
          area_ping: areaPing, unit_price: unit, raw_season: season,
        });
      }
      await db.delete(presale_deals).where(eq(presale_deals.raw_season, season));
      await insertBatched((c) => db.insert(presale_deals).values(c), out);
      console.log(`[${season}] 預售 ${out.length} 筆`);
    }

    // ---- 租賃 (c) ----
    const cFile = path.join(dir, "h_lvr_land_c.csv");
    if (fs.existsSync(cFile)) {
      const [h, ...rows] = readCsv(cFile);
      const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置");
      const iDate = col(h, "租賃年月日"), iArea = col(h, "建物總面積");
      const iRent = col(h, "總額元"), iBuilt = col(h, "建築完成年月");
      const iType = col(h, "建物型態"), iSvc = col(h, "租賃住宅服務");
      const out: (typeof rent_deals.$inferInsert)[] = [];
      for (const r of rows) {
        const rent = num(r[iRent]);
        const areaPing = num(r[iArea]) ? num(r[iArea])! / PING : null;
        if (!rent || !areaPing || areaPing <= 0) continue;
        const builtRoc = (r[iBuilt] ?? "").slice(0, 3);
        const buildYear = /^\d{2,3}$/.test(builtRoc) ? +builtRoc + 1911 : null;
        const rAddr = r[iAddr] ?? "";
        out.push({
          district: r[iDist], address: rAddr, deal_date: rocDate(r[iDate]),
          monthly_rent: rent, area_ping: areaPing, rent_per_ping: rent / areaPing,
          build_year: buildYear, building_type: iType >= 0 ? r[iType] || null : null,
          is_social: iSvc >= 0 && (r[iSvc] ?? "").includes("社會住宅"),
          addr_key: rAddr.includes("號") ? rAddr.replace(/號.*$/, "號") : null,
          raw_season: season,
        });
      }
      await db.delete(rent_deals).where(eq(rent_deals.raw_season, season));
      await insertBatched((c) => db.insert(rent_deals).values(c), out);
      console.log(`[${season}] 租賃 ${out.length} 筆`);
    }
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
