/**
 * 抓桃園「交通機能」靜態資料,跑一次即可:
 *  - data/stations.geojson:軌道車站(TDX:機捷/台鐵;OSM:綠線等施工中站)
 *    + 國道交流道(OSM motorway_junction),以 kind 區分:station | interchange
 *  - data/bus-stops.geojson:桃園公車站牌(TDX,分頁抓;只給 API 端算密度,不上地圖)
 * TDX client credentials 讀 .env / .env.example
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const OUT = path.join(ROOT, "data", "stations.geojson");

// 桃園外擴一點的 bbox(含機捷北段到台北車站 A1,通勤脈絡需要)
const BBOX = { s: 24.75, w: 120.95, n: 25.10, e: 121.35 };
const A1_KEEP = new Set(["台北車站", "臺北車站", "三重站", "新北產業園區站"]); // 機捷北段照留,通勤終點

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [".env", ".env.example"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !(m[1] in out)) out[m[1]] = m[2].trim();
    }
  }
  return out;
}

async function tdxToken(env: Record<string, string>): Promise<string> {
  const res = await fetch("https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.TDX_Client_ID,
      client_secret: env.TDX_Client_Secret,
    }),
  });
  if (!res.ok) throw new Error(`TDX token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tdx(token: string, url: string): Promise<any> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) return res.json();
    if (res.status === 429 && i < 6) {              // 免費方案限流,退避重試
      console.log(`TDX 429,等 20 秒重試(${i + 1}/6)`);
      await sleep(20000);
      continue;
    }
    throw new Error(`TDX ${res.status} ${url}`);
  }
}

type Feat = {
  name: string; line: string; status: "operating" | "construction";
  kind: "station" | "interchange"; lat: number; lng: number;
};
const inBox = (f: { lat: number; lng: number }) =>
  f.lat >= BBOX.s && f.lat <= BBOX.n && f.lng >= BBOX.w && f.lng <= BBOX.e;

// Overpass 常限流:輪替鏡像重試,成功寫快取;全失敗才吃快取
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
async function overpass(query: string, cacheFile: string): Promise<any> {
  const cache = path.join(ROOT, "etl", "downloads", "gis", cacheFile);
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(OVERPASS_MIRRORS[i % OVERPASS_MIRRORS.length], {
        method: "POST", body: new URLSearchParams({ data: query }),
      });
      const json = await res.json();                // 限流時回 HTML,parse 會丟錯進 catch
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

async function main() {
  const env = loadEnv();
  const feats: Feat[] = [];

  const token = await tdxToken(env);

  // 機場捷運(桃園捷運公司目前僅營運機場線)
  const tymc = await tdx(token, "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/Station/TYMC?%24format=JSON");
  for (const s of tymc) {
    feats.push({
      name: s.StationName?.Zh_tw ?? s.StationID,
      line: "機場捷運", status: "operating", kind: "station",
      lat: s.StationPosition?.PositionLat, lng: s.StationPosition?.PositionLon,
    });
  }
  console.log(`機捷 ${tymc.length} 站`);

  // 台鐵全線 → 篩 bbox 內
  const tra = await tdx(token, "https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/Station?%24format=JSON");
  let traN = 0;
  for (const s of tra) {
    const f: Feat = {
      name: `${s.StationName?.Zh_tw ?? s.StationID}站`,
      line: "台鐵", status: "operating", kind: "station",
      lat: s.StationPosition?.PositionLat, lng: s.StationPosition?.PositionLon,
    };
    if (inBox(f)) { feats.push(f); traN++; }
  }
  console.log(`台鐵(bbox 內)${traN} 站`);

  // 施工中站點(綠線 G/GE 編號、機捷延伸 A14/A23):TDX 無施工中路網,用 OSM
  try {
    const osm = await overpass(`[out:json][timeout:40];(
      node["railway"="construction"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      node["construction:railway"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      node["railway"="proposed"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
    );out body;`, "osm-construction-stations.json");
    let n = 0;
    for (const e of osm.elements ?? []) {
      const t = e.tags ?? {};
      const name: string = t.name ?? "", ref: string = t.ref ?? "";
      if (!name) continue;
      if (/^GE?\d/.test(ref)) {
        feats.push({ name, line: "桃園捷運綠線", status: "construction", kind: "station", lat: e.lat, lng: e.lon });
        n++;
      } else if (/^A\d/.test(ref)) {
        feats.push({ name, line: "機場捷運", status: "construction", kind: "station", lat: e.lat, lng: e.lon });
        n++;
      }
    }
    console.log(`施工中站點(OSM)${n} 站`);
  } catch (e) {
    console.warn("施工中站點抓取失敗,略過:", (e as Error).message);
  }

  // 國道交流道:OSM motorway_junction;同名匝道節點很多,同名取座標平均
  try {
    const osm = await overpass(`[out:json][timeout:40];
      node["highway"="motorway_junction"]["name"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      out body;`, "osm-interchanges.json");
    const byName = new Map<string, { lat: number; lng: number; n: number }>();
    for (const e of osm.elements ?? []) {
      const name: string = (e.tags?.name ?? "").trim();
      if (!name || !/交流道|系統/.test(name)) continue;
      const g = byName.get(name) ?? { lat: 0, lng: 0, n: 0 };
      byName.set(name, { lat: g.lat + e.lat, lng: g.lng + e.lon, n: g.n + 1 });
    }
    let n = 0;
    for (const [name, g] of byName) {
      feats.push({
        name, line: "國道", status: "operating", kind: "interchange",
        lat: g.lat / g.n, lng: g.lng / g.n,
      });
      n++;
    }
    console.log(`交流道(OSM)${n} 處`);
  } catch (e) {
    console.warn("交流道抓取失敗,略過:", (e as Error).message);
  }

  // 公車站牌:TDX 分頁抓,只留名稱+座標(給 API 端算「出門有沒有公車」的密度)
  const stops: { name: string; lat: number; lng: number }[] = [];
  for (let skip = 0; ; skip += 3000) {
    const page = await tdx(token,
      `https://tdx.transportdata.tw/api/basic/v2/Bus/Stop/City/Taoyuan?%24select=StopName,StopPosition&%24top=3000&%24skip=${skip}&%24format=JSON`);
    for (const s of page) {
      const lat = s.StopPosition?.PositionLat, lng = s.StopPosition?.PositionLon;
      if (Number.isFinite(lat) && Number.isFinite(lng))
        stops.push({ name: s.StopName?.Zh_tw ?? "", lat, lng });
    }
    if (page.length < 3000) break;
  }
  fs.writeFileSync(path.join(ROOT, "data", "bus-stops.geojson"), JSON.stringify({
    type: "FeatureCollection",
    features: stops.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [+s.lng.toFixed(5), +s.lat.toFixed(5)] },
      properties: { name: s.name },
    })),
  }));
  console.log(`公車站牌 ${stops.length} 個`);

  const clean = feats.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng))
    .filter((f) => inBox(f) || A1_KEEP.has(f.name));
  // 去重(同名同線)
  const seen = new Set<string>();
  const uniq = clean.filter((f) => {
    const k = `${f.line}|${f.name}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  const geo = {
    type: "FeatureCollection",
    features: uniq.map((f) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [f.lng, f.lat] },
      properties: { name: f.name, line: f.line, status: f.status, kind: f.kind },
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(geo));
  console.log(`寫入 ${OUT}:共 ${uniq.length} 站`);
}
main().catch((e) => { console.error(e); process.exit(1); });
