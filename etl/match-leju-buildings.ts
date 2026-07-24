/**
 * 樂居門牌歸戶:把 coord-overrides.json(樂居查證的 建案名↔門牌)灌進
 * communities / building_community,讓無備查的建案也能走既有的
 * 「交屋後轉售」管線(project-detail 的 communities → building_community → sale_deals)。
 *
 * 作法:
 *   1. 錨點 = override 門牌的 buildings 列(addr_key 精確命中;查無代表尚未有成屋交易,跳過)
 *   2. 群聚 = 同街道前綴 + 完工年 ±1 + 距錨點 ≤70m 的 buildings(同社區的其他門牌)
 *   3. communities upsert 合成列 case_no='leju|城市|區|建案名',first_reg=完工年 1/1
 *   4. building_community upsert(match_method='leju-door',錨點 confidence=100、鄰棟 80;
 *      不覆蓋既有的地號歸戶結果)
 * 冪等,可重跑。用法:tsx etl/match-leju-buildings.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createDb } from "../db/client";
import { cityByName } from "../src/lib/cities";
import { normAddrKey } from "./addr";

const OV_FILE = path.join(import.meta.dirname, "coord-overrides.json");
const NEIGHBOR_RADIUS_M = 70;
const YEAR_TOLERANCE = 1;

// buildings.addr_key 沿用實登原文的全形數字(朝陽街３５３號);樂居門牌是半形,先轉全形
const toFullDigits = (s: string) =>
  s.replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

const metersApprox = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const dy = (lat1 - lat2) * 111_320;
  const dx = (lng1 - lng2) * 111_320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

async function main() {
  if (!fs.existsSync(OV_FILE)) { console.log("[leju-match] 無 coord-overrides.json,跳過"); return; }
  const overrides: Array<{ city: string; district: string; name: string; address: string }> =
    JSON.parse(fs.readFileSync(OV_FILE, "utf8"));
  const { pool } = createDb();

  let anchors = 0, neighbors = 0, noBuilding = 0;
  for (const ov of overrides) {
    const city = cityByName(ov.city);
    if (!city) continue;
    const addrKey = normAddrKey(city, ov.district, toFullDigits(ov.address));
    if (!addrKey) continue;

    const { rows: [anchor] } = await pool.query(
      `SELECT addr_key, lat, lng, build_year FROM buildings WHERE addr_key = $1`, [addrKey]);
    if (!anchor?.lat) { noBuilding++; continue; }

    const caseNo = `leju|${ov.city}|${ov.district}|${ov.name}`;
    const firstReg = anchor.build_year ? `${anchor.build_year}-01-01` : null;
    await pool.query(`
      INSERT INTO communities (case_no, name, district, city, street, first_reg)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (case_no) DO UPDATE SET street = EXCLUDED.street, first_reg = EXCLUDED.first_reg
    `, [caseNo, ov.name, ov.district, ov.city, ov.address, firstReg]);

    // 錨點門牌
    const { rowCount: a } = await pool.query(`
      INSERT INTO building_community (addr_key, case_no, match_method, confidence)
      VALUES ($1, $2, 'leju-door', 100) ON CONFLICT (addr_key) DO NOTHING
    `, [anchor.addr_key, caseNo]);
    anchors += a ?? 0;

    // 鄰棟:同街道前綴(去掉門牌號)+ 完工年相近 + 距離內
    const streetPrefix = addrKey.replace(/[０-９]+(之[０-９]+)?號$/, "");
    if (streetPrefix !== addrKey && anchor.build_year) {
      const { rows: cluster } = await pool.query(`
        SELECT addr_key, lat, lng FROM buildings
        WHERE addr_key LIKE $1 || '%號' AND addr_key <> $2
          AND build_year BETWEEN $3 AND $4 AND lat IS NOT NULL
      `, [streetPrefix, anchor.addr_key, anchor.build_year - YEAR_TOLERANCE, anchor.build_year + YEAR_TOLERANCE]);
      for (const b of cluster) {
        if (metersApprox(+anchor.lat, +anchor.lng, +b.lat, +b.lng) > NEIGHBOR_RADIUS_M) continue;
        const { rowCount: n } = await pool.query(`
          INSERT INTO building_community (addr_key, case_no, match_method, confidence)
          VALUES ($1, $2, 'leju-door', 80) ON CONFLICT (addr_key) DO NOTHING
        `, [b.addr_key, caseNo]);
        neighbors += n ?? 0;
      }
    }
  }
  console.log(`[leju-match] 錨點 ${anchors}、鄰棟 ${neighbors};門牌尚無成屋交易 ${noBuilding} 案`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
