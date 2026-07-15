/**
 * 解析實價登錄 CSV → PostgreSQL
 * 處理:民國日期、BOM、第二列英文表頭、m²→坪、車位價拆分
 * 用法:tsx etl/parse-lvr.ts   (吃 etl/downloads/ 下所有期別)
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { Client } from "pg";

const PING = 3.305785; // m² per 坪
const DL = path.join(import.meta.dirname, "downloads");

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

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://roi:roi@localhost:5432/taoyuan_roi" });
  await client.connect();

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
      await client.query("DELETE FROM sale_deals WHERE raw_season=$1", [season]);
      let n = 0;
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
        await client.query(
          `INSERT INTO sale_deals(district,address,deal_date,total_price,parking_price,area_ping,parking_area_ping,main_area_ping,unit_price,unit_price_main,building_type,build_year,addr_key,raw_season)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [r[iDist], addr, rocDate(r[iDate]), total / 10000, park / 10000,
           areaPing, parkAreaPing, mainAreaPing, unit, unitMain,
           iType >= 0 ? r[iType] || null : null, buildYear, addrKey, season]);
        n++;
      }
      console.log(`[${season}] 買賣 ${n} 筆`);
    }

    // ---- 預售屋 (b) ----
    const bFile = path.join(dir, "h_lvr_land_b.csv");
    if (fs.existsSync(bFile)) {
      const [h, ...rows] = readCsv(bFile);
      const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置");
      const iDate = col(h, "交易年月日"), iArea = col(h, "建物移轉總面積");
      const iTotal = col(h, "總價元"), iPark = col(h, "車位總價");
      const iProj = col(h, "建案名稱");
      await client.query("DELETE FROM presale_deals WHERE raw_season=$1", [season]);
      let n = 0;
      for (const r of rows) {
        const total = num(r[iTotal]), park = num(r[iPark]) ?? 0;
        const areaPing = num(r[iArea]) ? num(r[iArea])! / PING : null;
        if (!total || !areaPing || areaPing <= 0) continue;
        const unit = (total - park) / 10000 / areaPing; // 萬/坪(粗估:未扣車位坪)
        await client.query(
          `INSERT INTO presale_deals(district,project_name,address,deal_date,total_price,parking_price,area_ping,unit_price,raw_season)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [r[iDist], iProj >= 0 ? r[iProj] : null, r[iAddr], rocDate(r[iDate]),
           total / 10000, park / 10000, areaPing, unit, season]);
        n++;
      }
      console.log(`[${season}] 預售 ${n} 筆`);
    }

    // ---- 租賃 (c) ----
    const cFile = path.join(dir, "h_lvr_land_c.csv");
    if (fs.existsSync(cFile)) {
      const [h, ...rows] = readCsv(cFile);
      const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置");
      const iDate = col(h, "租賃年月日"), iArea = col(h, "建物總面積");
      const iRent = col(h, "總額元"), iBuilt = col(h, "建築完成年月");
      const iType = col(h, "建物型態"), iSvc = col(h, "租賃住宅服務");
      await client.query("DELETE FROM rent_deals WHERE raw_season=$1", [season]);
      let n = 0;
      for (const r of rows) {
        const rent = num(r[iRent]);
        const areaPing = num(r[iArea]) ? num(r[iArea])! / PING : null;
        if (!rent || !areaPing || areaPing <= 0) continue;
        const builtRoc = (r[iBuilt] ?? "").slice(0, 3);
        const buildYear = /^\d{2,3}$/.test(builtRoc) ? +builtRoc + 1911 : null;
        const buildingType = iType >= 0 ? r[iType] || null : null;
        const isSocial = iSvc >= 0 && (r[iSvc] ?? "").includes("社會住宅");
        await client.query(
          `INSERT INTO rent_deals(district,address,deal_date,monthly_rent,area_ping,rent_per_ping,build_year,building_type,is_social,raw_season)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [r[iDist], r[iAddr], rocDate(r[iDate]), rent, areaPing, rent / areaPing, buildYear, buildingType, isSocial, season]);
        n++;
      }
      console.log(`[${season}] 租賃 ${n} 筆`);
    }
  }
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
