/**
 * 抓軌道「路線幾何」(OSM),跑一次即可 → data/rail-lines.geojson
 * 只畫產品裡有站點的線:機場捷運(營運+中壢延伸段)、台鐵、桃園捷運綠線(施工中)。
 * 規劃中路線(棕線/青線/橘線等)刻意不畫:未定案、無開放幾何,畫了誤導購屋判斷。
 * 不需 TDX 憑證;Overpass 免費、限流時輪替鏡像。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const OUT = path.join(ROOT, "data", "rail-lines.geojson");

// 與 fetch-stations 同一個 bbox(含機捷北段通勤脈絡)
const BBOX = { s: 24.75, w: 120.95, n: 25.1, e: 121.35 };

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpass(query: string, cacheFile: string): Promise<any> {
  const cache = path.join(ROOT, "etl", "downloads", "gis", cacheFile);
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(OVERPASS_MIRRORS[i % OVERPASS_MIRRORS.length], {
        method: "POST", body: new URLSearchParams({ data: query }),
      });
      const json = await res.json();
      fs.writeFileSync(cache, JSON.stringify(json));
      return json;
    } catch {
      console.log(`Overpass 失敗(${i + 1}/6),等 45 秒換鏡像重試`);
      await sleep(45000);
    }
  }
  console.log(`Overpass 全數失敗,改用快取 ${cacheFile}`);
  return JSON.parse(fs.readFileSync(cache, "utf-8"));
}

type LineFeat = {
  type: "Feature";
  properties: { line: string; status: "operating" | "construction" };
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

// 依 way 的 tags 歸類到產品的三條線;歸不進去的(高鐵、林口線、三鶯線、支線側線)回 null
function classify(t: Record<string, string>): LineFeat["properties"] | null {
  const name = `${t.name ?? ""}${t["name:zh"] ?? ""}`;
  const isConstruction = t.railway === "construction";
  const railKind = isConstruction ? (t.construction ?? t["construction:railway"] ?? "") : t.railway;

  if (/高鐵|高速鐵路|High Speed/i.test(name) || t.operator === "台灣高鐵") return null;
  if (/三鶯|林口線|地下化/.test(name)) return null;

  if (/機場捷運|桃園捷運.*機場|桃園國際機場/.test(name) || /^A\d/.test(t.ref ?? ""))
    return { line: "機場捷運", status: isConstruction ? "construction" : "operating" };
  if (/綠線/.test(name) || /^GE?\d/.test(t.ref ?? ""))
    return { line: "桃園捷運綠線", status: "construction" };

  // 一般鐵路且非站場側線 → 台鐵縱貫線(bbox 內已排除高鐵/林口線)
  if (!isConstruction && railKind === "rail" && !t.service && t.usage !== "industrial" && t.usage !== "military")
    return { line: "台鐵", status: "operating" };
  return null;
}

async function main() {
  fs.mkdirSync(path.join(ROOT, "etl", "downloads", "gis"), { recursive: true });
  const bbox = `(${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e})`;
  const osm = await overpass(`[out:json][timeout:90];(
    way["railway"="rail"]${bbox};
    way["railway"~"^(subway|light_rail|monorail)$"]${bbox};
    way["railway"="construction"]${bbox};
  );out tags geom;`, "osm-rail-lines.json");

  const feats: LineFeat[] = [];
  const counts: Record<string, number> = {};
  for (const e of osm.elements ?? []) {
    if (e.type !== "way" || !e.geometry?.length) continue;
    const props = classify(e.tags ?? {});
    if (!props) continue;
    feats.push({
      type: "Feature", properties: props,
      geometry: { type: "LineString", coordinates: e.geometry.map((p: any) => [p.lon, p.lat]) },
    });
    const k = `${props.line}/${props.status}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }

  fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features: feats }));
  console.log(`寫出 ${OUT}:${feats.length} 段`, counts);
}

main();
