/**
 * 示範種子資料:讓專案不跑 ETL 也能起來。跑過 etl:all 後會被真資料覆蓋。
 * 可重複執行:district_stats/projects 靠 ON CONFLICT;
 * sale_deals(raw_season='demo')與 buildings(demo addr_key)先刪再插。
 * 棟級點位與成交明細用固定種子 PRNG 生成,每次執行結果相同。
 */
import { sql, eq, inArray } from "drizzle-orm";
import { createDb, district_stats, projects, buildings, sale_deals } from "./client";

const DISTRICTS: Omit<typeof district_stats.$inferInsert, "city">[] = [
  { district: "桃園區", median_unit_price: 43.3, median_rent_ping: 740, est_roi: 2.05, presale_count: 128, rent_samples: 96, is_demo: true },
  { district: "龜山區", median_unit_price: 44.2, median_rent_ping: 865, est_roi: 2.35, presale_count: 87,  rent_samples: 74, is_demo: true },
  { district: "中壢區", median_unit_price: 38.4, median_rent_ping: 672, est_roi: 2.10, presale_count: 143, rent_samples: 88, is_demo: true },
  { district: "八德區", median_unit_price: 36.1, median_rent_ping: 737, est_roi: 2.45, presale_count: 65,  rent_samples: 52, is_demo: true },
  { district: "蘆竹區", median_unit_price: 35.2, median_rent_ping: 645, est_roi: 2.20, presale_count: 58,  rent_samples: 41, is_demo: true },
  { district: "大園區", median_unit_price: 32.8, median_rent_ping: 588, est_roi: 2.15, presale_count: 46,  rent_samples: 29, is_demo: true },
  { district: "平鎮區", median_unit_price: 30.5, median_rent_ping: 635, est_roi: 2.50, presale_count: 39,  rent_samples: 33, is_demo: true },
  { district: "楊梅區", median_unit_price: 25.4, median_rent_ping: 540, est_roi: 2.55, presale_count: 31,  rent_samples: 24, is_demo: true },
  { district: "龍潭區", median_unit_price: 24.8, median_rent_ping: 537, est_roi: 2.60, presale_count: 27,  rent_samples: 18, is_demo: true },
  { district: "大溪區", median_unit_price: 23.5, median_rent_ping: 470, est_roi: 2.40, presale_count: 14,  rent_samples: 11, is_demo: true },
  { district: "觀音區", median_unit_price: 21.2, median_rent_ping: 468, est_roi: 2.65, presale_count: 12,  rent_samples: 8,  is_demo: true },
  { district: "新屋區", median_unit_price: 19.6, median_rent_ping: 441, est_roi: 2.70, presale_count: 7,   rent_samples: 6,  is_demo: true },
];

// 建案:給 total/area/rent,單價與投報率由程式推導,避免手填不一致
type ProjSeed = { name: string; district: string; lat: number; lng: number;
  total: number; area: number; rent: number; rentN: number; deals: number };
