// 建案判讀指標的純運算(不碰 DB/React):比同圈行情、租金回報、解約率。
// 原則:每個數字都帶「跟誰比、幾筆樣本」;樣本不足一律回 null,不硬湊。

/** 比行情:本案近一年至少要有幾筆成交才比 */
export const DEV_MIN_OWN_DEALS = 3;
/** 比行情:基準至少要有幾個「其他」建案、合計幾筆成交 */
export const DEV_MIN_PEER_PROJECTS = 3;
export const DEV_MIN_PEER_DEALS = 30;
/** 租金回報:最少租約筆數 */
export const YIELD_MIN_LEASES = 5;
/** 解約率:成交+解約至少幾筆才算比率 */
export const CANCEL_MIN_TOTAL = 10;
/** 差距超過這個幅度多半是產品不同(廠辦/透天混入)或登錄異常,不當成行情比較 */
export const DEV_MAX_ABS_PCT = 50;
/** 近一年中位價與本案全期中位價差超過這個比例,視為近期紀錄異常(車位/持分等),不拿來比 */
export const RECENT_SANITY_RATIO = 0.4;
/** 毛報酬高於此值多半是售價登錄異常 */
export const YIELD_MAX_PCT = 8;
/** 貴/便宜的判讀門檻(%):門檻內視為「差不多」 */
export const DEV_NEUTRAL_PCT = 3;

export type ProjectMetrics = {
  recent_n: number;                 // 近一年有效成交筆數
  recent_price: number | null;      // 近一年中位單價(萬/坪,扣車位)
  last_deal: string | null;         // 最近一筆有效成交日
  dev: number | null;               // 比基準貴(+)/便宜(−) %
  dev_scope: "zone" | "district" | null;
  dev_base: string | null;          // 基準名稱(生活圈名或行政區名)
  dev_price: number | null;         // 基準單價(萬/坪)
  dev_projects: number;             // 基準內其他建案數
  dev_deals: number;                // 基準內其他建案近一年成交筆數
  yield_pct: number | null;         // 年租金 ÷ 總價 %(毛報酬,未扣稅費空置)
  yield_src: "community" | "nearby" | null;
  yield_rent: number | null;        // 每坪月租中位(元)
  yield_n: number;                  // 租約筆數
  yield_radius_m: number | null;    // nearby 時採用的半徑
  cancel_rate: number | null;       // 解約筆數 ÷ (成交+解約) %
};

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 以成交筆數加權的中位數:成交多的建案對「行情」影響較大,接近逐筆合併的中位。 */
export function weightedMedian(items: { value: number; weight: number }[]): number | null {
  const xs = items.filter((i) => i.weight > 0 && Number.isFinite(i.value)).sort((a, b) => a.value - b.value);
  const total = xs.reduce((sum, i) => sum + i.weight, 0);
  if (!xs.length || total <= 0) return null;
  let acc = 0;
  for (const x of xs) {
    acc += x.weight;
    if (acc >= total / 2) return x.value;
  }
  return xs[xs.length - 1].value;
}

export type Peer = { key: string; price: number; deals: number };

/** 近一年價是否可信:與全期中位差太多就不採用 */
export function recentPriceUsable(recentPrice: number | null, overallPrice: number | null): boolean {
  if (recentPrice == null || recentPrice <= 0) return false;
  if (overallPrice == null || overallPrice <= 0) return true;
  return Math.abs(recentPrice / overallPrice - 1) <= RECENT_SANITY_RATIO;
}

/** 本案單價 vs 同一範圍「其他」建案近一年行情;樣本不足回 null。 */
export function deviation(ownKey: string, ownPrice: number | null, ownDeals: number, peers: Peer[]) {
  if (ownPrice == null || ownPrice <= 0 || ownDeals < DEV_MIN_OWN_DEALS) return null;
  const others = peers.filter((p) => p.key !== ownKey && p.deals >= DEV_MIN_OWN_DEALS && p.price > 0);
  const deals = others.reduce((sum, p) => sum + p.deals, 0);
  if (others.length < DEV_MIN_PEER_PROJECTS || deals < DEV_MIN_PEER_DEALS) return null;
  const base = weightedMedian(others.map((p) => ({ value: p.price, weight: p.deals })));
  if (base == null || base <= 0) return null;
  const dev = (ownPrice / base - 1) * 100;
  if (Math.abs(dev) > DEV_MAX_ABS_PCT) return null;
  return {
    dev: +dev.toFixed(1),
    price: +base.toFixed(1), projects: others.length, deals,
  };
}

/** 毛租金回報 %:每坪月租(元) × 12 ÷ 每坪售價(萬 → 元)。兩邊都是扣車位後的每坪數字。 */
export function grossYield(rentPerPing: number | null, unitPriceWan: number | null): number | null {
  if (rentPerPing == null || unitPriceWan == null || rentPerPing <= 0 || unitPriceWan <= 0) return null;
  const pct = (rentPerPing * 12) / (unitPriceWan * 10000) * 100;
  return pct > YIELD_MAX_PCT ? null : +pct.toFixed(2);
}

export function cancelRate(deals: number, cancels: number): number | null {
  const total = deals + cancels;
  if (total < CANCEL_MIN_TOTAL) return null;
  return +((cancels / total) * 100).toFixed(1);
}

/** 白話判讀:門檻內說「差不多」,不把雜訊講成結論。 */
export function devWord(dev: number): "貴" | "便宜" | "差不多" {
  if (Math.abs(dev) < DEV_NEUTRAL_PCT) return "差不多";
  return dev > 0 ? "貴" : "便宜";
}

export function devLabel(dev: number): string {
  const word = devWord(dev);
  return word === "差不多" ? "差不多" : `${word} ${Math.abs(dev).toFixed(0)}%`;
}

/** 簡易網格索引:半徑查詢租約點,免逐點全掃。 */
export class PointGrid<T extends { lat: number; lng: number }> {
  private cells = new Map<string, T[]>();
  constructor(items: T[], private cell = 0.01) {
    for (const item of items) {
      const k = this.key(item.lat, item.lng);
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(item);
    }
  }
  private key(lat: number, lng: number) {
    return `${Math.floor(lat / this.cell)}|${Math.floor(lng / this.cell)}`;
  }
  /** 回傳半徑內的點(直線距離,公尺) */
  within(lat: number, lng: number, radiusM: number): T[] {
    const span = Math.ceil(radiusM / 111_320 / this.cell) + 1;
    const cy = Math.floor(lat / this.cell), cx = Math.floor(lng / this.cell);
    const mLng = 111_320 * Math.cos(lat * Math.PI / 180);
    const out: T[] = [];
    for (let y = cy - span; y <= cy + span; y++) for (let x = cx - span; x <= cx + span; x++) {
      for (const item of this.cells.get(`${y}|${x}`) ?? []) {
        const dx = (item.lng - lng) * mLng, dy = (item.lat - lat) * 111_320;
        if (dx * dx + dy * dy <= radiusM * radiusM) out.push(item);
      }
    }
    return out;
  }
}
