import { DEV_STOPS, PRICE_STOPS, rampColor } from "@/lib/map-colors";

// 地圖圖示全部用 canvas 現畫(免外部圖檔、免字型):
//  - 房屋:實心=已完工、空心=預售中;顏色分桶預先上色(比 SDF 染色穩,WebGL symbol 效能同圓點)
//  - 交流道:深色菱形
//  - 價格膠囊:白底圓角 stretchable image,配 icon-text-fit 自動包住文字
// 桶的邊界要跟 iconExpr()/pillTextColor() 的 step expression 一致。

export const DEV_BUCKETS = [
  { key: "g2", upTo: -8 }, { key: "g1", upTo: -3 }, { key: "fl", upTo: 3 },
  { key: "r1", upTo: 8 }, { key: "r2", upTo: Infinity },
] as const;
export const PRICE_BUCKETS = [
  { key: "p0", upTo: 23 }, { key: "p1", upTo: 29 }, { key: "p2", upTo: 35 },
  { key: "p3", upTo: 41 }, { key: "p4", upTo: Infinity },
] as const;
const NO_DATA = "#9aa5ad";

function bucketColor(kind: "dev" | "price", key: string): string {
  if (key === "nd") return NO_DATA;
  const [buckets, stops] = kind === "dev"
    ? [DEV_BUCKETS, DEV_STOPS] as const : [PRICE_BUCKETS, PRICE_STOPS] as const;
  const i = buckets.findIndex((b) => b.key === key);
  // 桶中點取色;最外側桶取色階端點
  const lo = i === 0 ? stops[0][0] : buckets[i - 1].upTo;
  const hi = buckets[i].upTo === Infinity ? stops[stops.length - 1][0] : buckets[i].upTo;
  return rampColor([...stops], (lo + hi) / 2);
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

// 房屋剪影(24 格座標系,@2x 畫)
function houseImage(color: string, hollow: boolean): ImageData {
  const S = 48, u = S / 24;
  const { ctx } = makeCanvas(S, S);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(12 * u, 3 * u);
    ctx.lineTo(21.5 * u, 11.5 * u);
    ctx.lineTo(19 * u, 11.5 * u);
    ctx.lineTo(19 * u, 21 * u);
    ctx.lineTo(5 * u, 21 * u);
    ctx.lineTo(5 * u, 11.5 * u);
    ctx.lineTo(2.5 * u, 11.5 * u);
    ctx.closePath();
  };
  // 白色外框襯底,在各種底圖上都清楚
  path();
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 5 * u; ctx.stroke();
  if (hollow) {
    path();
    ctx.fillStyle = "#ffffff"; ctx.fill();       // 空心:白底
    path();
    ctx.strokeStyle = color; ctx.lineWidth = 2.6 * u; ctx.stroke();
  } else {
    path();
    ctx.fillStyle = color; ctx.fill();
  }
  return ctx.getImageData(0, 0, S, S);
}

// 交流道:深色菱形 + 白襯底
function diamondImage(color: string): ImageData {
  const S = 36, m = S / 2;
  const { ctx } = makeCanvas(S, S);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(m, 4); ctx.lineTo(S - 4, m); ctx.lineTo(m, S - 4); ctx.lineTo(4, m);
    ctx.closePath();
  };
  path(); ctx.lineJoin = "round";
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 6; ctx.stroke();
  path(); ctx.fillStyle = color; ctx.fill();
  return ctx.getImageData(0, 0, S, S);
}

// 價格膠囊底圖:白底圓角 + 淡框(@2x;stretch 區讓文字自動撐開)
function pillImage(): { img: ImageData; opts: any } {
  const W = 88, H = 56, r = 26;
  const { ctx } = makeCanvas(W, H);
  ctx.beginPath();
  ctx.roundRect(3, 3, W - 6, H - 6, r);
  ctx.fillStyle = "rgba(255,255,255,.97)"; ctx.fill();
  ctx.strokeStyle = "#c9d2d8"; ctx.lineWidth = 2; ctx.stroke();
  return {
    img: ctx.getImageData(0, 0, W, H),
    opts: {
      pixelRatio: 2,
      stretchX: [[30, 58]], stretchY: [[24, 32]],
      content: [12, 8, 76, 48],
    },
  };
}

// map onLoad 時掛上全部圖示(重複呼叫安全)
export function addMapIcons(map: { hasImage(id: string): boolean; addImage(id: string, img: any, opts?: any): void }) {
  const add = (id: string, img: ImageData, opts?: any) => {
    if (!map.hasImage(id)) map.addImage(id, img, opts);
  };
  for (const [kind, buckets] of [["dev", DEV_BUCKETS], ["price", PRICE_BUCKETS]] as const) {
    for (const b of [...buckets.map((x) => x.key), "nd"]) {
      add(`h-f-${kind}-${b}`, houseImage(bucketColor(kind, b), false));
      add(`h-o-${kind}-${b}`, houseImage(bucketColor(kind, b), true));
    }
  }
  add("ic-diamond", diamondImage("#37474f"));
  const pill = pillImage();
  add("pill", pill.img, pill.opts);
}

// icon-image expression:預售中=空心、已完工=實心;依模式選 dev/price 分桶
export function houseIconExpr(mode: "rel" | "abs"): any {
  const fillState: any = ["case", ["==", ["get", "band"], "presale"], "h-o-", "h-f-"];
  const bucket: any = mode === "rel"
    ? ["case", ["==", ["get", "dev"], null], "dev-nd",
       ["step", ["get", "dev"], "dev-g2", -8, "dev-g1", -3, "dev-fl", 3, "dev-r1", 8, "dev-r2"]]
    : ["case", ["==", ["get", "price"], null], "price-nd",
       ["step", ["get", "price"], "price-p0", 23, "price-p1", 29, "price-p2", 35, "price-p3", 41, "price-p4"]];
  return ["concat", fillState, bucket];
}

// 膠囊文字顏色:rel=貴紅便宜綠、abs=深藍
export function pillTextColorExpr(mode: "rel" | "abs"): any {
  if (mode === "abs") return "#184a7c";
  return ["case", ["==", ["get", "dev"], null], "#5c6b76",
    ["step", ["get", "dev"], "#1a7f5c", -3, "#46565f", 3, "#c2452d"]];
}