const PROJECT_SEEDS: ProjSeed[] = [
  // 桃園區(藝文特區/中路/小檜溪/站前)
  { name: "擎天藝文",   district: "桃園區", lat: 25.0090, lng: 121.2985, total: 2150, area: 31, rent: 33000, rentN: 10, deals: 22 },
  { name: "樾中央",     district: "桃園區", lat: 24.9812, lng: 121.3055, total: 1720, area: 29, rent: 29000, rentN: 11, deals: 31 },
  { name: "悅河灣",     district: "桃園區", lat: 25.0062, lng: 121.3208, total: 1650, area: 28, rent: 28000, rentN: 9,  deals: 18 },
  { name: "城心站前",   district: "桃園區", lat: 24.9895, lng: 121.3125, total: 1450, area: 25, rent: 27500, rentN: 15, deals: 26 },
  { name: "中路雙星",   district: "桃園區", lat: 24.9838, lng: 121.2920, total: 1830, area: 30, rent: 30000, rentN: 12, deals: 35 },
  { name: "小檜溪湛",   district: "桃園區", lat: 25.0048, lng: 121.3252, total: 1980, area: 32, rent: 31000, rentN: 8,  deals: 16 },
  { name: "經國天匯",   district: "桃園區", lat: 25.0155, lng: 121.3020, total: 2080, area: 33, rent: 32000, rentN: 9,  deals: 24 },
  { name: "大有青雲",   district: "桃園區", lat: 25.0108, lng: 121.3175, total: 1380, area: 24, rent: 25500, rentN: 13, deals: 29 },
  // 中壢區(青埔/老街/中原)
  { name: "峰匯青埔",   district: "中壢區", lat: 25.0128, lng: 121.2148, total: 1980, area: 33, rent: 32000, rentN: 14, deals: 40 },
  { name: "鉑麗海華",   district: "中壢區", lat: 24.9645, lng: 121.2168, total: 1560, area: 27, rent: 27000, rentN: 12, deals: 15 },
  { name: "青塘悅",     district: "中壢區", lat: 25.0085, lng: 121.2210, total: 2250, area: 35, rent: 34000, rentN: 10, deals: 33 },
  { name: "站前威均",   district: "中壢區", lat: 24.9540, lng: 121.2258, total: 1280, area: 24, rent: 24000, rentN: 16, deals: 27 },
  { name: "中原學府",   district: "中壢區", lat: 24.9572, lng: 121.2402, total: 1150, area: 23, rent: 23000, rentN: 18, deals: 21 },
  { name: "過嶺春上",   district: "中壢區", lat: 24.9820, lng: 121.1850, total: 1050, area: 26, rent: 21000, rentN: 7,  deals: 19 },
  { name: "A21環北",    district: "中壢區", lat: 24.9700, lng: 121.2205, total: 1490, area: 26, rent: 26500, rentN: 11, deals: 25 },
  // 龜山區(A7/龜山市區/迴龍)
  { name: "山王A7",     district: "龜山區", lat: 25.0448, lng: 121.3842, total: 1280, area: 26, rent: 26500, rentN: 17, deals: 55 },
  { name: "鉑悅A7",     district: "龜山區", lat: 25.0412, lng: 121.3878, total: 1350, area: 28, rent: 27000, rentN: 17, deals: 38 },
  { name: "合雄文青",   district: "龜山區", lat: 25.0492, lng: 121.3905, total: 1180, area: 25, rent: 25000, rentN: 14, deals: 42 },
  { name: "長庚樾",     district: "龜山區", lat: 25.0575, lng: 121.3660, total: 1420, area: 27, rent: 27500, rentN: 12, deals: 20 },
  { name: "迴龍新境",   district: "龜山區", lat: 25.0135, lng: 121.4085, total: 1090, area: 25, rent: 24000, rentN: 9,  deals: 17 },
  // 八德區
  { name: "大砌八德",   district: "八德區", lat: 24.9460, lng: 121.2965, total: 1180, area: 27, rent: 24500, rentN: 13, deals: 20 },
  { name: "觀止大湳",   district: "八德區", lat: 24.9585, lng: 121.3120, total: 1250, area: 26, rent: 25000, rentN: 3,  deals: 9 },
  { name: "擴大謙玥",   district: "八德區", lat: 24.9400, lng: 121.2760, total: 1320, area: 28, rent: 25500, rentN: 10, deals: 28 },
  { name: "介壽央座",   district: "八德區", lat: 24.9520, lng: 121.2850, total: 1080, area: 24, rent: 22500, rentN: 11, deals: 15 },
  // 蘆竹區(南崁/大竹)
  { name: "南崁之星",   district: "蘆竹區", lat: 25.0450, lng: 121.2930, total: 1380, area: 28, rent: 26000, rentN: 12, deals: 30 },
  { name: "大竹麗池",   district: "蘆竹區", lat: 25.0330, lng: 121.2635, total: 980,  area: 25, rent: 20500, rentN: 8,  deals: 18 },
  { name: "蘆竹匯",     district: "蘆竹區", lat: 25.0508, lng: 121.2870, total: 1250, area: 26, rent: 24500, rentN: 10, deals: 22 },
  // 大園區(A19/A16/市區)
  { name: "灣岸A19",    district: "大園區", lat: 25.0335, lng: 121.2260, total: 1690, area: 30, rent: 28500, rentN: 7,  deals: 12 },
  { name: "領航橫峰",   district: "大園區", lat: 25.0420, lng: 121.2155, total: 1520, area: 29, rent: 26500, rentN: 6,  deals: 14 },
  { name: "A16堤頂",    district: "大園區", lat: 25.0570, lng: 121.2410, total: 1310, area: 28, rent: 24000, rentN: 5,  deals: 10 },
  // 平鎮區
  { name: "平鎮心",     district: "平鎮區", lat: 24.9450, lng: 121.2180, total: 990,  area: 25, rent: 21000, rentN: 8,  deals: 14 },
  { name: "山仔頂雙城", district: "平鎮區", lat: 24.9280, lng: 121.2295, total: 920,  area: 24, rent: 19500, rentN: 9,  deals: 16 },
  { name: "環南金鑽",   district: "平鎮區", lat: 24.9385, lng: 121.2085, total: 1060, area: 26, rent: 21500, rentN: 7,  deals: 12 },
  // 楊梅區
  { name: "埔心之丘",   district: "楊梅區", lat: 24.9210, lng: 121.1660, total: 880, area: 24, rent: 18500, rentN: 6, deals: 10 },
  { name: "楊梅香砌",   district: "楊梅區", lat: 24.9075, lng: 121.1455, total: 760, area: 23, rent: 16500, rentN: 7, deals: 13 },
  { name: "富岡樂章",   district: "楊梅區", lat: 24.9370, lng: 121.1120, total: 640, area: 24, rent: 14000, rentN: 4, deals: 8 },
  // 龍潭區
  { name: "潭心蘊",     district: "龍潭區", lat: 24.8640, lng: 121.2160, total: 720, area: 24, rent: 15500, rentN: 6, deals: 11 },
  { name: "北龍學苑",   district: "龍潭區", lat: 24.8710, lng: 121.2225, total: 680, area: 23, rent: 15000, rentN: 5, deals: 9 },
  // 大溪區
  { name: "溪岸埕",     district: "大溪區", lat: 24.8810, lng: 121.2870, total: 660, area: 24, rent: 13500, rentN: 5, deals: 8 },
  { name: "埔頂公園苑", district: "大溪區", lat: 24.8935, lng: 121.2760, total: 730, area: 25, rent: 14500, rentN: 4, deals: 7 },
  // 觀音區
  { name: "草漯晴",     district: "觀音區", lat: 25.0560, lng: 121.1300, total: 620, area: 25, rent: 12500, rentN: 4, deals: 9 },
  { name: "觀音首馥",   district: "觀音區", lat: 25.0330, lng: 121.0780, total: 560, area: 24, rent: 11500, rentN: 3, deals: 6 },
  // 新屋區
  { name: "頭洲寓",     district: "新屋區", lat: 24.9720, lng: 121.1060, total: 520, area: 24, rent: 10500, rentN: 3, deals: 5 },
  { name: "新屋星澄",   district: "新屋區", lat: 24.9660, lng: 121.0925, total: 490, area: 23, rent: 10000, rentN: 3, deals: 6 },
];

