import { and, eq, gte, isNotNull, lte, type SQL } from "drizzle-orm";
import { db, buildings, building_community, communities, projects, room_stats } from "@/lib/db";
import { ageBand, type AgeBand } from "@/lib/age";
import type { RoomBand } from "@/lib/rooms";

// 統一點位:建案(presale_deals 彙總)與棟級(sale_deals 歸戶)合流成單一實體,
// 屋齡帶是屬性不是頻道。/api/points 與 /api/zones 共用,口徑才不會漂移。

export type UnifiedPoint = {
  kind: "presale" | "resale";     // 資料來源(預售彙總 vs 中古歸戶),非使用者面向的分類
  band: AgeBand;
  lat: number; lng: number;
  city: string;
  district: string;
  price: number | null;           // 扣車位中位單價(萬/坪)
  deal_count: number;
  name: string | null;            // 社區/建案名(2021 後備查案才有)
  addr_key: string | null;        // 棟級點才有,開抽屜用
  building_type: string | null;
  build_year: number | null;      // 棟級=完工年;建案=first_reg 年(完工交屋)
  median_total: number | null;    // 中位總價(萬)
  median_area: number | null;     // 中位坪數(建案才有)
  cancel_count: number;           // 曾解約筆數(建案才有;不計入價格統計)
};

type Bbox = [number, number, number, number];

// rooms 給定時:用 room_stats 覆寫價格/總價/筆數,無該格局成交的點直接剔除
// kind="presale" 時只回建案點(預售 only 的前台用;中古仍留在圈/區聚合當行情基準)
export async function loadUnifiedPoints(opts: { bbox?: Bbox; city?: string; district?: string; rooms?: RoomBand; kind?: "presale" } = {}): Promise<UnifiedPoint[]> {
  const { bbox, city, district, rooms, kind } = opts;
  const box = (lat: any, lng: any): SQL | undefined =>
    bbox ? and(gte(lng, bbox[0]), lte(lng, bbox[2]), gte(lat, bbox[1]), lte(lat, bbox[3])) : undefined;

  const buildingQuery = db.select({
    addr_key: buildings.addr_key, city: buildings.city, district: buildings.district,
    lat: buildings.lat, lng: buildings.lng, deal_count: buildings.deal_count,
    median_unit_price: buildings.median_unit_price, median_total: buildings.median_total,
    building_type: buildings.building_type, build_year: buildings.build_year,
    community: communities.name,
  }).from(buildings)
    .leftJoin(building_community, eq(building_community.addr_key, buildings.addr_key))
    .leftJoin(communities, eq(communities.case_no, building_community.case_no))
    .where(and(isNotNull(buildings.lat),
               city ? eq(buildings.city, city) : undefined,
               district ? eq(buildings.district, district) : box(buildings.lat, buildings.lng)));
  const scopedBuildings = bbox || district ? buildingQuery.limit(8000) : buildingQuery;

  const [bldgs, projs, comms, linked] = await Promise.all([
    kind === "presale" ? Promise.resolve([]) : scopedBuildings,
    db.select().from(projects)
      .where(and(isNotNull(projects.lat),
                 city ? eq(projects.city, city) : undefined,
                 district ? eq(projects.district, district) : box(projects.lat, projects.lng))),
    db.select({ case_no: communities.case_no, name: communities.name,
                city: communities.city, district: communities.district,
                first_reg: communities.first_reg, use_issue_date: communities.use_issue_date })
      .from(communities).where(city ? eq(communities.city, city) : undefined),
    db.selectDistinct({ case_no: building_community.case_no }).from(building_community),
  ]);

  const roomMap = new Map<string, { deal_count: number | null; median_unit_price: number | null; median_total: number | null }>();
  if (rooms) {
    const rs = await db.select().from(room_stats).where(eq(room_stats.room_band, rooms));
    for (const r of rs) roomMap.set(`${r.kind}|${r.key}`, r);
  }

  const nowYear = new Date().getFullYear();
  const pts: UnifiedPoint[] = [];
  for (const b of bldgs) {
    const rm = rooms ? roomMap.get(`resale|${b.addr_key}`) : undefined;
    if (rooms && !rm) continue;
    pts.push({
      kind: "resale", band: ageBand(b.build_year, nowYear),
      lat: b.lat!, lng: b.lng!, city: b.city, district: b.district,
      price: rm ? rm.median_unit_price : b.median_unit_price,
      deal_count: (rm ? rm.deal_count : b.deal_count) ?? 0,
      name: b.community, addr_key: b.addr_key,
      building_type: b.building_type, build_year: b.build_year,
      median_total: rm ? rm.median_total : b.median_total, median_area: null,
      cancel_count: 0,
    });
  }

  // 建案 → 備查建案(city+district+name)接完工日:
  //   未備查/未完工 → 預售帶;已完工 → 依 first_reg 落帶;
  //   已完工且該案已有中古歸戶點位 → 略過(同社區避免雙點,棟級點已代表它)
  const commByKey = new Map<string, typeof comms>();
  for (const c of comms) {
    const k = `${c.city}|${c.district}|${c.name}`;
    (commByKey.get(k) ?? commByKey.set(k, []).get(k)!).push(c);
  }
  const linkedSet = new Set(linked.map((l) => l.case_no));

  for (const p of projs) {
    const matches = commByKey.get(`${p.city}|${p.district}|${p.name}`) ?? [];
    // 完工日:使照發照 > 備查首次登記(桃園無使照資料,自然走 first_reg)
    const m = matches.find((c) => (c.use_issue_date ?? c.first_reg) != null) ?? matches[0];
    const regDate = m?.use_issue_date ?? m?.first_reg;
    const regYear = regDate ? new Date(regDate).getFullYear() : null;
    const completed = regYear != null && regYear <= nowYear;
    // 預售 only 前台沒有中古點可代表同社區,不做去重略過
    if (kind !== "presale" && completed && matches.some((c) => linkedSet.has(c.case_no))) continue;
    const rm = rooms ? roomMap.get(`presale|${p.city}|${p.district}|${p.name}`) : undefined;
    if (rooms && !rm) continue;
    pts.push({
      kind: "presale", band: completed ? ageBand(regYear, nowYear) : "presale",
      lat: p.lat!, lng: p.lng!, city: p.city, district: p.district,
      price: rm ? rm.median_unit_price : p.unit_price,
      deal_count: (rm ? rm.deal_count : p.deal_count) ?? 0,
      name: p.name, addr_key: null,
      building_type: null, build_year: completed ? regYear : null,
      median_total: rm ? rm.median_total : p.median_total, median_area: p.median_area,
      cancel_count: p.cancel_count ?? 0,
    });
  }
  return pts;
}

