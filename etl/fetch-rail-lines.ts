/**
 * 抓軌道「路線幾何」(OSM),城市異動後重跑 → data/rail-lines.geojson
 * 只畫產品裡有站點的線:各市捷運營運線、台鐵、施工中捷運(桃園綠線/三鶯線等)。
 * 規劃中路線(棕線/青線/橘線等)刻意不畫:未定案、無開放幾何,畫了誤導購屋判斷。
 * 不需 TDX 憑證;Overpass 免費、限流時輪替鏡像。
 */
import fs from "node:fs";
import path from "node:path";
import { ALL_BBOX } from "../src/lib/cities";

const ROOT = path.join(import.meta.dirname, "..");
const OUT = path.join(ROOT, "data", "rail-lines.geojson");

// 與 fetch-stations 同源:啟用城市 bbox 聯集
const BBOX = ALL_BBOX;

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

// 名稱 → 產品線名(北捷各線含歷史命名;順序重要,先特例後通則)
const METRO_LINES: [RegExp, string][] = [
  [/機場捷運|桃園捷運.*機場|桃園國際機場/, "機場捷運"],
  [/桃園.*綠線|捷運綠線/, "桃園捷運綠線"],
  [/文湖線|木柵線|內湖線/, "文湖線"],
  [/淡水信義線|淡水線|信義線/, "淡水信義線"],
  [/松山新店線|新店線|松山線|小碧潭/, "松山新店線"],
  [/中和新蘆線|新蘆線|中和線|蘆洲線|新莊線/, "中和新蘆線"],
  [/板南線|南港線|板橋線|土城線/, "板南線"],
  [/環狀線/, "環狀線"],
  [/淡海輕軌/, "淡海輕軌"],
  [/安坑輕軌|安坑線/, "安坑輕軌"],
  [/三鶯線/, "三鶯線"],
  [/萬大|萬大樹林線/, "萬大線"],
];

// 依 way 的 tags 歸類到產品線;歸不進去的(高鐵、林口線、支線側線、規劃線)回 null
function classify(t: Record<string, string>): LineFeat["properties"] | null {
  const name = `${t.name ?? ""}${t["name:zh"] ?? ""}`;
  const isConstruction = t.railway === "construction";
  const railKind = isConstruction ? (t.construction ?? t["construction:railway"] ?? "") : t.railway;

  if (/高鐵|高速鐵路|High Speed/i.test(name) || t.operator === "台灣高鐵") return null;
  if (/林口線|地下化|貓空纜車/.test(name)) return null;

  const ref = t.ref ?? "";
  if (/^A\d/.test(ref)) return { line: "機場捷運", status: isConstruction ? "construction" : "operating" };
  if (/^GE?\d/.test(ref)) return { line: "桃園捷運綠線", status: "construction" };
  for (const [re, line] of METRO_LINES) {
    if (re.test(name)) return { line, status: isConstruction ? "construction" : "operating" };
  }

  // 一般鐵路且非站場側線 → 台鐵(bbox 內已排除高鐵/林口線)
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
