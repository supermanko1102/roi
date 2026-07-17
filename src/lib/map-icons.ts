// 地圖圖示全部用 canvas 現畫(免外部圖檔、免字型):
//  - 房屋:實心=已完工、空心=預售中;統一中性色，價格直接看標籤數字
//  - 交流道:深色菱形
//  - 價格膠囊:白底圓角 stretchable image,配 icon-text-fit 自動包住文字

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
  add("h-f-neutral", houseImage("#0d5b4f", false));
  add("h-o-neutral", houseImage("#0d5b4f", true));
  add("ic-diamond", diamondImage("#37474f"));
  const pill = pillImage();
  add("pill", pill.img, pill.opts);
}

// 預售中=空心、已完工=實心；不再用顏色暗示價格高低。
export function houseIconExpr(): any {
  return ["case", ["==", ["get", "band"], "presale"], "h-o-neutral", "h-f-neutral"];
}