const PROJECTS: Omit<typeof projects.$inferInsert, "city">[] = PROJECT_SEEDS.map((p) => ({
  name: p.name, district: p.district, lat: p.lat, lng: p.lng,
  median_total: p.total, median_area: p.area,
  unit_price: +(p.total / p.area * 0.88).toFixed(1),   // 粗估扣車位後單價
  est_rent: p.rent,
  est_roi: +((p.rent * 12) / (p.total * 10000) * 100).toFixed(2),
  rent_samples: p.rentN, deal_count: p.deals, is_demo: true,
}));

// ---------- 棟級(中古屋)demo 生成 ----------

// 每區:市中心錨點、常見路名、扣車位單價帶(萬/坪)、生成棟數
type DistrictGen = { district: string; anchors: [number, number][]; streets: string[];
  price: [number, number]; count: number };
const GEN: DistrictGen[] = [
  { district: "桃園區", count: 45, price: [26, 42],
    anchors: [[24.993, 121.301], [25.009, 121.298], [24.983, 121.291], [25.004, 121.320]],
    streets: ["中正路", "復興路", "三民路三段", "大興西路二段", "中平路", "南平路", "經國路", "大有路"] },
  { district: "中壢區", count: 42, price: [23, 38],
    anchors: [[24.954, 121.226], [25.011, 121.216], [24.957, 121.240], [24.970, 121.205]],
    streets: ["中央西路二段", "延平路", "環北路", "中華路一段", "中豐路", "元化路", "龍岡路二段", "高鐵北路一段"] },
  { district: "龜山區", count: 28, price: [22, 36],
    anchors: [[25.047, 121.386], [25.003, 121.339], [25.014, 121.408]],
    streets: ["文化一路", "復興一路", "萬壽路二段", "振興路", "文青路", "樂善二路"] },
  { district: "八德區", count: 24, price: [20, 33],
    anchors: [[24.946, 121.290], [24.958, 121.311], [24.941, 121.277]],
    streets: ["介壽路一段", "廣福路", "建國路", "和平路", "永豐路"] },
  { district: "蘆竹區", count: 22, price: [20, 32],
    anchors: [[25.045, 121.293], [25.033, 121.264]],
    streets: ["南崁路一段", "中正路", "奉化路", "大竹路", "南山路一段"] },
  { district: "平鎮區", count: 18, price: [16, 27],
    anchors: [[24.925, 121.218], [24.938, 121.209]],
    streets: ["環南路二段", "延平路一段", "民族路", "廣泰路"] },
  { district: "大園區", count: 14, price: [17, 30],
    anchors: [[25.064, 121.196], [25.034, 121.225]],
    streets: ["中正東路", "領航南路二段", "高鐵站前西路一段", "中華路"] },
  { district: "楊梅區", count: 14, price: [13, 23],
    anchors: [[24.907, 121.146], [24.921, 121.166]],
    streets: ["大成路", "中山北路一段", "永美路", "金德路"] },
  { district: "龍潭區", count: 12, price: [12, 22],
    anchors: [[24.864, 121.216]],
    streets: ["中正路", "北龍路", "大昌路二段", "中興路"] },
  { district: "大溪區", count: 8,  price: [11, 20],
    anchors: [[24.881, 121.287]],
    streets: ["康莊路", "員林路一段", "介壽路", "慈湖路一段"] },
  { district: "觀音區", count: 7,  price: [10, 18],
    anchors: [[25.056, 121.130], [25.033, 121.078]],
    streets: ["中山路二段", "成功路", "大觀路一段"] },
  { district: "新屋區", count: 6,  price: [9, 16],
    anchors: [[24.972, 121.106]],
    streets: ["中華路", "中山西路一段", "文化路"] },
];

