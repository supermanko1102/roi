import { type BandFilter } from "@/lib/age";

// 地圖只呈現實際登錄數字；房價不映射成區域色階。

// 車站路線色:機捷紫、台鐵藍、綠線綠(施工中畫空心)
export const LINE_COLOR: Record<string, string> = {
  "機場捷運": "#8e24aa", "台鐵": "#1a5fb4", "桃園捷運綠線": "#2e7d32",
};

export const priceProp = (band: BandFilter) => `price_${band}`;
