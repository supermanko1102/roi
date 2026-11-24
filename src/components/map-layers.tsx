import { Source, Layer } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import { LINE_COLOR } from "@/lib/map-colors";
import { DETAIL_ZOOM, POINT_ZOOM } from "@/lib/map-const";
import type { DistrictFC, PillMode, PresaleFC, RentalFC, StationFC, ZoneFC } from "@/lib/map-types";
import type { RoomFilter } from "@/lib/rooms";
import type { MarketMode } from "./product-kit";

// 地圖上所有 MapLibre 圖層(純呈現):區界、生活圈、租賃點、建案膠囊、解約標記、軌道與車站。
// 「要不要畫」由 PropertyMap 決定——傳 null 就不畫;圖層 id 是點擊命中判斷的契約,改名要同步 PropertyMap。
export default function MapLayers({ districts, zones, market, marketRentals, socialRentals,
  points, cancelPoints, pillMode, rooms, rails, stations }: {
  districts: DistrictFC | null; zones: ZoneFC | null; market: MarketMode;
  marketRentals: RentalFC | null; socialRentals: RentalFC | null;
  points: PresaleFC | null;          // 已套篩選的建案點;未到建案層級時為 null
  cancelPoints: PresaleFC | null;
  pillMode: PillMode; rooms: RoomFilter;
  rails: FeatureCollection | null; stations: StationFC | null;
}) {
  return (
    <>
    {districts && (
      <Source id="districts" type="geojson" data={districts} attribution="區界 © 內政部/g0v">
        <Layer id="district-fill" type="fill"
          paint={{
            // 行政區只作導航，不把價格轉譯成色階；跨城市擴充時比較口徑才不會誤導。
            "fill-color": "#f4f5f1",
            "fill-opacity": ["interpolate", ["linear"], ["zoom"],
              DETAIL_ZOOM - 0.6, 0.12, DETAIL_ZOOM + 0.8, 0.02] as any,
          }} />
        <Layer id="district-line" type="line"
          paint={{
            "line-color": "#71837c",
            "line-width": ["interpolate", ["linear"], ["zoom"],
              DETAIL_ZOOM - 0.6, 2, DETAIL_ZOOM + 0.8, 1] as any,
          }} />
      </Source>
    )}

    {zones && (
      <Source id="zones" type="geojson" data={zones}>
        <Layer id="zone-fill" type="fill"
          paint={{
            "fill-color": "#0d5b4f",
            "fill-opacity": ["interpolate", ["linear"], ["zoom"],
              DETAIL_ZOOM - 0.2, 0, DETAIL_ZOOM + 0.2, 0.055,
              POINT_ZOOM - 0.2, 0.055, POINT_ZOOM, 0] as any,
          }} />
        <Layer id="zone-glow" type="line"
          paint={{
            "line-color": "#0d5b4f", "line-blur": 6,
            "line-width": ["interpolate", ["linear"], ["zoom"],
              DETAIL_ZOOM, 8, POINT_ZOOM, 12] as any,
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              DETAIL_ZOOM - 0.3, 0, DETAIL_ZOOM + 0.2, 0.16,
              POINT_ZOOM - 0.3, 0.12, POINT_ZOOM, 0] as any,
          }} />
        <Layer id="zone-line" type="line"
          paint={{
            "line-color": "#71837c", "line-width": 1.5,
            "line-dasharray": [2, 1.5],
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              DETAIL_ZOOM - 0.4, 0, DETAIL_ZOOM + 0.3, 0.9,
              POINT_ZOOM - 0.7, 0.9, POINT_ZOOM, 0] as any,
          }} />
      </Source>
    )}

    {market === "rental" && marketRentals && (
      <Source id="rentals" type="geojson" data={marketRentals} cluster clusterMaxZoom={14} clusterRadius={44}>
        <Layer id="rent-cluster" type="circle" filter={["has", "point_count"]}
          paint={{
            "circle-color": "#8a6234", "circle-opacity": 0.9,
            "circle-radius": ["step", ["get", "point_count"], 15, 20, 20, 80, 26],
            "circle-stroke-width": 2, "circle-stroke-color": "#fff",
          }} />
        <Layer id="rent-cluster-count" type="symbol" filter={["has", "point_count"]}
          layout={{ "text-field": ["get", "point_count_abbreviated"], "text-size": 12.5 }}
          paint={{ "text-color": "#fff" }} />
        <Layer id="rent-point" type="circle" filter={["!", ["has", "point_count"]]}
          paint={{
            "circle-color": "#fffaf0", "circle-radius": 11,
            "circle-stroke-color": "#8a6234", "circle-stroke-width": 2.5,
          }} />
        <Layer id="rent-symbol" type="symbol" filter={["!", ["has", "point_count"]]}
          layout={{ "text-field": "租", "text-size": 10.5, "text-allow-overlap": true }}
          paint={{ "text-color": "#7a5328" }} />
        <Layer id="rent-label" type="symbol" minzoom={15} filter={["!", ["has", "point_count"]]}
          layout={{
            "text-field": ["get", "rent_label"], "text-size": 11,
            "text-offset": [0, 1.55], "text-anchor": "top", "text-optional": true,
          }}
          paint={{ "text-color": "#6c4b27", "text-halo-color": "#fff", "text-halo-width": 1.7 }} />
      </Source>
    )}

    {/* 社宅包租代管件:綠色「社」獨立圖層;僅供參考,租金非市場行情 */}
    {market === "rental" && socialRentals && (
      <Source id="rentals-social" type="geojson" data={socialRentals} cluster clusterMaxZoom={14} clusterRadius={44}>
        <Layer id="rent-social-cluster" type="circle" filter={["has", "point_count"]}
          paint={{
            "circle-color": "#2f7d68", "circle-opacity": 0.9,
            "circle-radius": ["step", ["get", "point_count"], 15, 20, 20, 80, 26],
            "circle-stroke-width": 2, "circle-stroke-color": "#fff",
          }} />
        <Layer id="rent-social-cluster-count" type="symbol" filter={["has", "point_count"]}
          layout={{ "text-field": ["get", "point_count_abbreviated"], "text-size": 12.5 }}
          paint={{ "text-color": "#fff" }} />
        <Layer id="rent-social-point" type="circle" filter={["!", ["has", "point_count"]]}
          paint={{
            "circle-color": "#f0faf5", "circle-radius": 11,
            "circle-stroke-color": "#2f7d68", "circle-stroke-width": 2.5,
          }} />
        <Layer id="rent-social-symbol" type="symbol" filter={["!", ["has", "point_count"]]}
          layout={{ "text-field": "社", "text-size": 10.5, "text-allow-overlap": true }}
          paint={{ "text-color": "#1f5c4b" }} />
        <Layer id="rent-social-label" type="symbol" minzoom={15} filter={["!", ["has", "point_count"]]}
          layout={{
            "text-field": ["get", "rent_label"], "text-size": 11,
            "text-offset": [0, 1.55], "text-anchor": "top", "text-optional": true,
          }}
          paint={{ "text-color": "#1f5c4b", "text-halo-color": "#fff", "text-halo-width": 1.7 }} />
      </Source>
    )}

    {market === "presale" && points && (
      <Source id="points" type="geojson" data={points}
        cluster clusterMaxZoom={15} clusterRadius={48}>
        <Layer id="pt-cluster" type="circle" filter={["has", "point_count"]}
          paint={{
            "circle-color": "#3d7ea6",
            "circle-opacity": 0.85,
            "circle-radius": ["step", ["get", "point_count"], 14, 20, 19, 100, 25],
            "circle-stroke-width": 2, "circle-stroke-color": "#fff",
          }} />
        <Layer id="pt-cluster-count" type="symbol" filter={["has", "point_count"]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Bold"], "text-size": 13,
          }}
          paint={{ "text-color": "#fff" }} />
        {/* 價格膠囊:白底圓角；格局篩選時顯示總價，否則顯示單價。
            建案一出場(POINT_ZOOM)就是膠囊,不再有圓點過場。 */}
        <Layer id="pt-pill" type="symbol" filter={["!", ["has", "point_count"]]}
          minzoom={POINT_ZOOM}
          layout={{
            "icon-image": "pill",
            "icon-text-fit": "both",
            // 膠囊數字跟著「看什麼」切換;沒有該數字的案顯示「—」而不是硬湊
            "text-field": (pillMode === "dev"
              ? ["case", ["has", "dev"],
                  ["concat", ["case", [">", ["get", "dev"], 0], "+", ""],
                    ["to-string", ["round", ["get", "dev"]]], "%"], "—"]
              : pillMode === "yield"
              ? ["case", ["has", "yield_pct"],
                  ["concat", ["to-string", ["/", ["round", ["*", ["get", "yield_pct"], 10]], 10]], "%"], "—"]
              : rooms !== "all"
              ? ["concat", ["to-string", ["get", "median_total"]], "萬"]
              : ["concat", "$", ["to-string", ["get", "price"]]]) as any,
            "text-font": ["Noto Sans Bold"], "text-size": 12.5,
            // 有數字的案優先佔位,避免被一堆「—」擠掉
            "symbol-sort-key": (pillMode === "dev" ? ["case", ["has", "dev"], 0, 1]
              : pillMode === "yield" ? ["case", ["has", "yield_pct"], 0, 1] : 0) as any,
          }}
          paint={{
            // 貴=紅、便宜=綠(±3% 內不上色);只染文字,不染區塊
            "text-color": (pillMode === "dev"
              ? ["case", ["!", ["has", "dev"]], "#9aa6a1",
                  [">=", ["get", "dev"], 3], "#a23e2d",
                  ["<=", ["get", "dev"], -3], "#0d5b4f", "#22303a"]
              : pillMode === "yield"
              ? ["case", ["has", "yield_pct"], "#22303a", "#9aa6a1"]
              : "#22303a") as any,
          }} />
        <Layer id="pt-name" type="symbol" filter={["!", ["has", "point_count"]]}
          minzoom={POINT_ZOOM}
          layout={{
            "text-field": ["get", "name"] as any,
            "text-font": ["Noto Sans Bold"], "text-size": 11,
            "text-offset": [0, 1.5] as any, // 讓出膠囊高度
            "text-anchor": "top",
            "text-optional": true,
          }}
          paint={{ "text-color": "#22303a", "text-halo-color": "#fff", "text-halo-width": 1.5 }} />
      </Source>
    )}

    {/* 解約標記:紅圈壓在點位上,獨立於屋齡帶/格局篩選 */}
    {market === "presale" && cancelPoints && (
      <Source id="cancels" type="geojson" data={cancelPoints}>
        <Layer id="cancel-halo" type="circle"
          paint={{
            "circle-color": "rgba(220,53,69,.12)",
            "circle-radius": ["+", 12, ["*", 2, ["get", "cancel_count"]]] as any,
            "circle-stroke-color": "#dc3545", "circle-stroke-width": 2,
          }} />
        <Layer id="cancel-label" type="symbol"
          layout={{
            "text-field": ["concat", ["get", "name"], "\n解約 ", ["to-string", ["get", "cancel_count"]], " 筆"] as any,
            "text-font": ["Noto Sans Bold"], "text-size": 11,
            "text-offset": [0, 1.6], "text-anchor": "top", "text-allow-overlap": true,
          }}
          paint={{ "text-color": "#b02a37", "text-halo-color": "#fff", "text-halo-width": 1.6 }} />
      </Source>
    )}

    {/* 軌道路線:營運畫實線、施工中畫虛線,墊在車站圓點下方。
        只畫有站點的線(機捷/台鐵/綠線);規劃中路線未定案,刻意不畫。 */}
    {rails && (
      <Source id="rails" type="geojson" data={rails}>
        <Layer id="rail-op" type="line" filter={["==", ["get", "status"], "operating"]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-color": ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#888"] as any,
            "line-width": ["interpolate", ["linear"], ["zoom"], DETAIL_ZOOM, 1.6, 16, 3.4] as any,
            "line-opacity": 0.42,
          }} />
        <Layer id="rail-con" type="line" filter={["==", ["get", "status"], "construction"]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-color": ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#888"] as any,
            "line-width": ["interpolate", ["linear"], ["zoom"], DETAIL_ZOOM, 1.6, 16, 3.4] as any,
            "line-opacity": 0.55,
            "line-dasharray": [2.4, 1.8],
          }} />
      </Source>
    )}

    {/* 車站+交流道圖層:車站圓點(營運實心、施工空心)、交流道菱形;放大到細節層才出現 */}
    {stations && (
      <Source id="stations" type="geojson" data={stations}>
        <Layer id="st-pt" type="circle" filter={["!=", ["get", "kind"], "interchange"]}
          paint={{
            "circle-color": ["case", ["==", ["get", "status"], "construction"], "#ffffff",
              ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#666"]] as any,
            "circle-stroke-color": ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#666"] as any,
            "circle-radius": 5.5, "circle-stroke-width": 2.5,
          }} />
        <Layer id="ic-pt" type="symbol" filter={["==", ["get", "kind"], "interchange"]}
          layout={{ "icon-image": "ic-diamond", "icon-size": 0.6, "icon-allow-overlap": true }} />
        <Layer id="st-label" type="symbol" minzoom={13}
          layout={{
            "text-field": ["case", ["==", ["get", "status"], "construction"],
              ["concat", ["get", "name"], "(施工中)"], ["get", "name"]] as any,
            "text-font": ["Noto Sans Bold"], "text-size": 11,
            "text-offset": [0, -1.4], "text-anchor": "bottom", "text-optional": true,
          }}
          paint={{
            "text-color": ["case", ["==", ["get", "kind"], "interchange"], "#37474f",
              ["match", ["get", "line"], ...Object.entries(LINE_COLOR).flat(), "#666"]] as any,
            "text-halo-color": "#fff", "text-halo-width": 1.6,
          }} />
      </Source>
    )}
    </>
  );
}
