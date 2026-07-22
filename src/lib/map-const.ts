/**
 * 地圖層級門檻與距離門檻的唯一來源。
 * 曾因寫死的 15.4/15.5/minzoom 15 沒跟著門檻調整連壞三次——
 * 任何跟層級或距離相關的數字都放這裡,用相對運算,不要在元件裡寫裸數字。
 */

// 樂居式層級切換:zoom 過門檻自動浮出點位,行政區色塊同步淡出
export const DETAIL_ZOOM = 14;
// 重劃區/生活圈先獨立呈現;再放大一級才顯示建案(價格膠囊)
export const POINT_ZOOM = 16;
// 多城市時全區遠景不塞 54 個區標,先顯示城市級標籤
export const CITY_LABEL_ZOOM = 12;
// 滾輪階梯式縮放:每滾一格跳到下一個語意層級(全區→行政區→生活圈→建案→街廓),
// 不會停在生活圈半透明、點又還沒出來的中間態;必須遞增排序
export const ZOOM_STEPS = [10, CITY_LABEL_ZOOM, DETAIL_ZOOM, POINT_ZOOM, 17.5];
// 導航到單一建案/租屋點的落點:剛跨過膠囊門檻一點點
export const PROJECT_ZOOM = POINT_ZOOM + 0.4;

// 「近捷運」「近交流道」篩選門檻(直線距離,公尺)
export const NEAR_METRO_M = 800;   // 步行約 10 分
export const NEAR_IC_M = 2000;
// popup 裡顯示交通資訊的門檻(比篩選寬:遠一點也值得知道)
export const SHOW_STATION_M = 2400;
export const SHOW_IC_M = 3000;

// 總價帶篩選:預售買家用預算找案,不是用單價
export const TOTAL_FILTERS: { key: string; label: string; min?: number; max?: number }[] = [
  { key: "all", label: "不限" },
  { key: "1000", label: "1,000萬內", max: 1000 },
  { key: "1500", label: "1,000–1,500萬", min: 1000, max: 1500 },
  { key: "2000", label: "1,500–2,000萬", min: 1500, max: 2000 },
  { key: "2000p", label: "2,000萬以上", min: 2000 },
];
