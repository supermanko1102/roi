import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";

/**
 * 前端地圖資料的型別契約。
 * 欄位真相:建案點=lib/points.ts 的 toFeatureCollection、租賃點=/api/rentals、
 * 區界/生活圈/車站=各自 API route。後端改欄位名時這裡跟著改,tsc 會揪出所有引用點。
 */

/** 建案/棟級統一點位屬性(選配欄位後端輸出時會省略) */
export type PresaleProps = {
  kind: "presale" | "resale";
  band: string;                   // 屋齡帶;"presale"=預售中
  city: string;
  district: string;
  price: number | null;           // 扣車位中位單價(萬/坪)
  deal_count: number;
  median_total: number | null;    // 中位總價(萬)
  median_area?: number;           // 中位坪數(建案才有)
  households?: number;            // 預售備查層棟戶數
  name?: string;
  addr_key?: string;
  building_type?: string;
  build_year?: number;
  cancel_count?: number;
  // 以下由前端 enrich 補上(最近車站/交流道)
  st_name?: string; st_line?: string; st_m?: number;
  ic_name?: string; ic_m?: number;
};
export type PresaleFeature = Feature<Point, PresaleProps>;
export type PresaleFC = FeatureCollection<Point, PresaleProps>;

/** 租賃棟級點位屬性(/api/rentals) */
export type RentalProps = {
  key: string;                    // addr_key,建議清單/開啟點位用
  name: string | null;            // 配對到備查建案才有
  city: string;
  district: string;
  address: string;                // 棟級門牌(不含樓層室號)
  building_type: string;
  build_year: number;
  age: number;
  monthly_rent: number;
  housing_rent: number;
  parking_rent: number | null;
  area_ping: number;
  rent_per_ping: number;
  deal_count: number;
  last_deal: string | null;
  rent_label?: string;            // 地圖標籤文字
};
export type RentalFeature = Feature<Point, RentalProps>;
export type RentalFC = FeatureCollection<Point, RentalProps>;

/** 行政區界屬性(另含 price/n 開頭的統計欄位,鍵名由 priceProp(band) 動態組出) */
export type DistrictProps = { city: string; name: string } & Record<string, any>;
export type DistrictFC = FeatureCollection<Polygon | MultiPolygon, DistrictProps>;

/** 生活圈屬性(zone_key 為跨市唯一鍵;統計欄位同上為動態鍵名) */
export type ZoneProps = { name: string; zone_key?: string; city?: string } & Record<string, any>;
export type ZoneFC = FeatureCollection<Polygon | MultiPolygon, ZoneProps>;

/** 車站/交流道(kind 區分)與軌道線 */
export type StationProps = { name: string; line: string; status: string; kind?: "station" | "interchange" };
export type StationFC = FeatureCollection<Point, StationProps>;

/** 車站/交流道攤平後的距離索引項 */
export type TransportStop = { name: string; line: string; status: string; kind: string; lng: number; lat: number };

/** 地圖標籤(行政區/生活圈共用):幾何邊界框中心+原始屬性 */
export type MapLabel = {
  key: string;
  name: string;
  lng: number;
  lat: number;
  props: Record<string, any>;
  bounds?: [[number, number], [number, number]];
};

/** 搜尋下拉建議:選中後直接飛到目標(建案開抽屜、行政區/生活圈縮放) */
export type SearchSuggestion = {
  kind: "project" | "district" | "zone" | "rental";
  key: string;
  label: string;
  sub?: string;
};
