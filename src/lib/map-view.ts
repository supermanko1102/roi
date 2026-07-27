import { haversineM } from "@/lib/geo";
import { CITIES, cityDisplay } from "@/lib/cities";
import { NEAR_IC_M, NEAR_METRO_M, TOTAL_FILTERS } from "@/lib/map-const";
import type {
  MapLabel, PresaleFC, ProjectIndexEntry, RentalFC, SearchSuggestion, TransportStop,
} from "@/lib/map-types";

// 地圖點位的純運算(不碰 React/DOM),PropertyMap 只負責 memo 化與餵資料。

/** 幫每個點補上最近車站/交流道的名稱與直線距離(地圖點位與建議清單共用同一套口徑)。 */
export function enrichNearestTransport(base: PresaleFC | null, rail: TransportStop[], ic: TransportStop[]): PresaleFC | null {
  if (!base) return null;
  return { ...base, features: base.features.map((f) => {
    const [lng, lat] = f.geometry.coordinates;
    let st: { name: string; line: string; m: number } | null = null;
    for (const s of rail) {
      const m = haversineM(lat, lng, s.lat, s.lng);
      if (!st || m < st.m) st = { name: s.name, line: s.line, m };
    }
    let nearIc: { name: string; m: number } | null = null;
    for (const s of ic) {
      const m = haversineM(lat, lng, s.lat, s.lng);
      if (!nearIc || m < nearIc.m) nearIc = { name: s.name, m };
    }
    return { ...f, properties: {
      ...f.properties,
      ...(st ? { st_name: st.name, st_line: st.line, st_m: Math.round(st.m) } : {}),
      ...(nearIc ? { ic_name: nearIc.name, ic_m: Math.round(nearIc.m) } : {}),
    } };
  }) };
}

export type PointFilter = {
  totalBand: string;
  householdMin: number | null;
  householdMax: number | null;
  query: string;
  nearMetro: boolean;
  nearIC: boolean;
};

/** 套用總價/總戶數/關鍵字/交通條件;query 同時當即時篩選。 */
export function filterPoints(base: PresaleFC | null, {
  totalBand, householdMin, householdMax, query, nearMetro, nearIC,
}: PointFilter): PresaleFC | null {
  if (!base) return null;
  const tf = TOTAL_FILTERS.find((t) => t.key === totalBand)!;
  const needle = query.trim().toLocaleLowerCase("zh-Hant");
  const feats = base.features
    .filter((f) => {
      const t = f.properties.median_total;
      if (tf.min != null && (t == null || t < tf.min)) return false;
      if (tf.max != null && (t == null || t >= tf.max)) return false;
      const households = f.properties.households;
      if (householdMin != null && (households == null || households < householdMin)) return false;
      if (householdMax != null && (households == null || households > householdMax)) return false;
      if (needle && !`${f.properties.name ?? ""} ${f.properties.district ?? ""}`.toLocaleLowerCase("zh-Hant").includes(needle)) return false;
      return true;
    })
    .filter((f) => !nearMetro || (f.properties.st_m != null && f.properties.st_m <= NEAR_METRO_M))
    .filter((f) => !nearIC || (f.properties.ic_m != null && f.properties.ic_m <= NEAR_IC_M));
  return { ...base, features: feats };
}

/** 搜尋下拉建議:比對建案/生活圈/行政區(租屋模式比對社區名與地址)。 */
export function buildSuggestions(opts: {
  query: string;
  market: "presale" | "rental";
  catalog: PresaleFC | null;
  projectIndex: ProjectIndexEntry[] | null;
  rentals: RentalFC | null;
  zoneLabels: MapLabel[];
  districtLabels: MapLabel[];
}): SearchSuggestion[] {
  const { query, market, catalog, projectIndex, rentals, zoneLabels, districtLabels } = opts;
  const needle = query.trim().toLocaleLowerCase("zh-Hant");
  if (!needle) return [];
  const hit = (s: string | null | undefined) => (s ?? "").toLocaleLowerCase("zh-Hant").includes(needle);
  const cityName = (city?: string) => (city && CITIES.length > 1 ? cityDisplay(city) : undefined);
  const cityTag = (city?: string) => { const n = cityName(city); return n ? `${n}・` : ""; };

  if (market === "rental") {
    return (rentals?.features ?? [])
      .filter((f) => hit(f.properties.name) || hit(f.properties.address) || hit(f.properties.district))
      .slice(0, 8)
      .map((f) => ({
        kind: "rental" as const, key: f.properties.key,
        label: f.properties.name ?? f.properties.address,
        sub: `${cityTag(f.properties.city)}${f.properties.district}${f.properties.is_social ? "・社宅" : ""}`,
      }));
  }
  // 全量索引(含無座標案)優先;索引還沒載好時退回地圖 catalog
  const projs = projectIndex
    ? projectIndex.filter((e) => hit(e.name)).slice(0, 6)
        .map((e) => ({
          kind: "project" as const,
          key: `${e.city}|${e.district}|${e.name}`,
          label: e.name,
          sub: `${cityTag(e.city)}${e.district}`
            + (e.unit_price != null ? `・$${(+e.unit_price).toFixed(1)}` : "")
            + (e.geo ? "" : "・未定位"),
        }))
    : (catalog?.features ?? [])
        .filter((f) => hit(f.properties.name)).slice(0, 6)
        .map((f) => ({
          kind: "project" as const,
          key: `${f.properties.city}|${f.properties.district}|${f.properties.name}`,
          label: f.properties.name!,
          sub: `${cityTag(f.properties.city)}${f.properties.district}${f.properties.price != null ? `・$${(+f.properties.price).toFixed(1)}` : ""}`,
        }));
  const zs = zoneLabels.filter((l) => hit(l.name)).slice(0, 3)
    .map((l) => ({ kind: "zone" as const, key: l.key, label: l.name, sub: cityName(l.props.city) }));
  const ds = districtLabels.filter((l) => hit(l.name)).slice(0, 3)
    .map((l) => ({ kind: "district" as const, key: l.key, label: l.name, sub: cityName(l.props.city) }));
  return [...projs, ...zs, ...ds];
}
