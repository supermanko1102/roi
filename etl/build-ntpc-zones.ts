/**
 * 由新北市都市計畫公開圖台產生重劃／特定區 GeoJSON。
 *
 * 圖台回傳 TWD97 TM2 (EPSG:3826) WKT，本程式轉成 WGS84 後寫入
 * data/ntpc-zones.geojson。相同市場生活圈的分期範圍會 dissolve 成單一 feature。
 *
 * 用法: tsx etl/build-ntpc-zones.ts [--refresh]
 */
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error mapshaper 沒有型別定義
import mapshaper from "mapshaper";

const HOME = "https://urban.planning.ntpc.gov.tw/NtpcURInfo/";
const API = `${HOME}ajax/datahandler.ashx`;
const CACHE = path.join(import.meta.dirname, "downloads", "ntpc-zones");
const OUT = path.join(import.meta.dirname, "..", "data", "ntpc-zones.geojson");

type ZoneDef = {
  ids: number[];
  name: string;
  district: string;
};

// BLAKEY 是新北都市計畫圖台「已開闢地區」公開清單的穩定識別碼。
const ZONES: ZoneDef[] = [
  { ids: [9], name: "新板特區", district: "板橋區" },
  { ids: [29, 28, 33], name: "江翠北側重劃區", district: "板橋區" },
  { ids: [20], name: "埔墘重劃區", district: "板橋區" },
  { ids: [32], name: "央北重劃區", district: "新店區" },
  { ids: [15], name: "七張重劃區", district: "新店區" },
  { ids: [17], name: "直潭社區", district: "新店區" },
  { ids: [19], name: "新莊副都心", district: "新莊區" },
  { ids: [18], name: "頭前重劃區", district: "新莊區" },
  { ids: [27], name: "新莊產業專用區", district: "新莊區" },
  { ids: [21], name: "洲子洋重劃區", district: "五股區" },
  { ids: [26], name: "二重疏洪道兩側重劃區", district: "三重區" },
  { ids: [31], name: "仁義重劃區", district: "三重區" },
  { ids: [11], name: "重陽橋引道安置區", district: "三重區" },
  { ids: [30], name: "土城暫緩發展區", district: "土城區" },
  { ids: [16], name: "頂埔特區", district: "土城區" },
  { ids: [37], name: "秀朗橋北側區段徵收區", district: "中和區" },
  { ids: [22], name: "中和環河快速道路沿線", district: "中和區" },
  { ids: [6], name: "北大特區", district: "三峽區/樹林區" },
  { ids: [36], name: "樹林三多里重劃區", district: "樹林區" },
  { ids: [24], name: "鳳鳴重劃區", district: "鶯歌區" },
  { ids: [13], name: "泰山東側重劃區", district: "泰山區" },
  { ids: [2], name: "南港子重劃區", district: "蘆洲區" },
  { ids: [3], name: "灰磘重陽重劃區", district: "蘆洲區" },
  { ids: [4], name: "沙崙重劃區", district: "淡水區" },
  { ids: [14], name: "淡海新市鎮一期", district: "淡水區" },
  { ids: [8], name: "林口新市鎮中心商業區", district: "林口區" },
  { ids: [10], name: "林口新市鎮三四期", district: "林口區" },
  { ids: [35], name: "林口第三種產業專用區", district: "林口區" },
  { ids: [1], name: "林口工二國宅區", district: "林口區" },
  { ids: [25], name: "臺北港特定區", district: "八里區" },
  { ids: [12], name: "臺北港特定區八里部分", district: "八里區" },
  { ids: [34], name: "金山三處重劃區", district: "金山區" },
];

// 塭仔圳尚未列入圖台的「已開闢地區」API；以下依地政局官方範圍圖與公告面積
// 數化，並以公開道路中心線校準位置。這兩筆可供市場圖層使用，但不能取代地籍鑑界。
const WENZIZHEN = [
  {
    type: "Feature",
    properties: {
      name: "塭仔圳重劃區（第一區）",
      city: "新北市",
      district: "新莊區/泰山區",
      zone_key: "新北市|塭仔圳重劃區（第一區）",
      zone_group: "塭仔圳重劃區",
      source: "新北市新、泰塭仔圳市地重劃案（第一區）範圍示意圖",
      source_kind: "official-map-digitized",
      boundary_quality: "approximate",
      official_area_ha: 276.6,
      source_url: "https://xintai.ntpc.gov.tw/websitedowndoc?file=xintai%2F202407161448360.pdf",
      georeference: "OpenStreetMap road centerlines; © OpenStreetMap contributors",
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [121.4380, 25.0655], [121.4424, 25.0580], [121.4423, 25.0500],
        [121.4422, 25.0420], [121.4422, 25.0340], [121.4360, 25.0330],
        [121.4340, 25.0350], [121.4280, 25.0310], [121.4230, 25.0290],
        [121.4190, 25.0260], [121.4160, 25.0240], [121.4190, 25.0270],
        [121.4230, 25.0300], [121.4280, 25.0330], [121.4320, 25.0410],
        [121.4350, 25.0490], [121.4375, 25.0580], [121.4380, 25.0655],
      ]],
    },
  },
  {
    type: "Feature",
    properties: {
      name: "塭仔圳重劃區（第二區）",
      city: "新北市",
      district: "新莊區",
      zone_key: "新北市|塭仔圳重劃區（第二區）",
      zone_group: "塭仔圳重劃區",
      source: "新北市新、泰塭仔圳市地重劃案（第二區）範圍示意圖",
      source_kind: "official-map-digitized",
      boundary_quality: "approximate",
      official_area_ha: 120.71,
      source_url: "https://xintai.ntpc.gov.tw/websitedowndoc?file=xintai%2F202407161447570.pdf",
      georeference: "OpenStreetMap road centerlines; © OpenStreetMap contributors",
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [121.4336, 25.0324], [121.4340, 25.0290], [121.4350, 25.0251],
        [121.4350, 25.0224], [121.4475, 25.0185], [121.4478, 25.0185],
        [121.4441, 25.0220], [121.4425, 25.0252], [121.4422, 25.0338],
        [121.4336, 25.0324],
      ]],
    },
  },
] as const;