// 固定種子 PRNG(mulberry32):重跑 seed 產生同一批門牌
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260715);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

function generateResale() {
  const bldgRows: (typeof buildings.$inferInsert)[] = [];
  const dealRows: (typeof sale_deals.$inferInsert)[] = [];
  const usedAddr = new Set<string>();

  for (const g of GEN) {
    for (let i = 0; i < g.count; i++) {
      const anchor = g.anchors[Math.floor(rand() * g.anchors.length)];
      const lat = +(anchor[0] + (rand() - 0.5) * 0.016).toFixed(6);
      const lng = +(anchor[1] + (rand() - 0.5) * 0.016).toFixed(6);

      let addr_key = "";
      do {
        const street = g.streets[Math.floor(rand() * g.streets.length)];
        addr_key = `桃園市${g.district}${street}${1 + Math.floor(rand() * 320)}號`;
      } while (usedAddr.has(addr_key));
      usedAddr.add(addr_key);

      const tRoll = rand();
      const building_type = tRoll < 0.55 ? "住宅大樓(11層含以上有電梯)"
        : tRoll < 0.75 ? "華廈(10層含以下有電梯)"
        : tRoll < 0.90 ? "透天厝" : "公寓(5樓含以下無電梯)";
      const isHouse = building_type === "透天厝";
      const build_year = 1990 + Math.floor(rand() * 34);
      // 棟基準單價:區間內隨機,屋齡越新越貴;透天單價通常較低
      const ageFactor = 0.78 + 0.22 * ((build_year - 1990) / 34);
      const base = (g.price[0] + (g.price[1] - g.price[0]) * rand()) * ageFactor * (isHouse ? 0.82 : 1);

      const nDeals = 2 + Math.floor(rand() * 7);
      const unitPrices: number[] = [];
      const totals: number[] = [];
      let last = "";
      for (let d = 0; d < nDeals; d++) {
        const dayOffset = Math.floor(rand() * 1095); // 2023-07 起三年內
        const date = new Date(Date.UTC(2023, 6, 1 + dayOffset));
        const drift = 1 + (dayOffset / 1095) * 0.06;  // 緩漲 6%/3年
        const unit = +(base * (0.92 + rand() * 0.16) * drift).toFixed(1);
        const area = +(isHouse ? 40 + rand() * 40 : 18 + rand() * 28).toFixed(1);
        const hasParking = !isHouse && rand() < 0.35;
        const parking_price = hasParking ? Math.round(120 + rand() * 130) : 0;
        const parking_area = hasParking ? +(8 + rand() * 4).toFixed(1) : 0;
        const total = Math.round(unit * area + parking_price);
        const main_area = +(area * (isHouse ? 0.9 : 0.58 + rand() * 0.1)).toFixed(1);

        unitPrices.push(unit); totals.push(total - parking_price);
        const ds = dateStr(date);
        if (ds > last) last = ds;
        dealRows.push({
          city: "桃園市", district: g.district, address: addr_key, addr_key,
          deal_date: ds, total_price: total,
          parking_count: hasParking ? 1 : 0,
          parking_type: hasParking ? "坡道平面" : null,
          parking_price,
          area_ping: +(area + parking_area).toFixed(1), parking_area_ping: parking_area,
          main_area_ping: main_area, unit_price: unit,
          unit_price_main: +((total - parking_price) / main_area).toFixed(1),
          building_type, build_year, raw_season: "demo",
        });
      }
      bldgRows.push({
        addr_key, city: "桃園市", district: g.district, lat, lng,
        deal_count: nDeals,
        median_unit_price: +median(unitPrices).toFixed(1),
        median_total: Math.round(median(totals)),
        building_type, build_year, last_deal: last,
      });
    }
  }
  return { bldgRows, dealRows };
}

