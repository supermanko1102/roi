/**
 * 解析實價登錄 CSV → PostgreSQL(逐城市;城市清單見 src/lib/cities)
 * 處理:民國日期、BOM、第二列英文表頭、m²→坪、車位價拆分
 * 用法:tsx etl/parse-lvr.ts   (吃 etl/downloads/ 下所有期別)
 */
import fs from "node:fs";
import path from "node:path";
import { and, count, eq, like, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createDb, sale_deals, presale_deals, rent_deals } from "../db/client";
import { CITIES } from "../src/lib/cities";
import { normAddrKey } from "./addr";
import { col, intOrNull, num, parseFloor, readCsv, rocDate } from "./lvr-fields";
import { assertReplacementSafe } from "./replacement-safety";

const PING = 3.305785; // m² per 坪
const DL = path.join(import.meta.dirname, "downloads");
const BATCH = 500;

async function insertBatched<T>(insert: (chunk: T[]) => Promise<unknown>, rows: T[]) {
  for (let i = 0; i < rows.length; i += BATCH) await insert(rows.slice(i, i + BATCH));
}

async function main() {
  const allowEmpty = process.argv.includes("--allow-empty");
  const { db, pool } = createDb();

  for (const season of fs.readdirSync(DL)) {
    const dir = path.join(DL, season);
    // 正式季度打包檔要一併取代該季累積的旬檔(raw_season 如 115S3#0701)
    const seasonScope = (col: AnyPgColumn) =>
      /^\d{3}S[1-4]$/.test(season) ? or(eq(col, season), like(col, `${season}#%`)) : eq(col, season);

    for (const city of CITIES) {
      // 刪除範圍必須同時鎖季別與城市:重跑單一城市不能清掉其他城市的資料
      const scope = (seasonCol: AnyPgColumn, cityCol: AnyPgColumn) =>
        and(seasonScope(seasonCol), eq(cityCol, city.name));

      // ---- 中古/成屋買賣 (a) ----
      const aFile = path.join(dir, `${city.code}_lvr_land_a.csv`);
      if (fs.existsSync(aFile)) {
        const [h, ...rows] = readCsv(aFile);
        const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置");
        const iTarget = col(h, "交易標的"), iDate = col(h, "交易年月日");
        const iArea = col(h, "建物移轉總面積"), iMain = col(h, "主建物面積");
        const iTotal = col(h, "總價元"), iPark = col(h, "車位總價");
        const iParkArea = col(h, "車位移轉總面積");
        const iType = col(h, "建物型態"), iBuilt = col(h, "建築完成年月");
        const iRooms = col(h, "格局", "房"), iHalls = col(h, "格局", "廳"), iBaths = col(h, "格局", "衛");
        const iFloor = col(h, "移轉層次"), iFloors = col(h, "總樓層數");
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
          out.push({
            city: city.name,
            district: r[iDist], address: addr, deal_date: rocDate(r[iDate]),
            total_price: total / 10000, parking_price: park / 10000,
            area_ping: areaPing, parking_area_ping: parkAreaPing, main_area_ping: mainAreaPing,
            unit_price: unit, unit_price_main: unitMain,
            building_type: iType >= 0 ? r[iType] || null : null,
            build_year: buildYear, addr_key: normAddrKey(city, r[iDist], addr),
            rooms: intOrNull(r[iRooms]), halls: intOrNull(r[iHalls]), baths: intOrNull(r[iBaths]),
            floor_no: parseFloor(r[iFloor]), total_floors: parseFloor(r[iFloors]),
            raw_season: season,
          });
        }
        const [{ n: previous }] = await db.select({ n: count() }).from(sale_deals)
          .where(and(eq(sale_deals.raw_season, season), eq(sale_deals.city, city.name)));
        assertReplacementSafe(`[${season}] ${city.display} 買賣`, previous, out.length, allowEmpty);
        await db.transaction(async (tx) => {
          await tx.delete(sale_deals).where(scope(sale_deals.raw_season, sale_deals.city));
          await insertBatched((c) => tx.insert(sale_deals).values(c), out);
        });
        console.log(`[${season}] ${city.display} 買賣 ${out.length} 筆`);
      }

      // ---- 預售屋 (b) ----
      const bFile = path.join(dir, `${city.code}_lvr_land_b.csv`);
      if (fs.existsSync(bFile)) {
        const [h, ...rows] = readCsv(bFile);
        const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置");
        const iDate = col(h, "交易年月日"), iArea = col(h, "建物移轉總面積");
        const iTotal = col(h, "總價元"), iPark = col(h, "車位總價");
        const iParkArea = col(h, "車位移轉總面積");
        const iProj = col(h, "建案名稱");
        const iRooms = col(h, "格局", "房"), iHalls = col(h, "格局", "廳"), iBaths = col(h, "格局", "衛");
        const iFloor = col(h, "移轉層次"), iFloors = col(h, "總樓層數");
        const iCancel = col(h, "解約情形"), iUnit = col(h, "棟及號");
        const out: (typeof presale_deals.$inferInsert)[] = [];
        for (const r of rows) {
          const total = num(r[iTotal]), park = num(r[iPark]) ?? 0;
          const areaPing = num(r[iArea]) ? num(r[iArea])! / PING : null;
          if (!total || !areaPing || areaPing <= 0) continue;
          const parkAreaPing = (num(r[iParkArea]) ?? 0) / PING;
          const netArea = areaPing - parkAreaPing;
          const unit = netArea > 0 ? (total - park) / 10000 / netArea : null;
          // 解約情形:如「1150530全部解約」,開頭是民國日期
          const cancel = iCancel >= 0 ? (r[iCancel] ?? "").trim() : "";
          out.push({
            city: city.name,
            district: r[iDist], project_name: iProj >= 0 ? r[iProj] : null,
            address: r[iAddr], deal_date: rocDate(r[iDate]),
            total_price: total / 10000, parking_price: park / 10000,
            area_ping: areaPing, parking_area_ping: parkAreaPing,
            unit_price: unit,
            rooms: intOrNull(r[iRooms]), halls: intOrNull(r[iHalls]), baths: intOrNull(r[iBaths]),
            floor_no: parseFloor(r[iFloor]), total_floors: parseFloor(r[iFloors]),
            is_cancelled: cancel.includes("解約"),
            cancel_date: rocDate(cancel.match(/^\d{7}/)?.[0]),
            unit_id: iUnit >= 0 ? r[iUnit] || null : null,
            raw_season: season,
          });
        }
        const [{ n: previous }] = await db.select({ n: count() }).from(presale_deals)
          .where(and(eq(presale_deals.raw_season, season), eq(presale_deals.city, city.name)));
        assertReplacementSafe(`[${season}] ${city.display} 預售`, previous, out.length, allowEmpty);
        await db.transaction(async (tx) => {
          await tx.delete(presale_deals).where(scope(presale_deals.raw_season, presale_deals.city));
          await insertBatched((c) => tx.insert(presale_deals).values(c), out);
        });
        console.log(`[${season}] ${city.display} 預售 ${out.length} 筆`);
      }

      // ---- 租賃 (c) ----
      const cFile = path.join(dir, `${city.code}_lvr_land_c.csv`);
      if (fs.existsSync(cFile)) {
        const [h, ...rows] = readCsv(cFile);
        const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置");
        const iDate = col(h, "租賃年月日"), iArea = col(h, "建物總面積");
        const iRent = col(h, "總額元"), iBuilt = col(h, "建築完成年月");
        const iType = col(h, "建物型態"), iSvc = col(h, "租賃住宅服務");
        const iPark = col(h, "車位總額"), iParkArea = col(h, "車位面積");
        const iRentalType = col(h, "出租型態");
        const iRooms = col(h, "格局", "房"), iHalls = col(h, "格局", "廳"), iBaths = col(h, "格局", "衛");
        const iFloor = col(h, "租賃層次"), iFloors = col(h, "總樓層數");
        const out: (typeof rent_deals.$inferInsert)[] = [];
        for (const r of rows) {
          const rent = num(r[iRent]);
          const areaPing = num(r[iArea]) ? num(r[iArea])! / PING : null;
          if (!rent || !areaPing || areaPing <= 0) continue;
          const parkingRentRaw = iPark >= 0 ? (num(r[iPark]) ?? 0) : 0;
          const parkingRent = parkingRentRaw > 0 && parkingRentRaw < rent ? parkingRentRaw : 0;
          const parkingAreaPing = iParkArea >= 0 ? (num(r[iParkArea]) ?? 0) / PING : 0;
          const housingRent = rent - parkingRent;
          const netArea = areaPing - parkingAreaPing;
          const builtRoc = (r[iBuilt] ?? "").slice(0, 3);
          const buildYear = /^\d{2,3}$/.test(builtRoc) ? +builtRoc + 1911 : null;
          const rAddr = r[iAddr] ?? "";
          const serviceType = iSvc >= 0 ? (r[iSvc] || null) : null;
          out.push({
            city: city.name,
            district: r[iDist], address: rAddr, deal_date: rocDate(r[iDate]),
            monthly_rent: rent, housing_rent: housingRent, parking_rent: parkingRent,
            area_ping: areaPing, parking_area_ping: parkingAreaPing,
            rent_per_ping: netArea > 0 ? housingRent / netArea : null,
            build_year: buildYear, building_type: iType >= 0 ? r[iType] || null : null,
            rental_type: iRentalType >= 0 ? r[iRentalType] || null : null,
            rooms: intOrNull(r[iRooms]), halls: intOrNull(r[iHalls]), baths: intOrNull(r[iBaths]),
            floor_no: parseFloor(r[iFloor]), total_floors: parseFloor(r[iFloors]),
            service_type: serviceType,
            is_social: serviceType?.includes("社會住宅") ?? false,
            addr_key: normAddrKey(city, r[iDist], rAddr),
            raw_season: season,
          });
        }
        const [{ n: previous }] = await db.select({ n: count() }).from(rent_deals)
          .where(and(eq(rent_deals.raw_season, season), eq(rent_deals.city, city.name)));
        assertReplacementSafe(`[${season}] ${city.display} 租賃`, previous, out.length, allowEmpty);
        await db.transaction(async (tx) => {
          await tx.delete(rent_deals).where(scope(rent_deals.raw_season, rent_deals.city));
          await insertBatched((c) => tx.insert(rent_deals).values(c), out);
        });
        console.log(`[${season}] ${city.display} 租賃 ${out.length} 筆`);
      }
    }
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
