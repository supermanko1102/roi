/**
 * 城市設定:全管線唯一的城市來源。ETL 逐城市迴圈、API 依此過濾地理資產。
 * name 一律用實登/NLSC 原生寫法(臺北市),UI 顯示用 display(台北);
 * 地址剝前綴請用 cityPrefixRe(涵蓋 aliases 的臺/台變體)。
 * 上線開關:把城市加進 CITIES 即啟用(資料要先回填,見 plan Phase 4 runbook)。
 */
export type City = {
  code: string;               // 實登批次檔檔名前綴(h=桃園 a=臺北 f=新北)
  name: string;               // 資料原生城市名(存 DB 用)
  display: string;            // UI 顯示名
  aliases: string[];          // 地址中可能出現的變體(臺/台)
  bbox: { s: number; w: number; n: number; e: number }; // 車站/軌道抓取範圍
  lejuPostalCodes: number[];  // 樂居生活圈抓取用郵遞區號(空=該市無生活圈層)
  metroOperators: string[];   // TDX Rail/Metro operator 代碼
  tdxBusCity: string;         // TDX 公車 API 的城市路徑(Taoyuan/Taipei/NewTaipei)
  center: [number, number];   // 城市級標籤/視角
  zoom: number;
};

export const CITIES: City[] = [
  {
    code: "h",
    name: "桃園市",
    display: "桃園",
    aliases: [],
    bbox: { s: 24.75, w: 120.95, n: 25.10, e: 121.35 },
    lejuPostalCodes: [330, 320, 324, 325, 326, 327, 328, 333, 334, 335, 336, 337, 338],
    metroOperators: ["TYMC"],
    tdxBusCity: "Taoyuan",
    center: [121.25, 24.94],
    zoom: 10.3,
  },
  {
    code: "a",
    name: "臺北市",
    display: "台北",
    aliases: ["台北市"],
    bbox: { s: 24.95, w: 121.45, n: 25.22, e: 121.67 },
    lejuPostalCodes: [], // 生活圈第二波再抓(樂居需瀏覽器手動)
    metroOperators: ["TRTC"],
    tdxBusCity: "Taipei",
    center: [121.545, 25.06],
    zoom: 11.2,
  },
  {
    code: "f",
    name: "新北市",
    display: "新北",
    aliases: ["台北縣"],  // 老資料可能殘留改制前寫法
    bbox: { s: 24.67, w: 121.28, n: 25.30, e: 122.02 },
    lejuPostalCodes: [], // 生活圈第二波再抓
    metroOperators: ["NTMC", "NTDLRT", "NTALRT"], // 環狀線/淡海輕軌/安坑輕軌是三個 operator
    tdxBusCity: "NewTaipei",
    center: [121.46, 25.01],
    zoom: 10.6,
  },
];

export const CITY_NAMES = CITIES.map((c) => c.name);

const byName = new Map<string, City>();
for (const c of CITIES) { byName.set(c.name, c); for (const a of c.aliases) byName.set(a, c); }

/** 以任何寫法(含別名)找城市;查無回 null。 */
export function cityByName(name: string): City | null {
  return byName.get(name) ?? null;
}

/** UI 顯示名(臺北市 → 台北);未知城市原樣返回。 */
export function cityDisplay(name: string): string {
  return byName.get(name)?.display ?? name;
}

/** 比對地址開頭的城市名(含臺/台別名),用於剝前綴或抽出城市。 */
export const cityPrefixRe = new RegExp(
  `^(${CITIES.flatMap((c) => [c.name, ...c.aliases]).join("|")})`,
);

/** 所有啟用城市 bbox 的聯集(車站/軌道抓取、地理資產過濾用)。 */
export const ALL_BBOX = CITIES.reduce(
  (acc, { bbox }) => ({
    s: Math.min(acc.s, bbox.s), w: Math.min(acc.w, bbox.w),
    n: Math.max(acc.n, bbox.n), e: Math.max(acc.e, bbox.e),
  }),
  { s: Infinity, w: Infinity, n: -Infinity, e: -Infinity },
);

/** 地圖預設視角:單城市用該市設定;多城市退到能收全部啟用城市的全區視野。 */
export const DEFAULT_VIEW = CITIES.length === 1
  ? { longitude: CITIES[0].center[0], latitude: CITIES[0].center[1], zoom: CITIES[0].zoom }
  : {
      longitude: (ALL_BBOX.w + ALL_BBOX.e) / 2,
      latitude: (ALL_BBOX.s + ALL_BBOX.n) / 2,
      zoom: 9.3,
    };
