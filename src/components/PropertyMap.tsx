"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Source, Layer, Marker, Popup, MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import BuildingDrawer from "./BuildingDrawer";
import "maplibre-gl/dist/maplibre-gl.css";

type Metric = "price" | "roi"; // 使用者自選:看單價或看租金投報比
type Market = "presale" | "resale"; // 預售屋 vs 中古屋(屋齡≤8年住宅,與租金池同屋齡帶)
type BldgDeal = {
  address: string; deal_date: string | null;
  total_price: string; area_ping: string; unit_price: string | null;
};
type BldgPopup = {
  lng: number; lat: number;
  addr_key: string; deal_count: number; median_unit_price: number | null;
  building_type: string | null; build_year: number | null;
  community: string | null; // 社區歸戶名稱(2021 後備查建案才有)
  deals: BldgDeal[] | null; // null = 載入中
};
type Project = {
  id: number; name: string; district: string;
  lat: string | null; lng: string | null;
  median_total: string; median_area: string; unit_price: string;
  est_rent: string | null; est_roi: string | null;
  est_rent_market: string | null; est_roi_market: string | null;
  rent_samples: number; rent_samples_market: number; deal_count: number;
};

// CARTO Positron 淺色底圖:極簡資料視覺化風格,CDN 快(NLSC 官方圖磚較慢且視覺雜訊多)
const BASE_STYLE: any = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    carto: {
      type: "raster",
      tiles: ["a", "b", "c", "d"].map(
        (s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png`),
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors © CARTO・區界 © 內政部/g0v",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

// 樂居式層級切換:zoom 過門檻自動浮出建案/棟級點位,行政區色塊同步淡出
const DETAIL_ZOOM = 12;
// 重劃區/生活圈層:DETAIL_ZOOM ~ ZONE_FADE 之間顯示,更放大就淡出讓位給點位
const ZONE_FADE = 13.9;

const PRICE_STOPS: [number, string][] = [[20, "#e2ebf5"], [32, "#7aa7cf"], [44, "#184a7c"]];
// 投報率一律用市場行情口徑(排除社會住宅包租代管件,租金受政策壓低不具參考性)
const ROI_STOPS: [number, string][] = [[2.6, "#d64541"], [3.4, "#e0a92e"], [5.0, "#2f9e6e"]];
// 行政區統計欄位:預售/中古各一套(中古=屋齡≤8年,單價與投報範圍相近,色階共用)
const PRICE_FIELD: Record<Market, string> = {
  presale: "median_unit_price", resale: "median_unit_price_resale",
};
const ROI_FIELD: Record<Market, string> = {
  presale: "est_roi_market", resale: "est_roi_resale_market",
};

function fillExpr(metric: Metric, market: Market): any {
  const prop = metric === "price" ? PRICE_FIELD[market] : ROI_FIELD[market];
  const stops = metric === "price" ? PRICE_STOPS : ROI_STOPS;
  return [
    "case",
    ["==", ["get", prop], null], "#cfd6da",
    ["interpolate", ["linear"], ["get", prop], ...stops.flat()],
  ];
}
function stopColor(v: number | null, s: [number, string][]): string {
  if (v == null) return "#9aa5ad";
  if (v <= s[0][0]) return s[0][1];
  if (v >= s[2][0]) return s[2][1];
  return v < s[1][0] ? mix(s[0], s[1], v) : mix(s[1], s[2], v);
}
const roiColor = (v: number | null) => stopColor(v, ROI_STOPS);
const priceColor = (v: number | null) => stopColor(v, PRICE_STOPS);
function mix(a: [number, string], b: [number, string], v: number): string {
  const t = (v - a[0]) / (b[0] - a[0]);
  const pa = hex(a[1]), pb = hex(b[1]);
  return `rgb(${pa.map((x, i) => Math.round(x + (pb[i] - x) * t)).join(",")})`;
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export default function PropertyMap() {
  const mapRef = useRef<MapRef>(null);
  const [districts, setDistricts] = useState<FeatureCollection | null>(null);
  const [metric, setMetric] = useState<Metric>("price");
  const [market, setMarket] = useState<Market>("presale");
  const [zoom, setZoom] = useState(10.3);
  const [projects, setProjects] = useState<Project[]>([]);
  const [popup, setPopup] = useState<Project | null>(null);
  const [buildings, setBuildings] = useState<FeatureCollection | null>(null);
  const [bldgPopup, setBldgPopup] = useState<BldgPopup | null>(null);
  const [zones, setZones] = useState<FeatureCollection | null>(null);
  const [drawerAddr, setDrawerAddr] = useState<string | null>(null);
  const detail = zoom >= DETAIL_ZOOM;
  const zoneLevel = zoom >= DETAIL_ZOOM && zoom < ZONE_FADE;

  useEffect(() => {
    fetch("/api/districts").then((r) => r.json()).then(setDistricts);
    fetch("/api/zones").then((r) => r.json()).then(setZones);
    // 深連結:?bldg=門牌 直接開抽屜(可分享)
    const b = new URLSearchParams(location.search).get("bldg");
    if (b) setDrawerAddr(b);
  }, []);

  // 抽屜開關同步到網址,重整/分享都能還原
  function openDrawer(addr: string) {
    setDrawerAddr(addr); setBldgPopup(null);
    const u = new URL(location.href);
    u.searchParams.set("bldg", addr);
    history.replaceState(null, "", u);
  }
  function closeDrawer() {
    setDrawerAddr(null);
    const u = new URL(location.href);
    u.searchParams.delete("bldg");
    history.replaceState(null, "", u);
  }

  useEffect(() => {
    if (!detail) { setPopup(null); setBldgPopup(null); }
  }, [detail]);

  const labels = useMemo(() => {
    if (!districts) return [];
    return districts.features.map((f: any) => {
      // 標籤放邊界框中心(粗略但夠用;更準可預算 pole of inaccessibility)
      const flat = JSON.stringify(f.geometry.coordinates).match(/\[(-?[\d.]+),(-?[\d.]+)\]/g) ?? [];
      let minX = 180, maxX = 0, minY = 90, maxY = 0;
      for (const pt of flat) {
        const [x, y] = pt.slice(1, -1).split(",").map(Number);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return { name: f.properties.name, lng: (minX + maxX) / 2, lat: (minY + maxY) / 2, props: f.properties };
    });
  }, [districts]);

  // 重劃區標籤放邊界框中心(邊界是官方圖資的 Polygon/MultiPolygon)
  const zoneLabels = useMemo(() => {
    if (!zones) return [];
    return zones.features.map((f: any) => {
      const pos: [number, number][] = f.geometry.type === "Polygon"
        ? f.geometry.coordinates.flat() : f.geometry.coordinates.flat(2);
      const xs = pos.map((p) => p[0]), ys = pos.map((p) => p[1]);
      return {
        name: f.properties.name,
        lng: (Math.min(...xs) + Math.max(...xs)) / 2,
        lat: (Math.min(...ys) + Math.max(...ys)) / 2,
        bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]] as [[number, number], [number, number]],
        props: f.properties,
      };
    });
  }, [zones]);

  function zoomToZone(name: string) {
    const z = zoneLabels.find((l) => l.name === name);
    if (!z) return;
    loadDetail([z.bounds[0][0], z.bounds[0][1], z.bounds[1][0], z.bounds[1][1]]); // 與飛行動畫並行抓資料
    mapRef.current?.fitBounds(z.bounds, { padding: 40, duration: 600 });
  }

  // 視窗載入:zoom 進入細節層級後按目前視窗(外擴 40%)抓建案與棟級點;
  // 新視窗仍在上次抓過的範圍內就不重抓
  const fetchedBbox = useRef<[number, number, number, number] | null>(null);
  async function loadDetail(view: [number, number, number, number]) {
    const fb = fetchedBbox.current;
    if (fb && view[0] >= fb[0] && view[1] >= fb[1] && view[2] <= fb[2] && view[3] <= fb[3]) return;
    const padX = (view[2] - view[0]) * 0.4, padY = (view[3] - view[1]) * 0.4;
    const bbox = [view[0] - padX, view[1] - padY, view[2] + padX, view[3] + padY]
      .map((v) => +v.toFixed(5)) as [number, number, number, number];
    fetchedBbox.current = bbox;
    const q = `bbox=${bbox.join(",")}`;
    const [projRes, bldgRes] = await Promise.all([
      fetch(`/api/projects?${q}`),
      fetch(`/api/buildings?${q}`),
    ]);
    setProjects(await projRes.json());
    setBuildings(await bldgRes.json());
  }

  // 點行政區 → 縮放到該區;顯示什麼由 zoom 門檻決定,與滾輪放大走同一條路
  function drill(name: string) {
    const feats = (districts?.features ?? []).find((f: any) => f.properties.name === name) as any;
    if (!feats) return;
    const flat = JSON.stringify(feats.geometry.coordinates).match(/\[(-?[\d.]+),(-?[\d.]+)\]/g) ?? [];
    let minX = 180, maxX = 0, minY = 90, maxY = 0;
    for (const pt of flat) {
      const [x, y] = pt.slice(1, -1).split(",").map(Number);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    loadDetail([minX, minY, maxX, maxY]); // 與飛行動畫並行抓資料,動畫結束即有點位
    // 面積大的區 fitBounds 後可能還不到細節門檻,保底跨過去
    const map = mapRef.current?.getMap();
    const cam = map?.cameraForBounds([[minX, minY], [maxX, maxY]], { padding: 60 });
    if (map && cam) map.easeTo({ ...cam, zoom: Math.max(cam.zoom ?? DETAIL_ZOOM, DETAIL_ZOOM + 0.1), duration: 700 });
  }
  function back() {
    mapRef.current?.flyTo({ center: [121.25, 24.94], zoom: 10.3, duration: 700 });
  }

  async function openBuilding(f: any) {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    setBldgPopup({
      lng, lat, addr_key: p.addr_key, deal_count: p.deal_count,
      median_unit_price: p.median_unit_price ?? null,
      building_type: p.building_type ?? null, build_year: p.build_year ?? null,
      community: p.community ?? null,
      deals: null,
    });
    const res = await fetch(`/api/building-deals?addr=${encodeURIComponent(p.addr_key)}`);
    const deals = await res.json();
    setBldgPopup((cur) => (cur && cur.addr_key === p.addr_key ? { ...cur, deals } : cur));
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Map
        ref={mapRef}
        mapStyle={BASE_STYLE}
        initialViewState={{ longitude: 121.25, latitude: 24.94, zoom: 10.3 }}
        onLoad={(e) => e.target.resize()} // 容器尺寸就緒前 canvas 可能只畫一角
        onMove={(e) => {
          // 動畫/拖曳中只在跨越門檻時更新,避免每幀重繪 DOM markers
          const z = e.viewState.zoom;
          setZoom((prev) => ((prev >= DETAIL_ZOOM) !== (z >= DETAIL_ZOOM) ? z : prev));
        }}
        onMoveEnd={(e) => {
          setZoom(e.viewState.zoom);
          if (e.viewState.zoom >= DETAIL_ZOOM) {
            const b = e.target.getBounds();
            loadDetail([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
          }
        }}
        onClick={(e) => {
          const f = e.features?.[0];
          if (!f) return;
          if (f.layer.id === "bldg-cluster") {
            // 點 cluster → 展開放大
            const src: any = mapRef.current?.getSource("buildings");
            src?.getClusterExpansionZoom(f.properties!.cluster_id).then((z: number) =>
              mapRef.current?.easeTo({ center: (f.geometry as any).coordinates, zoom: z + 0.5, duration: 500 }));
          } else if (f.layer.id === "bldg-point") {
            // 抽屜開著時點別棟直接切換內容,維持「掃描→查看→再掃描」的節奏
            if (drawerAddr) openDrawer((f.properties as any).addr_key);
            else openBuilding(f);
          } else if (f.layer.id === "zone-fill") {
            zoomToZone((f.properties as any).name);
          } else if (!detail) {
            drill((f.properties as any).name);
          }
        }}
        interactiveLayerIds={detail
          ? (zoneLevel ? ["bldg-cluster", "bldg-point", "zone-fill"] : ["bldg-cluster", "bldg-point"])
          : ["district-fill"]}
      >
        {districts && (
          <Source id="districts" type="geojson" data={districts}>
            <Layer id="district-fill" type="fill"
              paint={{
                "fill-color": fillExpr(metric, market) as any,
                // 放大進細節層級時色塊淡出,只留區界
                "fill-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.6, 0.34, DETAIL_ZOOM + 0.8, 0.04] as any,
              }} />
            <Layer id="district-line" type="line"
              paint={{
                "line-color": "#2c5f8a",
                "line-width": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.6, 2, DETAIL_ZOOM + 0.8, 1] as any,
              }} />
          </Source>
        )}

        {zones && (
          <Source id="zones" type="geojson" data={zones}>
            <Layer id="zone-fill" type="fill"
              paint={{
                "fill-color": (metric === "price"
                  ? ["case",
                      ["==", ["get", market === "presale" ? "presale_unit_price" : "resale_unit_price"], null], "#cfd6da",
                      ["interpolate", ["linear"],
                        ["get", market === "presale" ? "presale_unit_price" : "resale_unit_price"],
                        ...PRICE_STOPS.flat()]]
                  : ["case",
                      ["==", ["get", market === "presale" ? "est_roi" : "est_roi_resale"], null], "#cfd6da",
                      ["interpolate", ["linear"],
                        ["get", market === "presale" ? "est_roi" : "est_roi_resale"],
                        ...ROI_STOPS.flat()]]) as any,
                "fill-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.4, 0, DETAIL_ZOOM + 0.3, 0.22,
                  ZONE_FADE - 0.7, 0.22, ZONE_FADE, 0] as any,
              }} />
            <Layer id="zone-line" type="line"
              paint={{
                "line-color": "#8a5fb0", "line-width": 1.6, "line-dasharray": [2, 1.5],
                "line-opacity": ["interpolate", ["linear"], ["zoom"],
                  DETAIL_ZOOM - 0.4, 0, DETAIL_ZOOM + 0.3, 0.9,
                  ZONE_FADE - 0.7, 0.9, ZONE_FADE, 0] as any,
              }} />
          </Source>
        )}

        {detail && buildings && (
          <Source id="buildings" type="geojson" data={buildings}
            cluster clusterMaxZoom={15} clusterRadius={48}>
            <Layer id="bldg-cluster" type="circle" filter={["has", "point_count"]}
              paint={{
                "circle-color": "#3d7ea6",
                "circle-opacity": 0.85,
                "circle-radius": ["step", ["get", "point_count"], 14, 20, 19, 100, 25],
                "circle-stroke-width": 2, "circle-stroke-color": "#fff",
              }} />
            <Layer id="bldg-cluster-count" type="symbol" filter={["has", "point_count"]}
              layout={{
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": ["Open Sans Semibold"], "text-size": 13,
              }}
              paint={{ "text-color": "#fff" }} />
            <Layer id="bldg-point" type="circle" filter={["!", ["has", "point_count"]]}
              paint={{
                "circle-color": [
                  "case", ["==", ["get", "median_unit_price"], null], "#9aa5ad",
                  ["interpolate", ["linear"], ["get", "median_unit_price"], ...PRICE_STOPS.flat()],
                ] as any,
                "circle-radius": 8,
                "circle-stroke-width": 2, "circle-stroke-color": "#fff",
              }} />
            <Layer id="bldg-price" type="symbol" filter={["!", ["has", "point_count"]]}
              minzoom={15}
              layout={{
                // 有社區名(2021 後備查建案)就一併顯示,樂居式標籤
                "text-field": ["case", ["has", "community"],
                  ["concat", ["get", "community"], "\n$", ["to-string", ["get", "median_unit_price"]]],
                  ["concat", "$", ["to-string", ["get", "median_unit_price"]]]] as any,
                "text-font": ["Open Sans Semibold"], "text-size": 12,
                "text-offset": [0, 1.3], "text-anchor": "top",
                "text-optional": true,
              }}
              paint={{ "text-color": "#184a7c", "text-halo-color": "#fff", "text-halo-width": 1.6 }} />
          </Source>
        )}

        {!detail && labels.map((l) => (
          <Marker key={l.name} longitude={l.lng} latitude={l.lat} anchor="center">
            <div
              className={`dlabel ${l.props[PRICE_FIELD[market]] == null ? "nodata" : ""}`}
              onClick={(e) => { e.stopPropagation(); drill(l.name); }}
            >
              <span className="dname">{l.name}</span>
              <span className="dval num">
                {l.props[PRICE_FIELD[market]] == null ? "資料不足"
                  : metric === "price" ? `$${(+l.props[PRICE_FIELD[market]]).toFixed(1)}`
                  : l.props[ROI_FIELD[market]] == null ? "樣本不足" : `${(+l.props[ROI_FIELD[market]]).toFixed(2)}%`}
              </span>
            </div>
          </Marker>
        ))}

        {zoneLevel && zoneLabels.map((l) => {
          const v = metric === "price"
            ? (market === "presale" ? l.props.presale_unit_price : l.props.resale_unit_price)
            : (market === "presale" ? l.props.est_roi : l.props.est_roi_resale);
          return (
            <Marker key={l.name} longitude={l.lng} latitude={l.lat} anchor="center">
              <div className="zlabel" onClick={(e) => { e.stopPropagation(); zoomToZone(l.name); }}
                title={`${l.name}:預售 ${l.props.project_count} 案/${l.props.presale_deals} 筆・中古 ${l.props.resale_deals} 筆`}>
                <span className="zname">{l.name}</span>
                <span className="zval num">
                  {v == null ? "—" : metric === "price" ? `$${(+v).toFixed(1)}` : `${(+v).toFixed(2)}%`}
                </span>
              </div>
            </Marker>
          );
        })}

        {detail && market === "presale" && projects.filter((p) => p.lat && p.lng).map((p) => {
          // 點色跟著使用者選的指標:單價模式看價位、投報模式看報酬
          const color = metric === "price"
            ? priceColor(p.unit_price == null ? null : +p.unit_price)
            : roiColor(p.est_roi_market == null ? null : +p.est_roi_market);
          return (
            <Marker key={p.id} longitude={+p.lng!} latitude={+p.lat!} anchor="center">
              <div
                onClick={(e) => { e.stopPropagation(); setPopup(p); }}
                style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: color, border: "2.5px solid #fff",
                  boxShadow: "0 1px 4px rgba(0,0,0,.3)", cursor: "pointer",
                }}
                title={p.name}
              />
            </Marker>
          );
        })}

        {popup && popup.lat && popup.lng && (() => {
          const roi = popup.est_roi_market == null ? null : +popup.est_roi_market;
          const rent = popup.est_rent_market;
          const samples = popup.rent_samples_market;
          const showRoi = metric === "roi"; // 使用者選了投報比才呈現租金推估
          return (
            <Popup longitude={+popup.lng} latitude={+popup.lat} anchor="bottom"
              onClose={() => setPopup(null)} closeButton maxWidth="280px" offset={14}>
              <div className="popup-card">
                <h3>{popup.name}</h3>
                <div style={{ color: "var(--ink-soft)", fontSize: 11 }}>{popup.district}・{popup.deal_count} 筆成交</div>
                {showRoi ? (
                  <div className="roi" style={{ background: roiColor(roi) }}>
                    <b className="num">{roi == null ? "—" : `${roi.toFixed(2)}%`}</b>
                    <span>推估年投報{samples < 5 ? "(樣本不足)" : ""}</span>
                  </div>
                ) : (
                  <div className="roi" style={{ background: priceColor(+popup.unit_price) }}>
                    <b className="num">{(+popup.unit_price).toFixed(1)}</b>
                    <span>扣車位單價(萬/坪)</span>
                  </div>
                )}
                <dl>
                  <div><dt>中位總價</dt><dd className="num">{(+popup.median_total).toLocaleString()} 萬</dd></div>
                  <div><dt>中位坪數</dt><dd className="num">{(+popup.median_area).toFixed(1)} 坪</dd></div>
                  {showRoi && <div><dt>扣車位單價</dt><dd className="num">{(+popup.unit_price).toFixed(1)} 萬/坪</dd></div>}
                  {showRoi && <div><dt>推估月租</dt><dd className="num">{rent ? (+rent).toLocaleString() + " 元" : "—"}</dd></div>}
                </dl>
                {showRoi && (
                  <div className="note">租金推估:區內市場租賃中位數 × 坪數 × 0.85(n={samples},不含社宅包租代管件)</div>
                )}
              </div>
            </Popup>
          );
        })()}
        {bldgPopup && (
          <Popup longitude={bldgPopup.lng} latitude={bldgPopup.lat} anchor="bottom"
            onClose={() => setBldgPopup(null)} closeButton maxWidth="320px" offset={12}>
            <div className="popup-card">
              <h3>{bldgPopup.community ?? bldgPopup.addr_key.replace(/^桃園市[^區]+區/, "")}</h3>
              <div style={{ color: "var(--ink-soft)", fontSize: 11 }}>
                {bldgPopup.community ? `${bldgPopup.addr_key.replace(/^桃園市[^區]+區/, "")}・` : ""}
                {bldgPopup.building_type ?? "—"}
                {bldgPopup.build_year ? `・${new Date().getFullYear() - bldgPopup.build_year} 年屋` : ""}
                ・{bldgPopup.deal_count} 筆成交
              </div>
              <div className="roi" style={{ background: "#3d7ea6" }}>
                <b className="num">{bldgPopup.median_unit_price == null ? "—" : `${bldgPopup.median_unit_price.toFixed(1)}`}</b>
                <span>中位單價(萬/坪,扣車位)</span>
              </div>
              {bldgPopup.deals == null ? (
                <div className="note">載入成交明細…</div>
              ) : (
                <table className="deals num">
                  <thead><tr><th>日期</th><th>總價</th><th>單價</th></tr></thead>
                  <tbody>
                    {bldgPopup.deals.slice(0, 8).map((d, i) => (
                      <tr key={i}>
                        <td>{d.deal_date ? d.deal_date.slice(0, 10) : "—"}</td>
                        <td>{(+d.total_price).toLocaleString()} 萬</td>
                        <td>{d.unit_price ? (+d.unit_price).toFixed(1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {bldgPopup.deals && bldgPopup.deals.length > 8 && (
                <div className="note">僅列最近 8 筆(共 {bldgPopup.deals.length} 筆)</div>
              )}
              <button className="detailbtn" onClick={() => openDrawer(bldgPopup.addr_key)}>
                查看詳情(走勢與全部成交)→
              </button>
            </div>
          </Popup>
        )}
      </Map>

      {drawerAddr && <BuildingDrawer addrKey={drawerAddr} zones={zones} onClose={closeDrawer} />}

      <div id="topbar">
        <span className="title">桃園房價投報地圖</span>
        <div className="toggle" role="group" title="中古=屋齡8年內住宅(與租金推估池同屋齡帶)">
          <button className={market === "presale" ? "on" : ""} onClick={() => { setMarket("presale"); }}>預售</button>
          <button className={market === "resale" ? "on" : ""} onClick={() => { setMarket("resale"); setPopup(null); }}>中古</button>
        </div>
        <div className="toggle" role="group" title="租金投報比以市場租賃行情推估(不含社宅包租代管件)">
          <button className={metric === "price" ? "on" : ""} onClick={() => setMetric("price")}>看單價</button>
          <button className={metric === "roi" ? "on" : ""} onClick={() => setMetric("roi")}>看租金投報比</button>
        </div>
      </div>
      {detail && <button className="backbtn" onClick={back}>← 返回全市</button>}
      {!detail && <div className="zoomhint">滾輪放大或點擊行政區,可看建案與中古成交點位</div>}
    </div>
  );
}
