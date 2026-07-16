/**
 * 抓桃園相關軌道車站 → data/stations.geojson
 *  - 機場捷運(TYMC)與台鐵:TDX API(client credentials 讀 .env / .env.example)
 *  - 桃園捷運綠線(施工中):TDX 無施工中路網,改用 OpenStreetMap Overpass
 * 站點是靜態資料,跑一次即可;props: name, line, status(operating|construction)
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

async function tdx(token: string, url: string): Promise<any> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`TDX ${res.status} ${url}`);
  return res.json();
}

type Feat = { name: string; line: string; status: "operating" | "construction"; lat: number; lng: number };
const inBox = (f: Feat) => f.lat >= BBOX.s && f.lat <= BBOX.n && f.lng >= BBOX.w && f.lng <= BBOX.e;

async function main() {
  const env = loadEnv();
  const feats: Feat[] = [];

  const token = await tdxToken(env);

  // 機場捷運(桃園捷運公司目前僅營運機場線)
  const tymc = await tdx(token, "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/Station/TYMC?%24format=JSON");
  for (const s of tymc) {
    feats.push({
      name: s.StationName?.Zh_tw ?? s.StationID,
      line: "機場捷運", status: "operating",
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
      line: "台鐵", status: "operating",
      lat: s.StationPosition?.PositionLat, lng: s.StationPosition?.PositionLon,
    };
    if (inBox(f)) { feats.push(f); traN++; }
  }
  console.log(`台鐵(bbox 內)${traN} 站`);

  // 施工中站點(綠線 G/GE 編號、機捷延伸 A14/A23):TDX 無施工中路網,用 OSM Overpass;
  // Overpass 常限流,成功後留快取、失敗吃快取
  const cache = path.join(ROOT, "etl", "downloads", "gis", "osm-construction-stations.json");
  try {
    let osm: any;
    try {
      const q = `[out:json][timeout:40];(
        node["railway"="construction"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
        node["construction:railway"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
        node["railway"="proposed"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
      );out body;`;
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST", body: new URLSearchParams({ data: q }),
      });
      osm = await res.json();
      fs.writeFileSync(cache, JSON.stringify(osm));
    } catch {
      osm = JSON.parse(fs.readFileSync(cache, "utf-8"));
      console.log("Overpass 失敗,改用快取");
    }
    let n = 0;
    for (const e of osm.elements ?? []) {
      const t = e.tags ?? {};
      const name: string = t.name ?? "", ref: string = t.ref ?? "";
      if (!name) continue;
      if (/^GE?\d/.test(ref)) {
        feats.push({ name, line: "桃園捷運綠線", status: "construction", lat: e.lat, lng: e.lon });
        n++;
      } else if (/^A\d/.test(ref)) {
        feats.push({ name, line: "機場捷運", status: "construction", lat: e.lat, lng: e.lon });
        n++;
      }
    }
    console.log(`施工中站點(OSM)${n} 站`);
  } catch (e) {
    console.warn("施工中站點抓取失敗,略過:", (e as Error).message);
  }

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
      properties: { name: f.name, line: f.line, status: f.status },
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(geo));
  console.log(`寫入 ${OUT}:共 ${uniq.length} 站`);
}
main().catch((e) => { console.error(e); process.exit(1); });