export function toFeatureCollection(pts: UnifiedPoint[]) {
  // 部分地址只能定位到同一個道路/街廓中心，造成不同建案共用完全相同座標。
  // 群聚解除後若仍重疊，使用者會誤以為「2 筆」其實只有 1 案；僅在輸出地圖時環狀展開。
  const renderCoordinates = new Map<UnifiedPoint, [number, number]>();
  const coordinateGroups = new Map<string, UnifiedPoint[]>();
  for (const p of pts) {
    const key = `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}`;
    const group = coordinateGroups.get(key) ?? [];
    group.push(p);
    coordinateGroups.set(key, group);
  }
  for (const group of coordinateGroups.values()) {
    if (group.length === 1) continue;
    const ordered = [...group].sort((a, b) =>
      `${a.district}|${a.name ?? ""}|${a.kind}`.localeCompare(
        `${b.district}|${b.name ?? ""}|${b.kind}`, "zh-Hant"));
    const radiusM = Math.max(55, ordered.length * 16);
    ordered.forEach((p, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / ordered.length;
      const lat = p.lat + (Math.sin(angle) * radiusM) / 111_320;
      const lng = p.lng + (Math.cos(angle) * radiusM) /
        (111_320 * Math.cos(p.lat * Math.PI / 180));
      renderCoordinates.set(p, [+lng.toFixed(6), +lat.toFixed(6)]);
    });
  }

  return {
    type: "FeatureCollection" as const,
    features: pts.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: renderCoordinates.get(p) ?? [p.lng, p.lat] },
      properties: {
        kind: p.kind, band: p.band, city: p.city, district: p.district,
        price: p.price != null ? +p.price.toFixed(1) : null,
        deal_count: p.deal_count,
        median_total: p.median_total != null ? +p.median_total.toFixed(0) : null,
        ...(p.median_area != null ? { median_area: +p.median_area.toFixed(1) } : {}),
        ...(p.name ? { name: p.name } : {}),
        ...(p.addr_key ? { addr_key: p.addr_key } : {}),
        ...(p.building_type ? { building_type: p.building_type } : {}),
        ...(p.build_year != null ? { build_year: p.build_year } : {}),
        ...(p.cancel_count > 0 ? { cancel_count: p.cancel_count } : {}),
      },
    })),
  };
}