async function main() {
  const { db, pool } = createDb();

  // ETL 跑過(有真資料)就整批跳過,避免 demo 混進真資料
  const [{ n }] = (await db.execute(
    sql`SELECT count(*)::int AS n FROM district_stats WHERE is_demo = false`
  )).rows as { n: number }[];
  if (n > 0) {
    console.log("real data present (district_stats.is_demo=false), skipping demo seed");
    await pool.end();
    return;
  }

  const DEMO_CITY = "桃園市";
  await db.insert(district_stats).values(DISTRICTS.map((d) => ({ ...d, city: DEMO_CITY }))).onConflictDoNothing();
  await db.insert(projects).values(PROJECTS.map((p) => ({ ...p, city: DEMO_CITY }))).onConflictDoNothing();

  // 棟級 demo:先清舊 demo 再插,重跑不累積
  const { bldgRows, dealRows } = generateResale();
  await db.delete(sale_deals).where(eq(sale_deals.raw_season, "demo"));
  await db.delete(buildings).where(inArray(buildings.addr_key, bldgRows.map((b) => b.addr_key)));
  for (let i = 0; i < dealRows.length; i += 300)
    await db.insert(sale_deals).values(dealRows.slice(i, i + 300));
  for (let i = 0; i < bldgRows.length; i += 300)
    await db.insert(buildings).values(bldgRows.slice(i, i + 300)).onConflictDoNothing();

  // 示範用「排除社宅」與「中古屋」口徑:以混合值粗放大(真資料由 compute-stats 重算)
  await db.update(district_stats).set({
    median_rent_ping_market: sql`round(median_rent_ping * 1.9)`,
    est_roi_market: sql`round((est_roi * 1.9)::numeric, 2)`,
    rent_samples_market: sql`ceil(rent_samples * 0.4)`,
    median_unit_price_resale: sql`round((median_unit_price * 0.9)::numeric, 1)`,
    est_roi_resale: sql`round((est_roi * 1.1)::numeric, 2)`,
    est_roi_resale_market: sql`round((est_roi * 1.1 * 1.9)::numeric, 2)`,
    resale_count: sql`presale_count * 3`,
  }).where(eq(district_stats.is_demo, true));
  await db.update(projects).set({
    est_rent_market: sql`round(est_rent * 1.9)`,
    est_roi_market: sql`round((est_roi * 1.9)::numeric, 2)`,
    rent_samples_market: sql`ceil(rent_samples * 0.4)`,
  }).where(eq(projects.is_demo, true));

  console.log(`demo seed done: ${PROJECTS.length} projects, ${bldgRows.length} buildings, ${dealRows.length} deals`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
