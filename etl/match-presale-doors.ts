/**
 * 老案門牌歸戶:實登 2.0(2021-07)前的預售案是交屋前後才申報,b 檔地址就是
 * 真門牌(「吉安街171號11樓B3-11F」),直接抽出來建歸戶——不需備查、不需樂居。
 * 讓無備查老案接上既有「交屋後轉售/出租」管線(communities → building_community)。
 *
 * 作法:
 *   1. 撈無 communities 列的建案,從 presale_deals.address 抽「街路+號」
 *      (剝城市/區/里鄰前綴;「號旁/號對面」等工地描述型直接拒絕)
 *   2. 門檻:門牌列 ≥6 筆、相異門牌 ≥2、主要街道佔門牌列 ≥80%、門牌列佔全案 ≥50%
 *      ——2.0 後的工地描述地址(全案同一字串)天然過不了相異門牌門檻
 *   3. 跨案搶同一門牌 → 該門牌整個放棄(不硬猜)
 *   4. communities upsert(case_no='pd|城市|區|建案名'),first_reg 用門牌上
 *      sale_deals build_year 多數決(限 ≥ 預售起始年-1,防舊建物拆除前交易汙染)
 *   5. building_community upsert(match_method='presale-door',confidence 95;
 *      ON CONFLICT DO NOTHING——地號/樂居歸戶優先)
 *   6. 順帶回填 unit_id:老案棟戶代號在地址尾碼(A1-4F),補進空欄讓棟別圖可畫
 * 冪等,可重跑。用法:tsx etl/match-presale-doors.ts
 */
import { createDb } from "../db/client";
import { cityByName, cityPrefixRe, type City } from "../src/lib/cities";

const MIN_DOOR_ROWS = 6;
const MIN_DISTINCT_DOORS = 2;
const DOMINANT_STREET_SHARE = 0.8;
const MIN_DOOR_COVERAGE = 0.5;

