import { type BandFilter } from "@/lib/age";

// 地圖只呈現實際登錄數字；房價不映射成區域色階。

// 車站路線色:機捷紫、台鐵藍、綠線綠(施工中畫空心);
// 北捷用官方線色,輕軌/施工線為近似色(上線前可再校)
export const LINE_COLOR: Record<string, string> = {
  "機場捷運": "#8e24aa", "台鐵": "#1a5fb4", "桃園捷運綠線": "#2e7d32",
  "文湖線": "#c48c31", "淡水信義線": "#e3002c", "松山新店線": "#008659",
  "中和新蘆線": "#f8b61c", "板南線": "#0070bd", "環狀線": "#fedb00",
  "淡海輕軌": "#00a0b0", "安坑輕軌": "#8fbe00", "三鶯線": "#7fc6e8", "萬大線": "#8b57a5",
};

export const priceProp = (band: BandFilter) => `price_${band}`;