type Position = [number, number];
type PolygonCoords = Position[][];
type MultiPolygonCoords = PolygonCoords[];

/** 只接受官方 API 會回傳的 POLYGON / MULTIPOLYGON WKT。 */
function parseWkt(wkt: string): { type: "Polygon" | "MultiPolygon"; coordinates: PolygonCoords | MultiPolygonCoords } {
  const type = wkt.trim().match(/^(MULTIPOLYGON|POLYGON)\s*/i)?.[1]?.toUpperCase();
  if (!type) throw new Error(`不支援的 WKT: ${wkt.slice(0, 40)}`);
  const body = wkt.slice(wkt.indexOf("("));
  const tokens = body.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[(),]/g) ?? [];
  let i = 0;

  const group = (): unknown[] => {
    if (tokens[i++] !== "(") throw new Error("WKT 缺少 (");
    const values: unknown[] = [];
    while (i < tokens.length && tokens[i] !== ")") {
      if (tokens[i] === ",") { i++; continue; }
      if (tokens[i] === "(") values.push(group());
      else {
        const x = Number(tokens[i++]);
        const y = Number(tokens[i++]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("WKT 座標格式錯誤");
        values.push([x, y] satisfies Position);
      }
    }
    if (tokens[i++] !== ")") throw new Error("WKT 缺少 )");
    return values;
  };

  const coordinates = group();
  if (i !== tokens.length) throw new Error("WKT 尾端有未解析內容");
  return { type: type === "POLYGON" ? "Polygon" : "MultiPolygon", coordinates } as ReturnType<typeof parseWkt>;
}

async function createSession() {
  const res = await fetch(HOME, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`圖台首頁 HTTP ${res.status}`);
  const html = await res.text();
  const token = html.match(/id="hdToken"\s+value="([^"]+)"/)?.[1];
  if (!token) throw new Error("圖台頁面找不到 hdToken");
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie?.call(res.headers) ?? [res.headers.get("set-cookie") ?? ""];
  return { token, cookie: cookies.map((v) => v.split(";", 1)[0]).filter(Boolean).join("; ") };
}

async function fetchRegion(id: number, session: Awaited<ReturnType<typeof createSession>>, refresh: boolean) {
  const file = path.join(CACHE, `${id}.json`);
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  const form = new URLSearchParams({
    keyword: "GetBuildLineRegion",
    timeStamp: session.token,
    timeName: Buffer.from("MapToken").toString("base64"),
    keyId: String(id),
  });
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "Mozilla/5.0",
      "X-Requested-With": "XMLHttpRequest",
      Referer: HOME,
      Cookie: session.cookie,
    },
    body: form,
  });
  if (!res.ok) throw new Error(`BLAKEY=${id} HTTP ${res.status}`);
  const json = await res.json();
  if (json.MSGCODE !== 200 || !json.WKT) throw new Error(`BLAKEY=${id}: ${json.MSG || "無 WKT"}`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const session = await createSession();
  const rawFeatures: any[] = [];

  for (const zone of ZONES) {
    const polygons: PolygonCoords[] = [];
    for (const id of zone.ids) {
      const result = await fetchRegion(id, session, refresh);
      const geometry = parseWkt(result.WKT);
      if (geometry.type === "Polygon") polygons.push(geometry.coordinates as PolygonCoords);
      else polygons.push(...geometry.coordinates as MultiPolygonCoords);
    }
    rawFeatures.push({
      type: "Feature",
      properties: {
        name: zone.name,
        city: "新北市",
        district: zone.district,
        zone_key: `新北市|${zone.name}`,
        source: "新北市都市計畫土地使用分區及範圍圖",
        source_kind: "official-gis",
        source_ids: zone.ids.join(","),
        source_url: HOME,
      },
      geometry: polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons },
    });
    console.log(`[ntpc-zones] ${zone.name}`);
  }

  const converted = await mapshaper.applyCommands(
    "-i in.geojson -proj from=EPSG:3826 crs=EPSG:4326 -o out.geojson format=geojson precision=0.000001",
    { "in.geojson": JSON.stringify({ type: "FeatureCollection", features: rawFeatures }) },
  );
  const fc = JSON.parse(converted["out.geojson"].toString());
  fc.features.push(...WENZIZHEN);
  fc._comment = "由 etl/build-ntpc-zones.ts 取用新北市政府公開圖台資料產生，座標為 WGS84。";
  fs.writeFileSync(OUT, JSON.stringify(fc));
  console.log(`[ntpc-zones] ${fc.features.length} 區 → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