const toHalf = (s: string) =>
  s.replace(/[０-９Ａ-Ｚａ-ｚ－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const toFullDigits = (s: string) =>
  s.replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

/** 從單筆預售地址抽門牌;非門牌型(路名、號旁、附近…)回 null */
export function extractDoor(city: City, district: string, rawAddr: string):
  { street: string; addrKey: string; display: string } | null {
  let s = rawAddr.trim();
  // 反覆剝「城市+區」前綴(含「新北市永和區新北市永和區…」重複前綴的髒資料)
  for (let i = 0; i < 3; i++) {
    const m = s.match(cityPrefixRe);
    if (m) s = s.slice(m[1].length);
    if (s.startsWith(district)) s = s.slice(district.length);
  }
  // 里鄰前綴(「中成里11鄰吉安街…」)
  s = s.replace(/^[^0-9０-９號街路段巷弄]{0,6}里[0-9０-９]{0,3}鄰?/, "");
  if (/附近|預定|基地|工地/.test(s)) return null;
  const idx = s.indexOf("號");
  if (idx < 0) return null;
  // 「號」後面接旁/對面/鄰地等 → 是位置描述不是門牌
  if (/^[旁對側後鄰]/.test(s.slice(idx + 1))) return null;
  const head = toHalf(s.slice(0, idx));
  const m = head.match(/^(.*[街路段巷弄])(\d+(?:之\d+)?)$/);
  if (!m || m[1].length < 2) return null;
  const display = `${m[1]}${m[2]}號`;
  return { street: m[1], addrKey: `${city.name}${district}${toFullDigits(display)}`, display };
}

async function main() {
  const { pool } = createDb();

  // 棟戶代號回填:老案的 unit_id 藏在地址尾碼(A1-4F、B3-11F)
  const { rowCount: unitFilled } = await pool.query(`
    UPDATE presale_deals
    SET unit_id = (regexp_match(address, '([A-Za-zＡ-Ｚａ-ｚ0-9０-９]+[-－][0-9０-９]+[FfＦｆ])$'))[1]
    WHERE unit_id IS NULL AND address ~ '[A-Za-zＡ-Ｚａ-ｚ0-9０-９]+[-－][0-9０-９]+[FfＦｆ]$'
  `);

  const { rows } = await pool.query(`
    SELECT p.name, p.city, p.district, d.address, count(*)::int AS n,
      min(d.deal_date) AS first_deal
    FROM projects p
    JOIN presale_deals d ON d.project_name = p.name AND d.city = p.city AND d.district = p.district
    WHERE p.is_demo = false
      AND NOT EXISTS (SELECT 1 FROM communities c
        WHERE c.name = p.name AND c.city = p.city AND c.district = p.district)
    GROUP BY 1, 2, 3, 4
  `);

  type Cand = {
    caseNo: string; name: string; city: string; district: string;
    doors: Map<string, { display: string; n: number }>; firstDealYear: number; street: string;
  };
  type PRow = { address: string; n: number; first: string };
  const byProject = new Map<string, { rows: PRow[]; name: string; city: string; district: string }>();
  for (const r of rows) {
    const k = `${r.city}|${r.district}|${r.name}`;
    const g = byProject.get(k) ?? { rows: [] as PRow[], name: r.name, city: r.city, district: r.district };
    byProject.set(k, g);
    g.rows.push({ address: r.address ?? "", n: r.n, first: r.first_deal });
  }

  const candidates: Cand[] = [];
  for (const g of byProject.values()) {
    const city = cityByName(g.city);
    if (!city) continue;
    const total = g.rows.reduce((s, r) => s + r.n, 0);
    const doors = new Map<string, { display: string; street: string; n: number }>();
    let doorRows = 0;
    let firstDealYear = 9999;
    for (const r of g.rows) {
      if (r.first) firstDealYear = Math.min(firstDealYear, new Date(r.first).getFullYear());
      const d = extractDoor(city, g.district, r.address);
      if (!d) continue;
      doorRows += r.n;
      const e = doors.get(d.addrKey) ?? { display: d.display, street: d.street, n: 0 };
      e.n += r.n;
      doors.set(d.addrKey, e);
    }
    if (doorRows < MIN_DOOR_ROWS || doorRows / total < MIN_DOOR_COVERAGE) continue;
    // 主要街道多數決:雜訊門牌(打錯路名)不進歸戶
    const byStreet = new Map<string, number>();
    for (const e of doors.values()) byStreet.set(e.street, (byStreet.get(e.street) ?? 0) + e.n);
    const [mainStreet, mainN] = [...byStreet.entries()].sort((a, b) => b[1] - a[1])[0];
    if (mainN / doorRows < DOMINANT_STREET_SHARE) continue;
    const kept = new Map([...doors.entries()].filter(([, e]) => e.street === mainStreet)
      .map(([k, e]) => [k, { display: e.display, n: e.n }] as const));
    if (kept.size < MIN_DISTINCT_DOORS) continue;
    candidates.push({
      caseNo: `pd|${g.city}|${g.district}|${g.name}`,
      name: g.name, city: g.city, district: g.district,
      doors: new Map(kept), firstDealYear, street: mainStreet,
    });
  }

  // 跨案搶同一門牌:整個門牌放棄
  const claim = new Map<string, number>();
  for (const c of candidates) for (const k of c.doors.keys()) claim.set(k, (claim.get(k) ?? 0) + 1);
  let conflicts = 0;
  for (const c of candidates) {
    for (const k of [...c.doors.keys()]) {
      if ((claim.get(k) ?? 0) > 1) { c.doors.delete(k); conflicts++; }
    }
  }

  let projectsLinked = 0, doorsLinked = 0;
  for (const c of candidates) {
    if (c.doors.size < MIN_DISTINCT_DOORS) continue;
    const addrKeys = [...c.doors.keys()];
    // 完工年:門牌上成屋交易的 build_year 多數決(限預售起始年-1 之後,防舊屋汙染)
    const { rows: [by] } = await pool.query(`
      SELECT build_year FROM sale_deals
      WHERE addr_key = ANY($1) AND build_year IS NOT NULL AND build_year >= $2
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 1
    `, [addrKeys, c.firstDealYear - 1]);
    const firstReg = by?.build_year ? `${by.build_year}-01-01` : null;
    const repDoor = [...c.doors.values()].sort((a, b) => b.n - a.n)[0].display;

    await pool.query(`
      INSERT INTO communities (case_no, name, district, city, street, first_reg)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (case_no) DO UPDATE SET street = EXCLUDED.street, first_reg = EXCLUDED.first_reg
    `, [c.caseNo, c.name, c.district, c.city, repDoor, firstReg]);
    for (const k of addrKeys) {
      const { rowCount } = await pool.query(`
        INSERT INTO building_community (addr_key, case_no, match_method, confidence)
        VALUES ($1, $2, 'presale-door', 95) ON CONFLICT (addr_key) DO NOTHING
      `, [k, c.caseNo]);
      doorsLinked += rowCount ?? 0;
    }
    projectsLinked++;
  }

  console.log(
    `[presale-doors] 歸戶 ${projectsLinked} 案、${doorsLinked} 門牌;` +
    `跨案衝突棄用 ${conflicts} 門牌;unit_id 回填 ${unitFilled} 筆`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
